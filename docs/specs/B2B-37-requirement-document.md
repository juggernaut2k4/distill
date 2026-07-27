# Partner Session Insights Extraction Never Fires on the Real Completion Path — Requirement Document
Version: 1.0
Status: APPROVED — CEO review complete 2026-07-26
Author: Business Analyst Agent
Date: 2026-07-26

---

## 1. Purpose

`partner_session_insights` rows (action items, glitches, and the `learner_insight` object shown on
a partner's Performance tab) are supposed to be produced automatically the moment a partner session
ends. They never are, on any of the four real completion paths a session can take. The only thing
that has ever emitted the `clio/partner-session.ended` event `partnerSessionInsightsExtractor`
listens for is a best-effort fallback branch buried inside the Hume `chat_ended` webhook handler —
not part of the authoritative completion code, and it did not fire for the one real orphaned session
this brief exists to fix (`partner_sessions.id = 'ab71deef-977c-40e1-bfec-d0a182d241e3'`, Arun's own
first "Learn with AI" test).

Without this fix: every real partner session — test and live, every reseller — completes with zero
insight extraction on the fast path. The 30-minute backstop sweep is the only remaining safety net,
and it has an independent silent-failure gap (Section 6) that means a real query failure there would
also go unnoticed. Partner Performance tabs report on a reporting pipeline that, for all practical
purposes, does not run.

This is a pure bug fix. No new screen, no new user-facing behavior, no new billing logic — the fix
is entirely in event emission and error-handling code that already exists.

## 2. User Story

As **Arun** (product owner, responsible for the accuracy of what partners see on their Performance
tab),
I want every partner session that reaches a terminal status to reliably trigger insight extraction
the moment it ends, without depending on a 30-minute backstop for the common case,
so that partner reporting reflects real session data instead of silently missing rows.

As a **reseller/partner admin** viewing the Performance tab for their account,
I want the insights (action items, glitches, learner engagement summary) for a session that ended
to actually be there,
so that I can trust the tab reflects what happened in real sessions, not an empty pipeline.

There is no new end-user (learner) facing story — end users never see `partner_session_insights`
directly; it only surfaces via the partner-facing Performance tab, which already exists and is
unchanged by this fix.

## 3. Trigger / Entry Point

N/A — no new route, no new UI trigger. This fixes event emission inside four existing
session-completion code paths, all of which are internal (server-to-server or cron-triggered), not
user-initiated UI actions:

1. **Normal client-side disconnect** — `POST /api/partner/render/end-session` (`app/api/partner/render/end-session/route.ts:36`), calling `handleSessionEnd()` in `lib/partner/live-render.ts`. Triggered by the render page's client component on the participant's browser disconnect/unmount.
2. **Attendee-webhook fallback completion** — `app/api/attendee/webhook/route.ts:461`, also calling `handleSessionEnd()`, with `targetStatus: 'failed'` when the meeting bot reports `bot.state_change: fatal_error` and the normal disconnect flow never landed.
3. **Live-wallet forced cutoff** — `inngest/partner-live-cutoff.ts`, the `mark-session-completed` step (verified at lines 254-267) inside the `partner-live-cutoff` Inngest function, triggered when a live (non-test) session's wallet balance is exhausted mid-session.
4. **Trial/test-mode forced cutoff** — `inngest/partner-trial-cutoff.ts`, the `mark-session-completed` step (verified at lines 60-64) inside the `partner-trial-cutoff` Inngest function, triggered when a test-mode session hits its available-minutes boundary.

All four are the only places in the codebase that set a `partner_sessions.status` to a terminal
value (`'completed'` or `'failed'`). Confirmed by direct inspection of all four files plus a grep
for `clio/partner-session.ended` emitters (exactly one hit: `app/api/webhooks/hume/route.ts:144-147`,
the pre-existing best-effort fallback, left in place — see Section 6).

## 4. Screen / Flow Description

N/A — no user-facing screen change. See Section 9 for the one indirect, already-existing surface
this affects (the partner Performance tab, which already renders whatever rows exist in
`partner_session_insights` — this fix only ensures those rows actually get created).

## 5. Visual Examples

N/A — no screen, no wireframe.

## 6. Data Requirements

### 6.1 Event contract (unchanged shape, now reliably emitted)

`clio/partner-session.ended` — payload `{ partnerSessionId: string }`, matching exactly what
`partnerSessionInsightsExtractor` already reads (`inngest/partner-session-insights-extractor.ts:387`:
`const { partnerSessionId } = event.data as { partnerSessionId?: string }`). All four completion
paths already have the correct id available as a local variable named `clioSessionRef` (verified in
`live-render.ts`, `partner-live-cutoff.ts`, and `partner-trial-cutoff.ts` — in all three files this
variable is the `partner_sessions.id` primary key, used directly in `.eq('id', clioSessionRef)`).

### 6.2 Code change 1 (answers CEO Question 1) — shared emitter helper

**Decision: one shared helper function, called from three call sites — not four individual raw
`inngest.send()` calls.** `handleSessionEnd()` already collapses two of the four real completion
paths (the end-session route and the Attendee-webhook fallback both call it), so fixing it once
inside that function covers both. The two cutoff-cron files update `partner_sessions.status`
directly via Supabase and never call `handleSessionEnd()`, so each needs its own call to the same
shared helper. This is the smallest correct set (3 call sites, not 4 duplicated `inngest.send()`
blocks), and it reuses the exact fire-and-forget-with-logged-failure idiom this file already
established for `clio/partner-trial.ended` / `clio/partner-live.ended` (lines 514-523) rather than
inventing a new emission pattern.

**New exported function**, added to `lib/partner/live-render.ts` (which already imports `inngest`
from `@/inngest/client` at line 11 — no new import needed there; the two cutoff files gain one new
import each):

```ts
/**
 * B2B-37 — the single, shared emitter for `clio/partner-session.ended`, the only event
 * `partnerSessionInsightsExtractor` (inngest/partner-session-insights-extractor.ts) listens for.
 * Called from every completion path that lands a partner_sessions row in a terminal status
 * ('completed' or 'failed'): handleSessionEnd() below (covers both its call sites — the normal
 * client-triggered end-session route and the Attendee fatal_error fallback), plus
 * inngest/partner-live-cutoff.ts and inngest/partner-trial-cutoff.ts's own mark-session-completed
 * steps, which update partner_sessions.status directly via Supabase and never call
 * handleSessionEnd(). Fire-and-forget with logged failure, matching the existing
 * clio/partner-trial.ended / clio/partner-live.ended emit pattern in this same file — never blocks
 * or throws out of the caller.
 */
export function emitPartnerSessionEndedEvent(partnerSessionId: string): void {
  inngest.send({ name: 'clio/partner-session.ended', data: { partnerSessionId } })
    .catch((err) => console.error('[partner-session-ended] clio/partner-session.ended emit failed:', err))
}
```

**Call site A** — inside `handleSessionEnd()` (`lib/partner/live-render.ts:498-556`), add one call.
Placed after the existing trial/live emit `if`/`else` block (lines 514-523), before the billing
calls — purely additive, does not touch or reorder the existing trial/live emission or any billing
call:

```ts
  // ... existing lines 507-523 (status update, trial/live-ended emit) unchanged ...

  emitPartnerSessionEndedEvent(clioSessionRef)   // NEW — B2B-37

  if (durationMinutes > 0) {
    // ... existing billing code, unchanged ...
```

This single addition covers both `app/api/partner/render/end-session/route.ts:36` and
`app/api/attendee/webhook/route.ts:461`, since both call `handleSessionEnd()`.

**Call site B** — `inngest/partner-live-cutoff.ts`, inside the `mark-session-completed` step
(lines 254-267). Add `import { emitPartnerSessionEndedEvent } from '@/lib/partner/live-render'` and
call it at the end of the existing step callback, after the Supabase update:

```ts
    await step.run('mark-session-completed', async () => {
      const supabase = createSupabaseAdminClient()
      await supabase
        .from('partner_sessions')
        .update({ /* ... existing fields, unchanged ... */ })
        .eq('id', clioSessionRef)
      emitPartnerSessionEndedEvent(clioSessionRef)   // NEW — B2B-37
    })
```

**Call site C** — `inngest/partner-trial-cutoff.ts`, inside its own `mark-session-completed` step
(lines 60-64). Same import, same pattern:

```ts
    await step.run('mark-session-completed', async () => {
      const supabase = createSupabaseAdminClient()
      await supabase
        .from('partner_sessions')
        .update({ status: 'completed', ended_at: new Date().toISOString(), end_reason: 'trial_limit_reached' })
        .eq('id', clioSessionRef)
      emitPartnerSessionEndedEvent(clioSessionRef)   // NEW — B2B-37
    })
```

No circular-import risk: `lib/partner/live-render.ts` does not import from either cutoff file, both
cutoff files already import sibling modules from `@/lib/partner/*`, and both already depend on
`inngest/client.ts`, which `live-render.ts` also depends on (siblings, not a cycle).

### 6.3 Code change 2 (answers CEO Question 2) — idempotency guard for the concurrent-insert race

**Finding: the existing idempotency guard fully protects against sequential double-fires, but has a
narrow concurrent-insert race window.** `runInsightsIdempotencyGuard()`
(`inngest/partner-session-insights-extractor.ts:143-186`) correctly short-circuits a *second,
later* call once a row has reached `'success'` / `'success_empty'`, or `'failed'` with
`attempt_count >= 3`. That fully covers the common case: fast-path fires, extraction completes and
writes a terminal status, and if the legacy Hume-webhook fallback branch (still left in place — see
below) *also* fires afterward for the same session, it finds the terminal row and short-circuits
immediately. No double Anthropic call, no double webhook dispatch in that ordering.

The gap is near-simultaneous concurrent fires. If the fast-path emission (from `handleSessionEnd()`)
and the legacy Hume-webhook fallback emission land close enough together that both Inngest function
invocations pass the initial `if (existing)` check (lines 159-164) while the row genuinely does not
exist yet, both proceed into the `else` branch (lines 166-185): both `upsert(...)` the same
`'pending'` row (harmless — `onConflict: 'partner_session_id', ignoreDuplicates: true` prevents a
duplicate row), but then **both separately re-`SELECT` the row and both see `extraction_status:
'pending'`** — which is not `'success'`/`'success_empty'`, so `shortCircuit: false` for both. Both
then proceed to call the Anthropic API and both eventually call `recordInsightsReadyEvent()`,
producing one wasted Claude call and one duplicate outbound `session.insights_ready` webhook
dispatch to the partner's configured endpoint (`lib/partner/webhooks.ts:568-631` inserts a fresh
dispatch-log row, unconditionally, on every call — it has no dedup of its own).

