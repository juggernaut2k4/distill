import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/admin/glitches/summary
 *
 * B2B-09 Requirement Doc §4.B.5 / architecture.md §16.8 — backs Panel 1
 * ("Glitch Patterns") of `/dashboard/admin/glitches`. Clerk-authenticated
 * only, matching the exact authorization boundary of the existing
 * `/api/admin/billing/clients` precedent (any signed-in Clerk user, not
 * partner-scoped, not a partner API key).
 *
 * One row per distinct (glitch type, partner) combination, aggregated
 * entirely in SQL via `glitch_summary_by_type_and_partner()` (migration 078)
 * — no application-level aggregation.
 */
export async function GET() {
  const { error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data, error: rpcError } = await supabase.rpc('glitch_summary_by_type_and_partner')

  if (rpcError) {
    console.error('[admin/glitches/summary] Failed to load glitch summary:', rpcError.message)
    return NextResponse.json({ error: "Couldn't load glitch data." }, { status: 500 })
  }

  return NextResponse.json({ summary: data ?? [] })
}
