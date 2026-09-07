import { createSupabaseAdminClient } from '@/lib/supabase'
import type { BillingHealth } from './_shared'

/**
 * B2B-16 Requirement Doc Section 4.5 / Section 6 — server read of
 * `partner_wallets` for the billing-health banner. Read-only, fail-open.
 *
 * Priority: the hard-confirmed `plan_status` warning states (`past_due`,
 * `canceled`) take precedence over the secondary informational low-balance
 * state. Low balance is driven off the existing `low_balance_alert_fired_at`
 * signal (migration 075) — NOT an invented numeric threshold (Section 4.5).
 *
 * Fail-open (Error States, Section 8): a missing row, a `NULL`/`active`
 * `plan_status`, or any read error all resolve to `healthy` → no banner. A DB
 * hiccup must never inject a false "past due" warning nor block the page.
 *
 * PRICING-01 (docs/specs/PRICING-01-requirement-document.md §6.5) — once a
 * wallet row is found, an additional read resolves this partner's own
 * effective `voice_minute` rate: a partner-specific open
 * `billing_rate_versions` row wins, else the platform-default open row.
 * This is the same two-step resolution `resolveEffectiveRate()`
 * (lib/partner/webhooks.ts) already performs, reimplemented here as a direct
 * "what's true right now" read (that function takes an `occurredAt` and is
 * designed for the billing-event hot path, not a dashboard read). Fail-open:
 * any error or no rate configured resolves `voice_rate_usd: null`, never
 * blocks the balance/next-billing lines from rendering.
 */
async function getVoiceRateUsd(supabase: ReturnType<typeof createSupabaseAdminClient>, partnerAccountId: string): Promise<number | null> {
  try {
    const { data: partnerRateRows } = await supabase
      .from('billing_rate_versions')
      .select('rate_usd')
      .eq('partner_account_id', partnerAccountId)
      .eq('event_type', 'voice_minute')
      .is('effective_to', null)
      .limit(1)
    const partnerRate = partnerRateRows?.[0] ?? null
    if (partnerRate) return Number(partnerRate.rate_usd)

    const { data: defaultRateRows } = await supabase
      .from('billing_rate_versions')
      .select('rate_usd')
      .is('partner_account_id', null)
      .eq('event_type', 'voice_minute')
      .is('effective_to', null)
      .limit(1)
    const defaultRate = defaultRateRows?.[0] ?? null
    return defaultRate ? Number(defaultRate.rate_usd) : null
  } catch {
    return null
  }
}

export async function getBillingHealth(partnerAccountId: string): Promise<BillingHealth> {
  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('partner_wallets')
      .select('plan_status, low_balance_alert_fired_at, balance_usd, next_billing_date')
      .eq('partner_account_id', partnerAccountId)
      .maybeSingle()

    // B2B-24 §6.3 — no wallet row yet (fail-open branch) is the "No wallet
    // yet" case the Dashboard's Area 3 must render distinctly from a real
    // $0.00 balance: both new fields stay `null` here specifically.
    if (error || !data) return { state: 'healthy', balance_usd: null, next_billing_date: null, voice_rate_usd: null }

    const balance_usd = data.balance_usd != null ? Number(data.balance_usd) : null
    const next_billing_date = data.next_billing_date ?? null
    const voice_rate_usd = await getVoiceRateUsd(supabase, partnerAccountId)

    if (data.plan_status === 'past_due') return { state: 'past_due', balance_usd, next_billing_date, voice_rate_usd }
    if (data.plan_status === 'canceled') return { state: 'canceled', balance_usd, next_billing_date, voice_rate_usd }
    if (data.low_balance_alert_fired_at) return { state: 'low_balance', balance_usd, next_billing_date, voice_rate_usd }
    return { state: 'healthy', balance_usd, next_billing_date, voice_rate_usd }
  } catch {
    return { state: 'healthy', balance_usd: null, next_billing_date: null, voice_rate_usd: null }
  }
}
