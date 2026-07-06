# Session Duration Split & Rejoin Block — Requirement Document
Version: 1.0
Status: CEO APPROVED — pending Arun sign-off on Section 9 backfill tradeoff
Author: Business Analyst Agent
Date: 2026-07-05

---

## 1. Purpose

`sessions.duration_mins` currently does two jobs that must never share one column: it is the
number written once, at scheduling time, to mean "how long this session was planned to be," and it
is also the number overwritten every time a session ends (normal end or force-end) to mean "how many
minutes were actually billed." Every time a session is force-ended, the planned value is destroyed
and replaced by the billed value — permanently, with no way to recover the original plan afterward.

This has already produced a real, observed symptom (a session that should read "15 min planned"
instead read "2 minutes" in Arun's own test review) and is one of two compounding root causes of a
real production billing incident: a completed session was rejoined, its stale `speak_verified`
timestamp was paired with a fresh `disconnected` timestamp, and the resulting inflated duration was
capped to the user's full balance and deducted 170 minutes in one shot.

Without this fix: every session that has ever been force-ended shows a silently wrong "planned
length" everywhere that number is displayed pre-session (sessions list, session detail, dashboard,
schedule setup, KB topic page), and nothing stops a user (or a stray webhook retry, or a stale
browser tab) from rejoining and re-billing a session that has already finished.

## 2. User Story

