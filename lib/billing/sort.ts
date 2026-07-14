/**
 * B2B-04 — architecture.md §13.6, the days_remaining sort comparator
 * (literal). Pure functions only, no DB/server imports — this file is safe
 * to import from a Client Component (PartnerBillingClient's column-header
 * re-sort) as well as from server routes. Kept separate from
 * lib/billing/metrics.ts (which pulls in lib/supabase.ts and is
 * server-only) for exactly that reason.
 */

export type DaysRemainingNullReason = 'exhausted_balance' | 'no_burn_rate' | null

export interface DaysRemainingSortable {
  name: string
  projected_days_remaining: number | null
  days_remaining_null_reason: DaysRemainingNullReason
}

export function sortKey(row: Pick<DaysRemainingSortable, 'projected_days_remaining' | 'days_remaining_null_reason'>): number {
  if (row.days_remaining_null_reason === 'exhausted_balance') return -Infinity
  if (row.days_remaining_null_reason === 'no_burn_rate') return Infinity
  return row.projected_days_remaining as number // finite, real value
}

export function sortByDaysRemaining<T extends DaysRemainingSortable>(rows: T[], direction: 'asc' | 'desc'): T[] {
  const withKeys = rows.map((r) => ({ row: r, key: sortKey(r), name: r.name }))
  withKeys.sort((a, b) => {
    if (a.key !== b.key) return direction === 'asc' ? a.key - b.key : b.key - a.key
    return a.name.localeCompare(b.name) // deterministic secondary key, same for both directions
  })
  return withKeys.map((w) => w.row)
}
