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
 */
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
    if (error || !data) return { state: 'healthy', balance_usd: null, next_billing_date: null }

    const balance_usd = data.balance_usd != null ? Number(data.balance_usd) : null
    const next_billing_date = data.next_billing_date ?? null

    if (data.plan_status === 'past_due') return { state: 'past_due', balance_usd, next_billing_date }
    if (data.plan_status === 'canceled') return { state: 'canceled', balance_usd, next_billing_date }
    if (data.low_balance_alert_fired_at) return { state: 'low_balance', balance_usd, next_billing_date }
    return { state: 'healthy', balance_usd, next_billing_date }
  } catch {
    return { state: 'healthy', balance_usd: null, next_billing_date: null }
  }
}
