# DUR-01 — Duration Fallback Consistency Fix — Requirement Document
Version: 1.0
Status: APPROVED (pending final CEO sign-off pass)
Author: Business Analyst Agent
Date: 2026-07-07

Scope note: this is a backend logic-consistency fix with zero UI/UX surface. Per the
Feature Brief's explicit instruction and the project's "spec before build" standing rule,
sections that are purely UX-oriented (5. Visual Examples) are shortened to a one-line
justification rather than populated with wireframes, since there is no screen, copy, or
visual state involved anywhere in this change. All other sections are filled in full,
scoped to the precision a developer needs to make zero interpretive choices.

---

## 1. Purpose

Four call sites in the codebase read a session's duration from the database. Three of
them (`GET /api/sessions/[id]`, the minutes-balance check in
`POST /api/sessions/[id]/start`, and the existing-session lookup in
`POST /api/sessions/schedule`) read the raw `duration_mins` column directly, while the
rest of the codebase (including the *other* half of `start/route.ts`, line 95) correctly
falls back through `planned_duration_mins ?? duration_mins`. This inconsistency means the
same session can report two different "durations" depending on which code path touched
it — a latent correctness bug that has not yet caused visible user harm only because
`duration_mins` has been populated for every session created so far.

The more serious defect lives in `inngest/session-content-pipeline.ts`, the content
generation pipeline. When both `planned_duration_mins` and `duration_mins` are `null`
(true of every session created before 2026-07-05, per an explicit prior "do not backfill"
decision — and possible again in the future if any write path ever fails to set
duration), the pipeline silently:
1. Passes a hardcoded `30` into `generateScriptAndVisualization` as the word-budget
   target, regardless of the session's actual intended length, and
2. Skips the `adaptScriptToDuration` compression/expansion step entirely, because its
   guard (`sessionDurationMins ? {...} : rawScriptAndViz`) treats `null` as falsy.

Failure mode without this fix: a session generated under the null/null condition gets
script content silently sized for the wrong duration with no corrective step — this is a
content-correctness defect, not merely a cosmetic display bug, because it directly
determines what gets spoken/shown to the user in a live or KB session.

## 2. User Story

Not applicable in the traditional sense — this is a system-integrity fix with no new
user-visible behavior and no new UI. Restated as an engineering-invariant story for
traceability:

As the Clio system (any code path that reads or generates content against a session's
duration),
I want a single, consistently-applied duration-resolution rule everywhere `duration_mins`
is read,
So that a session's effective duration never silently differs between the billing check,
the API response, the schedule confirmation flow, and the content-generation pipeline.

## 3. Trigger / Entry Point

Not a user-facing trigger. The affected code paths activate on:
- `GET /api/sessions/[id]` — called when `SessionDetailClient.tsx` polls for `meeting_url`
  (existing behavior, unchanged trigger).
- `POST /api/sessions/[id]/start` — called when the Recall.ai bot successfully joins the
  meeting (existing trigger, unchanged).
- `POST /api/sessions/schedule` — called when the user confirms session scheduling from
  `ScheduleSetupClient.tsx` (existing trigger, unchanged).
- `inngest/session-content-pipeline.ts` — triggered by the `clio/session.content.generate`
  Inngest event (existing trigger, unchanged). No new event, no new schedule.

This fix changes internal logic only; it introduces no new routes, no new UI states, and
no new triggers.

## 4. Screen / Flow Description

Not applicable — no user-facing screen or flow changes in any way. All four affected code
paths are backend logic; their observable *inputs* (button clicks, page loads) and
*external outputs* (SMS/email copy, redirect targets, HTTP status codes) are unchanged.
The only thing that changes is which number is computed internally as "the session's
duration" when resolving from the database.

## 5. Visual Examples

Not applicable — no wireframes required. There is no new or changed screen, no new copy,
and no new visual state anywhere in this fix (confirmed against Feature Brief's explicit
"no new screens, no new copy, no UX change of any kind" constraint).

## 6. Data Requirements

