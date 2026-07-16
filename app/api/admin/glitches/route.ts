import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/admin/glitches?partner_account_id=&type=
 *
 * B2B-09 Requirement Doc §4.B.6 / architecture.md §16.8 — backs Panel 2
 * ("All Glitches") of `/dashboard/admin/glitches`. Clerk-authenticated only,
 * same boundary as `/api/admin/glitches/summary` and the existing
 * `/api/admin/billing/clients` precedent.
 *
 * One row per individual glitch (a session with 3 glitches produces 3 rows).
 * Reads `partner_session_insights` (`.not('glitches', 'is', null)`, optional
 * `partner_account_id` filter applied in SQL), then unnests the per-row JSONB
 * `glitches` array and applies the optional `type` filter in application
 * code — arrays are small (typically 0-3 glitches per session), so a second
 * SQL function is not warranted purely for row-level filtering (architecture.md
 * §16.8). Sorted by `extracted_at` descending.
 */

const QuerySchema = z.object({
  partner_account_id: z.string().uuid().optional(),
  type: z.enum(['misunderstanding', 'repetition', 'confusion_about_clio', 'derailment', 'other']).optional(),
})

interface GlitchElement {
  type: string
  description?: string
}

interface InsightsRow {
  partner_session_id: string
  partner_account_id: string
  glitches: GlitchElement[] | null
  full_detail_purged_at: string | null
  extracted_at: string
  partner_accounts: { name: string } | { name: string }[]
}

export async function GET(request: NextRequest) {
  const { error } = requireAuth()
  if (error) return error

  const parsed = QuerySchema.safeParse({
    partner_account_id: request.nextUrl.searchParams.get('partner_account_id') ?? undefined,
    type: request.nextUrl.searchParams.get('type') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { partner_account_id: partnerAccountId, type: typeFilter } = parsed.data

  const supabase = createSupabaseAdminClient()

  let query = supabase
    .from('partner_session_insights')
    .select(
      'partner_session_id, partner_account_id, glitches, full_detail_purged_at, extracted_at, partner_accounts!inner(name)'
    )
    .not('glitches', 'is', null)
    .order('extracted_at', { ascending: false })

  if (partnerAccountId) {
    query = query.eq('partner_account_id', partnerAccountId)
  }

  const { data, error: queryError } = await query

  if (queryError) {
    console.error('[admin/glitches] Failed to load glitch drill-down data:', queryError.message)
    return NextResponse.json({ error: "Couldn't load glitch data." }, { status: 500 })
  }

  const glitches = ((data ?? []) as unknown as InsightsRow[]).flatMap((row) => {
    const partnerAccount = Array.isArray(row.partner_accounts) ? row.partner_accounts[0] : row.partner_accounts
    const partnerName = partnerAccount?.name ?? ''
    const fullDetailPurged = row.full_detail_purged_at !== null

    return (row.glitches ?? [])
      .filter((g) => !typeFilter || g.type === typeFilter)
      .map((g) => ({
        partner_session_id: row.partner_session_id,
        partner_account_id: row.partner_account_id,
        partner_name: partnerName,
        glitch_type: g.type,
        description: g.description ?? null,
        full_detail_purged: fullDetailPurged,
        extracted_at: row.extracted_at,
      }))
  })

  return NextResponse.json({ glitches })
}
