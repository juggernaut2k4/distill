/**
 * B2B-17 — Glitch issue status lifecycle (Requirement Doc Section 5).
 *
 * Shared between the PATCH route (server-side transition guard) and the client (which only offers
 * valid transitions in the status control). Single source of truth so the two never drift.
 */

export const GLITCH_ISSUE_STATUSES = ['open', 'investigating', 'resolved', 'wont_fix'] as const
export type GlitchIssueStatus = (typeof GLITCH_ISSUE_STATUSES)[number]

/** The terminal statuses that set `resolved_at`; moving away from them clears it. */
export const TERMINAL_STATUSES: readonly GlitchIssueStatus[] = ['resolved', 'wont_fix']

/**
 * Valid forward transitions per Section 5's lifecycle diagram:
 *   OPEN → INVESTIGATING | RESOLVED | WONT_FIX
 *   INVESTIGATING → RESOLVED | WONT_FIX | OPEN
 *   RESOLVED → OPEN (reopen)
 *   WONT_FIX → OPEN (reopen)
 */
export const VALID_TRANSITIONS: Record<GlitchIssueStatus, readonly GlitchIssueStatus[]> = {
  open: ['investigating', 'resolved', 'wont_fix'],
  investigating: ['resolved', 'wont_fix', 'open'],
  resolved: ['open'],
  wont_fix: ['open'],
}

/**
 * Whether a status change from `from` to `to` is permitted. A no-op (from === to) is allowed
 * (idempotent). Anything else must appear in VALID_TRANSITIONS[from].
 */
export function isValidTransition(from: GlitchIssueStatus, to: GlitchIssueStatus): boolean {
  if (from === to) return true
  return VALID_TRANSITIONS[from].includes(to)
}