**Decision: yes, a guard is needed — but scoped narrowly to close only this race, not to the
`if (existing)` branch's intentional "`'pending'` is retryable" behavior**, which the backstop
sweep's crash-recovery design explicitly depends on (its own filter comment at
`inngest/partner-session-insights-extractor.ts:450` — `return true // 'pending' — allow retry` — is
there precisely so a row stuck at `'pending'` from a crashed run gets retried 30+ minutes later).
Changing that would silently break crash recovery, which is out of this brief's scope.

Fix: make the initial insert an atomic claim, using the upsert's own return value instead of a
separate re-`SELECT`. With `ignoreDuplicates: true`, Postgres performs
`INSERT ... ON CONFLICT (partner_session_id) DO NOTHING`, and `.select()` chained onto that upsert
returns only the row(s) *this specific call* actually inserted — empty for the call that lost the
race.

Replace lines 166-185 of `inngest/partner-session-insights-extractor.ts`:

```ts
  const { data: insertedRows } = await supabase.from('partner_session_insights').upsert(
    {
      partner_session_id: partnerSessionId,
      partner_account_id: partnerAccountId,
      hume_chat_id: humeChatId,
      extraction_status: 'pending',
      end_client_id: endClientId,
    },
    { onConflict: 'partner_session_id', ignoreDuplicates: true }
  ).select('extraction_status')

  // B2B-37 — atomic claim: with ignoreDuplicates:true this is INSERT ... ON CONFLICT DO NOTHING,
  // and .select() on the upsert returns only rows THIS call actually inserted. An empty array means
  // a concurrent invocation (e.g. the fast-path emission and the legacy Hume-webhook fallback
  // emission landing in the same window) already won the insert race — short-circuit immediately
  // rather than re-reading and treating 'pending' as retryable. Deliberately narrower than the
  // `if (existing)` branch above: this only closes the same-moment concurrent-insert race and does
  // not change the backstop sweep's intentional "pending is retryable" crash-recovery behavior for
  // a row genuinely stuck 30+ minutes from an earlier run.
  if (!insertedRows || insertedRows.length === 0) {
    return { shortCircuit: true, status: 'claimed_by_concurrent_run' }
  }
  return { shortCircuit: false }
```