No schema changes. No new columns, no new tables, no migration. This section documents
exactly which existing columns are read/written differently per file.

### 6.1 `app/api/sessions/[id]/route.ts`
- **Read (before):** `select('id, session_title, scheduled_at, status, duration_mins, meeting_url, topics, topic_id')`
- **Read (after):** adds `planned_duration_mins` to the select list.
- **Write:** none (GET only).
- **Response shape (before):** `{ session: { ...raw columns... } }`
- **Response shape (after):** `{ session: { ...raw columns including planned_duration_mins..., effective_duration_mins } }` — `effective_duration_mins` is a new computed field appended to the response object (not a DB column), value = `planned_duration_mins ?? duration_mins`. See Section 7 (Question 2 resolution) for why both raw columns are kept.

### 6.2 `app/api/sessions/[id]/start/route.ts`
- **Read (before/after, unchanged):** `select('id, status, duration_mins, planned_duration_mins, curriculum_plan_id')` — already selects both columns; no select change needed.
- **Write:** none new. Existing `.update({ started_at, status: 'active' })` unchanged.
- **Logic change only:** the fallback computation that already exists at line 95 (`effectiveDurationMins`) is moved earlier and reused for the line-81 minutes-balance check. See Section 8.

### 6.3 `app/api/sessions/schedule/route.ts`
- **Read (before):** `select('id, session_index, session_title, scheduled_at, duration_mins, status')`
- **Read (after):** adds `planned_duration_mins` to the select list.
- **Map type (before):** `Map<number, { id, session_title, duration_mins, status }>`
- **Map type (after):** `Map<number, { id, session_title, duration_mins, planned_duration_mins, status }>`
- **Write:** none (this endpoint only ever writes `scheduled_at`; it never writes duration).
- Note: this file currently has **zero** downstream reads of `existing.duration_mins` after the select — the map is only used for `existing.status`, `existing.id`, and `existing.session_title` (see line 89-97). There is no minutes/duration computation anywhere else in this file. This resolves Question 3 (Section 11 equivalent, below) — the fix here is limited to the select clause and type signature; no behavioral logic changes because no duration value is currently derived or used in this file.

### 6.4 `inngest/session-content-pipeline.ts`
- **Read (already unchanged):** `select(...,'duration_mins, planned_duration_mins')` on the `sessions` table — already selects both.
- **New read added:** the user's `learning_goal` column, needed only in the fallback branch. Current query at "Step A" selects `role, industry, ai_maturity, role_level` from `users` — `learning_goal` must be added to that same select (no new query round-trip).
- **Write:** none new.
- **New import:** `getSessionDuration` from `lib/curriculum/session-designer.ts` (already exported, reused verbatim — see Non-Goals).

## 7. Success Criteria (Acceptance Tests)

✓ **AC-1 (GET /api/sessions/[id] — both fields present):** Given a session row with `duration_mins=20` and `planned_duration_mins=15`, when `GET /api/sessions/[id]` is called, then the response `session` object contains `duration_mins: 20`, `planned_duration_mins: 15`, and `effective_duration_mins: 15`.

✓ **AC-2 (GET /api/sessions/[id] — only duration_mins present):** Given `duration_mins=20`, `planned_duration_mins=null`, when called, then `effective_duration_mins: 20`.

✓ **AC-3 (start/route.ts — balance check uses resolved value):** Given `planned_duration_mins=25`, `duration_mins=40` (a previously-billed stale value), and `minutes_balance=30`, when `POST /api/sessions/[id]/start` is called, then the balance check passes (30 ≥ 25, using the resolved value, not the stale 40) and the response's `effectiveDurationMins` is `25` — both reads agree.

✓ **AC-4 (start/route.ts — insufficient balance uses resolved value):** Given `planned_duration_mins=25`, `duration_mins=40`, `minutes_balance=10`, when called, then the 403 error message reads "This session requires 25 minutes but you have 10 remaining" (not 40) — the error message and the accept/reject decision both reference the same resolved number.

