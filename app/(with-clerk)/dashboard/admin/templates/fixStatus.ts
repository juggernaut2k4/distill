/**
 * TMPL-01 (requirement doc Section 4.2) — shared status/color/label mapping for
 * the per-card "bulb" (TemplateApprovalClient.tsx) and the Fix Progress view
 * (TemplateFixProgressClient.tsx). Kept in one place so both surfaces always
 * agree on what a given status/fix_state combination looks like.
 *
 * Two new accent tokens proposed in Section 4.2, pending Arun's final
 * confirmation (Section 12 of the requirement doc) — easy to swap later,
 * only ever referenced here:
 *   - #3B82F6 ("accent-blue")   — Pending Review
 *   - #F97316 ("accent-orange") — Fix Failed
 */

export type FixState = 'none' | 'generating' | 'failed'
export type TemplateStatus = 'pending_review' | 'approved' | 'changes_requested'

export type FixStatusIcon = 'check' | 'clock' | 'x' | 'loader' | 'alert'

export interface FixStatusDisplay {
  color: string
  label: string
  icon: FixStatusIcon
}

/**
 * Section 4.2's status/color table, exactly:
 *   approved                              -> green  #10B981
 *   pending_review        / none          -> blue   #3B82F6 (new)
 *   changes_requested     / none          -> red    #EF4444
 *   changes_requested     / generating    -> amber  #F59E0B, "Generating fix…"
 *   changes_requested     / failed        -> orange #F97316 (new), "Fix failed — needs attention."
 */
export function getFixStatusDisplay(status: TemplateStatus, fixState: FixState): FixStatusDisplay {
  if (status === 'approved') {
    return { color: '#10B981', label: 'Approved', icon: 'check' }
  }
  if (status === 'pending_review') {
    return { color: '#3B82F6', label: 'Pending Review', icon: 'clock' }
  }
  // status === 'changes_requested'
  if (fixState === 'generating') {
    return { color: '#F59E0B', label: 'Generating fix…', icon: 'loader' }
  }
  if (fixState === 'failed') {
    return { color: '#F97316', label: 'Fix failed — needs attention.', icon: 'alert' }
  }
  return { color: '#EF4444', label: 'Changes Requested', icon: 'x' }
}

/**
 * Does this row have at least one fix cycle to show in the progress view?
 * Section 4.3: the link "appears below any template card that has ever had
 * at least one fix cycle (i.e. has at least one template_fix_log row)" — a
 * fix_cycle_id is assigned atomically with that row's very first
 * feedback_received log entry (PATCH .../route.ts), so its presence is a
 * reliable proxy without a second network call per card.
 */
export function hasFixHistory(row: { fix_cycle_id?: string | null; fix_attempt_count?: number | null }): boolean {
  return Boolean(row.fix_cycle_id) || (row.fix_attempt_count ?? 0) > 0
}