As an **executive user** (Clio's end customer),
I want to see the length I actually scheduled for a session, both before I join it and even after
it's been rejoined or interrupted,
so that I can trust the time commitment I'm making and never get billed twice for a session that
already ended.

As **Arun** (product owner, responsible for billing correctness),
I want a session's planned length permanently separated from what actually got billed, and want
completed sessions structurally unable to be rejoined,
so that a single force-end (voice drop, timeout, reconnect) can never corrupt the session's stated
plan, and a completed session can never generate a second billing cycle.

## 3. Trigger / Entry Point

This is a data-model and API-gate change, not a new user-facing flow. There is no new route. The
two behavior changes fire at these existing entry points:

- **Schema/write path**: `POST` to `app/api/plan/approve/route.ts` — this is the one and only place
  in the codebase where a `sessions` row is `insert()`-ed (both the v2 arc-organizer path at line
  131 and the v1 direct-design path at line 180). This is "scheduling time" for the purposes of this
  spec — the moment a session first comes into existence with a duration.
- **Rejoin-block path**: `POST /api/sessions/[id]/start` (`app/api/sessions/[id]/start/route.ts`) —
  called from `SessionDetailClient.tsx`'s `handleLaunchBot()` the moment a user clicks "Start Live
  Session." This is the sole gate that must reject an attempt to (re)start a session whose `status`
  is already `'completed'`.
- User state required: authenticated (Clerk session, `requireSessionAuth`), owns the session
  (`user_id` match), on any plan/tier — this gate applies universally, it is not tier-gated.

## 4. Screen / Flow Description

No new screens. Two existing flows change behavior:

**Flow A — Session creation (unchanged sequence, new field written)**
1. User approves a curriculum plan → `POST /api/plan/approve`.
2. For each planned session, the route computes a duration (`ds.duration_mins`, sourced from
   `designSessionsForTopic()` in `lib/curriculum/session-designer.ts`, itself derived from
   `organizeSubtopicsIntoSessions()` in `lib/curriculum/session-organizer.ts`) and inserts a new
   `sessions` row.
3. **New behavior**: the insert now also sets `planned_duration_mins` to the same computed value.
   `duration_mins` continues to be written at insert time too (see Section 6 for why, and Section
   9 for the backfill/compatibility rationale) but from this point forward its meaning is "actual
   minutes billed, defaulting to the plan until a real billing event overwrites it."

**Flow B — Attempting to (re)start a session**
1. User opens a session detail page and clicks "Start Live Session."
2. Client calls `POST /api/sessions/[id]/start`.
3. **New behavior**: the route now checks `session.status === 'completed'` before doing anything
   else (before the plan-approval check, before the minutes-balance check). If true, it returns
   immediately with a 409 and a clear error message; the bot is never created, no audit event is
   written, no Inngest timer is started.
4. Client (`SessionDetailClient.tsx`'s `handleLaunchBot`) receives `{ error: ... }` with a non-2xx
   status, exactly like any other current failure branch of this same function (e.g. insufficient
   minutes) — it calls `setBotError(startData.error)` and `setBotStatus('idle')`. No new client-side
   branching is required: the existing generic error-banner rendering path (already present for the
   "insufficient minutes" and "plan not approved" cases in the same component) displays it.
5. User sees an inline red error banner in the same location where "insufficient minutes" and "plan
   not approved" errors already render (`SessionDetailClient.tsx`, the `botStatus === 'idle'`
   conditional block starting at line 964). No new UI component is introduced.

## 5. Visual Examples

**State: session detail page, attempting to rejoin a completed session**

```
┌─────────────────────────────────────────────────────────┐
│  ← Back to Sessions                                      │
│                                                           │
│  (2)  Understanding Context Windows            [Completed]│
│                                                           │
│  Minutes used                                            │
│  ⏱  12 min                                                │
│                                                           │
│  ─────────────────────────────────────────────────────  │
│  📅 Scheduled for   Jul 3, 2026, 2:00 PM                  │
│  🕐 Duration        ~15 minutes                           │
│  ─────────────────────────────────────────────────────  │
│                                                           │
│  🎥 Start Live Session                                    │
│     Clio AI joins your Zoom or Teams call and shares a    │
│     visual walkthrough                                    │
│                                                           │
│  ⚠ This session has already been completed.               │
│     [Error banner — same red style used today for         │
│      "insufficient minutes" / "plan not approved"]        │
└─────────────────────────────────────────────────────────┘
```

No other screen states change in appearance — the "Duration" row (`~15 minutes`) and the "Minutes
used" row (`12 min`) both already exist and already display side-by-side today; this spec makes them
correct rather than sometimes-identical/corrupted, with no new layout or copy elsewhere.

## 6. Data Requirements

### Schema change

New column on `sessions`:

```sql
ALTER TABLE sessions
  ADD COLUMN planned_duration_mins INTEGER;

COMMENT ON COLUMN sessions.planned_duration_mins IS
  'Immutable snapshot of the planned session length in minutes, set once at row-insert time '
  '(app/api/plan/approve/route.ts). Never overwritten after insert by any billing/end path. '
  'NULL for historical rows created before this migration whose true original plan cannot be '
  'reconstructed (see migration backfill step for the one exception where it is safe to infer).';

COMMENT ON COLUMN sessions.duration_mins IS
  'Actual minutes billed for this session, written by the billing/end paths '
  '(app/api/sessions/[id]/end/route.ts, lib/session-billing.ts forceEndSession()). '
  'Defaults to the planned value at insert time and is only overwritten once a real '
  'billing event (normal end or force-end) occurs. For the "planned length" display '
  'pre-session, read planned_duration_mins instead — see SESSION-DURATION-01.';
```

Existing `duration_mins` column definition (confirmed from `supabase/migrations/002_minutes_and_sessions.sql`
line 22): `duration_mins INTEGER DEFAULT 0`. It is nullable with a default of `0` — there is no
`NOT NULL` constraint to work around. No default/backfill workaround is needed for `duration_mins`
itself; it keeps its exact current definition, unchanged.

`planned_duration_mins` is added as nullable, no default — a `NULL` here is a deliberate, meaningful
state ("we don't know"), not an error condition, so no default value should mask that.

### Write sites — what changes

| File | What it writes today | What it writes after this change |
|---|---|---|
| `app/api/plan/approve/route.ts` line 131 (v2 path) | `duration_mins: ds.duration_mins` | `duration_mins: ds.duration_mins, planned_duration_mins: ds.duration_mins` (same value, both columns, at insert only) |
| `app/api/plan/approve/route.ts` line 180 (v1 path) | `duration_mins: ds.duration_mins` | `duration_mins: ds.duration_mins, planned_duration_mins: ds.duration_mins` (same value, both columns, at insert only) |
| `app/api/sessions/[id]/end/route.ts` line 79 | `duration_mins: minutesUsed` | **unchanged** — still writes only `duration_mins`. Never touches `planned_duration_mins`. |
| `lib/session-billing.ts` `forceEndSession()` line 296 | `duration_mins: cappedMinutes` | **unchanged** — still writes only `duration_mins`. Never touches `planned_duration_mins`. |
| `app/api/admin/test-session/route.ts` line 62 (dev/test helper) | `duration_mins: durationMins` | add `planned_duration_mins: durationMins` alongside, so admin-created test sessions get correct data too |
| `app/api/admin/backfill-sub-sessions/route.ts` line 49 | `duration_mins: Math.max(2, Math.floor(...))` | add `planned_duration_mins` with the same computed value — this route creates `sub_sessions` shape data, not fresh top-level sessions, but if it ever writes a fresh session row, keep both columns in sync |

No other file writes `duration_mins` to the `sessions` table. (Confirmed by full-repo grep — every
other file only `select()`s it or reads/interpolates the value client-side.)

### Read sites — see Section 3 of the site-by-site table below (duplicated with UI mapping for clarity).

### APIs called

No new external API calls. No changes to Stripe, Twilio, Anthropic, or any third-party SDK usage.

## 7. Success Criteria (Acceptance Tests)

AC-1. **Given** a curriculum plan is approved and a new session is inserted, **when** the insert
completes, **then** `sessions.planned_duration_mins` equals `sessions.duration_mins`, both equal to
the computed session length, and both are non-null.

AC-2. **Given** a session with `status = 'active'` that has never been force-ended, **when** the
user clicks "End Session" (normal end path), **then** `duration_mins` is overwritten with the
actual billed minutes (unchanged existing behavior) and `planned_duration_mins` remains exactly
what it was at insert time, unchanged.

AC-3. **Given** a session that reaches the server-side timeout/watchdog and is force-ended via
`forceEndSession()`, **when** force-end completes, **then** `duration_mins` is overwritten with
`cappedMinutes` (unchanged existing behavior) and `planned_duration_mins` remains exactly what it
was at insert time, unchanged.

AC-4. **Given** a session that has been force-ended twice in a row (e.g. rejoined before this fix
shipped, or via any other path), **when** each force-end runs, **then** `planned_duration_mins` is
never written to by either force-end call — it was set exactly once, at insert, and stays that way
through any number of subsequent end/force-end cycles.

AC-5. **Given** a session whose `status` is already `'completed'`, **when** any client calls
`POST /api/sessions/[id]/start`, **then** the endpoint returns HTTP 409 with a JSON body
`{ error: "This session has already been completed and can't be restarted.", code: "SESSION_ALREADY_COMPLETED" }`,
no `walkthrough_state` row is touched, no audit event is written, no Inngest `clio/session.started`
event is emitted, and no bot is created.

AC-6. **Given** a session whose `status` is `'scheduled'`, `'draft'`, or `'active'` (not
`'completed'`), **when** `POST /api/sessions/[id]/start` is called, **then** existing behavior is
completely unchanged — the plan-approval check, minutes-balance check, and start sequence all run
exactly as they do today.

AC-7. **Given** a session that never reaches `speak_verified` in its current cycle (zero minutes
billed, per already-shipped `computeBilledMinutes` AC-D3 behavior), **when** the session ends,
**then** `duration_mins` is set to `0` (existing, unchanged behavior) and `planned_duration_mins`
still correctly reflects the original non-zero planned length — these two fields are allowed to
diverge completely, by design, and the UI at `SessionDetailClient.tsx` line 493-501 already renders
`duration_mins === 0` as "0 min (session ended before connecting)" correctly today; no change needed
to that branch since it is reading the correct (actual-billed) field already.

AC-8. **Given** a session created before this migration ships (a pre-existing row), **when** its
data is read for display, **then** `planned_duration_mins` is populated per the backfill rule in
Section 9 (best-effort from current `duration_mins` at migration time, explicitly caveated as not
guaranteed accurate) — it is never left silently blank/undefined in a way that breaks a UI render
(no NaN, no "undefined minutes" string).

AC-9. **Given** a user attempts to rejoin a completed session immediately after completion (within
seconds) **or** long after (days later), **when** `POST /api/sessions/[id]/start` is called in
either case, **then** the same 409 rejection occurs — there is no time-based leniency window; the
check is a pure `status === 'completed'` comparison with no timestamp logic.

AC-10. **Given** the existing `computeBilledMinutes` function and its cycle-scoping logic in
`lib/session-billing.ts`, **when** this feature ships, **then** that function's implementation,
inputs, outputs, and call sites are byte-for-byte unchanged — this feature does not modify billing
math, only which field receives the "planned" vs. "actual" write.

## 8. Error States

- **Rejoin attempt on a completed session**: handled explicitly (AC-5) — 409, no side effects, no
  partial writes. This is the primary new error state this feature introduces.
- **`planned_duration_mins` missing/null on a historical row**: not an error — this is an expected,
  documented state (Section 9). Every UI read site listed in Section 6/9 must use `?? <fallback>` at
  the exact point of use, matching the existing fallback convention already used everywhere else in
  this codebase for `duration_mins` (e.g. `?? 30`, `?? 15`) — see the site-by-site table for the
  exact fallback value per site. No site should render a blank or `NaN` duration.
- **Insert to `sessions` partially fails** (e.g. Supabase insert error at `plan/approve` line 135 or
  184): unchanged existing behavior — the route already logs the insert error and continues to the
  next session in the loop (`console.error(...)`, no throw). Adding `planned_duration_mins` to the
  same insert payload does not change this error handling; if the insert fails, neither column is
  written, exactly as neither is written today.
- **`start` route's other existing error branches** (session not found / 404, plan not approved /
  403, no minutes / 403, insufficient minutes / 403): all unchanged, and all now run strictly after
  the new `status === 'completed'` check, which is inserted as the very first check in the handler
  after the session/user fetch.

