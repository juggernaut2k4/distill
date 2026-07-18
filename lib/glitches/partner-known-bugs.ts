import { createSupabaseAdminClient } from '@/lib/supabase'
import { CLOSED_ISSUE_STATUSES } from './partner-status'
import type { GlitchIssueStatus } from './issue-status'

/**
 * B2B-22 Requirement Doc §6.3 — the partner-facing hybrid read scope, shared by every partner-facing
 * route (`GET /api/partner/known-bugs`, `.../summary`, `.../[issueId]/comments`) so the table, the
 * chart, and the comment-read-scope check are always computed by the exact same rule and can never
 * disagree with each other.
 *
 * A row counts for a partner if it is CURRENTLY visible (`is_visible = true`), OR it was EVER visible
 * (`first_visible_at IS NOT NULL`) AND its issue's current status is Closed (`resolved`/`wont_fix`).
 * A bug never toggled visible, or toggled off while still open/investigating, is fully excluded
 * either way — the no-hidden-bug-count guarantee.
 *
 * This is a genuinely separate query path from the internal, unscoped `/api/admin/glitches*` routes
 * (§6.3 non-regression) — never a shared query with a role filter bolted on.
 */

export interface HybridScopedVisibilityRow {
  id: string
  issue_id: string
  is_visible: boolean
  eta: string | null
  partner_facing_description: string | null
  first_visible_at: string | null
  issue_status: GlitchIssueStatus
}

interface RawRow {
  id: string
  issue_id: string
  is_visible: boolean
  eta: string | null
  partner_facing_description: string | null
  first_visible_at: string | null
  glitch_issues: { status: GlitchIssueStatus } | { status: GlitchIssueStatus }[] | null
}

/**
 * Fetches every glitch_issue_partner_visibility row for a partner that satisfies §6.3's hybrid scope.
 */
export async function fetchHybridScopedVisibilityRows(partnerAccountId: string): Promise<HybridScopedVisibilityRow[]> {
  const supabase = createSupabaseAdminClient()

  const { data, error } = await supabase
    .from('glitch_issue_partner_visibility')
    .select('id, issue_id, is_visible, eta, partner_facing_description, first_visible_at, glitch_issues!inner(status)')
    .eq('partner_account_id', partnerAccountId)

  if (error) {
    throw new Error(error.message)
  }

  return ((data ?? []) as unknown as RawRow[])
    .map((row) => {
      const issue = Array.isArray(row.glitch_issues) ? row.glitch_issues[0] : row.glitch_issues
      return {
        id: row.id,
        issue_id: row.issue_id,
        is_visible: row.is_visible,
        eta: row.eta,
        partner_facing_description: row.partner_facing_description,
        first_visible_at: row.first_visible_at,
        issue_status: (issue?.status ?? 'open') as GlitchIssueStatus,
      }
    })
    .filter(
      (row) =>
        row.is_visible === true ||
        (row.first_visible_at !== null && CLOSED_ISSUE_STATUSES.includes(row.issue_status))
    )
}

/** Fetches a single (issueId, partnerAccountId) row if it satisfies §6.3's hybrid read scope, else null. */
export async function fetchHybridScopedVisibilityRow(
  issueId: string,
  partnerAccountId: string
): Promise<HybridScopedVisibilityRow | null> {
  const rows = await fetchHybridScopedVisibilityRows(partnerAccountId)
  return rows.find((row) => row.issue_id === issueId) ?? null
}