✓ **AC-5 (schedule/route.ts — select does not break existing flow):** Given an existing session at `session_index=1`, when `POST /api/sessions/schedule` is called with a matching `sessionIndex`, then the update, skip-protected-status logic, and email/SMS confirmation all behave exactly as before (regression check — this file's only change is an additive column in the select and type; no behavioral branch depends on it).

✓ **AC-6 (pipeline — both fields present):** Given a session with `planned_duration_mins=20`, `duration_mins=15`, when the content pipeline runs, then `sessionDurationMins` resolves to `20`, is passed to `generateScriptAndVisualization`, and `adaptScriptToDuration` is invoked (not skipped).

✓ **AC-7 (pipeline — only duration_mins present):** Given `planned_duration_mins=null`, `duration_mins=15`, then `sessionDurationMins` resolves to `15` and `adaptScriptToDuration` is invoked.

✓ **AC-8 (pipeline — both null, learning_goal present):** Given `planned_duration_mins=null`, `duration_mins=null`, and the session's user has `learning_goal='quick_wins'`, then `sessionDurationMins` resolves to `getSessionDuration('quick_wins') === 5`, this value is passed into `generateScriptAndVisualization`, and `adaptScriptToDuration` **is invoked** (not skipped) with `targetMinutes=5`.

✓ **AC-9 (pipeline — both null, learning_goal also null/missing):** Given `planned_duration_mins=null`, `duration_mins=null`, and the user's `learning_goal` is `null` or the user row itself is missing, then `sessionDurationMins` resolves to the hardcoded absolute-last-resort value of `30` (matching `getSessionDuration`'s own internal default of 15 is explicitly NOT reused here — see Section 11 resolution below for why 30, not 15, is correct), and `adaptScriptToDuration` **is invoked** with `targetMinutes=30` (this is the core fix — previously this exact case skipped `adaptScriptToDuration` entirely).

✓ **AC-10 (typecheck):** `npx tsc --noEmit` passes with zero errors after all four files are changed.

✓ **AC-11 (non-goal enforcement):** `git diff` on `lib/curriculum/session-organizer.ts` and `lib/curriculum/session-designer.ts` is empty.

## 8. Error States

No new error states are introduced. Existing error handling is preserved as-is in every
file:
- `route.ts` (GET): unchanged 404 if session not found.
- `start/route.ts`: unchanged 403s for zero balance / insufficient balance / unapproved
  plan; unchanged 404 for session not found. The only change is which number feeds the
  insufficient-balance comparison and message (Section 7, AC-3/AC-4) — no new failure
  mode, no new status code.
- `schedule/route.ts`: unchanged — no error paths are touched since no logic branches on
  `duration_mins` in this file today (Section 6.3).
- `session-content-pipeline.ts`: no new error path. If the added `learning_goal` select on
  the `users` query fails or returns null, this is treated as "goal missing" and folds
  into the existing AC-9 last-resort branch — it does not throw, does not fail the step,
  and does not block content generation. This preserves the pipeline's existing
  fault-tolerance posture (per-session failures already isolated via `step.run` +
  `onFailure` admin alert, both untouched).

## 9. Edge Cases

- **Session with `duration_mins=0`:** `0 ?? x` in JS/TS nullish-coalescing does NOT fall
  through (0 is not null/undefined), so `planned_duration_mins ?? duration_mins` correctly
  preserves an explicit `0` if ever set. No special-casing needed; this matches existing
  behavior at `start/route.ts:95` today (confirmed: the file already renders "0 min"
  specially in `SessionDetailClient.tsx:494`, a display concern, out of scope here).
- **`learning_goal` present but not a recognized key** (e.g. a typo'd/legacy value not in
  `LEARNING_GOAL_MINUTES`): `getSessionDuration` already handles this — it defaults to
  `15` internally (its own `?? 15` fallback, see `session-designer.ts:12`). This is
  reused as-is; DUR-01 does not add a second layer of validation on top of it.
