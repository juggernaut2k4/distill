import { NextResponse } from 'next/server'
import { requireInternalAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/admin/glitches/summary
 *
 * B2B-09 Requirement Doc §4.B.5 / architecture.md §16.8 — backs Panel 1
 * ("Glitch Patterns") of `/dashboard/admin/glitches`.
 *
 * One row per distinct (glitch type, partner) combination, aggregated
 * entirely in SQL via `glitch_summary_by_type_and_partner()` (migration 078)
 * — no application-level aggregation beyond the B2B-21 sales-partner filter
 * below.
 *
 * B2B-21 Requirement Doc §6.3 — a scoped sales-partner only sees summary
 * rows for their tagged partner accounts (the RPC already returns
 * partner_account_id per row, so this filters the result set rather than
 * altering the RPC).
 */
export async function GET() {
  const admin = await requireInternalAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  const { data, error: rpcError } = await supabase.rpc('glitch_summary_by_type_and_partner')

  if (rpcError) {
    console.error('[admin/glitches/summary] Failed to load glitch summary:', rpcError.message)
    return NextResponse.json({ error: "Couldn't load glitch data." }, { status: 500 })
  }

  const rows = (data ?? []) as Array<{ partner_account_id: string }>
  const summary =
    admin.role === 'sales_partner' ? rows.filter((row) => admin.scopedPartnerAccountIds.includes(row.partner_account_id)) : rows

  return NextResponse.json({ summary })
}
