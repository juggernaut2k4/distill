# Requirement Document: RETAKE-01 — Retake a Completed Session

Status: APPROVED by CEO Agent, 2026-07-06
Source: Resolves all six open questions from `.claude/agents/clio/feature-briefs/retake-completed-session.md`
Priority: P1

## 1. Summary
Allow a user to start a brand-new session on the same topic as a session they've already
completed, without touching or reopening the original completed session in any way.

## 2. Entry point / UX
- Location: `app/dashboard/sessions/[id]/SessionDetailClient.tsx`, Actions row, positioned between
  "Add to Calendar" and "View all sessions."
- Visible only when `session.status === 'completed'`.
- Button: secondary variant, `RefreshCw` icon, label "Retake this session."
- Click opens a confirmation modal (dark overlay, centered card, reusing this file's existing
  dark-surface/border-subtle styling):
  - Heading: "Start a new session on this topic?"
  - Body: "This will use your own session minutes."
  - Buttons: "Cancel" / "Start new session"
- Confirming calls `POST /api/sessions/[id]/retake`, shows a spinner in the button while in
  flight, and on success redirects to `/dashboard/sessions/{newSessionId}`.
- On error, show the exact message mapped to the status code (Section 10).

## 3. Content reuse vs. regeneration — DECISION: regenerate fresh
`session-content-pipeline.ts` keys `topic_content_cache` by `topic_id = sessionId` (the row's own
UUID), not a shared topic slug. A retake gets a new session UUID, so caching by the new row's own
id naturally triggers fresh generation via the existing `distill/session.content.generate` event —
no special-case code needed. This also better matches the "brand-new attempt" framing Arun
confirmed verbatim, and avoids ever showing byte-identical content on a paid second attempt.
Reasoning: reuses the existing pipeline exactly as constrained (no parallel system), costs one
normal generation run (same as any new session), and needs zero new caching logic.

## 4. Abuse / rate-limit guard — DECISION: none beyond minutes_balance
The user's own `minutes_balance > 0` check is sufficient gating. A paying user has no incentive to
spawn retakes they don't intend to use, since each one bills normally. No additional cooldown or
max-retake-count is added. If abuse is observed in practice, add a guard later — not speculatively
now.

## 5. Schema — DECISION: nullable link column
New migration `supabase/migrations/061_retaken_from_session_id.sql`:
- `sessions.retaken_from_session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL`
- Partial index: `CREATE INDEX ... ON sessions (retaken_from_session_id) WHERE retaken_from_session_id IS NOT NULL`
- Downstream systems (deferred-questions carry-forward, learner-profile tracking) are NOT wired to
  read this column in this ticket — out of scope. The column exists so a future ticket can use it;
  this ticket only writes it. Explicitly flagging this as a deliberate scope cut, not an oversight.

## 6. Which files change
1. `supabase/migrations/061_retaken_from_session_id.sql` — new migration (above).
2. `app/api/sessions/[id]/retake/route.ts` — new route (see Section 7).
3. `app/dashboard/sessions/[id]/SessionDetailClient.tsx` — new button + modal (Section 2).
No other existing files are modified. No changes to `session-designer-auto.ts`,
`session-content-pipeline.ts`, `/api/sessions/[id]/start/route.ts`, or the deferred-questions
system — all reused as-is via the normal new-session path.

## 7. API contract — `POST /api/sessions/[id]/retake`
- Auth: Clerk, via `requireSessionAuth()`. No request body.
- Steps:
  1. Fetch original session by `:id`. Must belong to caller and have `status === 'completed'`.
  2. If applicable, check curriculum plan approval state (same check as normal session creation).
  3. Check `users.minutes_balance > 0`.
  4. Compute next `session_index`.
  5. Insert new `sessions` row: `status: 'draft'`, `session_title: "Retake — {original title}"`,
     copies `topics` / `sub_sessions` / `curriculum_plan_id` / `curriculum_session_id` /
     `duration_mins` / `planned_duration_mins` from original, `deferred_questions: []`,
     `retaken_from_session_id: original.id`, `meeting_url` and `session_plan` left null.
  6. Second update: set the new row's `topic_id` to its own id (matches existing
     `session-designer-auto.ts` pattern for how `topic_id` self-references a session).
  7. Fire Inngest event `distill/session.content.generate` with `{ sessionId, userId }`.
  8. Return `201 { newSessionId }`.
- The original session row is read-only throughout — never updated or written to.

## 8. Billing
Identical to any normal session — new session bills against `minutes_balance` independently, no
special-casing, no discount, no shared/joint minute pool with the original.

## 9. Session numbering / display
- `session_index`: next global index (not a sub-index). A retake appears as a normal next session
  in the list.
- Distinguished visually only via its title prefix "Retake — {original title}" and (for future use)
  the `retaken_from_session_id` link. No separate UI treatment beyond the title in this ticket.

## 10. Error states
| Condition | Status | User-facing message |
|---|---|---|
| Not authenticated | 401 | "Please sign in and try again." |
| Session not found / not owned by caller | 404 | "Session not found." |
| Original session not completed | 409 | "This session hasn't been completed yet." |
| Curriculum plan not approved (if applicable) | 403 | "Your learning plan needs to be approved first." |
| `minutes_balance <= 0` | 403 | "You're out of session minutes. Add more to continue." |
| Unexpected server error | 500 | "Something went wrong. Please try again." |

## 11. Open Questions
None. All six BA questions resolved above (Sections 2–6, 9).

## 12. Acceptance criteria / edge cases
- Retaking a session whose topic's content has since changed: fine — retake always regenerates
  fresh (Section 3), so it naturally reflects current content.
- Retaking the same session more than once: allowed, no limit (Section 4). Each retake links back
  to the same original via `retaken_from_session_id`.
- Retaking while the user has zero minutes: blocked at step 3 with 403 (Section 7/10).
- Original session's `status`, transcript, `deferred_questions`, and `duration_mins` are verified
  untouched — the retake route never issues an UPDATE against the original row, only a SELECT.
- Attempting to retake a session that is not `completed` (e.g. `draft`, `in_progress`): 409.
- The `/api/sessions/[id]/start` rejoin block for completed sessions is completely unmodified by
  this ticket — verified by diff review before merge.