- **`learning_goal` is an empty string `''`:** same as above — `LEARNING_GOAL_MINUTES['']`
  is `undefined`, so `getSessionDuration`'s internal `?? 15` applies. No special handling
  needed in the pipeline; treated identically to "goal present but unrecognized," which
  still counts as "goal present" for AC-8 (routes to `getSessionDuration`, not to the
  hardcoded-30 AC-9 branch) — see Section 11 resolution for the exact truthiness check.
- **Historical sessions (created before 2026-07-05) with both duration fields null:**
  explicitly left alone — no backfill (Non-Goals). They will hit AC-8 or AC-9 the next
  time their content pipeline runs (e.g. on regeneration), which is the intended and
  sufficient fix per the Feature Brief ("if the newer sessions work correctly... that is
  sufficient" — this also correctly repairs any old session whose pipeline re-runs, as a
  side effect, without any dedicated backfill work).
- **`schedule/route.ts` receiving a session index with no `existing` match:** unchanged —
  already logs a warning and continues (line 60-61), untouched by this fix.
- **Concurrent read during a write:** out of scope; no change to transaction/consistency
  behavior in any of the four files.

## 10. Non-Goals

- **No backfill, migration, or data-correction script** for any existing session row with
  NULL duration fields. This is explicit and non-negotiable per the Feature Brief. Success
  is defined purely by "new/regenerated sessions behave correctly," not by fixing
  historical data at rest.
- **No changes whatsoever to `lib/curriculum/session-organizer.ts` or
  `lib/curriculum/session-designer.ts`'s session-count/topic-splitting logic.** These
  files derive duration fresh from `users.learning_goal` at plan-approval time, before
  session rows exist, and are confirmed correct today. `session-designer.ts`'s
  `getSessionDuration` function and `LEARNING_GOAL_MINUTES` map are **reused by import
  only** — zero lines in that file are modified. `git diff` on both files must be empty
  (AC-11).
- **No work related to the deleted "retake completed session" feature** (removed in
  commits `a7a42d2` → `a8e13ce` per REVERT-01). Not touched, not reintroduced, not
  referenced.
- **No new UI, screen, copy, or visual state of any kind.**
- **No commit, push, or deploy** — changes are left as local uncommitted edits, consistent
  with the rest of this session's work, per the Feature Brief's explicit instruction.
- **No new API routes, no new Inngest events, no new database columns.**

## 11. Open Questions

None. All four questions from the Feature Brief are resolved below with the reasoning
that grounds each decision in the actual code (per the Brief's own instruction to attempt
hard resolution before escalating).

**Q1 — Pattern/helper name for "compute effective duration once" in `start/route.ts`:**
Resolved: a small local `const effectiveDurationMins = session.planned_duration_mins ??
session.duration_mins` computed once, immediately after the session/user fetch (before
line 73's balance check), and reused for both the line-81 comparison and the final
line-95 usage (which already has this exact expression — it is simply moved up and
de-duplicated, not changed in form). Rationale: the file already uses local `const`
computed-once patterns for `minutesBalance` (line 73) and `startedAt` (line 97) — a bare
local constant is the established style in this file, not a shared utility function. No
new utility file is warranted for a single-file, two-use-site expression.

**Q2 — GET /api/sessions/[id] response shape:** Resolved: keep both raw DB columns
(`duration_mins`, `planned_duration_mins`) in the select for transparency/debugging, AND
add a new computed `effective_duration_mins` field to the response JSON. Confirmed safe
by checking the only current caller — `SessionDetailClient.tsx:306` — which calls this
GET endpoint solely to poll for `meeting_url` (`data?.session?.meeting_url`); it does not
read `duration_mins` or any duration field from this endpoint's response at all (its
`session.duration_mins` usages elsewhere in that component, e.g. lines 384/489/967, come
from the page's initial server-rendered prop, a separate code path not touched by this
fix). Therefore adding a new field is fully additive and breaks nothing.

