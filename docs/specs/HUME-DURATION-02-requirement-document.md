# HUME-DURATION-02 — Fix Hume Duration-Fetch Timing Race
# Requirement Document

Version: 1.0
Status: READY FOR CEO APPROVAL — all open questions resolved 2026-07-06
Author: Business Analyst Agent
Date: 2026-07-06

---

## 1. Purpose

`finalizeHumeNativeBilling()` (`lib/session-billing.ts`) exists so that Hume-native sessions are billed from Hume's own authoritative chat-duration record, not our own audit-log approximation — this is the entire point of HUME-DURATION-BILLING-01. Today, `forceEndSession()` writes our `disconnected` audit event and, in the same synchronous call, asks Hume for that chat's final duration exactly once, with a 5-second timeout and no retry. Hume frequently has not finished finalizing its own chat record (no `end_timestamp` yet) at that exact instant — a genuine timing race, not a bug in either system.

When this race is lost, we silently fall back to `computeBilledMinutes()` (our own audit-log calculation). The user is never billed incorrectly — the fallback is conservative and already proven correct — but we lose the Hume-authoritative cross-check that HUME-DURATION-BILLING-01 was built to provide, on what may be a large fraction of sessions if the race is lost often.

Without this fix, `billing_source` in `minutes_ledger` will show `fallback_audit_log` far more often than it should, undermining confidence in Hume-sourced billing data and creating unnecessary reconciliation work if Hume's invoiced compute time is ever compared against our own numbers.

## 2. User Story

As the billing system,
I want to give Hume's chat-duration API enough time to finalize before asking it for a session's duration, retrying once if the first attempt is too early,
So that Hume-native sessions are billed from Hume's authoritative record in the common case, and only fall back to our own audit log when Hume's data is genuinely unavailable — never merely because we asked too soon.

As a user finishing a Hume-native session,
I want the app to end my session and release the meeting bot immediately when I'm done,
So that I never notice or wait on any billing reconciliation happening behind the scenes.

## 3. Trigger / Entry Point

- No new route, page, or user-facing entry point. This is a backend timing/retry fix contained entirely within the existing call chain:
  `forceEndSession()` (`lib/session-billing.ts`) → `finalizeHumeNativeBilling()` (`lib/session-billing.ts`) → `fetchHumeChatDuration()` (`lib/voice/hume-native/session-details.ts`)
- Entry conditions are unchanged: fires whenever a Hume-native session ends, via either the wall-clock timer (D3 backstop) or the voice-gap watchdog (D2/AC-D8), both of which call `forceEndSession()`.
- Only sessions where `humeNativeEnabled === true` are affected. ElevenLabs/Custom-LLM sessions never call `finalizeHumeNativeBilling()`'s Hume-fetch branch (it returns `{ source: 'not_applicable' }` immediately) and are completely untouched by this change.

## 4. Screen / Flow Description

There is no user-visible screen for this feature. The "flow" is entirely a backend timing sequence. Documented step-by-step for the developer building it:

**Step 1 — Teardown happens first, unconditionally, synchronously (unchanged).**
`forceEndSession()` continues to do all of the following in the existing order, with zero added delay:
1. Look up session status; no-op if already `completed`.
2. Delete the Recall.ai bot (best-effort, non-fatal on error).
3. Reset `walkthrough_state` to idle (clears `bot_id`, `sections`, `current_section_index`, `audit_token`, etc.).
4. Write the `disconnected` audit event.

**Step 2 — Hume duration resolution (this is what changes).**
Immediately after the `disconnected` audit event is written, for Hume-native sessions only:
1. Wait 3 seconds (fixed delay — see Section 11 decision below) before the *first* `fetchHumeChatDuration()` attempt. This delay happens in the background (see Step 3) — it must never block bot deletion, `walkthrough_state` teardown, or the audit event write, all of which have already completed by Step 1.
2. Call `fetchHumeChatDuration(humeChatId)` (existing function, unchanged internals: 5s timeout, single HTTP call).
3. If the result is `{ ok: true, ... }`: use it. Done — this is now the fast/common path with the timing race mostly avoided.
4. If the result is `{ ok: false, reason: 'missing_timestamps' }` specifically: wait 4 more seconds, then retry `fetchHumeChatDuration()` exactly once more.
   - If the retry succeeds (`ok: true`): use it.
   - If the retry also fails (any reason, including `missing_timestamps` again): stop retrying and fall back to `computeBilledMinutes()`, exactly as today.