`GuardOutcome`'s type (line 141) gains `'claimed_by_concurrent_run'` as a valid `status` value
alongside the existing `'already_terminal'`.

The legacy Hume-webhook fallback branch (`app/api/webhooks/hume/route.ts:130-149`) is **left in
place, unmodified** — it remains a genuine (if now largely redundant) extra safety net for any
future completion path this brief hasn't anticipated, and removing it is explicitly out of scope
(Section 10).

### 6.4 Code change 3 (answers CEO Question 3) — backstop sweep error surfacing

Both unchecked Supabase queries in `partnerSessionInsightsBackstopSweep`'s `find-eligible-sessions`
step (`inngest/partner-session-insights-extractor.ts:425-431` and `436-439`) currently destructure
only `data`, never `error` — a query failure silently degrades to an empty candidate list and the
Inngest run still records as a normal success.

**Decision: log, then throw** — not log-and-skip. Rationale: (1) this file already has a directly
comparable precedent that throws on a Supabase/RPC error rather than swallowing it —
`partnerSessionInsightsPurge` (lines 486-493: `if (error) throw new Error(...)`); (2) the CEO's own
success criterion is explicit — "a broken sweep must be loud, not invisible" — and a thrown error
inside a `step.run()` surfaces as a **failed** run in Inngest's dashboard/run history, which is
genuinely loud (visible without anyone having to go looking through server logs), whereas a
log-and-skip reproduces exactly today's failure mode (a `console.error` line that, empirically, went
unnoticed for 48+ consecutive runs) with no visible signal that anything is wrong; (3) the function
already declares `retries: 3` at the function level, so throwing lets Inngest's existing retry/backoff
machinery do its job on what is very likely a transient error (permissions blip, network hiccup) — 
exactly the case throwing is for.