## 9. Edge Cases

- **Historical rows, never force-ended**: `duration_mins` still holds the true original plan for
  these rows (they were never overwritten). Migration backfill sets
  `planned_duration_mins = duration_mins` for these — this is a safe, accurate backfill, not a
  guess, because nothing has touched `duration_mins` since insert.
- **Historical rows, force-ended at least once**: `duration_mins` no longer holds the true plan —
  it holds whatever was last billed. Per the brief's explicit instruction (Constraint 4) and Arun's
  non-negotiable "do not invent a recovery heuristic," the migration backfill still sets
  `planned_duration_mins = duration_mins` for these rows too (there is no cheaper way to avoid a
  blank UI per AC-8), but this is documented plainly in the migration file and this spec as a
  **best-effort default that carries no accuracy guarantee** for any row where `duration_mins` has
  already been overwritten by a billing event before this migration runs. There is no way to
  distinguish "row never force-ended" from "row force-ended, value coincidentally still correct"
  from "row force-ended, value now wrong" purely from the current schema — the migration does not
  attempt this distinction. This is the deliberate tradeoff Section 4 of the brief calls for: null
  vs. best-effort-backfill was the choice, and best-effort-backfill was chosen (over null) because
  every current UI read site already assumes a numeric value is always present and falling back to
  `null`/blank across the entire historical dataset would be a much larger, more visible regression
  than a best-effort number that is sometimes stale for pre-migration rows only. **This tradeoff is
  flagged here explicitly for Arun's sign-off before this spec is approved** (see Section 5 of the
  brief's own instructions — visibility into this decision before it ships is required).