**Q3 — schedule/route.ts fallback scope:** Resolved: the fallback is needed only in the
select clause and the `existingByIndex` map's TypeScript type. Traced every use of
`existing.duration_mins` / `existingByIndex` after the select (lines 58-97): the map value
is only ever accessed for `.status`, `.id`, and `.session_title` — never for a duration
computation. This file never derives a duration or minutes value from `existing` at all.
(Separately, `GET /api/sessions/schedule` already does `select('*')`, so it already
returns both columns unfiltered — confirmed no fix needed there; its client-side consumer
`ScheduleSetupClient.tsx:150` already applies its own `planned_duration_mins ??
duration_mins ?? 30` fallback correctly today.) Conclusion: the POST handler's fix is
strictly additive (select clause + type annotation) with zero behavioral logic change,
because no logic in this file currently branches on duration.

**Q4 — Pipeline fallback chain and comment wording:** Resolved as a 4-step chain:
```
planned_duration_mins ?? duration_mins ?? getSessionDuration(learning_goal) ?? 30
```
More precisely (since `getSessionDuration` itself never returns null/undefined — it has
its own internal `?? 15` default for a present-but-unrecognized/empty goal — see Section
9), the actual chain must explicitly branch on whether `learning_goal` was present at all,
not just chain nullish-coalescing naively (naive chaining would never reach the hardcoded
30, since `getSessionDuration` always returns a number). The exact logic:
```ts
const rawDurationMins = session.planned_duration_mins ?? session.duration_mins ?? null
const sessionDurationMins: number = rawDurationMins
  ?? (userProfile?.learning_goal
        ? getSessionDuration(userProfile.learning_goal)
        // Absolute last resort: both duration_mins/planned_duration_mins AND the
        // user's learning_goal are missing. This should not happen for any session
        // created after the AUTOGEN-01 session-generation pipeline went live, but is
        // kept as a hard floor so content generation never throws on a fully-null
        // duration input. 30 (not getSessionDuration's own 15-minute internal
        // default) is used deliberately here to match this pipeline's pre-existing
        // historical default value, minimizing behavior change for the rare rows
        // that hit this exact branch.
        : 30)
```
This makes `sessionDurationMins` a plain `number` (never `null`), which means the
`sessionDurationMins ? {...} : rawScriptAndViz` guard around `adaptScriptToDuration`
always evaluates truthy for any nonzero duration — satisfying AC-6 through AC-9 in one
change. (Note: if `sessionDurationMins` could ever legitimately be `0`, the truthy check
would still skip adaptation — but 0-minute sessions are not a real scenario for content
generation, since `ScheduledSessionSchema` in `schedule/route.ts` already enforces
`estimatedMinutes: z.number().int().positive().max(120)` at creation time, so a
newly-created session can never carry a 0-minute duration into this pipeline.)

## 12. Dependencies

- `lib/curriculum/session-designer.ts`'s exported `getSessionDuration` and
  `LEARNING_GOAL_MINUTES` — must exist unchanged (confirmed present, lines 5-13).
- The `users` table must have a `learning_goal` column already (used elsewhere in the
  codebase for plan generation) — confirmed exists and is queryable; only being added to
  one additional `select()` call in the pipeline's existing Step A query, no schema work.
- No other feature must land first; this is a standalone, self-contained fix across
  exactly four files with no build-order dependency on other in-flight work.

---

## Exact Diff-Level Changes Per File

### File 1: `app/api/sessions/[id]/route.ts`

```ts
// BEFORE (line 15-24):
  const { data: session } = await supabase
    .from('sessions')
    .select('id, session_title, scheduled_at, status, duration_mins, meeting_url, topics, topic_id')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  return NextResponse.json({ session })

// AFTER:
  const { data: session } = await supabase
    .from('sessions')
    .select('id, session_title, scheduled_at, status, duration_mins, planned_duration_mins, meeting_url, topics, topic_id')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // DUR-01: expose a single resolved duration value alongside the raw columns so any
  // consumer can use `effective_duration_mins` without re-implementing the fallback.
  const effective_duration_mins = session.planned_duration_mins ?? session.duration_mins

  return NextResponse.json({ session: { ...session, effective_duration_mins } })
```

