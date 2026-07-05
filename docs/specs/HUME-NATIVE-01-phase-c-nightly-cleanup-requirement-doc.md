# Nightly Hume Config Archive + Cleanup — Requirement Document
Version: 1.0
Status: DRAFT — pending CEO review
Author: Business Analyst Agent
Date: 2026-07-05
Source: `docs/specs/HUME-NATIVE-01-phase-c-nightly-cleanup-feature-brief.md` (all 6 questions resolved below) + `docs/specs/HUME-NATIVE-01-requirement-doc.md` Section 4.8 (original scope) + Section 11 precedent (empty-Open-Questions gate)

---

## 1. Purpose

Every Hume-native session (`sessions.hume_native_enabled = true`) provisions a brand-new,
per-session Hume EVI Config (per HUME-NATIVE-01 Section 4.3) that is never reused. Two problems
follow from that: (1) once a Config is deleted on Hume's side, its exact prompt/voice/tool-wiring
state at the time of that session is gone forever — and the same durability risk applies to the
session's transcript if it ever became unavailable Hume-side; (2) Configs otherwise accumulate on
Hume's account indefinitely with no functional purpose once the session is long over.

This feature is a nightly Inngest cron job that, for every eligible session, durably archives a
full copy of the Config's details and the full transcript into our own database, and only after
that archival write is confirmed successful, deletes the Hume-side Config to keep the account
tidy. Without this feature: Hume Configs pile up forever (tidiness problem, not urgent), and if
anyone ever manually deletes a Config or Hume's own retention changes, the historical record of
that session's exact configuration and conversation is unrecoverable — including breaking the
already-approved action-item/glitch extraction feature (Section 4.8 of the original requirement
doc), which depends on the transcript still being fetchable.

## 2. User Story

As the system (no human-facing user for this feature — it is a backend maintenance job),
I want to archive every eligible Hume-native session's Config details and transcript into our own
database, then delete the Hume-side Config,
So that historical session data survives independent of Hume's retention, the extraction pipeline
always has a transcript to consume, and the Hume account doesn't accumulate unused Configs
indefinitely.

There is no end-user-facing screen, UI, or interaction for this feature. It is a fully backend,
scheduled, non-interactive job. (Confirmed no UI requirement anywhere in the brief.)

## 3. Trigger / Entry Point

- **Not a route, not a UI action.** This is an Inngest scheduled (cron) function, registered in
  `app/api/inngest/route.ts` alongside all other existing Inngest functions (`dailyDelivery`,
  `weeklyDigest`, etc. — confirmed pattern from `inngest/daily-delivery.ts` and
  `inngest/weekly-digest.ts`).
- **New file:** `inngest/hume-native-nightly-cleanup.ts`.
- **Exact Inngest trigger:** `triggers: [{ cron: '0 6 * * *' }]`.
- **Timezone resolution (brief's Question 1, blocking — resolved below).**

### 3.1 Cron timezone — confirmed, not assumed

Every existing cron function in this codebase (`inngest/daily-delivery.ts` line 9,
`inngest/weekly-digest.ts` line 8, `inngest/catalog-refresh.ts`, `inngest/trial-expiry.ts`, and all
others — 15 cron definitions checked) uses a bare 5-field cron expression with no timezone
qualifier, and every one that documents its intended wall-clock time explicitly comments it as
**UTC** (e.g. `daily-delivery.ts`: `"Cron: 0 7 * * * (7AM UTC — user timezone handling done at
delivery level)"`). Inngest's own cron trigger syntax evaluates bare cron expressions in UTC by
default; a timezone can only be forced by prefixing the expression with `TZ=<IANA-zone>` (e.g.
`TZ=America/Chicago 0 0 * * *`), a feature not used anywhere in this codebase today. Since no
existing job in this repo uses the `TZ=` prefix, and the project's own convention (per every code
comment above) is to write cron expressions in UTC and do any timezone math in the surrounding
query logic, this job follows that same established convention rather than introducing the first
`TZ=`-prefixed cron in the codebase — consistent, not novel.

- **CST is fixed UTC−6.** The brief says "CST" specifically (not "CDT"), so this spec treats CST
  as the fixed offset UTC−6, matching the literal term used, not the DST-shifting "US Central time"
  colloquialism. (If Arun actually means "whatever the US Central clock currently reads,
  DST-adjusted," that is a distinct, contradicting requirement — flagged explicitly in Section 9
  Edge Cases below as the one nuance carried forward, not left as an Open Question, since the
  literal brief text says "CST" and this spec builds to that literal instruction per the
  implement-literally rule in CLAUDE.md.)
