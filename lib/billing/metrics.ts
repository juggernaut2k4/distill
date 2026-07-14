import { createSupabaseAdminClient } from '@/lib/supabase'
import type { DaysRemainingNullReason } from './sort'

export type { DaysRemainingNullReason, DaysRemainingSortable } from './sort'
export { sortKey, sortByDaysRemaining } from './sort'

/**
 * B2B-04 — shared burn-rate/projection formula, used by both
 * `GET /api/admin/billing/clients` and `GET /api/partner/v1/wallet`
 * (Requirement Doc Section 4.B.1/4.B.2).
 *
 * Server-only (pulls in lib/supabase.ts, which uses next/headers) — the
 * days_remaining sort comparator this file re-exports for convenience lives
 * in lib/billing/sort.ts, which has no server-only imports and is safe for
 * PartnerBillingClient (a Client Component) to import directly.
 *
 * Kept in one shared module deliberately — Requirement Doc Section 4.B.2's
 * compatibility note requires both endpoints to produce byte-identical
 * numbers for the same account ("never a divergent computation"), which is
 * only guaranteed by both callers running the exact same code, not two
 * independent implementations of the same formula.
 */

export interface BurnRateProjection {
  avg_daily_burn_usd: number | null
  projected_days_remaining: number | null
  days_remaining_null_reason: DaysRemainingNullReason
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function truncToUtcMidnight(date: Date): Date {
  const truncated = new Date(date)
  truncated.setUTCHours(0, 0, 0, 0)
  return truncated
}

/**
 * architecture.md §13.5 — trailing 7 complete UTC calendar days, current
 * partial day always excluded. `walletCreatedAt` is `partner_wallets.created_at`
 * (or `null` if no wallet row exists yet — a partner with no wallet has never
 * had a decrement or credit, so this short-circuits to `no_burn_rate` without
 * a query, matching the "brand-new account, zero complete days elapsed"
 * edge case in Requirement Doc Section 9).
 */
export async function computeBurnRateProjection(params: {
  partnerAccountId: string
  walletCreatedAt: string | null
  balanceUsd: number
}): Promise<BurnRateProjection> {
  if (!params.walletCreatedAt) {
    return { avg_daily_burn_usd: null, projected_days_remaining: null, days_remaining_null_reason: 'no_burn_rate' }
  }

  const windowEnd = truncToUtcMidnight(new Date())
  const windowStart = new Date(windowEnd.getTime() - 7 * MS_PER_DAY)
  const accountStart = truncToUtcMidnight(new Date(params.walletCreatedAt))
  const effectiveStart = accountStart > windowStart ? accountStart : windowStart
  const daysInWindow = Math.max(0, Math.round((windowEnd.getTime() - effectiveStart.getTime()) / MS_PER_DAY))

  if (daysInWindow === 0) {
    // Wallet created today — no complete day has passed yet. Identical
    // treatment to "no billed usage" (Requirement Doc Section 9).
    return { avg_daily_burn_usd: null, projected_days_remaining: null, days_remaining_null_reason: 'no_burn_rate' }
  }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('usage_events')
    .select('amount_usd')
    .eq('partner_account_id', params.partnerAccountId)
    .eq('billed', true)
    .gte('occurred_at', effectiveStart.toISOString())
    .lt('occurred_at', windowEnd.toISOString())

  if (error) {
    console.error('[billing/metrics] burn-rate aggregate query failed:', error.message)
    return { avg_daily_burn_usd: null, projected_days_remaining: null, days_remaining_null_reason: 'no_burn_rate' }
  }

  const windowTotalUsd = (data ?? []).reduce((sum, row) => sum + Number(row.amount_usd ?? 0), 0)

  if (windowTotalUsd === 0) {
    return { avg_daily_burn_usd: null, projected_days_remaining: null, days_remaining_null_reason: 'no_burn_rate' }
  }

  const avgDailyBurnUsd = windowTotalUsd / daysInWindow

  if (params.balanceUsd <= 0) {
    return { avg_daily_burn_usd: avgDailyBurnUsd, projected_days_remaining: null, days_remaining_null_reason: 'exhausted_balance' }
  }

  return {
    avg_daily_burn_usd: avgDailyBurnUsd,
    projected_days_remaining: params.balanceUsd / avgDailyBurnUsd,
    days_remaining_null_reason: null,
  }
}
