import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerApiKey } from '@/lib/partner/auth'
import { computeBurnRateProjection } from '@/lib/billing/metrics'

/**
 * GET /api/partner/v1/wallet
 *
 * B2B-04 Requirement Doc Section 4.B.2 — new sibling to
 * `GET /api/partner/v1/usage`, same auth path
 * (`requirePartnerApiKey(request, 'reads')`, same 300 req/min rate-limit
 * class) and same 401/403 error envelope. Balance/burn-rate/days-remaining
 * for the caller's OWN account only — never any field derived from another
 * partner's data.
 *
 * `avg_daily_burn_usd`/`projected_days_remaining`/`days_remaining_null_reason`
 * use the identical formula (lib/billing/metrics.ts) as
 * `GET /api/admin/billing/clients`, so a partner building their own
 * dashboard against this field gets the same numbers Arun sees on the admin
 * page for the same account (Objective 6).
 */

const EVENT_TYPES = [
  'voice_minute',
  'llm_generation_topic',
  'llm_generation_content',
  'llm_generation_prerequisite',
  'llm_generation_skeleton',
  'llm_generation_discovery',
  'llm_generation_sample_fill',
  'llm_generation_new_template',
] as const

const UNIT_BY_EVENT_TYPE: Record<(typeof EVENT_TYPES)[number], 'minute' | 'call'> = {
  voice_minute: 'minute',
  llm_generation_topic: 'call',
  llm_generation_content: 'call',
  llm_generation_prerequisite: 'call',
  llm_generation_skeleton: 'call',
  llm_generation_discovery: 'call',
  llm_generation_sample_fill: 'call',
  llm_generation_new_template: 'call',
}

interface RateRow {
  event_type: string
  rate_usd: string | number
  rate_basis: string
  partner_account_id: string | null
}

export async function GET(request: NextRequest) {
  const auth = await requirePartnerApiKey(request, 'reads')
  if (auth.error) return auth.error

  const supabase = createSupabaseAdminClient()

  const { data: wallet } = await supabase
    .from('partner_wallets')
    .select('balance_usd, reference_topup_amount_usd, low_balance_alert_fired_at, next_billing_date, created_at, updated_at')
    .eq('partner_account_id', auth.partnerAccountId)
    .maybeSingle()

  const balanceUsd = wallet?.balance_usd != null ? Number(wallet.balance_usd) : 0

  const { data: rates } = await supabase
    .from('billing_rate_versions')
    .select('event_type, rate_usd, rate_basis, partner_account_id')
    .is('effective_to', null)
    .or(`partner_account_id.eq.${auth.partnerAccountId},partner_account_id.is.null`)

  // Partner-specific override wins over the platform default for the same event_type.
  const rateByEventType = new Map<string, { rate_usd: number; rate_basis: string }>()
  for (const r of (rates ?? []) as RateRow[]) {
    if (r.partner_account_id === null && !rateByEventType.has(r.event_type)) {
      rateByEventType.set(r.event_type, { rate_usd: Number(r.rate_usd), rate_basis: r.rate_basis })
    }
  }
  for (const r of (rates ?? []) as RateRow[]) {
    if (r.partner_account_id === auth.partnerAccountId) {
      rateByEventType.set(r.event_type, { rate_usd: Number(r.rate_usd), rate_basis: r.rate_basis })
    }
  }

  const burnRateByEventType = EVENT_TYPES.map((eventType) => {
    const resolved = rateByEventType.get(eventType)
    return {
      event_type: eventType,
      unit: UNIT_BY_EVENT_TYPE[eventType],
      rate_usd: resolved?.rate_usd ?? null,
      rate_basis: resolved?.rate_basis ?? null,
    }
  })

  const projection = await computeBurnRateProjection({
    partnerAccountId: auth.partnerAccountId,
    walletCreatedAt: wallet?.created_at ?? null,
    balanceUsd,
  })

  return NextResponse.json({
    balance_usd: balanceUsd,
    reference_topup_amount_usd: wallet?.reference_topup_amount_usd != null ? Number(wallet.reference_topup_amount_usd) : null,
    low_balance_alert_active: !!wallet?.low_balance_alert_fired_at,
    burn_rate_by_event_type: burnRateByEventType,
    avg_daily_burn_usd: projection.avg_daily_burn_usd,
    projected_days_remaining: projection.projected_days_remaining,
    days_remaining_null_reason: projection.days_remaining_null_reason,
    next_billing_date: wallet?.next_billing_date ?? null,
    updated_at: wallet?.updated_at ?? new Date().toISOString(),
  })
}