### File 2: `app/api/sessions/[id]/start/route.ts`

```ts
// BEFORE (line 73-95):
  const minutesBalance = user?.minutes_balance ?? 0
  if (minutesBalance <= 0) {
    return NextResponse.json(
      { error: 'No minutes remaining. Please top up or upgrade your plan.' },
      { status: 403 }
    )
  }

  if (minutesBalance < session.duration_mins) {
    return NextResponse.json(
      { error: `Insufficient minutes. This session requires ${session.duration_mins} minutes but you have ${minutesBalance} remaining.` },
      { status: 403 }
    )
  }

  // Timer runs for the planned session duration (not the full balance).
  // ... (comment unchanged) ...
  const effectiveDurationMins = session.planned_duration_mins ?? session.duration_mins

// AFTER:
  const minutesBalance = user?.minutes_balance ?? 0
  if (minutesBalance <= 0) {
    return NextResponse.json(
      { error: 'No minutes remaining. Please top up or upgrade your plan.' },
      { status: 403 }
    )
  }

  // DUR-01: compute the resolved duration once, before either usage below, so the
  // minutes-balance check and the timer-seed value can never disagree.
  // SESSION-DURATION-01: always seed from the immutable planned length, never from
  // duration_mins alone, since duration_mins may already hold a prior billed value for
  // a session that was previously force-ended and is now being legitimately restarted.
  const effectiveDurationMins = session.planned_duration_mins ?? session.duration_mins

  if (minutesBalance < effectiveDurationMins) {
    return NextResponse.json(
      { error: `Insufficient minutes. This session requires ${effectiveDurationMins} minutes but you have ${minutesBalance} remaining.` },
      { status: 403 }
    )
  }

  // Timer runs for the planned session duration (not the full balance).
  // The server-side Inngest timer enforces this — it fires a warning at T-1min and
  // force-ends the session at T, regardless of client state.
```
Note: the second `const effectiveDurationMins = ...` declaration (old line 95) is
deleted — it is now declared once, above, and reused at both call sites. No other line in
this file changes.

### File 3: `app/api/sessions/schedule/route.ts`

```ts
// BEFORE (line 46-54):
  const { data: existingSessions } = await supabase
    .from('sessions')
    .select('id, session_index, session_title, scheduled_at, duration_mins, status')
    .eq('user_id', userId!)
    .order('session_index', { ascending: true })

  const existingByIndex = new Map<number, { id: string; session_title: string; duration_mins: number; status: string }>(
    (existingSessions ?? []).map((s: { id: string; session_index: number; session_title: string; duration_mins: number; status: string }) => [s.session_index, s])
  )

// AFTER:
  const { data: existingSessions } = await supabase
    .from('sessions')
    .select('id, session_index, session_title, scheduled_at, duration_mins, planned_duration_mins, status')
    .eq('user_id', userId!)
    .order('session_index', { ascending: true })

  const existingByIndex = new Map<number, { id: string; session_title: string; duration_mins: number; planned_duration_mins: number | null; status: string }>(
    (existingSessions ?? []).map((s: { id: string; session_index: number; session_title: string; duration_mins: number; planned_duration_mins: number | null; status: string }) => [s.session_index, s])
  )
```
No other line in this file changes — confirmed (Section 11, Q3) that no downstream logic
in this file reads a duration value from `existingByIndex`. This is a select-clause and
type-signature addition only, made for consistency/future-proofing per the Feature
Brief's stated goal, with zero behavioral change today.

### File 4: `inngest/session-content-pipeline.ts`

```ts
// BEFORE (Step A user select, ~line 130):
        supabase
          .from('users')
          .select('role, industry, ai_maturity, role_level')
          .eq('id', userId)
          .single(),
      ])
      return {
        session: sessionRow,
        userProfile: userRow as { role?: string | null; industry?: string | null; ai_maturity?: string | null; role_level?: string | null } | null,
      }
    })

// AFTER:
        supabase
          .from('users')
          .select('role, industry, ai_maturity, role_level, learning_goal')
          .eq('id', userId)
          .single(),
      ])
      return {
        session: sessionRow,
        userProfile: userRow as { role?: string | null; industry?: string | null; ai_maturity?: string | null; role_level?: string | null; learning_goal?: string | null } | null,
      }
    })
```

