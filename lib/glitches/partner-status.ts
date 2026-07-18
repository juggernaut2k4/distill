import type { GlitchIssueStatus } from './issue-status'

/**
 * B2B-22 — Partner-visible status vocabulary (Requirement Doc §6.2).
 *
 * Reuses B2B-17's internal 4-state lifecycle (`lib/glitches/issue-status.ts`) — never a parallel
 * partner status field. Mapped at read time from `glitch_issues.status`, so the two can never drift.
 */

export type PartnerBugStatus = 'open' | 'in_progress' | 'closed'

export const PARTNER_STATUS_LABEL: Record<PartnerBugStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  closed: 'Closed',
}

/**
 * Maps B2B-17's internal 4-state lifecycle to the partner-visible 3-bucket vocabulary Arun asked for
 * ("open, closed, in-progress"). `wont_fix` is deliberately bucketed into `closed` alongside
 * `resolved` — the partner is never shown a literal "won't fix" label (Requirement Doc §6.2). There
 * is no independent partner status field; this mapping is always computed live from
 * `glitch_issues.status`.
 */
export function mapToPartnerStatus(status: GlitchIssueStatus): PartnerBugStatus {
  switch (status) {
    case 'open':
      return 'open'
    case 'investigating':
      return 'in_progress'
    case 'resolved':
    case 'wont_fix':
      return 'closed'
  }
}

/** Statuses treated as "Closed" for §6.3's sticky-closed-history hybrid scope rule. */
export const CLOSED_ISSUE_STATUSES: readonly GlitchIssueStatus[] = ['resolved', 'wont_fix']