- **A session force-ended twice in a row**: covered by AC-4 — `planned_duration_mins` is immune by
  construction, since no force-end code path ever writes to it.
- **A session that never reaches `speak_verified` (0 minutes billed)**: covered by AC-7 —
  `planned_duration_mins` and `duration_mins` diverge by design (15 vs. 0, e.g.), and this is
  correct, not a bug.
- **Rejoin attempt immediately after completion vs. much later**: covered by AC-9 — no time
  component in the check.
- **A session with `status = 'cancelled'`** (exists as a status value per `app/dashboard/page.tsx`
  line 74 filter): out of scope for the rejoin block — the brief and action items only ever discuss
  `'completed'` as the problematic status enabling the real incident. `'cancelled'` sessions are not
  addressed by this spec; if rejoining a cancelled session is also undesirable, that is a separate,
  future decision requiring its own sign-off, not assumed here.
- **Mobile vs. desktop**: no layout differs; this is a data-correctness fix with one new error
  banner reusing an existing, already-responsive component. No separate mobile spec needed.
- **The graceful-session-end nudge feature** (already shipped, in progress separately): see Section
  10 (Out of Scope) — explicitly does not intersect this spec's write paths per direct code
  confirmation below.

## 10. Out of Scope

- **`computeBilledMinutes()` and any billing-math logic in `lib/session-billing.ts`.** Confirmed by
  direct read: this function's cycle-scoping fix (2026-07-05) is untouched by this spec. Zero lines
  of that function change.