```ts
// BEFORE (~line 149-152):
    const sessionDurationMins: number | null =
      (session as unknown as { planned_duration_mins?: number | null; duration_mins?: number | null }).planned_duration_mins
      ?? (session as unknown as { duration_mins?: number | null }).duration_mins
      ?? null

// AFTER:
    // DUR-01: when both DB duration fields are missing, derive the correct duration
    // from the session's user's learning_goal via the existing session-designer helper
    // (reused, not modified — see docs/specs/DUR-01-requirement-document.md §11 Q4)
    // instead of silently defaulting the word-budget to a bare hardcoded 30. Only if
    // learning_goal is ALSO missing do we fall through to the hardcoded floor.
    const rawDurationMins =
      (session as unknown as { planned_duration_mins?: number | null; duration_mins?: number | null }).planned_duration_mins
      ?? (session as unknown as { duration_mins?: number | null }).duration_mins
      ?? null

    const sessionDurationMins: number = rawDurationMins
      ?? (userProfile?.learning_goal
            ? getSessionDuration(userProfile.learning_goal)
            // Absolute last resort: both duration_mins/planned_duration_mins AND the
            // user's learning_goal are missing. Should not occur for any session
            // created after the AUTOGEN-01 generation pipeline went live; kept as a
            // hard floor so content generation never throws on fully-null duration
            // input. Deliberately 30 (this pipeline's pre-existing historical
            // default), not getSessionDuration's own internal 15-minute default, to
            // minimize behavior change for the rare rows that hit this branch.
            : 30)
```

```ts
// BEFORE (~line 275, generateScriptAndVisualization call):
        const rawScriptAndViz = await generateScriptAndVisualization(
          article,
          userContext,
          isLast,
          i,
          articles.length,
          sessionDurationMins ?? 30
        )

// AFTER:
        const rawScriptAndViz = await generateScriptAndVisualization(
          article,
          userContext,
          isLast,
          i,
          articles.length,
          sessionDurationMins
        )
```
(`sessionDurationMins` is now always a `number`, so the `?? 30` at the call site is
redundant and removed — the fallback now happens once, upstream, at the point of
derivation, not duplicated at every call site that consumes it.)

```ts
// BEFORE (~line 283-295):
        const scriptAndViz = sessionDurationMins
          ? {
              ...rawScriptAndViz,
              segments: (await adaptScriptToDuration(
                {
                  subtopic_title: article.subtopic_title,
                  subtopic_slug: article.subtopic_slug,
                  segments: rawScriptAndViz.segments,
                  total_duration_seconds: rawScriptAndViz.total_duration_seconds,
                },
                sessionDurationMins,
                articles.length
              )).segments,
            }
          : rawScriptAndViz

// AFTER:
        // DUR-01: sessionDurationMins is now always a resolved number (never null),
        // so adaptScriptToDuration always runs — it is no longer possible to silently
        // skip this step due to a null duration.
        const scriptAndViz = {
          ...rawScriptAndViz,
          segments: (await adaptScriptToDuration(
            {
              subtopic_title: article.subtopic_title,
              subtopic_slug: article.subtopic_slug,
              segments: rawScriptAndViz.segments,
              total_duration_seconds: rawScriptAndViz.total_duration_seconds,
            },
            sessionDurationMins,
            articles.length
          )).segments,
        }
```

```ts
// New import to add near the top of the file, alongside other lib/curriculum or
// lib/content imports already present:
import { getSessionDuration } from '@/lib/curriculum/session-designer'
```

No other lines in `session-content-pipeline.ts` change. The `LIVE_CONDUCTOR_ENABLED`
branch, template selection, cache upsert, and all steps after Step D/D.5 are untouched.
