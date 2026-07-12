# TMPL-04 — force_retrigger Sends No Feedback Text (Bug Fix) — Requirement Document
Version: 1.0
Status: APPROVED (see CEO Review, end of document)
Author: Business Analyst Agent
Date: 2026-07-12

## 1. Purpose
`force_retrigger` (the manual escape valve in the Fix Progress view — TMPL-01 Section 4.3/6) is
supposed to re-run the style-fix generator using the reviewer's original feedback. Instead it
hardcodes `notes: ''` in the event it fires, so the generator always reports "no reviewer feedback
was provided" and the retry can never succeed — even though the real feedback text is sitting
untouched in the row's own `review_notes` column. Without this fix, force_retrigger is not a retry at
all; it is a guaranteed-to-fail no-op that wastes an attempt and gives Arun no way to get the fix
generator to act on feedback he already gave.

## 2. User Story
As the configured approver (Arun),
I want "Force retrigger fix attempt" to resend my original review feedback to the fix generator,
So that the retry actually has something to act on and can succeed instead of failing every time with
"no feedback provided."

## 3. Trigger / Entry Point
No change from current behavior. Same route, same gating, same trigger:
- Route: `POST /api/templates/library/[templateName]/nudge`
- Body: `{ "action": "force_retrigger" }`
- Auth: `requireSessionAuth`, then `isConfiguredApprover(user.email)` — 403 for anyone else, 403 for
  everyone if the approver env var is unset. Unchanged.
- Precondition: `isFixLoopTemplate(templateName)` must be true (400 otherwise). Unchanged.

## 4. Screen / Flow Description
No UI changes. This is a server-side payload-construction fix inside the existing `force_retrigger`
branch of the nudge route handler. Sequence after the fix:
1. Route fetches the current row — the `select()` now includes `review_notes` alongside the
   existing `fix_state, fix_attempt_count, fix_cycle_id`.
2. Route generates a new `fix_cycle_id`, increments `fix_attempt_count` (unchanged), updates the row
   (unchanged), logs the `nudge_force_retrigger` event (unchanged).
3. Route fires `clio/template.fix_requested` via `inngest.send()`, now passing
   `notes: current.review_notes` instead of the hardcoded `notes: ''`.
4. Response body and status codes are unchanged.

## 5. Visual Examples
Not applicable — no screen changes. This is a backend event-payload fix with no visible UI surface.

## 6. Data Requirements
**Read (new):** `template_library.review_notes` for the row matching `template_name`. This is added
to the existing `select('fix_state, fix_attempt_count, fix_cycle_id')` call at
`app/api/templates/library/[templateName]/nudge/route.ts:71-75`, becoming
`select('fix_state, fix_attempt_count, fix_cycle_id, review_notes')`.

**Written:** No change to what's written to `template_library` or `template_fix_log`.

**API/event call (changed):** `inngest.send({ name: 'clio/template.fix_requested', data: {
templateName, notes: current.review_notes, fixCycleId: newFixCycleId, forceRetrigger: true } })` —
replacing the hardcoded `notes: ''` at line 130 with `current.review_notes`.

No other tables, routes, or files are read from or written to.

## 7. Success Criteria (Acceptance Tests)
✓ Given a template with `review_notes` containing reviewer feedback text and an existing fix cycle,
  when the approver calls `force_retrigger`, then the `clio/template.fix_requested` event fired
  contains `notes` equal to that exact `review_notes` text (not an empty string).

✓ Given the same scenario, when the fix generator (`generateStyleFix()`) receives the event, then it
  no longer reports "No reviewer feedback was provided" and instead acts on the forwarded text (this
  is exercised end-to-end by Inngest/the generator, not by this route directly — the route's job is
  only to forward the correct value).

✓ Given a non-approver calls `force_retrigger`, then the response is still 403 and no event is fired —
  unchanged from current behavior.

✓ Given the `request_changes` action (a separate branch, not touched by this fix), when a new fix
  cycle starts, then it continues to pass `notes` from the request body exactly as it does today —
  unaffected by this change.

✓ Given `review_notes` is `null` on the row at the moment `force_retrigger` is called, when the event
  fires, then `notes` is forwarded as `null` (not coerced to `''` or any placeholder text) — see
  Section 9 for why this is correct.

## 8. Error States
No new error states are introduced. The existing `fetchError || !current` → 404 branch already
covers the case where the row can't be read at all, and now implicitly covers the `review_notes`
column too since it's part of the same `select()`. No new failure mode exists solely because
`review_notes` is added to the query.

## 9. Edge Cases
- **`review_notes` is `null` or empty at retrigger time:** Per the brief, `force_retrigger` is only
  reachable from the UI once a fix cycle already exists, which means a "Request changes" submission
  (which always writes `review_notes`) must have already happened. This case shouldn't be reachable
  through normal use. If it somehow occurs anyway (e.g. data manipulated directly, or a future UI
  change exposes force_retrigger earlier than intended), the correct behavior is to forward
  `review_notes` as-is — `null` or `''`, whatever it actually is — rather than substituting any
  fallback text. If there genuinely is no feedback on the row, `generateStyleFix()` reporting "no
  feedback provided" is the *correct* outcome, not a bug. That is a different situation from today's
  bug, where real feedback existed on the row but the route discarded it before it ever reached the
  generator.
- **Multiple force_retrigger calls in a row:** Unaffected by this fix — `review_notes` is not
  modified by this route, so repeated calls keep forwarding the same original feedback each time,
  which is the expected "retry with the same context" behavior.

## 10. Out of Scope
- No changes to `lib/templates/fix-generator.ts`, `lib/templates/fix-cycle-runner.ts`,
  `lib/templates/styleOverrideSlots.ts`, or the Inngest job itself.
- No changes to the `status_check` action.
- No changes to the `request_changes` action's notes handling — it already correctly sources `notes`
  from the request body.
- No new UI for viewing or editing feedback text at retrigger time.
- No changes to attempt-count handling, fix_cycle_id generation, or the uncapped nature of manual
  force-retrigger (TMPL-01 Sections 4.2/4.3/6 remain as-is).

## 11. Open Questions
None.

## 12. Dependencies
- Depends on `template_library.review_notes` existing as a column that is populated by the
  `request_changes` action (already true today — confirmed live against the database per the Feature
  Brief).
- No new dependencies introduced.

---

## CEO Review

Approved. Section 11 confirmed empty. This is exactly right-sized for a one-line bug fix — every
section stayed proportionate rather than padded. The fix is unambiguous: forward `review_notes`
instead of an empty string, no fallback substitution when it's genuinely null. Developer agent:
implement exactly Section 6's change, nothing else.