- **Deleting the `duration_mins` column.** It is repurposed/clarified in meaning only, per Arun's
  explicit non-negotiable constraint. It keeps its current name, type, nullability, and default.
- **Any new recovery/heuristic mechanism for historical planned-duration data.** Explicitly
  rejected per Section 9 — the best-effort backfill is a plain copy, not an inferred estimate from
  any other signal (audit log, session type, etc.).
- **The graceful-session-end nudge feature.** Confirmed via direct code read of
  `lib/session-billing.ts` and both end-session routes: nothing in the nudge feature (which is a
  separate, already-shipped mechanism for warning a user their session is about to end) writes to
  `sessions.duration_mins` or would need to write to `planned_duration_mins`. No coordination
  conflict exists between the two efforts — they touch different code paths entirely (the nudge
  feature is a client/timer-side warning; this spec is a server-side field split + join gate).
- **Blocking rejoin of `'cancelled'` sessions.** See Section 9 — only `'completed'` is addressed.
- **Any change to `app/api/sessions/schedule/route.ts`'s rescheduling logic**, beyond none needed —
  that route already protects `'completed'`/`'active'` sessions from being touched (line 63) and
  never writes `duration_mins` or `planned_duration_mins` itself; it only updates `scheduled_at`.
- **New UI copy, new components, new pages.** The one new error state reuses the existing error-
  banner pattern already present in `SessionDetailClient.tsx`.
- **Any change to how `minutesBalance < session.duration_mins` insufficient-minutes checks work**
  (`start/route.ts` line 70, `SessionDetailClient.tsx` line 966/972) — these deliberately keep
  reading `duration_mins`, not `planned_duration_mins`. Rationale: at the moment `/start` runs, for
  a session that has never been billed, `duration_mins` still equals the plan (same value as
  `planned_duration_mins`) — so behavior is identical either way for the normal case. For a session
  that has previously been force-ended and is now being legitimately restarted in a *future*, not-
  yet-completed cycle (this can only happen for `'active'`/`'scheduled'` sessions, not `'completed'`
  ones, since those are now blocked outright) `duration_mins` may already reflect a prior partial
  bill rather than the plan; this pre-existing minutes-sufficiency check behavior is not changed by
  this spec and is called out here as a known, separate, non-blocking observation — not something
  this ticket fixes.

## 11. Open Questions

None.

## 12. Dependencies

- **Migration must run before the code deploy that reads `planned_duration_mins`.** Standard
  Supabase migration ordering: add the column (nullable, no default) and run the one-time backfill
  UPDATE (`planned_duration_mins = duration_mins` for all existing rows where
  `planned_duration_mins IS NULL`) in the same migration file, before any application code assumes
  the column exists.
- **`app/api/plan/approve/route.ts`** must ship in the same deploy as the migration (or after it) —
  it is the only creation path and must write both columns from day one going forward.
- **`app/api/sessions/[id]/start/route.ts`** rejoin-block change has no schema dependency and can
  ship independently of the schema change, but shipping both together in one deploy is recommended
  to close both halves of the root cause (per the action-items doc, items #2/#3 and #11 are
  presented as one combined fix).
- No dependency on the graceful-session-end nudge feature — confirmed independent (Section 10).
- No dependency on any pending database migration mentioned elsewhere in
  `docs/ACTION-ITEMS-2026-07-06.md` (items #7/#9/#10's `058_hume_native_config_archive.sql` is
  unrelated to `sessions` and can be applied independently, in any order, relative to this feature).

