# Feature Brief: DUR-01 — Duration Fallback Consistency Fix
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-07

## What Arun Said
"we need to fix the logic and silently assuming 30 min fallback also. but need not fix the
existing session durations. if the newer sessions work correctly and if their duration does
not change anymore then that is sufficient"

## The Problem Being Solved
Two investigations already completed today established the following as fact (not to be
re-investigated):

1. Every user-facing DISPLAY of session duration already correctly does
   `planned_duration_mins ?? duration_mins`. That is not broken.
2. Three specific READ sites bypass that fallback and use raw `duration_mins` only,
   inconsistent with the rest of the codebase:
   - `app/api/sessions/[id]/route.ts:17` — GET select clause omits `planned_duration_mins`
     entirely.
   - `app/api/sessions/[id]/start/route.ts:81` — the minutes-balance check
     (`minutesBalance < session.duration_mins`) uses raw `duration_mins`, while the same
     file's line 95 (`effectiveDurationMins`) already does the correct fallback. Same file,
     inconsistent logic.
   - `app/api/sessions/schedule/route.ts:48` — select clause omits `planned_duration_mins`
     entirely.
3. The more serious defect: `inngest/session-content-pipeline.ts` (content-generation
   pipeline, not display) computes `sessionDurationMins = planned_duration_mins ??
   duration_mins ?? null`. If a session has BOTH fields null (true of every session created
   before 2026-07-05, by Arun's own explicit "don't backfill" decision on that date), the
   pipeline:
   - silently defaults the word-budget/generation prompt to a hardcoded 30 minutes
     (currently passed as `sessionDurationMins ?? 30` into `generateScriptAndVisualization`)
   - SKIPS the `adaptScriptToDuration` compression/expansion step entirely, because the
     `sessionDurationMins ? {...} : rawScriptAndViz` branch treats `null` as falsy
   This means actual spoken/generated content for a session could silently be generated for
   the wrong length with no correction — a content-correctness bug, not just a display bug.

Confirmed NOT in scope (do not touch, do not re-verify beyond this brief):
- `lib/curriculum/session-organizer.ts` / `lib/curriculum/session-designer.ts` — the
  session-count/topic-splitting logic. Investigation 2 confirmed this derives duration
  fresh from `users.learning_goal` at plan-approval time, before session rows exist, and
  never reads `duration_mins`/`planned_duration_mins` at all. It is correct today and must
  remain byte-for-byte untouched.
- The deleted "retake completed session" feature (built and removed in commits `a7a42d2`
  → `a8e13ce`, per REVERT-01). Not a live concern. Do not build anything related to retake.

## What Success Looks Like
- All three inconsistent read sites use the same `planned_duration_mins ?? duration_mins`
  fallback pattern used everywhere else in the codebase.
- `app/api/sessions/[id]/start/route.ts` computes the fallback value once and reuses it for
  both the minutes-balance check and `effectiveDurationMins` — no duplicated logic in one
  file.
- `inngest/session-content-pipeline.ts`: when BOTH duration fields are null/missing, the
  fallback is no longer a bare hardcoded 30. Instead it derives the correct duration from
  the session's user's `learning_goal` via the existing `getSessionDuration(learningGoal)`
  helper in `lib/curriculum/session-designer.ts` (`LEARNING_GOAL_MINUTES`: quick_wins=5,
  steady_progress=15, deep_dive=30 — default 15 if goal itself missing).
  - This derived value must also be used for `sessionDurationMins` such that
    `adaptScriptToDuration` is NOT skipped in this fallback case (the `sessionDurationMins ?
    {...} : rawScriptAndViz` branch must evaluate truthy).
  - Only if `learning_goal` itself is missing too does the code fall back to a hardcoded 30,
    with a code comment explaining this is an absolute last resort.
- Going forward (from today), every newly created session has a duration that is computed
  once, correctly, and never silently drifts or defaults across any code path — API reads,
  billing checks, or content generation.
- Historical sessions with NULL duration fields are explicitly left alone. No backfill, no
  migration, no data-correction script of any kind.
- `npx tsc --noEmit` clean after the change.
- `session-organizer.ts` / `session-designer.ts` diff is empty (aside from being read, not
  edited) — confirmed in review.

## Known Constraints
- Do NOT write any migration, backfill script, or data-correction tooling for existing rows.
  This is explicit and non-negotiable per Arun's direction — success is defined purely by
  "new sessions behave correctly forever," not by fixing old data.
- Do NOT touch `session-organizer.ts` or `session-designer.ts`'s session-count/splitting
  logic — only *reuse* the existing exported `getSessionDuration` helper from
  `session-designer.ts` as a fallback input, do not modify that file's behavior.
- Do NOT build or reintroduce anything related to the deleted retake-session feature.
- Do NOT commit, push, or deploy. Leave as local uncommitted changes, consistent with
  everything else this session.
- This is a technical/logic-consistency fix, not a new user-facing feature — no new screens,
  no new copy, no UX change of any kind. The BA spec should be scoped accordingly (a short,
  precise technical requirement doc is appropriate; this does not need wireframes or a full
  12-section UX spec, but must still document exact before/after logic per file, acceptance
  criteria, and edge cases per the standing "spec before build" rule).

## Questions for BA
1. Confirm the exact reused pattern/helper name for "compute effective duration once" in
   `start/route.ts` (e.g. a small local `const effectiveDurationMins = ...` computed before
   both usages, or a shared utility function) — pick whichever is more consistent with
   existing code style in that file, and document your choice.
2. Confirm whether `app/api/sessions/[id]/route.ts`'s GET response should return
   `planned_duration_mins` as a new top-level field, only replace `duration_mins` in the
   response with the resolved value, or both. Recommend: keep both raw DB columns in the
   select for transparency/debugging, but also confirm/add a single resolved
   `effective_duration_mins` (or similarly named) field in the JSON response for any current
   or future consumer, OR confirm no consumer needs a new field and the existing
   `duration_mins` key in the response should simply carry the resolved value. Document
   whichever approach avoids breaking any existing caller — check current callers of this
   endpoint before deciding.
3. Same question for `schedule/route.ts` — confirm exactly what `duration_mins` is used for
   in that file after the select (I see it currently used for existing-session lookups in
   the map) and confirm the fallback is applied everywhere `existing.duration_mins` is read
   in that file, not just in the select clause.
4. Confirm the exact fallback chain and code comment wording for
   `session-content-pipeline.ts`'s "last resort 30" case, and confirm test/acceptance
   criteria for: (a) both fields present → uses planned_duration_mins, (b) only duration_mins
   present → uses it, (c) both null, learning_goal present → uses getSessionDuration(goal),
   (d) both null AND learning_goal null → uses hardcoded 30 with explanatory comment, and in
   all of (a)-(d), adaptScriptToDuration is actually invoked (not skipped).

Please write the full requirement document with all sections completed, all four questions
above answered (escalate to me only if you cannot resolve them from the code itself), and
Section 11 (Open Questions) empty before any code is written.
