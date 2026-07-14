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

  const supabase = createSupabaseAdminClient()
  const { data: session } = await supabase
    .from('partner_sessions')
    .select('id, status, created_at, ended_at')
    .eq('id', params.clio_session_ref)
    .eq('partner_account_id', auth.partnerAccountId)
    .maybeSingle()

  if (!session) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Session not found.' } }, { status: 404 })
  }

  return NextResponse.json({
    clio_session_ref: session.id,
    status: session.status,
    created_at: session.created_at,
    ended_at: session.ended_at,
  })
}
