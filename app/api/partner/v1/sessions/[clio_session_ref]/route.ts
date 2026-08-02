import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerApiKey } from '@/lib/partner/auth'

/**
 * GET /api/partner/v1/sessions/:clio_session_ref
 *
 * docs/specs/B2B-02-requirement-document.md Section 4.2: never includes
 * `provider_bot_id`, `provider_name`, `meeting_url`, or any opaque reference
 * the caller didn't already supply. A ref that doesn't exist and a ref that
 * belongs to a different partner are deliberately indistinguishable (both
 * 404) — this is enforced structurally by scoping the query to the
 * authenticated `partner_account_id`, not by a separate ownership check.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Params {
  params: { clio_session_ref: string }
}

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requirePartnerApiKey(request, 'reads')
  if (auth.error) return auth.error

  if (!UUID_RE.test(params.clio_session_ref)) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Session not found.' } }, { status: 404 })
  }

  // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project (root cause doc
  // comment in app/api/demo/[slug]/performance/route.ts); replaced with a plain array fetch + [0].
  const supabase = createSupabaseAdminClient()
  const { data: sessionRows } = await supabase
    .from('partner_sessions')
    // B2B-38 (docs/specs/B2B-38-requirement-document.md §6.10) — extended to include
    // reseller_unique_id, echoed back below when the session was created with one.
    .select('id, status, created_at, ended_at, reseller_unique_id')
    .eq('id', params.clio_session_ref)
    .eq('partner_account_id', auth.partnerAccountId)
    .limit(1)

  const session = sessionRows?.[0] ?? null

  if (!session) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Session not found.' } }, { status: 404 })
  }

  return NextResponse.json({
    clio_session_ref: session.id,
    status: session.status,
    created_at: session.created_at,
    ended_at: session.ended_at,
    // B2B-38 §6.10 — present only when the session was created with a reseller_unique_id (same
    // conditional-inclusion convention as the POST response). reseller_id/client_id/hume_config_id
    // deliberately not added here — see §6.10.
    ...(session.reseller_unique_id ? { reseller_unique_id: session.reseller_unique_id } : {}),
  })
}