- **12:00 AM CST = 06:00 UTC.** Cron expression: **`0 6 * * *`** (every day, 06:00 UTC).
- **11:00 PM CST cutoff = 05:00 UTC, same calendar day as the 06:00 UTC run.** A session is
  eligible only if it ended strictly before 05:00 UTC on the day the job runs (i.e., more than one
  hour before the 06:00 UTC run time) — this is the exact realization of "ended before 11:00 PM CST
  relative to the run," expressed in UTC for implementation clarity per the brief's explicit
  request.

## 4. Screen / Flow Description

Not applicable — no screens. This section documents the job's execution flow instead, step by
step, since that is the equivalent "flow" for a backend job.

**Flow (one nightly run):**
1. Inngest triggers `humeNativeNightlyCleanup` at 06:00 UTC.
2. Step `fetch-eligible-sessions`: query `sessions` for every row matching the eligibility criteria
   (Section 4, Data Requirements, below).
3. If zero eligible sessions: log `[hume-native-cleanup] No eligible sessions` and return
   `{ processed: 0, archived: 0, deleted: 0, errors: 0 }`. No-op, not an error.
4. For each eligible session, independently (loop, not a single all-or-nothing step — see Section
   8, Error States, for isolation guarantee):
   a. Fetch Config details: `GET https://api.hume.ai/v0/evi/configs/{hume_native_config_id}`.
   b. Fetch full transcript: `GET https://api.hume.ai/v0/evi/chats/{hume_chat_id}/events`,
      paginating until all pages are retrieved.
   c. Insert one row into the new `hume_native_session_archives` table containing the full raw
      Config response and the full concatenated transcript events array.
   d. Only if (c) succeeds (no insert error): call
      `DELETE https://api.hume.ai/v0/evi/configs/{hume_native_config_id}`.
      - A 404 response is treated as "already deleted" — non-fatal, proceed to step (e) as success.
      - Any other non-2xx/non-404 response is a failure for this session only — do NOT proceed to
        step (e); log and move to the next session (Config remains live on Hume's side, to be
        retried on the next nightly run since the session is not yet marked archived).
   e. Update `sessions.hume_config_archived_at = NOW()` for this session — the idempotency marker.
5. Log a summary: `{ processed, archived, deleted, errors }` and return it as the job's result.

## 5. Visual Examples

Not applicable — no UI. Per the Requirement Document template, this is explicitly noted rather
than fabricating a wireframe for a feature with no screen.

## 6. Data Requirements

### 6.1 Eligibility query (exact)

```sql
SELECT id, hume_native_config_id, hume_chat_id
FROM sessions
WHERE hume_native_enabled = true
  AND hume_native_config_id IS NOT NULL
  AND hume_chat_id IS NOT NULL
  AND ended_at IS NOT NULL
  AND ended_at < (NOW() - INTERVAL '1 hour')
  AND hume_config_archived_at IS NULL
ORDER BY ended_at ASC;
```

Notes on each condition:
- `hume_native_enabled = true` — only sessions that actually ran in native mode (per-session flag,
  not the global env toggle — matches the existing convention documented in
  `HUME-NATIVE-01-requirement-doc.md` Section 4.5).
- `hume_native_config_id IS NOT NULL` — nothing to delete/archive-config for if this was never
  set (e.g. provisioning failed before a Config was ever created).
- `hume_chat_id IS NOT NULL` — nothing to fetch a transcript for if the call never reached
  `chat_metadata` (never connected). A session with `hume_native_enabled=true` but no
  `hume_chat_id` is excluded — there is no transcript to archive, and by Section 4.3 of the
  original requirement doc, if Config provisioning failed the session was already hard-blocked
  from starting, so this state should be rare (aborted native-mode attempts).