5. If the result is `{ ok: false, reason: <anything other than 'missing_timestamps'> }` (e.g. `api_key_not_configured`, `timeout`, `network_error`, `http_*xx`, `unparsable_response`, `no_hume_chat_id`): no retry — fall back to `computeBilledMinutes()` immediately, exactly as today. These reasons are not a "we asked too early" problem and a retry would not help.

**Step 3 — This entire Step 2 sequence runs asynchronously, after teardown, and never delays the user.**
The bot has already been deleted and `walkthrough_state` already reset by the time Step 2 begins. The session row update (`status: 'completed'`, `duration_mins`) and the minutes deduction/ledger write, however, still only happen once Step 2 resolves (see Section 11, Decision A) — this is a change from today's fully-synchronous flow, described precisely in Section 6.

**Step 4 — Session row and ledger are written exactly once, after Step 2 resolves (success or fallback).**
Unchanged from today except for timing: `sessions.status = 'completed'`, `duration_mins` set, minutes deducted via `deduct_minutes` RPC, and `minutes_ledger` row written with `billing_source: 'hume'` or `billing_source: 'fallback_audit_log'` plus the same `billingSourceMetadata` shape as today (`{ hume_duration_seconds }` or `{ fallback_reason }`).

There is no Section 5 (Visual Examples) content to write — no UI is involved. Per the template, this is stated explicitly rather than omitted: **N/A — backend-only change, no wireframes apply.**

## 5. Visual Examples

N/A — this is a backend-only timing/retry fix with no UI surface. No screen states exist to wireframe.

## 6. Data Requirements

**Read:**
- `sessions.hume_native_enabled`, `sessions.hume_chat_id` (existing read in `finalizeHumeNativeBilling()`, unchanged)
- `users.minutes_balance` (existing read in `forceEndSession()`, unchanged)
- `session_billing_audit_log` rows via `getAuditLog()` (existing, only used by the fallback path, unchanged)

**Written:**
- `sessions.ended_at`, `sessions.status = 'completed'`, `sessions.duration_mins` — same fields as today, written once Step 2 (Section 4) resolves rather than immediately after the single old attempt.
- `minutes_ledger` — one row per session end via `writeMinutesLedgerEvent()`, same shape as today. New field value only: `billingSourceMetadata` gains an optional `retry_used: boolean` and `total_wait_ms: number` (see below) for observability.
- `session_billing_audit_log` — `disconnected` event, written immediately in Step 1, unchanged position in the sequence (i.e. still written before any Hume fetch attempt, exactly as today).

**New metadata fields on the `minutes_ledger` row (additive, non-breaking):**
- `retry_used: boolean` — `true` if the `missing_timestamps` retry path was taken (regardless of whether the retry succeeded or not).
- `total_wait_ms: number` — total milliseconds spent waiting on Hume before resolving to either `hume` or `fallback_audit_log` (3000 if no retry attempted and first call resolved either way, or 7000 if the retry path ran). Purely observability — lets us later query "how often does the retry actually help" without new instrumentation.

**No new tables, no new API calls, no new npm packages** (per Known Constraints in the brief).

## 7. Success Criteria (Acceptance Tests)

✓ Given a Hume-native session ends and Hume's chat record is already finalized within 3 seconds of the `disconnected` audit event, when `forceEndSession()` runs, then the session is billed with `billing_source: 'hume'` and `retry_used: false`.

✓ Given a Hume-native session ends and Hume's chat record is NOT finalized at the first attempt (3s) but IS finalized by the retry attempt (7s total), when `forceEndSession()` runs, then the session is billed with `billing_source: 'hume'`, `retry_used: true`, and `total_wait_ms: 7000`.

✓ Given a Hume-native session ends and Hume's chat record is still not finalized after both the first attempt and the retry, when `forceEndSession()` runs, then the session falls back to `computeBilledMinutes()`, is billed with `billing_source: 'fallback_audit_log'`, `fallback_reason: 'missing_timestamps'`, and `retry_used: true` — and the user's billed minutes exactly match what today's (pre-fix) behavior would have produced via the fallback path.

✓ Given a Hume-native session ends and `fetchHumeChatDuration()` returns a non-`missing_timestamps` failure (e.g. `timeout`, `http_500`, `no_hume_chat_id`), when `forceEndSession()` runs, then NO retry is attempted, the session falls back to `computeBilledMinutes()` immediately, and total added latency vs. today is 3 seconds (the fixed pre-first-attempt delay), not 7.

