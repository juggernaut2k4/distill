# Feature Brief: SESSION-DURATION-01 — Separate Planned Duration from Billed Minutes; Block Rejoin of Completed Sessions

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-05

---

## What Arun Said

From the 2026-07-06 test session review (`docs/ACTION-ITEMS-2026-07-06.md`, items #2, #3, #11),
already investigated and root-caused earlier today:

> A session's minute countdown must always start fresh from the full planned length, never carry
> over from a prior reconnect. Root cause: `sessions.duration_mins` is overloaded — it's used both
> as the session's planned length and gets overwritten with actual billed minutes every time a
> session force-ends. Also: nothing stops a completed session from being rejoined, which is the
> root enabler that let a real production billing bug happen (a stale timestamp got paired with a
> fresh one, computing a wildly inflated duration that got capped to the user's full balance and
> deducted 170 minutes in one shot).

Arun's explicit instruction: write a proper spec for (1) splitting planned vs. actual duration into
two distinct fields, and (2) blocking rejoin of already-completed sessions. Both items are called
out in the action-items doc as "needs a proper spec" before any code is written — this brief starts
that process.

## The Problem Being Solved

Two compounding data-integrity bugs, confirmed via source-code read today:

**Bug A — one column, two jobs.** `sessions.duration_mins` is set once at scheduling time as the
planned session length (e.g. 15 or 30 minutes — see `lib/curriculum/session-designer.ts` and
`session-organizer.ts`, where it's computed from the curriculum plan). It is then silently
overwritten with the *actual minutes billed* every time a session ends, in two separate places:
- `app/api/sessions/[id]/end/route.ts` (normal end-session path)
- `lib/session-billing.ts`'s `forceEndSession()` (timeout/watchdog force-end path)

Both write `duration_mins: minutesUsed` (or `cappedMinutes`) directly onto the same column that was
originally the plan. After a session's first force-end, its planned length is gone forever —
replaced by whatever got billed that cycle. This already produced a real symptom: a session that
should have shown "15 min planned" instead showed "2 minutes" in Arun's test review, because the
column had already been overwritten by an earlier short cycle.

This also creates a **live UI correctness bug**, confirmed by reading
`app/dashboard/sessions/[id]/SessionDetailClient.tsx`: the same `session.duration_mins` field is
used at line 533 to show the pre-session estimate ("~X minutes") to the user before they start, AND
at line 499 to show the post-completion actual-minutes-billed figure. Once a session has been
force-ended even once, both of these numbers are actually "whatever got billed last cycle," not the
plan — meaning the pre-session estimate becomes silently wrong for any session that has previously
been rejoined/force-ended.

**Bug B — no re-entry guard.** Neither `app/api/sessions/[id]/start/route.ts` nor the bot-join path
checks `session.status === 'completed'` before allowing a session to be joined and started again.
This is the root enabler of a real production billing incident: a stale `speak_verified` timestamp
from an old reconnect got paired with a fresh `disconnected` timestamp from a new join, computing a
wildly inflated duration. That duration was capped to the user's entire minutes balance and deducted
170 minutes in a single shot, requiring a manual correction. (A related same-cycle-scoping bug in
`computeBilledMinutes` was already fixed today separately — this brief does not touch that function
or its math. This brief closes the other half: stopping the rejoin from happening in the first
place.)

## What Success Looks Like

- Every session has two independent, unambiguous fields: one that always reflects what was planned
  at scheduling time and is never touched again after creation, and one that always reflects actual
  minutes billed and is only ever written by the billing/end paths (as today).
- A session whose `status` is already `completed` cannot be started or rejoined — the start/join
  path returns a clear rejection instead of silently proceeding.
- Every existing UI surface that currently reads `duration_mins` for a "planned length" display
  (schedule setup, sessions list, session detail pre-session estimate, dashboard, KB topic page)
  is updated to read the correct field for that purpose, and continues to render the same kind of
  number it renders today — no visible regression, no blank/undefined durations.
- Historical sessions whose planned length was already overwritten are **not** silently
  "fixed" with invented numbers. The spec is explicit that this data is unrecoverable for sessions
  that already went through a force-end before this change ships; only sessions created after the
  fix are structurally protected from this ever happening again.

## Known Constraints (from Arun, non-negotiable)

1. **Do not change how minutes are calculated or deducted.** `computeBilledMinutes`'s cycle-scoping
   logic in `lib/session-billing.ts` is already correct as of today's earlier fix. This brief is
   purely about *which field* gets written to, and *whether rejoin is allowed* — not the billing
   math itself.
2. **No deletion of existing columns without explicit approval.** The existing `duration_mins`
   column should be repurposed/clarified (e.g. becoming purely "actual minutes billed" going
   forward), not dropped — unless the BA has a strong reason to recommend otherwise, in which case
   it must be flagged explicitly for Arun's approval before being built, not decided unilaterally.
3. **Must not break existing UI displays of session length.** Every current read site of
   `duration_mins` (confirmed by direct source read today):
   - `app/dashboard/sessions/SessionsClient.tsx` (list view + per-group total minutes)
   - `app/dashboard/sessions/[id]/SessionDetailClient.tsx` (pre-session estimate AND post-completion
     actual, two different uses of the same field today — this is exactly the bug)
   - `app/dashboard/DashboardClient.tsx` (dashboard summary)
   - `app/dashboard/knowledge-base/[topicId]/KBTopicClient.tsx` (KB topic session-length preview)
   - `app/dashboard/schedule-setup/ScheduleSetupClient.tsx` (schedule-setup estimated minutes)
   - `app/api/sessions/schedule/route.ts` (session creation/rescheduling)
   The BA spec must confirm, site by site, which field each one should read after the split, and
   that none of them regress.
4. **Historical corruption is not recoverable — do not invent a recovery mechanism.** Sessions that
   have already been force-ended at least once have already lost their true planned length; there
   is no reliable source (e.g. no separate untouched copy) to recover it from. The spec must state
   this plainly rather than propose a heuristic "best guess" backfill that could quietly introduce
   wrong numbers into historical data. It is acceptable for historical sessions' "planned duration"
   field to be null/unknown or backfilled from the current (possibly-corrupted) `duration_mins`
   value with an explicit caveat that this is a best-effort default, not a claim of accuracy.
5. **Out of scope for this brief:** the already-approved, already-in-progress graceful-session-end
   nudge feature. That is a separate, unrelated fix about how a session ends gracefully near its
   time limit — nothing in this brief should touch that code path's logic, only the field(s) it may
   incidentally read/write for duration bookkeeping.

## Questions for BA

1. **Naming and shape of the new field.** Recommend the simplest schema change: a new column (e.g.
   `sessions.planned_duration_mins`, immutable after insert) alongside the existing `duration_mins`
   (repurposed to mean "actual minutes billed" only). Confirm this is the least-disruptive option
   versus any alternative (e.g. a separate table), and document the exact migration.
2. **Backfill strategy for existing rows.** For sessions never force-ended (i.e. `duration_mins`
   still holds their true original plan), the new planned-duration field can be safely backfilled
   from the current value. For sessions that HAVE been force-ended at least once, decide and
   document explicitly: null (unknown/unrecoverable) vs. best-effort backfill from current value
   with a caveat — and make sure this decision is visible to Arun before it ships, since it affects
   how "planned length" will display for every historical session in the sessions list and KB pages.
3. **Rejoin-block mechanics.** Where exactly does the `status === 'completed'` check belong —
   `app/api/sessions/[id]/start/route.ts` only, or also anywhere else a bot/join can be triggered
   (e.g. `app/api/recall/bot/route.ts`)? Confirm the full set of entry points that need the guard,
   and define the exact user-facing error/response when someone attempts to rejoin a completed
   session (what does the UI show?).
4. **Site-by-site field mapping.** For every UI/API read site listed under Constraint 3 above,
   specify precisely which field it reads after the split (planned vs. actual) and what changes (if
   any) are needed in each file, with example before/after values.
5. **Interaction with the in-progress graceful-session-end feature.** Confirm with the team building
   that feature (or note as an open coordination item) whether it reads/writes `duration_mins` in a
   way that could conflict with this split, so the two efforts don't collide when both ship.
6. **Acceptance criteria and edge cases.** Full write-up required per governance (all 12 sections),
   including: a session force-ended twice in a row, a session that never reaches `speak_verified`
   (0 minutes billed — should planned duration still show correctly?), and a session rejoin attempt
   immediately after completion vs. much later.

No code should be written until this spec is complete, all six items above are answered, and the
CEO Agent has approved it.
