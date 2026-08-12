import { createSupabaseAdminClient } from '@/lib/supabase'
import { decryptContentSourceCredential } from './crypto'
import { assertUrlSafe } from './ssrf'

/**
 * B2B-19 — Content-source resolution + outbound-auth header building.
 *
 * A content source is a partner-registered fetch credential (Requirement Doc
 * Section 1.2). Clio replays the resolved credential OUTWARD when fetching the
 * partner's page URLs (SSRF-guarded, see ssrf.ts). Three functional auth types:
 *
 *   - none                        → no header
 *   - static_bearer               → a configurable header (default Authorization: Bearer <token>)
 *   - oauth2_client_credentials   → an RFC 6749 §4.4 client-credentials grant
 *                                   against the PARTNER's own token endpoint
 *                                   (Clio is the CLIENT here, not the issuer —
 *                                   nothing to do with lib/partner/oauth.ts's
 *                                   Clio-as-issuer logic).
 *
 * `presigned_url` / `mtls` are documented enum values rejected at registration;
 * they are never stored, so they never reach this module (a defensive branch
 * still rejects them if somehow encountered).
 */

export type ContentSourceAuthType =
  | 'none'
  | 'static_bearer'
  | 'oauth2_client_credentials'
  | 'presigned_url'
  | 'mtls'

/** The three auth types that are actually built + stored. */
export const SUPPORTED_CONTENT_SOURCE_AUTH_TYPES = ['none', 'static_bearer', 'oauth2_client_credentials'] as const
/** Documented-in-schema but rejected-at-runtime. */
export const REJECTED_CONTENT_SOURCE_AUTH_TYPES = ['presigned_url', 'mtls'] as const

export interface ContentSourceRow {
  id: string
  partnerAccountId: string
  authType: ContentSourceAuthType
  credentialCiphertext: string | null
  oauthTokenUrl: string | null
  oauthScope: string | null
  oauthAudience: string | null
  headerName: string | null
  headerScheme: string | null
}

/**
 * Resolves a content source by id, scoped to the owning partner account
 * (tenant isolation — a source is only ever readable/usable by its owner).
 * Returns null on not-found OR wrong-owner (both surface as
 * `content_source_not_found` at the call site).
 */
export async function getContentSource(
  contentSourceId: string,
  partnerAccountId: string
): Promise<ContentSourceRow | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_content_sources')
    .select('id, partner_account_id, auth_type, credential_ciphertext, oauth_token_url, oauth_scope, oauth_audience, header_name, header_scheme')
    .eq('id', contentSourceId)
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id as string,
    partnerAccountId: data.partner_account_id as string,
    authType: data.auth_type as ContentSourceAuthType,
    credentialCiphertext: (data.credential_ciphertext as string | null) ?? null,
    oauthTokenUrl: (data.oauth_token_url as string | null) ?? null,
    oauthScope: (data.oauth_scope as string | null) ?? null,
    oauthAudience: (data.oauth_audience as string | null) ?? null,
    headerName: (data.header_name as string | null) ?? null,
    headerScheme: (data.header_scheme as string | null) ?? null,
  }
}

// ─── OAuth2 client-credentials outbound token cache ──────────────────────────
// Keyed by content_source_id. In-memory, per warm serverless instance — a cache
// miss simply re-fetches a fresh token, so a cold start is never a correctness
// problem, only one extra token round-trip.
interface CachedToken {
  accessToken: string
  expiresAtMs: number
}
const oauthTokenCache = new Map<string, CachedToken>()

/** Test/dev-only reset. */
export function resetContentSourceOAuthCache(): void {
  oauthTokenCache.clear()
}

/**
 * Acquires (or returns a cached) OAuth2 access token via an RFC 6749 §4.4
 * client-credentials grant against the partner's own token endpoint. Returns
 * null on any failure (SSRF-rejected token_url, network error, non-2xx,
 * malformed response) — the caller degrades the page to `unavailable`, never
 * crashes the render.
 */
async function acquireOAuth2Token(row: ContentSourceRow): Promise<string | null> {
  const cached = oauthTokenCache.get(row.id)
  if (cached && cached.expiresAtMs > Date.now() + 5_000) return cached.accessToken

  if (!row.oauthTokenUrl || !row.credentialCiphertext) return null

  // The token endpoint is partner-controlled and fetched server-side — SSRF-guard it too.
  const safety = await assertUrlSafe(row.oauthTokenUrl)
  if (!safety.ok) {
    console.error('[partner/content-sources] oauth token_url rejected by SSRF gate:', safety.reason)
    return null
  }

  let creds: { client_id?: string; client_secret?: string }
  try {
    creds = JSON.parse(decryptContentSourceCredential(row.credentialCiphertext) ?? '{}')
  } catch {
    return null
  }
  if (!creds.client_id || !creds.client_secret) return null

  const bodyParams = new URLSearchParams({ grant_type: 'client_credentials' })
  if (row.oauthScope) bodyParams.set('scope', row.oauthScope)
  if (row.oauthAudience) bodyParams.set('audience', row.oauthAudience)

  const basic = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(row.oauthTokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
      redirect: 'manual',
      signal: controller.signal,
    })
    if (!res.ok) {
      console.error('[partner/content-sources] oauth token endpoint returned', res.status)
      return null
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token) return null
    const expiresInMs = (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000
    oauthTokenCache.set(row.id, { accessToken: json.access_token, expiresAtMs: Date.now() + expiresInMs })
    return json.access_token
  } catch (err) {
    console.error('[partner/content-sources] oauth token acquisition failed:', err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export type ResolvedHeaders =
  | { status: 'ok'; headers: Record<string, string> }
  | { status: 'unavailable'; reason: string }

/**
 * Resolves the outbound HTTP headers Clio must send when fetching this source's
 * pages. Never throws — a credential-resolution failure degrades to
 * `unavailable` (mirrors pullPartnerContent).
 */
export async function resolveContentSourceHeaders(row: ContentSourceRow): Promise<ResolvedHeaders> {
  switch (row.authType) {
    case 'none':
      return { status: 'ok', headers: {} }

    case 'static_bearer': {
      const token = decryptContentSourceCredential(row.credentialCiphertext)
      if (!token) return { status: 'unavailable', reason: 'bearer credential could not be decrypted' }
      const headerName = row.headerName || 'Authorization'
      const scheme = row.headerScheme ?? 'Bearer'
      const value = scheme ? `${scheme} ${token}` : token
      return { status: 'ok', headers: { [headerName]: value } }
    }

    case 'oauth2_client_credentials': {
      const token = await acquireOAuth2Token(row)
      if (!token) return { status: 'unavailable', reason: 'oauth2 token could not be acquired' }
      return { status: 'ok', headers: { Authorization: `Bearer ${token}` } }
    }

    default:
      // presigned_url / mtls — never stored, defensive only.
      return { status: 'unavailable', reason: `auth_type '${row.authType}' is not supported` }
  }
}