---

## Site-by-site field mapping (full detail, per brief Constraint 3 / Question 4)

| # | File : Line | Current read | After split | Example before → after |
|---|---|---|---|---|
| 1 | `app/dashboard/sessions/SessionsClient.tsx:177` | `{session.duration_mins}m` — per-row badge in the sessions list, shown for sessions of **any** status (scheduled, active, completed) | Read `session.planned_duration_mins ?? session.duration_mins ?? 30` — this is a length badge shown regardless of status, and the user's mental model here is "how long is/was this session," which is the plan, not the bill | Before: completed session force-ended at 2 min shows "2m". After: shows "15m" (the plan) consistently for every row regardless of status |
| 2 | `app/dashboard/sessions/SessionsClient.tsx:351` | `group.sessions.reduce((sum, s) => sum + s.duration_mins, 0)` — topic-group total minutes | Read `s.planned_duration_mins ?? s.duration_mins ?? 30` per session in the sum — a group total is a planning/overview figure ("this topic is about N minutes of content"), not a running bill | Before: a group with one corrupted 2-min session showed an artificially low group total. After: total reflects the real planned length of every session in the group |
| 3 | `app/dashboard/sessions/[id]/SessionDetailClient.tsx:499` (inside `session.status === 'completed'` block, "Minutes used") | `{session.duration_mins} min` | **No change** — this is explicitly the post-completion actual-billed display (comment at line 487 already says "per-call minutes used, completed sessions only"); it is correct today and stays on `duration_mins` | `12 min` (unchanged) |
| 4 | `app/dashboard/sessions/[id]/SessionDetailClient.tsx:533` ("Duration" row, always shown regardless of status) | `~{session.duration_mins} minutes` | Read `~{session.planned_duration_mins ?? session.duration_mins} minutes` — this row appears for scheduled, active, AND completed sessions and today is the exact bug the brief flags (same field, two meanings); it must always show the plan | Before (post-force-end): "~2 minutes". After: "~15 minutes", permanently, regardless of what got billed |
| 5 | `app/dashboard/sessions/[id]/SessionDetailClient.tsx:383, 392` (`effectiveDurationMins` used to start the client-side countdown timer via `startTimer()`) | `session.duration_mins`, overridden by `startData.effectiveDurationMins` from the `/start` response | **No change to the client.** The `/start` route itself must be updated to compute `effectiveDurationMins` from `session.planned_duration_mins ?? session.duration_mins` server-side (see row 9 below) — the client already just takes whatever the server returns, so no client-side edit is needed here beyond what row 9 covers |
| 6 | `app/dashboard/sessions/[id]/SessionDetailClient.tsx:966, 972` (insufficient-minutes check/copy) | `session.duration_mins` | **No change** — see Section 10 rationale; deliberately kept on `duration_mins` |
| 7 | `app/dashboard/DashboardClient.tsx:252` ("next upcoming session" card) | `~{session.duration_mins} min` | Read `~{session.planned_duration_mins ?? session.duration_mins} min` — confirmed via `app/dashboard/page.tsx` lines 68-76 that this query explicitly excludes `status = 'completed'` and `status = 'cancelled'`, so this card is ALWAYS a pre-session estimate, never a post-completion actual | Before (if this session had been force-ended in a prior cycle and somehow reappeared, edge case): could show a stale billed number. After: always shows the true plan |
| 8 | `app/dashboard/knowledge-base/[topicId]/KBTopicClient.tsx:354` (synthetic Session Overview tab, `so_what_preview`) | `` `${session?.duration_mins ?? 30}-minute session...` `` | `` `${session?.planned_duration_mins ?? session?.duration_mins ?? 30}-minute session...` `` — this is a pre-session content preview shown in the knowledge-base tab, always describing the plan, never a bill | Before: "2-minute session · 4 subtopics" for a previously force-ended session. After: "15-minute session · 4 subtopics" |
| 9 | `app/api/kb/topics/[topicId]/route.ts:186` (`sessionOut.duration_mins`, feeds row 8 above) | `duration_mins: thisSession.duration_mins` | Add the field through: `duration_mins: thisSession.duration_mins, planned_duration_mins: thisSession.planned_duration_mins` — and update the `select()` at line 90 to also fetch `planned_duration_mins` | API response gains one new field; existing `duration_mins` field on the response is left as-is for any other consumer |
| 10 | `app/dashboard/schedule-setup/ScheduleSetupClient.tsx:149` (`estimatedMinutes: s.duration_mins ?? 30`, sent to `/api/sessions/schedule`) | `s.duration_mins ?? 30` | `s.planned_duration_mins ?? s.duration_mins ?? 30` — schedule-setup only ever operates on not-yet-completed sessions (this screen is pre-session by definition), so it should reflect the plan | Before/after identical for the common case (session never force-ended); differs only for a session that was previously force-ended and is being rescheduled, now correctly showing its original plan instead of a prior partial bill |
| 11 | `app/api/sessions/[id]/start/route.ts:31, 70, 72, 80` (`session.duration_mins` used for balance check, error copy, and `effectiveDurationMins` returned to start the timer) | `session.duration_mins` throughout | Update the `select()` at line 31 to also fetch `planned_duration_mins`. Change line 80's `effectiveDurationMins` assignment to `session.planned_duration_mins ?? session.duration_mins` — this is the value that seeds the countdown timer (row 5 above) and must always be the full plan, never a corrupted prior bill, closing the exact symptom described in the brief ("must always start fresh from the full planned length"). **Leave lines 70/72 (the balance-sufficiency check and its error copy) on `session.duration_mins`** per the Section 10 rationale — changing the balance check is out of scope for this ticket | Before (post-force-end): timer could start from a corrupted short value. After: timer always starts from the true planned length |
| 12 | `app/api/recall/bot/route.ts:89` (`sessionDurationMins`, passed into `buildAllClioDocs` for the AI's own context/prompt, and used in the synthetic overview's `so_what_preview` at line 379) | `(sessionData?.duration_mins as number | null) ?? 15` | Update the `select()` at line 60 to also fetch `planned_duration_mins`; change to `(sessionData?.planned_duration_mins as number | null) ?? (sessionData?.duration_mins as number | null) ?? 15` — this value tells Clio (the AI) and the user-facing overview tab how long the session is meant to run, which is plan, not bill | Before: an AI briefing document could describe a 2-minute session that was actually planned as 15. After: always describes the true plan |
| 13 | `app/api/sessions/[id]/end/route.ts:79` and `lib/session-billing.ts:296` (both write `duration_mins: <billed value>`) | writes only `duration_mins` | **No change** — these remain the only two writers of "actual billed minutes," exactly as today, and must never write `planned_duration_mins` |
| 14 | `app/api/sessions/calendar/route.ts:41` and `app/api/sessions/[id]/calendar/route.ts:51` (`durationMinutes: (s.duration_mins as number) ?? 30`, used to build `.ics` calendar invite duration) | `s.duration_mins ?? 30` | `s.planned_duration_mins ?? s.duration_mins ?? 30` — a calendar invite is always describing a future/planned meeting length, never a bill. Update both routes' `select()` to include `planned_duration_mins` | Before/after identical for normal case; corrected for a previously force-ended session being re-invited |
| 15 | `inngest/session-reminder.ts:71` and `inngest/session-agenda-email.ts:66` (`estimatedMinutes: (session.duration_mins as number) ?? 30`, used in reminder/agenda emails sent before a session) | `session.duration_mins ?? 30` | `session.planned_duration_mins ?? session.duration_mins ?? 30` — pre-session email copy, same rationale as row 14. Update both jobs' `select()` to include `planned_duration_mins` | Before/after identical for normal case; corrected for previously-force-ended sessions |
| 16 | `inngest/session-content-pipeline.ts:165` (`sessionDurationMins`, used to adapt/condense the training script length — "Step D.5: Adapt script to session duration") | `(session as {...}).duration_mins ?? null` | `(session as {...}).planned_duration_mins ?? (session as {...}).duration_mins ?? null` — content generation must always target the planned length of the session it's writing content FOR, never a previously billed amount. Update this job's `select()` (line 145) to include `planned_duration_mins` | Before: content generation for a re-run/re-generated session could target a corrupted short duration. After: always targets the true plan |

