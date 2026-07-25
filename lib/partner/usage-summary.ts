import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-34 Piece 3 (docs/specs/B2B-34-requirement-document.md Part E §6.1) —
 * minutes-usage aggregation for the super-admin `/dashboard/admin/sales-partners`
 * roster and detail page. Read-only, sourced from `usage_events` only — never
 * `wallet_ledger`/`balance_usd` (Part E §10).
 *
 * Aggregation happens in application code rather than PostgREST aggregate/
 * group-by syntax — mirrors this codebase's existing pattern (see
 * lib/billing/metrics.ts computeBurnRateProjection(), and this same route's
 * own pre-existing clientCounts/teamCounts Map-building in
 * app/api/admin/sales-partners/route.ts) rather than introducing a new query
 * style for this one feature.
 *
 * Per Part E §6.1's "Note on partner_account_id scope": every client-
 * attributed usage_events row already carries partner_account_id = the
 * reseller's own id (the authenticating account) — "reseller total = self +
 * all clients combined" requires no UNION, no client-id enumeration; it was
 * always one pool. `end_client_id` is purely the dimension the per-client
 * breakdown groups on, never a second scope to filter partner_account_id by.
 */

const MINUTES_WINDOW_DAYS = 30

/** Exported for tests — the trailing-30-day window boundary as an ISO string. */
export function thirtyDaysAgoIso(now: Date = new Date()): string {
  return new Date(now.getTime() - MINUTES_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

export interface UsageQuantityRow {
  quantity: number | string
}

/**
 * Sums `quantity` across rows and rounds to the nearest whole minute — Part E
 * §4: "no decimals — minutes are summed as whole numbers for this headline
 * figure, rounded."
 */
export function sumMinutes(rows: UsageQuantityRow[]): number {
  const total = rows.reduce((sum, row) => sum + Number(row.quantity), 0)
  return Math.round(total)
}

export interface PartnerAccountQuantityRow {
  partner_account_id: string
  quantity: number | string
}

/**
 * List-page batched aggregation: one summed+rounded total per reseller,
 * mirroring the existing `clientCounts`/`teamCounts` `.in(...)`-batched
 * Map-building pattern in `GET /api/admin/sales-partners`.
 */
export function groupMinutesByPartnerAccount(rows: PartnerAccountQuantityRow[]): Map<string, number> {
  const raw = new Map<string, number>()
  for (const row of rows) {
    raw.set(row.partner_account_id, (raw.get(row.partner_account_id) ?? 0) + Number(row.quantity))
  }
  const rounded = new Map<string, number>()
  raw.forEach((total, id) => rounded.set(id, Math.round(total)))
  return rounded
}

export interface ClientQuantityRow {
  end_client_id: string | null
  quantity: number | string
}

export interface ClientMinutesBreakdown {
  client_id: string
  minutes: number
}

/**
 * Detail-page per-client breakdown: groups by `end_client_id`, sums, rounds,
 * sorts descending by minutes (Part E §4's visual example). Rows with a null
 * `end_client_id` are skipped — Part E §9 confirms this can't actually occur
 * within a reseller's own `partner_account_id` scope ("noted for
 * completeness, not a code branch that needs handling"), so there is
 * deliberately no UI state for it; the grouping itself just stays defensive
 * rather than crashing on an unexpected null.
 */
export function groupMinutesByClient(rows: ClientQuantityRow[]): ClientMinutesBreakdown[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (!row.end_client_id) continue
    totals.set(row.end_client_id, (totals.get(row.end_client_id) ?? 0) + Number(row.quantity))
  }
  return Array.from(totals.entries())
    .map(([client_id, total]) => ({ client_id, minutes: Math.round(total) }))
    .sort((a, b) => b.minutes - a.minutes)
}

/**
 * List page — Part E §6.1's first query, batched across every reseller on
 * the page (not N+1). Falls back to an empty map (→ `minutes_30d: 0` for
 * every row) on any Supabase error, matching this route's own existing
 * `clientCounts`/`teamCounts` graceful-degradation-to-empty-map convention
 * (Part E §8).
 */
export async function getMinutes30dByReseller(resellerIds: string[]): Promise<Map<string, number>> {
  if (resellerIds.length === 0) return new Map()

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('usage_events')
    .select('partner_account_id, quantity')
    .in('partner_account_id', resellerIds)
    .eq('event_type', 'voice_minute')
    .eq('test_mode', false)
    .gte('occurred_at', thirtyDaysAgoIso())

  if (error) {
    console.error('[usage-summary] getMinutes30dByReseller failed:', error.message)
    return new Map()
  }

  return groupMinutesByPartnerAccount((data ?? []) as PartnerAccountQuantityRow[])
}

export interface ResellerUsageSummary {
  /** false whenever any underlying query failed — drives the Usage card's own independent error state (Part E §8). */
  success: boolean
  minutes_30d: number
  minutes_all_time: number
  breakdown: Array<{ client_id: string; client_name: string; minutes: number }>
}

const FAILED_SUMMARY: ResellerUsageSummary = { success: false, minutes_30d: 0, minutes_all_time: 0, breakdown: [] }

/**
 * Detail page — Part E §6.1's second/third/fourth queries (all-time total,
 * 30-day total, per-client 30-day breakdown, then a small bounded
 * `partner_accounts` name lookup — "not a SQL join," matching
 * `lib/partner/clients.ts`'s existing pattern of resolving names via a
 * separate small query). Any failure anywhere in this pipeline returns
 * `success: false` so the caller can render the Usage card's own inline
 * error state independently of the Clients/Team sections (Part E §8).
 */
export async function getResellerUsageSummary(resellerId: string): Promise<ResellerUsageSummary> {
  const supabase = createSupabaseAdminClient()
  const windowStart = thirtyDaysAgoIso()

  const [allTimeResult, windowTotalResult, breakdownResult] = await Promise.all([
    supabase
      .from('usage_events')
      .select('quantity')
      .eq('partner_account_id', resellerId)
      .eq('event_type', 'voice_minute')
      .eq('test_mode', false),
    supabase
      .from('usage_events')
      .select('quantity')
      .eq('partner_account_id', resellerId)
      .eq('event_type', 'voice_minute')
      .eq('test_mode', false)
      .gte('occurred_at', windowStart),
    supabase
      .from('usage_events')
      .select('end_client_id, quantity')
      .eq('partner_account_id', resellerId)
      .eq('event_type', 'voice_minute')
      .eq('test_mode', false)
      .gte('occurred_at', windowStart),
  ])

  if (allTimeResult.error || windowTotalResult.error || breakdownResult.error) {
    console.error(
      '[usage-summary] getResellerUsageSummary usage_events query failed:',
      allTimeResult.error?.message ?? windowTotalResult.error?.message ?? breakdownResult.error?.message
    )
    return FAILED_SUMMARY
  }

  const minutesAllTime = sumMinutes((allTimeResult.data ?? []) as UsageQuantityRow[])
  const minutes30d = sumMinutes((windowTotalResult.data ?? []) as UsageQuantityRow[])
  const breakdownTotals = groupMinutesByClient((breakdownResult.data ?? []) as ClientQuantityRow[])

  if (breakdownTotals.length === 0) {
    return { success: true, minutes_30d: minutes30d, minutes_all_time: minutesAllTime, breakdown: [] }
  }

  const clientIds = breakdownTotals.map((row) => row.client_id)
  const { data: accounts, error: accountsError } = await supabase
    .from('partner_accounts')
    .select('id, name')
    .in('id', clientIds)

  if (accountsError) {
    console.error('[usage-summary] getResellerUsageSummary name lookup failed:', accountsError.message)
    return FAILED_SUMMARY
  }

  const nameById = new Map<string, string>()
  for (const row of accounts ?? []) nameById.set(row.id as string, row.name as string)

  const breakdown = breakdownTotals.map((row) => ({
    client_id: row.client_id,
    client_name: nameById.get(row.client_id) ?? 'Unknown client',
    minutes: row.minutes,
  }))

  return { success: true, minutes_30d: minutes30d, minutes_all_time: minutesAllTime, breakdown }
}
