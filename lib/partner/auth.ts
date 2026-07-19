import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { auth as clerkAuth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { hashApiKey, looksLikePartnerApiKey } from './api-keys'
import { checkRateLimit, type RateLimitClass } from './rate-limit'
import { looksLikeOAuthAccessToken, verifyAccessToken } from './oauth'
import { getChannelPartnerAccountForClerkUser } from './admin-accounts'

/**
 * B2B-02 — Two Auth Systems, kept structurally separate (architecture.md
 * Section 1). This file owns ONLY the partner-API-key direction
 * (`requirePartnerApiKey`, for everything under `/api/partner/v1/*`) and the
 * Clerk-partner-admin direction (`requirePartnerAdmin`, for
 * `/api/admin/partner-keys*` and `/api/admin/partner-accounts/*`). Neither
 * function is ever a valid credential path for the other's routes — there is
 * no shared code between them beyond the error-envelope helper.
 */

export interface PartnerErrorBody {
  error: { code: string; message: string; request_id: string }
}

function errorEnvelope(code: string, message: string): PartnerErrorBody {
  return { error: { code, message, request_id: crypto.randomUUID() } }
}

export interface PartnerApiKeyContext {
  partnerAccountId: string
  /** Set for a static-API-key-authenticated request (the partner_api_keys.id row). Null for OAuth2. */
  apiKeyId: string | null
  /** Set for an OAuth2-authenticated request (the partner_oauth_clients.id row, NOT the public
   *  client_id string). Null for a static-API-key request. Exactly one of apiKeyId/clientId is ever
   *  non-null on a successful result — mirrors partner_sessions' own auth-credential CHECK
   *  constraint (migration 079) that this field pair exists specifically to satisfy. B2B-06,
   *  architecture.md §18.3. */
  clientId: string | null
  mode: 'test' | 'live'
}

type PartnerApiKeyResult =
  | (PartnerApiKeyContext & { error: null })
  | { partnerAccountId: null; apiKeyId: null; clientId: null; mode: null; error: NextResponse }

/**
 * Authenticates a `/api/partner/v1/*` request via `Authorization: Bearer
 * clio_live_sk_...` / `clio_test_sk_...` (static partner API key) OR a
 * short-lived OAuth2 Client Credentials access token minted by `POST
 * /api/partner/v1/oauth/token` (B2B-06). Section 4/8 of the requirement doc:
 * 401 for missing/malformed/unrecognized/revoked/expired credentials, 403 for
 * a suspended partner account. `last_used_at` is updated best-effort
 * (fire-and-forget, never blocks the response) per architecture.md Section
 * 10. Also enforces the per-partner-account rate limit for the given route
 * class (Section 10) — 429 with `Retry-After` on exceed.
 *
 * Zero changes to callers — every existing call site keeps calling this
 * exactly as before; only the returned context shape gained `clientId`
 * (docs/specs/B2B-06-requirement-document.md Section 4.B.2 point 3).
 */
export async function requirePartnerApiKey(
  request: NextRequest,
  routeClass: RateLimitClass
): Promise<PartnerApiKeyResult> {
  const authHeader = request.headers.get('authorization') ?? ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  const rawKey = match?.[1]?.trim()

  if (!rawKey || !looksLikePartnerApiKey(rawKey)) {
    // B2B-06 — fall through to OAuth2 access-token verification before giving up.
    if (rawKey && looksLikeOAuthAccessToken(rawKey)) {
      const verified = verifyAccessToken(rawKey)
      if (verified.valid) {
        const supabase = createSupabaseAdminClient()

        const { data: clientRow } = await supabase
          .from('partner_oauth_clients')
          .select('id, status')
          .eq('client_id', verified.claims.sub)
          .maybeSingle()

        const { data: accountRow } = await supabase
          .from('partner_accounts')
          .select('id, status')
          .eq('id', verified.claims.partner_account_id)
          .maybeSingle()

        if (clientRow?.status === 'active' && accountRow) {
          if (accountRow.status !== 'active') {
            return {
              partnerAccountId: null,
              apiKeyId: null,
              clientId: null,
              mode: null,
              error: NextResponse.json(errorEnvelope('account_suspended', 'This partner account is suspended.'), { status: 403 }),
            }
          }

          const rateLimit = checkRateLimit(accountRow.id, routeClass)
          if (!rateLimit.allowed) {
            const res = NextResponse.json(errorEnvelope('rate_limit_exceeded', 'Rate limit exceeded.'), { status: 429 })
            res.headers.set('Retry-After', String(rateLimit.retryAfterSeconds))
            return { partnerAccountId: null, apiKeyId: null, clientId: null, mode: null, error: res }
          }

          // Best-effort, non-blocking — mirrors the static-key path's own last_used_at update.
          supabase
            .from('partner_oauth_clients')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', clientRow.id)
            .then(undefined, (err: unknown) => console.error('[partner/auth] oauth last_used_at update failed (non-fatal):', err))

          // clientId is the partner_oauth_clients row id (clientRow.id) — the FK value
          // app/api/partner/v1/sessions/route.ts writes into partner_sessions.partner_oauth_client_id,
          // exactly parallel to how apiKeyId already carries keyRow.id, not the raw key string.
          return {
            partnerAccountId: accountRow.id,
            apiKeyId: null,
            clientId: clientRow.id,
            mode: verified.claims.mode,
            error: null,
          }
        }
      }
    }

    return {
      partnerAccountId: null,
      apiKeyId: null,
      clientId: null,
      mode: null,
      error: NextResponse.json(errorEnvelope('invalid_api_key', 'Missing or malformed API key.'), { status: 401 }),
    }
  }

  const keyHash = hashApiKey(rawKey)
  const supabase = createSupabaseAdminClient()

  const { data: keyRow } = await supabase
    .from('partner_api_keys')
    .select('id, partner_account_id, mode, status')
    .eq('key_hash', keyHash)
    .maybeSingle()

  if (!keyRow) {
    return {
      partnerAccountId: null,
      apiKeyId: null,
      clientId: null,
      mode: null,
      error: NextResponse.json(errorEnvelope('invalid_api_key', 'API key not recognized.'), { status: 401 }),
    }
  }

  if (keyRow.status !== 'active') {
    return {
      partnerAccountId: null,
      apiKeyId: null,
      clientId: null,
      mode: null,
      error: NextResponse.json(errorEnvelope('revoked_api_key', 'This API key has been revoked.'), { status: 401 }),
    }
  }

  const { data: accountRow } = await supabase
    .from('partner_accounts')
    .select('id, status')
    .eq('id', keyRow.partner_account_id)
    .maybeSingle()

  if (!accountRow || accountRow.status !== 'active') {
    return {
      partnerAccountId: null,
      apiKeyId: null,
      clientId: null,
      mode: null,
      error: NextResponse.json(errorEnvelope('account_suspended', 'This partner account is suspended.'), { status: 403 }),
    }
  }

  const rateLimit = checkRateLimit(accountRow.id, routeClass)
  if (!rateLimit.allowed) {
    const res = NextResponse.json(errorEnvelope('rate_limit_exceeded', 'Rate limit exceeded.'), { status: 429 })
    res.headers.set('Retry-After', String(rateLimit.retryAfterSeconds))
    return { partnerAccountId: null, apiKeyId: null, clientId: null, mode: null, error: res }
  }

  // Best-effort, non-blocking — never delays or fails the response (architecture.md Section 10).
  supabase
    .from('partner_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRow.id)
    .then(undefined, (err: unknown) => console.error('[partner/auth] last_used_at update failed (non-fatal):', err))

  return {
    partnerAccountId: accountRow.id,
    apiKeyId: keyRow.id,
    clientId: null,
    mode: keyRow.mode as 'test' | 'live',
    error: null,
  }
}

type PartnerAdminResult =
  | { clerkUserId: string; error: null }
  | { clerkUserId: null; error: NextResponse }

/**
 * Authenticates a Clerk-authenticated partner-admin human and verifies they
 * administer the given `partner_account_id` (a `partner_admin_users` row
 * must exist for the pair). 401 if no Clerk session at all, 403 if the
 * session is valid but the user has no membership on this partner account —
 * matching Section 8's "Partner-admin lacks permission" row exactly.
 */
export async function requirePartnerAdmin(partnerAccountId: string): Promise<PartnerAdminResult> {
  const { userId } = clerkAuth()
  if (!userId) {
    return { clerkUserId: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const supabase = createSupabaseAdminClient()
  const { data: membership } = await supabase
    .from('partner_admin_users')
    .select('id')
    .eq('clerk_user_id', userId)
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  if (!membership) {
    return {
      clerkUserId: null,
      error: NextResponse.json(errorEnvelope('forbidden', 'You do not administer this partner account.'), { status: 403 }),
    }
  }

  // B2B-26 §6.14 (v1.2 chokepoint fix) — runs only after the existing
  // membership check succeeds (adds exactly one query on the
  // already-authorized path, none on the unauthorized path). Provably a
  // no-op for every account_kind='partner' row — the column's own default,
  // i.e. every direct partner past and future — since only account_kind=
  // 'channel_partner' is newly rejected here, and only from this one place.
  // Same 403 shape as the missing-membership case above, deliberately
  // indistinguishable (no info leak about *why*, matching this codebase's
  // existing no-info-leak convention). This closes the entire 42-route
  // `requirePartnerAdmin`-gated surface (billing, go-live, content
  // generation, API keys, OAuth clients, and any future route that adopts
  // this function) to a channel-partner-kind account id, present and future
  // — see docs/specs/B2B-26-requirement-document.md §6.14/§9 Edge Case 3 for
  // the full reasoning behind fixing this at the chokepoint.
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('account_kind')
    .eq('id', partnerAccountId)
    .maybeSingle()

  if (account?.account_kind === 'channel_partner') {
    return {
      clerkUserId: null,
      error: NextResponse.json(errorEnvelope('forbidden', 'You do not administer this partner account.'), { status: 403 }),
    }
  }

  return { clerkUserId: userId, error: null }
}

type ChannelPartnerAdminResult =
  | { clerkUserId: string; partnerAccountId: string; error: null }
  | { clerkUserId: null; partnerAccountId: null; error: NextResponse }

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §6.6). Parallel to
 * `requirePartnerAdmin`, not a variant of it — requires the caller to
 * administer a `partner_accounts` row that is SPECIFICALLY
 * `account_kind='channel_partner'`. 401 no session, 403 no membership OR the
 * membership exists but the account is `account_kind='partner'` (a direct
 * partner's own admin can never reach a channel-partner-only route, even for
 * their own account — these are disjoint route trees). Takes no
 * `partnerAccountId` parameter, unlike `requirePartnerAdmin` — every
 * `/api/channel-partner/*` route acts on "the caller's own channel-partner
 * account," resolved from the session, never from a client-supplied id
 * (there is exactly one such account per user).
 */
export async function requireChannelPartnerAdmin(): Promise<ChannelPartnerAdminResult> {
  const { userId } = clerkAuth()
  if (!userId) {
    return { clerkUserId: null, partnerAccountId: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const account = await getChannelPartnerAccountForClerkUser(userId)
  if (!account) {
    return {
      clerkUserId: null,
      partnerAccountId: null,
      error: NextResponse.json(errorEnvelope('forbidden', 'You do not administer a sales-partner account.'), { status: 403 }),
    }
  }
  return { clerkUserId: userId, partnerAccountId: account.id, error: null }
}