Replace lines 425-439:

```ts
      const { data: candidates, error: candidatesError } = await supabase
        .from('partner_sessions')
        .select('id')
        .eq('status', 'completed')
        .not('ended_at', 'is', null)
        .lt('ended_at', cutoff)
        .not('hume_chat_id', 'is', null)

      if (candidatesError) {
        console.error('[partner-session-insights-backstop] Failed to query eligible candidates:', candidatesError.message)
        throw new Error(`Backstop sweep candidate query failed: ${candidatesError.message}`)
      }

      const candidateIds = (candidates ?? []).map((s) => s.id as string)
      if (candidateIds.length === 0) return [] as string[]

      const { data: existing, error: existingError } = await supabase
        .from('partner_session_insights')
        .select('partner_session_id, extraction_status, attempt_count')
        .in('partner_session_id', candidateIds)

      if (existingError) {
        console.error('[partner-session-insights-backstop] Failed to query existing extraction rows:', existingError.message)
        throw new Error(`Backstop sweep existing-rows query failed: ${existingError.message}`)
      }
```

The rest of the function (the `.filter()` returning eligible ids) is unchanged.

*Note (not in scope, flagged for awareness only):* the same unchecked-`error` pattern exists
elsewhere in this same file — e.g. `runInsightsIdempotencyGuard()`'s own `SELECT`s
(lines 153, 177 pre-fix) and `extractInsightsForPartnerSession()`'s session lookup (line 201). The
CEO brief scoped this fix specifically to the backstop sweep's two queries; the rest are unchanged
by this brief. See Section 10.

### 6.5 Code change 4 (answers CEO Question 4) — one-time backfill for the orphaned session