✓ Given an ElevenLabs or Custom-LLM session ends (`humeNativeEnabled !== true`), when `forceEndSession()` runs, then `finalizeHumeNativeBilling()` returns `{ source: 'not_applicable' }` immediately with zero added delay, exactly as today — this fix must not add any latency to non-Hume-native session teardown.

✓ Given a Hume-native session ends, when `forceEndSession()` runs, then the Recall.ai bot is deleted and `walkthrough_state` is reset to idle within the same timeframe as today (no added delay) — the 3s/7s wait only affects when the `sessions` row is marked `completed` and minutes are deducted, never bot teardown or state reset.

✓ Given the retry path is taken and both attempts fail with `missing_timestamps`, when the ledger row is written, then `billingSourceMetadata` contains exactly `{ fallback_reason: 'missing_timestamps', retry_used: true, total_wait_ms: 7000 }` — no other reason strings leak in.

## 8. Error States

- **First Hume fetch times out (5s) or errors (network):** treated identically to today — falls straight to `computeBilledMinutes()`, no retry (per Section 4 Step 2.5 — only `missing_timestamps` triggers a retry). `retry_used: false`.
- **Retry attempt also times out or network-errors:** falls back to `computeBilledMinutes()`. `fallback_reason` is set to whatever the retry's own failure reason was (may differ from `missing_timestamps` — e.g. the network could time out on the second attempt even though the first returned `missing_timestamps`). `retry_used: true`.
- **`HUME_API_KEY` is a placeholder/unset:** `fetchHumeChatDuration()` already returns `{ ok: false, reason: 'api_key_not_configured' }` synchronously without an HTTP call — no retry triggered (not `missing_timestamps`), falls back immediately, zero added wait beyond the fixed 3s pre-delay.
- **`forceEndSession()` itself is called twice for the same session (idempotency):** unchanged — the existing `status === 'completed'` check at the top of `forceEndSession()` already returns `{ skipped: true }` before any billing logic runs, so a duplicate call (e.g. watchdog firing after the wall-clock timer already ended the session) cannot double-deduct or re-trigger a second wait/retry cycle.
- **Retry succeeds but returns an implausible duration (e.g. negative or absurdly large):** out of scope for this fix — `fetchHumeChatDuration()`'s existing validation (`typeof === 'number'` check on both timestamps) is unchanged; no new validation is added here. If Hume ever returns `end_timestamp < start_timestamp`, `durationSeconds` would be negative and `Math.max(0, Math.ceil(...))` in `finalizeHumeNativeBilling()` already floors it to 0 minutes — pre-existing behavior, not modified.

## 9. Edge Cases

