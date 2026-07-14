import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { auth as clerkAuth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { hashApiKey, looksLikePartnerApiKey } from './api-keys'
import { checkRateLimit, type RateLimitClass } from './rate-limit'

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
  apiKeyId: string
  mode: 'test' | 'live'
}

type PartnerApiKeyResult =
  | (PartnerApiKeyContext & { error: null })
  | { partnerAccountId: null; apiKeyId: null; mode: null; error: NextResponse }

/**
 * Authenticates a `/api/partner/v1/*` request via `Authorization: Bearer
 * clio_live_sk_...` (or `clio_test_sk_...`). Section 4/8 of the requirement
 * doc: 401 for missing/malformed/unrecognized/revoked keys, 403 for a
 * suspended partner account. `last_used_at` is updated best-effort
 * (fire-and-forget, never blocks the response) per architecture.md Section
 * 10. Also enforces the per-partner-account rate limit for the given route
 * class (Section 10) — 429 with `Retry-After` on exceed.
 */
export async function requirePartnerApiKey(
  request: NextRequest,
  routeClass: RateLimitClass
): Promise<PartnerApiKeyResult> {
  const authHeader = request.headers.get('authorization') ?? ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  const rawKey = match?.[1]?.trim()

  if (!rawKey || !looksLikePartnerApiKey(rawKey)) {
    return {
      partnerAccountId: null,
      apiKeyId: null,
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
      mode: null,
      error: NextResponse.json(errorEnvelope('invalid_api_key', 'API key not recognized.'), { status: 401 }),
    }
  }

  if (keyRow.status !== 'active') {
    return {
      partnerAccountId: null,
      apiKeyId: null,
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
      mode: null,
      error: NextResponse.json(errorEnvelope('account_suspended', 'This partner account is suspended.'), { status: 403 }),
    }
  }

  const rateLimit = checkRateLimit(accountRow.id, routeClass)
  if (!rateLimit.allowed) {
    const res = NextResponse.json(errorEnvelope('rate_limit_exceeded', 'Rate limit exceeded.'), { status: 429 })
    res.headers.set('Retry-After', String(rateLimit.retryAfterSeconds))
    return { partnerAccountId: null, apiKeyId: null, mode: null, error: res }
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

  return { clerkUserId: userId, error: null }
}
