import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { buildSignatureHeader } from '@/lib/partner/webhook-signature'

/**
 * POST /api/admin/configurator/integration/test-outbound
 *
 * B2B-06 (docs/specs/B2B-06-requirement-document.md Section 4.B.6,
 * architecture.md §18.10). Sends one synchronous, synthetic signed POST to
 * the partner's own `{outbound_base_url}/webhooks/usage` endpoint — the same
 * path `attemptDispatch()` (lib/partner/webhooks.ts) posts real events to —
 * signed with the account's real `outbound_signing_secret` via the existing,
 * unmodified `buildSignatureHeader()`, so a success genuinely proves the
 * partner's receiver can verify Clio's real signature, not a stub.
 *
 * Deliberately never writes to `webhook_dispatch_log` — this is a synchronous,
 * ephemeral test call, not a queued/audited billing event. Always returns 200
 * from this route regardless of the outbound call's own outcome; the outbound
 * result is reported in the response payload's own `success`/`error` fields.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const partnerAccountId = body?.partner_account_id
  if (!partnerAccountId) {
    return NextResponse.json({ error: 'partner_account_id is required' }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('outbound_base_url, outbound_signing_secret')
    .eq('id', partnerAccountId)
    .maybeSingle()

  if (!account?.outbound_base_url || !account?.outbound_signing_secret) {
    return NextResponse.json(
      { error: { code: 'outbound_not_configured', message: 'Set your outbound base URL and signing secret first.' } },
      { status: 422 }
    )
  }

  const payload = {
    event_id: `test-${crypto.randomUUID()}`,
    event_type: 'webhook.test',
    occurred_at: new Date().toISOString(),
    test: true,
  }
  const rawBody = JSON.stringify(payload)
  const signature = buildSignatureHeader(account.outbound_signing_secret as string, rawBody)
  const url = `${(account.outbound_base_url as string).replace(/\/$/, '')}/webhooks/usage`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Clio-Signature': signature },
      body: rawBody,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    return NextResponse.json({
      success: res.ok,
      status_code: res.status,
      ...(res.ok ? {} : { error: `Received HTTP ${res.status}.` }),
    })
  } catch {
    return NextResponse.json({
      success: false,
      status_code: null,
      error: 'Could not reach the endpoint (timeout or connection refused).',
    })
  }
}