- **Session ends via the voice-gap watchdog rather than the wall-clock timer:** both call the same `forceEndSession()` — the fix applies identically regardless of which caller triggered teardown.
- **Bot deletion itself is slow (Recall.ai API latency):** unaffected — Step 1 (bot deletion, walkthrough_state reset, audit event) is unchanged and still fully synchronous; Step 2's wait/retry only starts after Step 1 completes, so any Recall.ai slowness and the Hume wait are not compounded from the user's perspective (user already sees the bot leave / screen clear before the Hume wait even begins).
- **App restarts / serverless function is killed mid-wait:** if the process hosting `forceEndSession()` is torn down during the 3s or 7s wait (e.g. serverless timeout), the `sessions` row is left in whatever status it was in before Step 4 ran (not yet `completed`). This is an accepted risk already inherent in today's single-attempt synchronous design — this fix does not change how deployment/runtime risk is handled, since it does not detach Step 2 into a separate durable job (see Section 11 Decision A for why not). If this becomes a real, observed problem, it should be raised as a new follow-up spec, not solved speculatively here.
- **Two sessions with Hume-native enabled end within the same few seconds (concurrent users):** each session's `forceEndSession()` call is independent (own `sessionId`, own `setTimeout`/await chain) — no shared state or lock between them, no cross-session interference.
- **`missing_timestamps` recurs frequently even after this fix ships (i.e. 7 seconds still isn't enough for Hume, some fraction of the time):** flagged explicitly as a monitoring need — see Section 11 Decision D. This spec does not attempt to guess a delay long enough to reach 100%; it accepts a residual fallback rate and asks for observability instead of a longer/uncapped wait.

## 10. Out of Scope

- Reconciling a session's billed minutes after the fact if a delayed/async Hume fetch later succeeds with a different number than what was already deducted via fallback (this was Brief Question 2 — resolved as "no reconciliation path," see Section 11 Decision B). No correction job, no re-billing, no ledger adjustment entries are built as part of this fix.
- Any change to ElevenLabs or Custom-LLM billing paths.
- Any change to the fallback failure reasons other than `missing_timestamps` (e.g. `no_hume_chat_id`, `api_key_not_configured` continue to skip straight to fallback with zero retry, exactly as today).
- Building a dedicated alerting/dashboard system for `missing_timestamps` frequency — this fix only ensures the data needed for such monitoring (`retry_used`, `total_wait_ms`, `fallback_reason` in `minutes_ledger.metadata`) is captured. Building the actual alert is a separate, future piece of work.
- Any new npm package, any new Hume API endpoint beyond the existing `GET /v0/evi/chats/{chat_id}` call already used by `fetchHumeChatDuration()`.
- Increasing the per-attempt HTTP timeout (still 5s per attempt, unchanged) — only the pre-attempt delay and the single conditional retry are new.

## 11. Open Questions

None. All four questions raised in the Feature Brief are technical implementation decisions within this fix's own scope (delay/retry timing, synchronous-vs-async placement, reconciliation policy, and monitoring data) — resolved below rather than left open, per this project's standing rule that no spec proceeds to development with unresolved Section 11 items.

**Decision A — Delay/retry amount and critical-path placement (Brief Question 1):**
Fixed 3-second delay before the first attempt, and — only on a `missing_timestamps` result specifically — one retry after 4 additional seconds (7 seconds total elapsed since the `disconnected` audit event). This is a single bounded retry, not a backoff loop. Placement: teardown-critical work (bot deletion, `walkthrough_state` reset, audit event write) remains fully synchronous and unaffected, exactly as today. The wait/retry/billing-resolution sequence (Step 2–4 in Section 4) runs after teardown, within the same `forceEndSession()` async function call (i.e. the caller of `forceEndSession()` — the wall-clock timer or the gap watchdog — awaits slightly longer than before, up to ~7 extra seconds in the retry case, 3 extra seconds otherwise), but the user has already had their bot removed and screen cleared by the time this wait happens, so it is not user-perceptible. Rationale: 3 seconds is a reasonable, conservative guess at Hume's own finalization latency based on the fact that this is a genuine "hadn't closed out yet" race rather than a slow endpoint; a single bounded retry avoids open-ended delay while giving the fix real teeth. This keeps `forceEndSession()`'s existing signature and single-function-call shape rather than splitting billing resolution into a separate detached job, which would be a larger architectural change not justified by this bug (see Decision D for how we'll know if more is needed).

**Decision B — Reconciliation if a later/retried Hume fetch produces a different number than the already-deducted fallback (Brief Question 2):**
No reconciliation path is built. The fallback-derived deduction, once written, is final. Rationale (stated in the brief itself and confirmed here as the simplest defensible choice): `computeBilledMinutes()` is our own audit-log-derived calculation and is already conservative — users are never worse off by it being used instead of Hume's number. Since this fix's retry is bounded to 7 seconds total (not indefinite/async-after-completion), there is no scenario in this design where a session is marked `completed` via fallback and then later, separately, gets a delayed Hume answer — by the time Step 4 (Section 4) runs, the Hume-vs-fallback decision has already been made once, synchronously (within this same `forceEndSession()` call), and is never revisited. This eliminates the reconciliation problem by construction rather than requiring a correction mechanism.

**Decision C — Cap on total retry/delay time (Brief Question 3):**
Yes: 7 seconds total (3s initial delay + 4s before the single retry), hard-capped, no further retries regardless of outcome. This is enforced structurally by Decision A's single-retry design, not by a separate timeout wrapper — there is no code path that can wait longer than 7 seconds before falling back.

**Decision D — Monitoring/alerting if `missing_timestamps` recurs frequently after this fix (Brief Question 4):**
This fix adds the data needed for future monitoring (`retry_used`, `total_wait_ms`, and the existing `fallback_reason` — all in `minutes_ledger.metadata`, per Section 6) but does not build a dashboard or alert as part of this ship. This is a technical instrumentation decision, not a product one, and is resolved here: capture the data now, so that if `fallback_reason: 'missing_timestamps'` frequency after this fix is later reviewed (e.g. via a `minutes_ledger` query filtering on `metadata->>'fallback_reason'`), the retry's effectiveness can be measured without needing a second data-collection ship. Building an actual alert/dashboard on top of this data is out of scope (Section 10) and should be raised as its own follow-up if the data shows a persistent problem.

## 12. Dependencies

- No dependency on any other in-flight spec. This fix is fully contained within `lib/session-billing.ts` and `lib/voice/hume-native/session-details.ts`, both of which already exist and already implement HUME-DURATION-BILLING-01.
- Depends on `HUME_API_KEY` being a real (non-placeholder) key in any environment where this is expected to actually exercise the Hume branch — unchanged precondition from today.
- No database migration required — the two new metadata fields (`retry_used`, `total_wait_ms`) are stored inside the existing `minutes_ledger.metadata` JSONB column, which already accepts arbitrary additional keys (see `writeMinutesLedgerEvent()` — `metadata: params.metadata ?? {}`, no schema enforced beyond JSONB).

---

## Files Changed

### `lib/voice/hume-native/session-details.ts`

- **`fetchHumeChatDuration(humeChatId: string)`** (lines 141–204): **No signature change and no internal logic change.** This function remains a single-attempt, 5-second-timeout fetch exactly as it is today. All new delay/retry orchestration lives in the caller (`finalizeHumeNativeBilling()`), not here — this function's contract ("one attempt, typed result, never throws") is preserved so it can still be called twice (initial + retry) without any modification.

### `lib/session-billing.ts`

- **New helper function `delay(ms: number): Promise<void>`** (add near the top of the file, after imports, before `mintAuditToken`): a trivial `new Promise(resolve => setTimeout(resolve, ms))` wrapper. No new npm package — plain `setTimeout`, consistent with the "no new packages" constraint.

- **`finalizeHumeNativeBilling(params)`** (lines 257–300): modify the single existing call
  ```
  const result = await fetchHumeChatDuration(humeChatId)
  ```
  (currently line 289) to the new sequence:
  1. `await delay(3000)`
  2. `let result = await fetchHumeChatDuration(humeChatId)`
  3. `let retryUsed = false`
  4. `if (!result.ok && result.reason === 'missing_timestamps') { retryUsed = true; await delay(4000); result = await fetchHumeChatDuration(humeChatId) }`
  5. Existing `if (!result.ok) { ...fallback... }` branch (lines 291–296) is unchanged in structure, but the returned `FinalizeHumeNativeBillingResult` for the fallback case must now also carry `retryUsed` and `totalWaitMs` so `forceEndSession()` can pass them into the ledger metadata. Extend the `{ source: 'fallback'; reason: string }` variant of `FinalizeHumeNativeBillingResult` (line 230) to `{ source: 'fallback'; reason: string; retryUsed: boolean; totalWaitMs: number }`.
  6. The success branch (line 298–299, `{ source: 'hume', minutesUsed, durationSeconds }`) must likewise be extended to `{ source: 'hume'; minutesUsed: number; durationSeconds: number; retryUsed: boolean; totalWaitMs: number }`.
  - `totalWaitMs` is `3000` if no retry occurred, `7000` if the retry path ran (regardless of the retry's own outcome).
  - The `not_applicable` early-return (lines 278–280, non-Hume-native sessions) is completely unaffected — it still returns immediately with zero delay, before the new `delay(3000)` call is ever reached (the `delay` call sits after the `humeNativeEnabled`/`humeChatId` checks, exactly where today's single `fetchHumeChatDuration` call sits).

- **`FinalizeHumeNativeBillingResult` type** (lines 227–230): update as described above to add `retryUsed` and `totalWaitMs` to both the `hume` and `fallback` variants (the `not_applicable` variant is unchanged — it never waits).

- **`forceEndSession(params)`** (lines 310–420): update the block that reads `humeResult` (lines 368–384) to pass the new fields into the ledger metadata:
  - When `humeResult.source === 'hume'`: `billingSourceMetadata = { hume_duration_seconds: humeResult.durationSeconds, retry_used: humeResult.retryUsed, total_wait_ms: humeResult.totalWaitMs }`.
  - When `humeResult.source === 'fallback'`: `billingSourceMetadata = { fallback_reason: humeResult.reason, retry_used: humeResult.retryUsed, total_wait_ms: humeResult.totalWaitMs }`.
  - When `humeResult.source === 'not_applicable'`: unchanged — `billingSourceMetadata = {}` (no wait ever happened, no new fields to add).
  - No other line in `forceEndSession()` changes — bot deletion (line 332–339), `walkthrough_state` reset (lines 341–359), and the `disconnected` audit write (line 362) all remain exactly where they are, before the (now slightly longer) `finalizeHumeNativeBilling()` call at line 368.

### No other files change.

- `app/api/webhooks/twilio/route.ts`, `lib/voice/relay-handler.ts`, and every other caller of `forceEndSession()` are unaffected — `forceEndSession()`'s external signature and return shape (`{ skipped: true } | { skipped: false; minutesUsed: number }`) do not change, only its internal timing.