- `ended_at IS NOT NULL` — this is the authoritative "ended" signal (see 6.2 below for why, and
  the resolution of the brief's Question 2).
- `ended_at < (NOW() - INTERVAL '1 hour')` — the 1-hour safety buffer, expressed relative to job
  run time (`NOW()` at 06:00 UTC), which is equivalent to and simpler than hardcoding the 05:00 UTC
  boundary — both express "ended more than 1 hour before this run," and using `NOW() - INTERVAL
  '1 hour'` is robust to the job occasionally running a few minutes late without silently
  shrinking the safety buffer.
- `hume_config_archived_at IS NULL` — the idempotency guard (Section 6.3.2 below defines this new
  column). A session already fully archived+deleted in a prior run is never reprocessed.

### 6.2 "Ended" determination — resolved (brief's Question 2)

**`sessions.ended_at` is the sole authoritative source.** No cross-check against Hume's own
chat-ended timestamp is performed, for these concrete reasons:
- `sessions.ended_at` is already the authoritative end-of-session timestamp used for all other
  billing and lifecycle logic in this codebase (`lib/session-billing.ts`'s `forceEndSession()`
  writes it; `session-quality-evaluator.ts`'s own cron query — migration 029 — already uses
  `ended_at` as its window boundary with an identical established pattern: "Used by the cron query
  (status='completed', quality_evaluated=false, ended_at window)"). This job follows the same,
  already-proven convention rather than inventing a second "which timestamp is truth" mechanism.
- Hume's Chat History API response does carry its own chat end signal, but introducing a
  cross-check would mean: (a) an extra Hume API call before eligibility is even determined (against
  every session in the lookback window, not just eligible ones — a needless cost), and (b) a new,
  undefined tie-breaking rule for what happens on disagreement, which is exactly the kind of
  invented ambiguity this governance model exists to prevent. `ended_at` alone is simpler, already
  battle-tested elsewhere in this codebase, and sufficient.
- **If `ended_at` is null but `hume_chat_id` exists** (e.g. a dropped call that never went through
  the clean `end_session` path): the session is simply not yet eligible — it is excluded by the
  `ended_at IS NOT NULL` condition and will become eligible automatically once `ended_at` is
  populated by whatever other mechanism sets it (the existing `forceEndSession()` / session-timer
  backstop paths already set `ended_at` for abnormally-ended sessions per the original
  HUME-NATIVE-01 spec's Edge Cases section — "the post-session extraction job's safety-net cron
  still picks it up as long as `hume_chat_id` was captured at connect time"). This job does not need
  its own separate abnormal-end detection; it simply waits for `ended_at` to exist, consistent with
  every other cron in this codebase.

### 6.3 New migration

**File:** `supabase/migrations/058_hume_native_config_archive.sql`

(Migration number confirmed against the current migrations directory at spec-writing time: the
highest existing migration is `057_minutes_ledger.sql` — `058` is the next free number. Per the
brief's own instruction, the developer must re-confirm this number against the migrations
directory at build time in case another migration lands first in the interim.)

#### 6.3.1 New table: `hume_native_config_archives`

Append-only, one row per archived session, following the exact structural conventions of
`session_billing_audit_log` (migration 051) and `minutes_ledger` (migration 057): UUID PK,
`session_id` FK with an index, JSONB for free-form/raw payloads, `created_at`/`archived_at`
timestamps, RLS enabling user-read-own + service-role-only-write, no UPDATE/DELETE policy defined
for any role (dispute-defensible / immutable-once-written, matching both precedent tables exactly).

```sql
-- HUME-NATIVE-01 Phase C — durable archive of a Hume-native session's Config
-- details and full transcript, written before the Hume-side Config is deleted.
-- Append-only: once a session's data is archived here, it is never updated —
-- this is the permanent record that survives independent of Hume's own retention.
-- Follows the exact RLS/append-only conventions of session_billing_audit_log
-- (migration 051) and minutes_ledger (migration 057).

CREATE TABLE IF NOT EXISTS hume_native_config_archives (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id           UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- Full raw response body from GET /v0/evi/configs/{id} at archive time — the
  -- complete Config document (prompt, voice settings, tool wiring, versions),
  -- captured verbatim since we lose access to it entirely once the Config is
  -- deleted on Hume's side.
  config_snapshot      JSONB       NOT NULL,

  -- Full concatenated array of every event returned by
  -- GET /v0/evi/chats/{chat_id}/events across all pages — the complete
  -- transcript, captured verbatim. This is the same data the (separately
  -- scoped) action-item/glitch extraction job (Section 4.8 of
  -- HUME-NATIVE-01-requirement-doc.md) consumes; this table is its durable
  -- source, not a duplicate of its own storage.
  transcript_events    JSONB       NOT NULL,

  -- The Hume config_id and chat_id this archive was captured from — kept
  -- alongside the snapshot (not just on `sessions`) so this row is a
  -- self-contained historical record even if `sessions` columns are ever
  -- restructured later.
  hume_config_id       TEXT        NOT NULL,
  hume_chat_id         TEXT        NOT NULL,

  -- Whether the DELETE /v0/evi/configs/{id} call that followed this archive
  -- succeeded (true), returned 404/already-deleted (true — treated as success
  -- per the non-fatal-404 rule), or the delete step itself failed after a
  -- successful archive write (false — an archive can exist with a Config
  -- still live on Hume's side if the delete sub-step failed; the next
  -- nightly run will retry only the delete, see Section 7 Step 4 note).
  hume_config_deleted  BOOLEAN     NOT NULL DEFAULT false,

  archived_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hume_native_config_archives_session
  ON hume_native_config_archives(session_id);

-- ─── APPEND-ONLY ENFORCEMENT (mirrors session_billing_audit_log / minutes_ledger) ───
ALTER TABLE hume_native_config_archives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hume native config archives"
  ON hume_native_config_archives FOR SELECT
  USING (
    auth.uid()::text = (SELECT user_id FROM sessions WHERE sessions.id = session_id)
  );

CREATE POLICY "Service role can insert hume native config archives"
  ON hume_native_config_archives FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can read all hume native config archives"
  ON hume_native_config_archives FOR SELECT
  USING (auth.role() = 'service_role');
```

Note on the user-read policy: unlike `session_billing_audit_log`/`minutes_ledger` (which store
`user_id` directly as a column), `sessions` is the join path to `user_id` here since this table's
natural key is `session_id` only — this is the correct adaptation of the same isolation principle,
not a deviation from it. (Confirm `sessions.user_id` column name/type at build time against
`architecture.md`/existing migrations — used identically to how `session_billing_audit_log`
already joins in other RLS-adjacent code paths in this repo.)

#### 6.3.2 New column on `sessions`

```sql
-- Idempotency marker: set once a session's Config + transcript have been
-- durably archived AND the Hume-side Config delete step has been attempted
-- (success or non-fatal 404). NULL means "not yet processed by the nightly
-- cleanup job" — this is the sole gate the eligibility query checks.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hume_config_archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_hume_config_archived_at
  ON sessions(hume_config_archived_at) WHERE hume_config_archived_at IS NULL;
```

This follows the exact `ended_at` / (future) `action_items_extracted_at`-style nullable-timestamp
pattern already used on `sessions` per the brief's own instruction, and the partial index (`WHERE
hume_config_archived_at IS NULL`) matches this table's existing indexing convention of only
indexing the "not yet done" state that the cron query actually filters on (mirrors migration 029's
`quality_evaluated` partial-index precedent).

**No existing column, table, or RLS policy is modified or dropped anywhere in this migration** —
purely additive, per the brief's non-negotiable constraint.

## 7. Success Criteria (Acceptance Tests)

1. ✓ Given a session with `hume_native_enabled=true`, `hume_native_config_id` and `hume_chat_id`
   both populated, `ended_at` set to 2 hours before the job runs, and `hume_config_archived_at`
   NULL, when the nightly job runs, then the session is selected as eligible, its Config details
   and full transcript are written to `hume_native_config_archives`, the Hume Config is deleted,
   and `sessions.hume_config_archived_at` is set to a non-null timestamp.
2. ✓ Given a session identical to the above but with `ended_at` set to 30 minutes before the job
   runs, when the nightly job runs, then the session is NOT selected as eligible (inside the 1-hour
   safety buffer) and no archive row is written, no delete call is made, and
   `hume_config_archived_at` remains NULL.
3. ✓ Given a session already fully processed in a prior run (`hume_config_archived_at` is
   non-null), when the nightly job runs again, then that session is excluded from the eligibility
   query entirely and no duplicate archive row is created (idempotent — no reprocessing).
4. ✓ Given an eligible session whose `DELETE /v0/evi/configs/{id}` call returns 404, when the job
   processes it, then the 404 is treated as a non-error/expected-already-deleted outcome, the
   archive row's `hume_config_deleted` is set `true`, and `hume_config_archived_at` is set
   (success path, not a failure).
5. ✓ Given a batch of 5 eligible sessions where session #3's Config-detail fetch (`GET
   /v0/evi/configs/{id}`) returns a 500 error, when the job runs, then sessions #1, #2, #4, #5 are
   each independently archived and cleaned up successfully, session #3 is logged as an error and
   left with `hume_config_archived_at` still NULL (eligible again on the next run), and the job's
   final summary reports `errors: 1` without throwing or halting the batch.
6. ✓ Given an eligible session whose transcript has more than one page of events (Hume's Chat
   History API truncates by `page_size`), when the job fetches the transcript, then it paginates
   through every page and the full concatenated event list (not just the first page) is written to
   `transcript_events`.
7. ✓ Given an eligible session where the archive-table insert itself fails (e.g. a transient
   Supabase error), when the job processes it, then `DELETE /v0/evi/configs/{id}` is NEVER called
   for that session (archive-before-delete ordering enforced), the session is logged as an error,
   and `hume_config_archived_at` remains NULL so it is retried on the next run.
8. ✓ Given zero eligible sessions on a given night, when the job runs, then it completes
   successfully with `{ processed: 0, archived: 0, deleted: 0, errors: 0 }` and does not error or
   send a failure alert.
9. ✓ Given the base production Config ID `4e0c7e15-bb03-40b2-aded-21813f19fc8d` is never present
   as any session's `hume_native_config_id` (it is not a per-session cloned Config), when the
   eligibility query and delete step run, then this Config ID is never targeted by any `DELETE`
   call — verified structurally, since the query only ever selects `sessions.hume_native_config_id`
   values and this ID is never written to that column by any code path (per HUME-NATIVE-01 Section
   4.3, each session gets a freshly created Config).
10. ✓ Given a session in progress (no `ended_at` set) or one whose `hume_native_enabled` is false,
    when the eligibility query runs, then that session is never selected, regardless of how old its
    `created_at` is.

## 8. Error States

- **Per-session isolation (non-negotiable):** each eligible session is processed inside its own
  `step.run('archive-session-<id>', ...)` call with an internal `try/catch`, matching the existing
  `inngest/daily-delivery.ts` per-user-loop convention exactly (`for (const user of batch) { try {
  ... } catch (err) { console.error(...); errors++; /* continue */ } }`). One session's failure
  (any of: Config fetch fails, transcript fetch fails, archive insert fails, delete call fails
  non-404) is caught, logged with `console.error('[hume-native-cleanup] Error for session <id>:',
  err)`, increments an `errors` counter, and the loop continues to the next session. The batch
  never throws uncaught and never halts on one session's failure.
- **Archive-before-delete ordering is enforced at the code level, not just documented:** the
  `DELETE /v0/evi/configs/{id}` call is only reached if the Supabase insert into
  `hume_native_config_archives` returns no error. If the insert fails, the function returns/throws
  within that session's own try block before ever reaching the delete call — this is a straight-line
  code dependency (insert result checked, delete call is the next line only on success), not a
  race or a best-effort ordering.
- **Partial failure within one session (brief's Question 5):** if the Config-detail fetch succeeds
  but the transcript fetch fails (or vice versa), the ENTIRE session-processing step for that
  session is treated as failed — no archive row is written at all (an archive row is only inserted
  once BOTH the Config snapshot and the full transcript are successfully fetched; a partial/
  incomplete archive is never written, since the archive's whole purpose is being a complete,
  trustworthy durable copy). The session remains un-archived and is retried in full (both fetches
  again) on the next nightly run — there is no "retry only the missing piece" partial-resume state,
  which would add complexity for a job that already re-runs nightly at negligible cost.
- **Delete step fails after a successful archive (brief's Question 5, the other partial-failure
  shape):** if the archive insert succeeds but the subsequent `DELETE` call fails with a non-404,
  non-2xx response, `hume_config_archived_at` is deliberately left NULL (not set) even though the
  archive row already exists — this session becomes eligible again on the next run. On that next
  run, the archive insert will run again (a second, separate archive row for the same session is
  an acceptable, harmless duplicate under this append-only design — it is not treated as an error;
  the eligibility query does not check "does an archive row already exist," only
  `hume_config_archived_at IS NULL|NOT NULL`), and the delete call is retried. This keeps the logic
  simple (single linear path per attempt) rather than adding a "delete-only-retry" branch, and a
  duplicate archive row is harmless since the table is append-only and read for historical/
  extraction purposes, never deduplicated against.
- **Inngest-level retries (brief's Question 5, job-level):** the whole function is configured with
  `retries: 3` (matching `daily-delivery.ts`'s convention exactly — the highest-retry precedent in
  this codebase for a batch job touching many independent records). Inngest's retry applies to the
  function/step level (an uncaught throw), not to the internal per-session try/catch loop described
  above — the per-session catch blocks are what prevent one bad session from ever causing an
  uncaught throw that would trigger a full-function retry (which would then reprocess already-
  succeeded sessions redundantly, though harmlessly, since re-running the fetch-eligible-sessions
  step would simply find fewer sessions the second time — already-archived ones are excluded by
  `hume_config_archived_at IS NOT NULL`).
- **Admin alert on total function failure:** if the function does throw uncaught after exhausting
  all 3 retries (e.g. Supabase itself is down, `fetch-eligible-sessions` step fails entirely), an
  `onFailure` handler sends an admin alert via `sendAdminAlert()` (`lib/delivery/email.ts`),
  matching `daily-delivery.ts`'s exact `onFailure` pattern (lines 18-29) verbatim in structure.
- **HUME_API_KEY missing/placeholder:** if `process.env.HUME_API_KEY` is unset or a
  `PLACEHOLDER_`-prefixed value, the job logs `[MOCK] HUME_API_KEY not set — hume-native nightly
  cleanup will log intended actions but skip real Hume API calls` once at the top of the run, and
  for each eligible session logs what it would have fetched/deleted without making real HTTP calls,
  returning a mock success result — matching this project's existing "never throw on missing keys"
  convention (per CLAUDE.md's autonomy rules and this project's existing mock-guard pattern used in
  `lib/stripe.ts`, `lib/content/generator.ts`, etc.). The archive insert in mock mode still writes
  a row (with clearly-marked mock/placeholder JSONB content), so the idempotency marker still
  behaves correctly in dev/test environments without a real key.

## 9. Edge Cases

- **CST vs. CDT (daylight saving):** this spec builds to the literal term "CST" = fixed UTC−6,
  per the brief's exact wording, using a fixed `0 6 * * *` UTC cron with no seasonal adjustment.
  If Arun's actual intent is "whichever offset US Central time currently observes" (UTC−6 in
  winter, UTC−5 during daylight saving/CDT months), the cron expression and the 1-hour eligibility
  window would need to shift by an hour twice a year. **This spec does not implement DST-aware
  shifting** — it implements the literal "CST" instruction as written, since introducing seasonal
  cron-expression changes was not asked for and would be inventing a requirement not stated in the
  brief. This is noted here as a documented interpretation, not left as an Open Question, because
  the brief's literal text is unambiguous ("CST") even though colloquial usage sometimes conflates
  CST/CDT — if Arun intends DST-aware behavior, that is a one-line follow-up change to the cron
  expression and window math, not a redesign.
- **A session with `hume_native_enabled=true` but `hume_native_config_id` NULL** (native mode was
  toggled on for the session record, but Config provisioning never succeeded — per the original
  spec's hard-failure stance in Section 4.3, this should mean the session never actually started in
  native mode, but the flag could still be true on the row): excluded by the eligibility query's
  `hume_native_config_id IS NOT NULL` condition — never processed, never errors, simply invisible
  to this job forever (nothing to archive or delete).
- **A session's Hume Config was already manually deleted by someone outside this job** (e.g. ad-hoc
  cleanup via Hume's dashboard) before the nightly run reaches it: the Config-detail fetch (`GET
  /v0/evi/configs/{id}`) itself would 404. Unlike the DELETE step's explicit 404-is-fine handling,
  a 404 on the **fetch** step means there is nothing left to archive — this is treated as a
  session-level error (logged, `hume_config_archived_at` left NULL, retried next run) rather than a
  silent skip, since a missing Config at fetch time means the archive would be permanently
  incomplete for that session (we can never recover what we didn't get to read). This is flagged
  explicitly rather than silently treated the same as the delete-step's 404 case, because the two
  404s mean different things: "already deleted, nothing to fetch" (fetch-time 404 = data loss, real
  problem worth surfacing) vs. "already deleted, nothing to delete" (delete-time 404 = expected,
  harmless).
- **Very long transcripts requiring many pages:** the pagination loop has no artificial cap — it
  continues until Hume's API signals no further pages (matching whatever "next page" indicator the
  Chat History API returns, to be confirmed against Hume's actual pagination response shape at
  build time; the existing debug endpoint's `page_size=50` example is illustrative only, not a
  production limit).
- **Job runs late (e.g. Inngest infra delay pushes the actual run to 06:40 UTC instead of 06:00):**
  because the eligibility window is computed as `NOW() - INTERVAL '1 hour'` rather than a hardcoded
  05:00 UTC constant, a late run naturally still enforces "at least 1 hour since ended," just
  shifted later — never accidentally shrinking the safety buffer.
- **Two nightly runs somehow overlap (e.g. a manual re-trigger while the scheduled run is still
  in-flight):** idempotency via `hume_config_archived_at` prevents double-processing of any session
  that the first run already completed before the second run's eligibility query executes; a
  session both runs pick up concurrently (rare, since Inngest steps are not typically triggered
  concurrently for the same cron function) could produce one harmless duplicate archive row (see
  Section 8) but never a double-delete-call failure worse than an extra, harmless 404.

## 10. Out of Scope

- **The action-item/glitch extraction logic itself.** Already separately scoped in Section 4.8 of
  `HUME-NATIVE-01-requirement-doc.md`. This job's responsibility ends at "transcript is durably
  archived in `hume_native_config_archives.transcript_events`" — the extraction job (a distinct,
  already-approved consumer) reads from that same archived data. Per the original spec's Question 4
  resolution (recommended and confirmed: separate concerns), this nightly cleanup job and the 4.8
  extraction job are **two separate Inngest functions** — this spec does not merge them. The 4.8
  extraction job's own "secondary safety-net cron" (querying `hume_chat_id IS NOT NULL AND
  action_items_extracted_at IS NULL`) continues to read `hume_chat_id` directly from `sessions` for
  its own transcript pull today; whether it should be updated later to instead read from
  `hume_native_config_archives.transcript_events` once this job exists is a future, separate
  decision for whoever builds 4.8 — not decided or required by this spec.
- Any change to the primary event-driven extraction trigger path
  (`distill/session.hume-native.ended`) described in Section 4.8 of the original requirement doc.
- Any change to `lib/voice/hume-adapter.ts`, the base production Config
  (`4e0c7e15-bb03-40b2-aded-21813f19fc8d`), or any other file listed as untouched in Section 4.9 of
  the original requirement doc.
- Broader Hume account management — e.g. bulk historical cleanup of Configs created before this
  system existed, or Configs belonging to sessions where `hume_native_enabled` was never set. Scope
  is limited to sessions going forward that satisfy the exact eligibility query in Section 6.1.
- Any UI, dashboard, or user-facing display of archived Config/transcript data — this is a durable
  backend store only; a future feature could expose it, but none is specified or built here.
- Any change to `sessions.hume_chat_id` or `sessions.hume_native_config_id`'s existing write paths
  (set at connect-time / provisioning-time, per the original spec) — this job only reads them.
- DST-aware cron scheduling (see Section 9 Edge Cases) — out of scope unless Arun confirms that is
  actually wanted, at which point it is a small follow-up change, not a new spec.

## 11. Open Questions

None. All 6 questions from the feature brief are resolved concretely above:
1. Cron timezone — resolved in Section 3.1 (`0 6 * * *` UTC, cited against this repo's own
   established all-UTC-cron convention, since Inngest's bare cron syntax evaluates in UTC absent a
   `TZ=` prefix that no job in this codebase uses).
2. "Ended" determination — resolved in Section 6.2 (`sessions.ended_at` alone, no Hume cross-check,
   matching the existing `session-quality-evaluator.ts` / migration 029 precedent).
3. Exact schema — resolved in Section 6.3 (full DDL for `hume_native_config_archives` +
   `sessions.hume_config_archived_at`).
4. Relationship to the 4.8 extraction job — resolved in Section 10 (separate Inngest functions,
   confirming the brief's own recommendation; this job's output is a durable store the extraction
   job may consume, not a merged single function).
5. Failure/retry semantics — resolved in Section 8 (Inngest `retries: 3` at function level,
   per-session try/catch for isolation, whole-session retry on partial in-session failure, no
   partial-piece-only retry).
6. Config-detail fetch scope — resolved in Section 7 of this doc (`GET /v0/evi/configs/{id}`,
   confirmed against the exact working pattern already in `app/api/debug/hume-chat/route.ts` line
   20-24, which calls this exact endpoint with the exact same `X-Hume-Api-Key` header); full raw
   response body captured in `config_snapshot`, per the durable-archive intent (brief explicitly
   recommends "full raw response").

## 12. Dependencies

- **`sessions.hume_native_enabled`, `hume_native_config_id`, `hume_chat_id`** — already exist
  (migration 056, HUME-NATIVE-01 Phase A, already shipped/approved). This spec only adds
  `hume_config_archived_at` on top.
- **`HUME_API_KEY`** env var — already exists and is already used by
  `app/api/debug/hume-chat/route.ts` and `app/api/hume-token/route.ts`. No new secret needed.
- **Inngest client (`inngest/client.ts`) and its registration point
  (`app/api/inngest/route.ts`)** — already exist; this job is added to the existing functions array
  there, following the exact pattern every other Inngest function in this repo already uses.
- **`sendAdminAlert()` (`lib/delivery/email.ts`)** — already exists (used by `daily-delivery.ts`'s
  `onFailure` handler); reused here for the equivalent handler.
- **Migration `058_hume_native_config_archive.sql`** must be applied before this job can run in any
  environment — this is the one new piece of infrastructure this spec introduces; everything else
  it touches already exists.
- **HUME-NATIVE-01 Phase A** (Config provisioning, `hume_chat_id` capture) must be live and
  producing real sessions with both IDs populated for this job to ever find eligible rows — this
  job is purely a downstream consumer of that already-approved, already-built (per HUME-NATIVE-01's
  CEO approval) architecture.

---

## Self-Review Checklist

- Could a developer build this with zero follow-up questions? Yes — exact cron expression, exact
  SQL eligibility query, full migration DDL, exact per-step processing order, exact error/retry
  handling, and exact resolution of every ambiguity flagged in the brief are all specified above
  with no "TBD" left for a product decision. The two items explicitly deferred to build-time (exact
  pagination response shape confirmation against Hume's live API, and the `sessions.user_id` column
  name/type check for the RLS join) are technical confirmations against already-external,
  already-documented systems — not product ambiguities — consistent with this project's
  established technical-vs-product distinction (see `HUME-NATIVE-01-requirement-doc.md`'s own
  Section 12 escalation note, which draws the same line for its own build-time technical items).
- No "standard"/"typical" UI language used — there is no UI in this feature.
- No "similar to X" shorthand — every table, column, and step is written out in full.
- Section 11 is empty.

---

## 12b. Approval

- [x] CEO Agent review
- [x] CEO Agent approval (required before any developer agent writes code, per CLAUDE.md's
      governance model — no exceptions for "just a cron job")

## CEO Approval

**Date:** 2026-07-05
**Status:** APPROVED

This requirement document accurately reflects the feature brief's scope — nightly archive-then-delete
of per-session Hume Configs, ended-before-11PM-CST eligibility with a 1-hour safety buffer, feeding
(not merging with) the already-approved 4.8 action-item extraction. Nothing invented, nothing dropped.

Section 11 is genuinely empty — all 6 brief questions are resolved concretely, with cited evidence
against this codebase's own conventions (15 existing cron jobs checked for timezone handling,
migration 029 checked for the `ended_at`-as-authoritative precedent, `app/api/debug/hume-chat/route.ts`
checked for the exact Hume config-fetch call shape). The timezone math (`0 6 * * *` UTC = 12:00 AM CST,
05:00 UTC = 11:00 PM CST cutoff, eligibility window computed as `NOW() - INTERVAL '1 hour'` rather than
a hardcoded UTC literal) is sound reasoning, not an assertion, and correctly matches how Inngest cron
actually evaluates in this codebase (bare expression = UTC, no `TZ=` prefix ever used here).
Archive-before-delete ordering is enforced at the code level (Section 8), not just documented. Schema
follows the `session_billing_audit_log`/`minutes_ledger` append-only/RLS conventions exactly. The base
production Config is structurally guaranteed to never be targeted. Full DDL is specified with no
ambiguity left for a developer.

**One flag for Arun, not a blocker:** the BA assumed "CST" means fixed UTC−6 year-round (per your
literal wording), not the DST-shifting US Central clock (which is CDT/UTC−5 for roughly 8 months of
the year). This spec builds to the literal fixed-offset reading. If you actually meant "whatever
Central time currently reads," that's a one-line follow-up (adjust the cron expression and window by
an hour for part of the year), not a redesign — flagging now so it doesn't get silently baked in wrong.

Development may proceed against this spec as written.