**Mechanism: a one-off local script**, following the exact precedent already established in this
repo (`scripts/reseed-failed-domains.ts`, `scripts/seed-template-library.ts` — both one-off,
hardcoded-target, run-once-via-`npx tsx` scripts against production credentials passed through the
calling shell's environment). This is the "existing admin/ops path" the CEO brief asked the BA to
find; no new admin API route, no new UI, nothing generalized.

New file `scripts/backfill-b2b37-orphaned-session.ts`:

```ts
/**
 * One-off script: B2B-37 backfill for the one orphaned partner session whose insights extraction
 * never fired (fixed on the fast path by this same brief's code changes). Hardcoded to exactly one
 * session id — not a general-purpose re-extraction tool. Run once, after the B2B-37 fix has shipped.
 * Run with: npx tsx scripts/backfill-b2b37-orphaned-session.ts
 * Reads credentials from the calling shell's environment (see scripts/reseed-failed-domains.ts for
 * the same pattern: ANTHROPIC_API_KEY, HUME_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, all pulled from production env before running).
 */
import { extractInsightsForPartnerSession } from '../inngest/partner-session-insights-extractor'

const ORPHANED_SESSION_ID = 'ab71deef-977c-40e1-bfec-d0a182d241e3'

extractInsightsForPartnerSession(ORPHANED_SESSION_ID)
  .then((result) => {
    console.log('[backfill-b2b37] Extraction result:', result)
    process.exit(0)
  })
  .catch((err) => {
    console.error('[backfill-b2b37] Extraction failed:', err)
    process.exit(1)
  })
```

**Exact steps, in order:**
1. Ship and deploy code changes 1-3 above to production first. The backfill must run *after* the
   fix, not before — running it against unfixed code changes nothing about the four completion
   paths, only proves the extractor itself still works standalone.
2. Pull production env vars locally (same mechanism `reseed-failed-domains.ts`'s doc comment
   references: `.env.production.pulled`, or `vercel env pull` equivalent — whatever this repo's
   existing convention for pulling prod credentials for one-off scripts is; Orchestrator to confirm
   exact command if `.env.production.pulled` does not already exist locally).
3. Run `npx tsx scripts/backfill-b2b37-orphaned-session.ts`.
4. Confirm the logged result is `{ status: 'success' }` or `{ status: 'success_empty' }` — not
   `'failed'`.
5. Query (via existing admin API, not raw SQL — per standing project rule) or view directly on the
   Performance tab that `partner_session_insights` now has a row for
   `partner_session_id = 'ab71deef-977c-40e1-bfec-d0a182d241e3'` with `extraction_status` in
   (`'success'`, `'success_empty'`).
6. Leave the script in place in `scripts/` afterward (matches the existing precedent of
   `reseed-failed-domains.ts`, which remains in the repo as a historical record, not wired into any
   automation, never re-run).

**Known side effect, disclosed not hidden:** running this will also cause
`recordInsightsReadyEvent()` to enqueue one real outbound `session.insights_ready` webhook dispatch
to whatever partner account owns this session, with `test_mode: true` in the payload (the session's
real `partner_sessions.test_mode` value). Since this is Arun's own "Learn with AI" test session, this
is expected and safe — no unrelated partner is affected. See Section 9.

### 6.6 Data read/written summary

| Operation | Table / Event | Trigger |
|---|---|---|
| Read | `partner_sessions` (id, partner_account_id, hume_chat_id, test_mode, partner_reference, end_client_id) | `extractInsightsForPartnerSession()` — unchanged |
| Read/Write | `partner_session_insights` (extraction_status, action_items, glitches, learner_insight, attempt_count, error_message, extracted_at) | idempotency guard + extraction write — guard logic changed per 6.3, write logic unchanged |
| Write | `partner_sessions.status`, `ended_at` (+ path-specific fields) | all four completion paths — unchanged, this brief adds nothing here |
| Emit | `clio/partner-session.ended` `{ partnerSessionId }` | NEW — 3 call sites per 6.2 |
| Emit (unchanged) | `clio/partner-trial.ended`, `clio/partner-live.ended` | `handleSessionEnd()` — untouched, per Known Constraints |
| Emit (unchanged) | `clio/hume-native-session.ended` | `app/api/webhooks/hume/route.ts` legacy-session branch — untouched, unrelated to this brief |
| Insert | `partner_webhook_dispatch_log` (via `recordInsightsReadyEvent()`) | unchanged, now reliably reached |

## 7. Success Criteria (Acceptance Tests)

✓ Given a partner session ends via the normal client disconnect flow (`POST
  /api/partner/render/end-session`) with `testMode: false`, when `handleSessionEnd()` runs, then
  `clio/partner-session.ended` is emitted with `{ partnerSessionId: <the session id> }`, in addition
  to (not replacing) the existing `clio/partner-live.ended` emission.

✓ Given the same flow with `testMode: true`, when `handleSessionEnd()` runs, then
  `clio/partner-session.ended` is emitted in addition to the existing `clio/partner-trial.ended`
  emission.

✓ Given the Attendee-webhook fallback path fires with `state: 'fatal_error'` (landing the session as
  `'failed'`), when `handleSessionEnd()` runs with `targetStatus: 'failed'`, then
  `clio/partner-session.ended` is still emitted (status value does not gate the emission).

✓ Given a live session's wallet balance is exhausted mid-session, when
  `partner-live-cutoff`'s `mark-session-completed` step runs, then `clio/partner-session.ended` is
  emitted with the correct `partnerSessionId`, in addition to the existing billable-event calls.

✓ Given a trial/test-mode session hits its available-minutes boundary, when
  `partner-trial-cutoff`'s `mark-session-completed` step runs, then `clio/partner-session.ended` is
  emitted with the correct `partnerSessionId`.

✓ Given `clio/partner-session.ended` fires for a session with a `partner_session_insights` row
  already present with `extraction_status: 'success'`, when `partnerSessionInsightsExtractor` runs
  again, then it short-circuits with `{ status: 'already_terminal' }` and makes zero Anthropic API
  calls.

✓ Given two near-simultaneous invocations both reach `runInsightsIdempotencyGuard()`'s no-existing-row
  branch for the same `partnerSessionId` before either has inserted, when both call the upsert, then
  exactly one receives a non-empty `insertedRows` array and proceeds to extraction, and the other
  receives an empty array and short-circuits with `{ status: 'claimed_by_concurrent_run' }` — making
  only one Anthropic API call and one `recordInsightsReadyEvent()` call total.

✓ Given `partnerSessionInsightsBackstopSweep`'s candidate query returns a Supabase error (mocked),
  when the `find-eligible-sessions` step runs, then it throws (after logging), the step is retried
  per the function's `retries: 3` configuration, and the Inngest run is visible as failed/retried —
  not recorded as a normal success with 0 candidates.

✓ Given the same for the existing-extraction-rows query (second query, after candidates is
  non-empty), when it returns a Supabase error, then it also throws and is retried, not silently
  skipped.

✓ Given the fix has shipped and the one-off backfill script is run for
  `partner_session_id = 'ab71deef-977c-40e1-bfec-d0a182d241e3'`, when
  `extractInsightsForPartnerSession()` completes, then a `partner_session_insights` row exists for
  that id with `extraction_status` in (`'success'`, `'success_empty'`), visible on the Performance
  tab for that session's partner account.

## 8. Error States

- **`inngest.send()` fails inside `emitPartnerSessionEndedEvent()`** — caught and logged
  (`console.error`), never thrown, never blocks the caller. Matches the existing
  `clio/partner-trial.ended` / `clio/partner-live.ended` emit error handling in the same function —
  a failed emission here means the fast path is missed for that one session, but the 30-minute
  backstop sweep (now with error surfacing per 6.4) remains the safety net, exactly as designed.
- **Backstop sweep candidate/existing-rows query fails** — now throws (Section 6.4); Inngest retries
  the step up to the function's `retries: 3` budget; if all retries are exhausted, the run shows as
  failed in Inngest's dashboard. No silent empty-candidate-list outcome remains possible for a genuine
  query error.
- **Anthropic API call fails during extraction** (existing behavior, unchanged) —
  `extractInsightsForPartnerSession()` throws; the fast-path function's outer `try`/`catch`
  (`inngest/partner-session-insights-extractor.ts:394-404`) calls `markInsightsExtractionFailed()`
  after Inngest's own 3 retries are exhausted, writing `extraction_status: 'failed'`.
- **Both a fast-path and legacy-fallback emission race for the same session** — now resolved
  deterministically by the atomic-claim fix in 6.3: exactly one proceeds, the other short-circuits
  immediately with no Anthropic call and no duplicate webhook dispatch.
- **Backfill script (`scripts/backfill-b2b37-orphaned-session.ts`) fails** — logs the error, exits
  with a non-zero code. No automatic retry; this is a manual, human-run, one-time operation — a
  failure means a human re-runs it after investigating, same as `reseed-failed-domains.ts`'s existing
  operational model.

## 9. Edge Cases

- **Session already has a terminal `partner_session_insights` row when a completion path re-fires**
  (e.g., a rare double-completion) — idempotency guard's `if (existing)` branch (unchanged) catches
  this exactly as it does today.
- **`clioSessionRef` / `partnerSessionId` referenced by a completion path no longer exists in
  `partner_sessions`** (should not happen in practice, but not impossible under a hard delete) —
  `extractInsightsForPartnerSession()` already throws `No partner_sessions row for id ...`
  (line 209, unchanged); the fast-path function catches it and calls `markInsightsExtractionFailed()`,
  which itself no-ops if no `partner_session_insights` row exists yet (documented behavior, line 338,
  unchanged) — the backstop sweep will not retry it since it never appears in the sweep's
  `partner_sessions`-driven candidate query either.
- **Legacy Hume-webhook fallback branch still fires for a session the fast path already handled** —
  covered by Section 6.3's guard; no double extraction, no double webhook dispatch. If it fires for a
  session the fast path has *not yet* finished handling (the race case), the atomic-claim fix
  resolves it deterministically to exactly one extraction.
- **Backfilling the orphaned test session dispatches one real outbound webhook** to that session's
  partner account (Section 6.5) — disclosed as expected, not a bug; `test_mode: true` is included in
  the payload so the partner side can distinguish it if they care to.
- **A session stuck at `extraction_status: 'pending'` for a genuinely long time from a crashed run**
  (not a same-moment race, a real crash) — still correctly retried by the backstop sweep's
  `if (existing)` branch (line 163: `'pending' — allow retry`, unchanged by this brief).
- **Inngest cron for the backstop sweep is not actually registered/running on this deployment's
  Inngest platform** — see Section 11, Q5. This is the one edge case this brief cannot verify or fix
  from code alone.
- **Mobile vs. desktop** — not applicable; no UI surface changes.

## 10. Out of Scope

- No new billing logic, no change to `recordBillableEvent()` calls, no change to
  `billed_duration_source` semantics, per the CEO brief's explicit Known Constraints.
- No change to the existing `clio/partner-trial.ended` / `clio/partner-live.ended` emissions or the
  watchdog-cancellation behavior they serve.
- No removal of the legacy Hume-webhook fallback branch (`app/api/webhooks/hume/route.ts:130-149`) —
  left in place as a redundant-but-harmless extra safety net; see Section 6.3.
- No general-purpose "re-extract any session" admin tool or UI — the backfill mechanism (Section 6.5)
  is a hardcoded, one-off, single-session script, explicitly not reusable infrastructure.
- No fix to the same unchecked-Supabase-error pattern found elsewhere in
  `inngest/partner-session-insights-extractor.ts` outside the two query sites the CEO brief
  specifically scoped (Section 6.4's note) — flagged for awareness, not fixed here.
- No verification of the Inngest Cloud dashboard's cron registration — see Section 11, Q5; explicitly
  a non-code, non-BA/Dev-resolvable precondition.
- No change to `partnerSessionInsightsPurge` (the daily 30-day purge cron) — unrelated to this bug.

## 11. Open Questions

**Status: all questions within BA/Dev's ability to resolve from the repository are answered below and
closed. One question (Q5) is explicitly not resolvable from the repository and is documented as a
standing precondition, not a blocker to CEO approval or to the developer building/shipping the code
changes in Sections 6.2-6.4.**

- **Q1 (helper vs. individual calls):** RESOLVED — one shared helper, `emitPartnerSessionEndedEvent()`
  in `lib/partner/live-render.ts`, called from 3 sites (covers all 4 completion paths since
  `handleSessionEnd()` collapses 2 of them). See Section 6.2.
- **Q2 (double-extraction risk):** RESOLVED — sequential double-fires were already safe; a narrow
  concurrent-insert race was real and is closed via an atomic-claim change to
  `runInsightsIdempotencyGuard()`'s insert branch, without touching the backstop sweep's intentional
  `'pending'`-is-retryable crash-recovery behavior. See Section 6.3.
- **Q3 (backstop error handling):** RESOLVED — log then throw, matching this file's own
  `partnerSessionInsightsPurge` precedent and the CEO's explicit "must be loud" success criterion.
  See Section 6.4.
- **Q4 (backfill mechanism):** RESOLVED — a one-off local script,
  `scripts/backfill-b2b37-orphaned-session.ts`, following the exact existing precedent of
  `scripts/reseed-failed-domains.ts`. Concrete run steps in Section 6.5.
- **Q5 (Inngest cron registration verification):** **NOT RESOLVABLE FROM THE REPOSITORY.** Whether
  `partner-session-insights-backstop-sweep` (cron `*/30 * * * *`) is actually registered and running
  on the Inngest platform for this specific deployment can only be confirmed by checking Inngest's
  own Cloud dashboard/run history — nothing in the repo can prove or disprove this. This is
  explicitly flagged, per the CEO brief, as an item for **Arun or the Orchestrator**, not something a
  BA or developer can close from code review. **This does not block CEO approval of this spec, and
  does not block a developer building and shipping the code changes in Sections 6.2-6.4** — but per
  the CEO brief's own "What Success Looks Like," this brief should not be considered **fully
  resolved** until that dashboard check happens and confirms the cron is live. Recommend checking
  this in the same dashboard session used for Section 6.5's backfill step, since both require the
  same access.
- **Q6 (test coverage plan):** RESOLVED — full list in Section 7; covers `testMode` true/false on the
  fast path, both cutoff-cron paths, the idempotency guard's terminal-state and concurrent-race
  behavior, and both backstop error-surfacing cases.

## 12. Dependencies

- Code changes 1-3 (Sections 6.2-6.4) must all ship together in the same deploy — they are
  interdependent (the emission fix without the idempotency fix reintroduces the race; the error-
  surfacing fix is independent but trivial to bundle in the same PR).
- The backfill script (Section 6.5) depends on code changes 1-3 already being live in production —
  running it before the fix ships only proves the extractor works standalone, does not fix the
  four completion paths.
- Requires `ANTHROPIC_API_KEY` and `HUME_API_KEY` to be real (non-placeholder) values in the
  environment the backfill script runs against, exactly as `extractInsightsForPartnerSession()`
  already requires for any real (non-mock) extraction.
- Requires whatever production-credential-pulling mechanism this repo already uses for one-off
  scripts (referenced in `reseed-failed-domains.ts` as `.env.production.pulled`) to be available to
  whoever runs the backfill.
- Requires Inngest dashboard access for Arun/Orchestrator to close Q5 (Section 11) — not a code
  dependency, a verification dependency.

---

## CEO Review — 2026-07-26 — APPROVED, zero revision requests

Independently re-verified every load-bearing claim against the actual live files, not the spec's
narrative, before approving:

- **Q1 (3 call sites, not 4)**: read `lib/partner/live-render.ts:498-556` directly — confirmed
  `handleSessionEnd()` has exactly the two existing emit branches (`clio/partner-trial.ended` /
  `clio/partner-live.ended`, lines 514-523) and confirmed both
  `app/api/partner/render/end-session/route.ts` (line 36, the only call in that file) and
  `app/api/attendee/webhook/route.ts` (the `handleSessionEnd(row.id, ...)` call, matching the cited
  line) call this one function. The two cutoff files (`inngest/partner-live-cutoff.ts:254-267`,
  `inngest/partner-trial-cutoff.ts:60-66`) confirmed to update `partner_sessions` directly via
  Supabase, never through `handleSessionEnd()`. The 3-call-site consolidation is correct, not a
  shortcut — it is the minimum correct set, not an undercount.
- **Q2 (TOCTOU race)**: read `runInsightsIdempotencyGuard()` (lines 143-186) and the backstop sweep's
  filter (lines 445-451) directly. Confirmed the race is real: the current `else` branch does a
  blind `upsert(...)` followed by a *separate* re-`SELECT`, so two near-simultaneous callers can both
  observe `'pending'` after their own upsert and both proceed. Confirmed the proposed fix (chaining
  `.select()` onto the `upsert(..., { ignoreDuplicates: true })` call and using the returned row
  count as an atomic claim) is standard, correct Postgres `INSERT ... ON CONFLICT DO NOTHING
  RETURNING` semantics — exactly one concurrent caller gets a non-empty result. Confirmed the fix is
  scoped only to the "no existing row" branch and does not touch the separate `if (existing)` branch
  (lines 159-164) that the backstop sweep's crash-recovery design depends on — traced the backstop's
  own `'pending' — allow retry` comment to line 450 exactly as claimed, and confirmed that logic lives
  entirely in the sweep's own filter, untouched by this change. The claim that sequential double-fires
  were already safe and only the concurrent-insert window was open is correct.
- **Q3 (log then throw)**: confirmed `partnerSessionInsightsPurge` (line 491, `if (error) throw new
  Error(...)`) is a real, directly comparable precedent in the same file, and confirmed
  `partnerSessionInsightsBackstopSweep` declares `retries: 3` at the function level (line 416) — so a
  thrown error inside `find-eligible-sessions` gets Inngest's normal retry/backoff before ever
  surfacing as a failed run, not an immediate page. This is proportionate: it goes loud (visible in
  Inngest's run history) only after retries are exhausted on what is very likely transient, and it
  replaces a failure mode that already went unnoticed for 48+ consecutive runs empirically. Correct
  call.
- **Q4 (backfill mechanism and disclosure)**: read `scripts/reseed-failed-domains.ts` directly —
  confirmed it matches the claimed precedent exactly (one-off, hardcoded target, credentials pulled
  from the calling shell's environment, run via `npx tsx`, left in the repo afterward as a historical
  record). Read `recordInsightsReadyEvent()` (`lib/partner/webhooks.ts:568-631`) directly — confirmed
  it unconditionally inserts a webhook-dispatch-log row on every call, which the async dispatcher
  (`fetchDueDispatches()` / the webhook dispatcher job) will pick up and actually deliver to the
  partner's configured outbound endpoint. The BA's disclosure that running the backfill will cause one
  real outbound `session.insights_ready` HTTP dispatch is accurate, not understated — this is exactly
  the "test_mode session, but a real HTTP call still fires" pattern this project has been burned by
  before, and it is called out explicitly in both Section 6.5 and Section 9, not buried. Approved as
  written.
- **Q5 (Inngest dashboard verification)**: confirmed this is documented as a non-blocking-but-required
  precondition (Section 11, Q5) — explicitly not conflated with "the code fix is verified working,"
  and explicitly not something a BA or developer can close from the repo alone. Carrying this forward
  as the one remaining action item before this brief is considered fully closed.

**Verdict: APPROVED as written. No revision requests.** Cleared for developer dispatch against
Sections 6.2-6.4 (interdependent, ship together in one deploy per Section 12). The backfill script
(6.5) and the Inngest dashboard check (Q5) both happen only after that deploy is live — do not run
either against unfixed code.

**Required next step before this brief is fully closed (do not drop):** check Inngest's own Cloud
dashboard/run history for this deployment and confirm `partner-session-insights-backstop-sweep`
(cron `*/30 * * * *`) is actually a registered, running function — nothing in the repository can
prove or disprove this. Recommend doing this in the same dashboard session as the Section 6.5 backfill
step, since both need the same access. This verification, not the code merge, is what closes B2B-37.