**Sites deliberately left unchanged (confirmed correct as-is, reasons noted above):** row 3, row 6,
row 13, and the balance checks in row 11.

---

**(a) File written:** confirmed — `docs/specs/SESSION-DURATION-01-requirement-doc.md`

**(b) Section 11 (Open Questions):** confirmed empty. All six of the CEO brief's open questions are
resolved concretely in this document: (1) new-column naming/shape in Section 6, (2) backfill
strategy in Section 9 (best-effort copy from `duration_mins`, explicitly caveated, flagged for
Arun's sign-off), (3) rejoin-block mechanics in Sections 3/4/7 (AC-5, AC-6, AC-9) — confirmed the
guard belongs solely in `app/api/sessions/[id]/start/route.ts`; `app/api/recall/bot/route.ts` does
not need its own duplicate guard because `/start` always runs first in the join sequence
(`SessionDetailClient.tsx`'s `handleLaunchBot` calls `/start` before `/api/recall/bot`) and blocking
there is sufficient, (4) site-by-site field mapping in the table above (16 sites), (5) interaction
with the graceful-session-end feature confirmed independent in Section 10, (6) full 12-section
write-up with acceptance criteria covering double force-end, zero-minute sessions, and immediate-vs-
delayed rejoin attempts.

**(c) Plain-English summary for Arun:**

Today, a session's "planned length" and "actual minutes billed" share one database column, so the
first time a session gets force-ended, its original plan is gone forever — replaced by whatever got
billed. This spec adds a second, permanent column (`planned_duration_mins`) that's set once when the
session is created and never touched again, while the existing column becomes purely "what was
actually billed." It also closes the bug that let a finished session be rejoined at all, which is
what caused the real 170-minute overcharge — trying to restart a completed session now gets rejected
outright with a clear error, exactly like the "insufficient minutes" error you already see today.
Sixteen places in the UI/API that show a duration were individually checked and updated to show the
right one. For sessions created before this ships, we can't recover their true original plan if
they were ever force-ended — we copy over the current (possibly-already-wrong) number as a
best-effort default rather than showing a blank, and I'm flagging that as a deliberate, visible
tradeoff rather than deciding it silently. No billing math changes at all.

---

## CEO Approval

**Date:** 2026-07-05
**Reviewer:** CEO Agent (on behalf of Arun)
**Verdict:** APPROVED for development.

Verified against the feature brief:
- Core fix (planned vs. actual duration split) matches brief exactly — new immutable
  `planned_duration_mins`, `duration_mins` repurposed not deleted, both columns written once at
  insert only by `plan/approve/route.ts`.
- Rejoin block matches brief exactly — single guard in `start/route.ts`, checked first, 409 with
  a typed error code, no time-based leniency, no duplicate guard needed at `recall/bot/route.ts`
  (justified by call-order dependency, not assumed).
- Section 11 confirmed genuinely empty — the 16-row site-by-site table covers all 6 files named in
  the brief plus 10 additional real call sites found independently (calendar routes, reminder/
  agenda emails, content pipeline, KB API, admin test/backfill routes). Three sites are explicitly
  left unchanged with stated rationale, which is evidence of real per-site judgment, not a
  mechanical find-replace.
- Backfill decision is honest: Section 9 states plainly that the schema cannot distinguish
  "never force-ended" from "force-ended, coincidentally correct" from "force-ended, now wrong,"
  names the tradeoff (best-effort copy over null), and does not invent a recovery heuristic.
- Non-negotiables held: `computeBilledMinutes` untouched (AC-10, byte-for-byte); no column
  deletion; graceful-session-end nudge feature confirmed independent and out of scope.

**One item routed to Arun directly, not absorbed by this approval:** the Section 9 backfill
tradeoff — historical sessions that were ever force-ended will display a "best-effort, no accuracy
guarantee" planned-duration number with no way to know which specific rows are affected. This is a
product/data-integrity call, not an engineering one, and the brief itself asked for it to be visible
before shipping. Development may proceed on everything else in this spec; the backfill migration
step specifically should get an explicit go/no-go from Arun before that migration is applied to
production data.
