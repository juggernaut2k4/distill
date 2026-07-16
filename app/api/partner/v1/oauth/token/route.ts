import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { hashClientSecret, signAccessToken } from '@/lib/partner/oauth'
import { checkRateLimit } from '@/lib/partner/rate-limit'

/**
 * POST /api/partner/v1/oauth/token
 *
 * RFC 6749 §4.4 Client Credentials grant. B2B-06 — the v1/day-one self-serve
 * default credential mechanism (docs/specs/B2B-06-requirement-document.md
 * Section 4.B.2, architecture.md §18.4).
 *
 * Deliberately accepts `application/x-www-form-urlencoded` (the RFC 6749
 * §4.4.2 standard body shape) as the primary form, with a JSON-body fallback
 * for callers that don't send form-encoded bodies — matching the Requirement
 * Doc's explicit reasoning for building this endpoint at all (a real
 * enterprise-compliance checkbox; off-the-shelf OAuth2 client libraries send
 * form-encoded by default). This is the one route in this codebase that uses
 * the RFC's own `error`/`error_description` shape rather than the usual
 * `{ error: { code, message, request_id } }` envelope — matching the RFC
 * §5.2 error contract on purpose.
 */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? ''
  let grantType: string | null
  let clientId: string | null
  let clientSecret: string | null

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(await request.text())
    grantType = form.get('grant_type')
    clientId = form.get('client_id')
    clientSecret = form.get('client_secret')
  } else {
    const body = await request.json().catch(() => ({}))
    grantType = body.grant_type ?? null
    clientId = body.client_id ?? null
    clientSecret = body.client_secret ?? null
  }

  if (grantType !== 'client_credentials' || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'grant_type must be client_credentials.' },
      { status: 400 }
    )
  }

  const rateLimit = checkRateLimit(clientId, 'oauth_token')
  if (!rateLimit.allowed) {
    const res = NextResponse.json(
      { error: 'invalid_request', error_description: 'Rate limit exceeded.' },
      { status: 429 }
    )
    res.headers.set('Retry-After', String(rateLimit.retryAfterSeconds))
    return res
  }

  const supabase = createSupabaseAdminClient()
  const { data: clientRow } = await supabase
    .from('partner_oauth_clients')
    .select('id, partner_account_id, mode, status, client_secret_hash, client_id')
    .eq('client_id', clientId)
    .maybeSingle()

  // Never distinguishes "unknown client_id" from "wrong secret" from "revoked" in the response body
  // (timing-and-enumeration-safe) — mirrors requirePartnerApiKey()'s existing discipline.
  if (!clientRow || clientRow.status !== 'active' || clientRow.client_secret_hash !== hashClientSecret(clientSecret)) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Client authentication failed.' },
      { status: 401 }
    )
  }

  const { data: accountRow } = await supabase
    .from('partner_accounts')
    .select('id, status')
    .eq('id', clientRow.partner_account_id)
    .maybeSingle()

  if (!accountRow || accountRow.status !== 'active') {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'This partner account is suspended.' },
      { status: 403 }
    )
  }

  const { token, expiresIn } = signAccessToken(clientRow.client_id as string, accountRow.id, clientRow.mode as 'test' | 'live')

  // Best-effort, non-blocking — mirrors the static-key path's own last_used_at update.
  supabase
    .from('partner_oauth_clients')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', clientRow.id)
    .then(undefined, (err: unknown) => console.error('[oauth/token] last_used_at update failed (non-fatal):', err))

  return NextResponse.json({ access_token: token, token_type: 'Bearer', expires_in: expiresIn })
}
