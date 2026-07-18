import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { mapToPartnerStatus } from '@/lib/glitches/partner-status'
import { fetchHybridScopedVisibilityRows } from '@/lib/glitches/partner-known-bugs'

/**
 * GET /api/partner/known-bugs?partner_account_id=
 *
 * B2B-22 Requirement Doc §6.4 — the partner-facing Known Bugs table. Scoped per §6.3's hybrid rule
 * (currently visible, OR ever-visible-and-now-Closed). Response whitelist is exhaustive (§7 AT-12):
 * id, status, eta, description, visible_since, comment_count, can_comment — never title,
 * root_cause_summary, created_by, glitch_type, is_visible, or anything from glitch_issue_notes /
 * raw glitch_instances.
 *
 * Gated by the existing, unrelated requirePartnerAdmin(partner_account_id) — NOT B2B-21's internal
 * role system (§6.5).
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
    console.error('[partner/known-bugs] Failed to load known bugs:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Couldn't load your bugs — try refreshing." }, { status: 500 })
  }

  const issueIds = rows.map((r) => r.issue_id)
  const commentCountByIssue = new Map<string, number>()
  if (issueIds.length > 0) {
    const supabase = createSupabaseAdminClient()
    const { data: commentRows } = await supabase
      .from('glitch_issue_partner_comments')
      .select('issue_id')
      .eq('partner_account_id', partnerAccountId)
      .in('issue_id', issueIds)
    for (const row of (commentRows ?? []) as Array<{ issue_id: string }>) {
      commentCountByIssue.set(row.issue_id, (commentCountByIssue.get(row.issue_id) ?? 0) + 1)
    }
  }

  const bugs = rows
    .map((row) => ({
      id: row.id,
      status: mapToPartnerStatus(row.issue_status),
      eta: row.eta,
      description: row.partner_facing_description,
      visible_since: row.first_visible_at,
      comment_count: commentCountByIssue.get(row.issue_id) ?? 0,
      can_comment: row.is_visible,
    }))
    .sort((a, b) => (a.visible_since && b.visible_since ? (a.visible_since < b.visible_since ? 1 : -1) : 0))

  return NextResponse.json({ bugs })
}
