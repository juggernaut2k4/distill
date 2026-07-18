import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { mapToPartnerStatus, type PartnerBugStatus } from '@/lib/glitches/partner-status'
import { fetchHybridScopedVisibilityRows } from '@/lib/glitches/partner-known-bugs'

/**
 * GET /api/partner/known-bugs/summary?partner_account_id=
 *
 * B2B-22 Requirement Doc §6.4 — the aggregate chart. Computed over the IDENTICAL hybrid scope as the
 * table (§6.3) — table and chart are always perfectly consistent with each other by construction
 * (one shared query shape, `fetchHybridScopedVisibilityRows`). Mirrors the existing
 * /api/admin/glitches + /api/admin/glitches/summary split precedent.
 */

const QuerySchema = z.object({
  partner_account_id: z.string().uuid(),
})

export async function GET(request: NextRequest) {
  const parsed = QuerySchema.safeParse({
    partner_account_id: request.nextUrl.searchParams.get('partner_account_id') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { partner_account_id: partnerAccountId } = parsed.data

  const partnerAuth = await requirePartnerAdmin(partnerAccountId)
  if (partnerAuth.error) return partnerAuth.error

  let rows
  try {
    rows = await fetchHybridScopedVisibilityRows(partnerAccountId)
  } catch (err) {
    console.error('[partner/known-bugs/summary] Failed to load summary:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Couldn't load your bugs — try refreshing." }, { status: 500 })
  }

  const counts: Record<PartnerBugStatus, number> = { open: 0, in_progress: 0, closed: 0 }
  for (const row of rows) {
    counts[mapToPartnerStatus(row.issue_status)] += 1
  }

  return NextResponse.json(counts)
}
