# Hume-Native Call Duration as Billing Source of Truth — Requirement Document
Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-05

---

## 1. Purpose

Today, Hume-native sessions bill minutes using an internally-computed window —
`speak_verified` (first confirmed working voice) to `disconnected` — derived entirely
from our own `session_billing_audit_log`. Hume's own Chat History API separately
records the full WebSocket connection lifetime for the same call, and the two numbers
can disagree. If a user or Arun ever compares our billed minutes against Hume's own
usage dashboard, there's no way to reconcile the difference, and long-term we cannot
accurately reconcile against what Hume actually bills us for compute.

Separately, a structural double-charge risk exists: `app/api/sessions/[id]/end/route.ts`
(the manual "End Session" path) has no `status === 'completed'` guard before deducting,
unlike `forceEndSession()` in `lib/session-billing.ts` which already has one. If a
user clicks "End Session" at the same moment the watchdog or session timer force-ends
the same session, both paths can independently write a deduction.

Without this feature: Hume-native billing continues to drift from Hume's authoritative
record (a trust and reconciliation problem), and a race between manual end and an
automatic force-end can double-charge a user for one session.

## 2. User Story

As a Hume-native session user,
I want the minutes deducted from my balance to match what Hume itself recorded for the call,
So that my bill is never disputable against Hume's own usage data and I am never charged twice for the same session.

As Arun (product owner),
I want Hume-native billing reconciled against Hume's own authoritative call record,
So that our internal billing never silently drifts from what Hume will actually invoice us for compute.

(This is a backend/billing-logic change with no new user-facing screen. There is no
separate end-user-facing user story beyond the one above — the user experiences this
purely as "the number deducted is now provably correct.")

## 3. Trigger / Entry Point

This feature activates whenever a Hume-native session (`sessions.hume_native_enabled =
true`) ends, through any of these three existing entry points — no new entry point is
introduced:

- **Manual end**: `POST /api/sessions/[id]/end` — user clicks "End Session" in the UI
  (Clerk-authenticated, via `requireSessionAuth`).
- **Voice-gap watchdog force-end**: `inngest/voice-gap-watchdog.ts` → calls
  `forceEndSession()` after a 30s unresolved voice disconnect.
- **Session-timer force-end**: `inngest/session-timer.ts` → calls `forceEndSession()`
  after the planned duration elapses (shared backstop for both the ElevenLabs and
  Hume-native branches).
- **Recall.ai bot-side end-call**: `POST /api/sessions/end-call` (public,
  userId+token-keyed) → also calls `forceEndSession()` when the `end_session` tool
  fires or farewell-detection triggers.

All four of these must produce billing that is (a) sourced from Hume's own chat
duration when the session is Hume-native, and (b) idempotent — never deducting twice
for the same session.

## 4. Screen / Flow Description

There is no new UI screen. This is a backend billing-logic and reconciliation change.
The only observable behavior change for a user is in the *numbers*: minutes deducted
for a Hume-native session will now include the connection-setup window before Clio
starts speaking (previously unbilled), because billing now starts at Hume's own
call-start instant rather than at `speak_verified`.

### 4.1 New shared function: `finalizeHumeNativeBilling()`

Added to `lib/session-billing.ts`. This is the single new entry point both
`forceEndSession()` and the manual-end route call for Hume-native sessions. Step by
step:

1. Caller (either `forceEndSession()` or the manual-end route) has already confirmed
   `session.status !== 'completed'` (idempotency guard — see Section 6) and is about
   to compute minutes to deduct.
2. Read `sessions.hume_native_enabled` for this session (already fetched by callers in
   most cases; fetched fresh if not).
3. If `hume_native_enabled === false` → return immediately with
   `{ source: 'not_applicable' }`; caller falls through to the existing
   `computeBilledMinutes()` path, completely unchanged. (This is the ElevenLabs/Custom-LLM
   branch — out of scope for any billing-model change.)
4. If `hume_native_enabled === true`:
   a. Read `sessions.hume_chat_id`. If null/missing → log a warning, return
      `{ source: 'fallback', reason: 'no_hume_chat_id' }` immediately (no fetch
      attempted — there is nothing to fetch).
   b. Otherwise, call `fetchHumeChatDuration(humeChatId)` (new function, Section 6) with
      a single attempt and a 5-second timeout (Section 6.2 for exact policy).
   c. On success (`duration_seconds` returned): compute
      `minutesUsed = Math.max(0, Math.ceil(duration_seconds / 60))` and return
      `{ source: 'hume', minutesUsed, durationSeconds: duration_seconds }`.
   d. On failure/timeout/unavailable: log a warning with the specific reason, return
      `{ source: 'fallback', reason: <specific code> }`. Caller then calls the existing
      `computeBilledMinutes()` exactly as it does today.
5. The caller (whichever of `forceEndSession()` or the manual-end route) writes
   `metadata.billing_source` (`'hume'` or `'fallback_audit_log'`) onto the
   `minutes_ledger` row it already writes today, alongside the existing
   `reached_speak_verified` field. No new column, no new table (Section 6.4).

### 4.2 No visual change

Section 5 (Visual Examples) is intentionally empty of wireframes — there is no new or
changed screen. See Section 5 note below.

## 5. Visual Examples

Not applicable — this is a backend-only change with zero UI surface. No wireframes are
produced. (Per the BA template: every feature must state visual examples; here the
correct statement is that none exist because no screen is added or altered.)

## 6. Data Requirements

### 6.1 Exact fetch mechanism (resolves CEO Q1)

**Recommendation: fetch chat *metadata*, not paginated transcript events.**

New function `fetchHumeChatDuration(humeChatId: string)` added to
`lib/voice/hume-native/session-details.ts` (co-located with the existing Hume-fetch
patterns in that file, reusing its typed-error convention — not a new file, since the
brief specifies reusing this file's approach as the template).

- **Endpoint**: `GET https://api.hume.ai/v0/evi/chats/{chat_id}`
  (note: this is the single-chat metadata endpoint — distinct from
  `GET /v0/evi/chats/{chat_id}/events`, which is the paginated transcript-events
  endpoint already used by `fetchAllTranscriptEvents()` in `session-details.ts` and by
  `hume-native-nightly-cleanup.ts`). The metadata endpoint returns one JSON object
  describing the chat (status, timestamps, config reference) with no pagination and no
  transcript payload — confirmed cheaper and faster than pulling transcript events,
  which is exactly the CEO's Q1 ask.
- **Field read**: Hume's chat metadata object exposes `start_timestamp` and
  `end_timestamp` (both epoch milliseconds) once the chat has ended, plus a `status`
  field (`ACTIVE` / `USER_ENDED` / `TIMEOUT` / etc.). This codebase has never
  previously read a `duration_seconds` field directly from Hume anywhere (confirmed —
  neither `session-details.ts` nor `hume-native-nightly-cleanup.ts` reads it); both
  existing files only ever fetch Config snapshots and transcript events, never chat
  metadata. Therefore: **compute duration as
  `durationSeconds = (end_timestamp - start_timestamp) / 1000`**, derived from the two
  timestamps on the metadata object, rather than assuming a pre-computed
  `duration_seconds` field exists on Hume's side. If `end_timestamp` is absent (chat
  not yet marked ended on Hume's side) or `start_timestamp` is absent, treat this as
  "duration data unavailable" (Section 6.2) and fall back — never treat a missing
  `end_timestamp` as "duration is zero."
- Auth header: `X-Hume-Api-Key`, identical to every other Hume call in this codebase.
- If `HUME_API_KEY` is unset or a `PLACEHOLDER_` value: `fetchHumeChatDuration()`
  returns `{ ok: false, reason: 'api_key_not_configured' }` immediately, no network
  call attempted — same convention as `getHumeSessionDetails()`.

### 6.2 Exact fallback behavior and timing policy (resolves CEO Q2)

- **Single attempt, 5-second timeout, no retries.** Rationale: this call happens
  synchronously in the hot path of ending a session (user is waiting for "End Session"
  to complete, or the watchdog/timer job needs to finish promptly). A bounded retry
  adds latency for a call-ending user with no guaranteed payoff — the safe, always-available
  fallback (`computeBilledMinutes()`) exists precisely so a single fast attempt is
  sufficient. Implemented via `AbortController` with a 5000ms timeout wrapping the
  `fetch()` call.
- **"Fetch failed or unavailable" is defined operationally as any of:**
  - Network error / timeout (the 5s `AbortController` fires).
  - Non-2xx HTTP status from Hume (`401`, `404`, `429`, `500`, etc. — all treated
    identically: log the status code, fall back).
  - `200 OK` but the response body is missing `start_timestamp` or `end_timestamp`.
  - `sessions.hume_chat_id` is null (no chat was ever provisioned/connected).
  - `HUME_API_KEY` not configured.
- **On any of the above**: `finalizeHumeNativeBilling()` returns
  `{ source: 'fallback', reason: <code> }` and the caller (unchanged) proceeds to call
  the existing `computeBilledMinutes()` exactly as today. This fallback path is not new
  code — it is the current production code path, entirely unmodified. **Billing never
  blocks, never retries indefinitely, and never skips a deduction because of this
  fetch** — worst case, it silently reverts to today's behavior for that one session.
- **Where this lives**: the single-attempt-with-timeout logic lives inside
  `fetchHumeChatDuration()` in `lib/voice/hume-native/session-details.ts`. The
  decision of "did it succeed, if not fall back" lives inside the new
  `finalizeHumeNativeBilling()` function in `lib/session-billing.ts` (Section 4.1) —
  kept as two separate concerns: the fetch primitive (session-details.ts, matching
  that file's existing responsibility) vs. the billing decision (session-billing.ts,
  matching that file's existing responsibility). No fetch/retry logic is duplicated
  into the route handlers or Inngest jobs themselves.

### 6.3 Where the idempotency guard and new fetch logic live (resolves CEO Q3)

**Recommendation: a single new shared function, not four independent patches.**

- `finalizeHumeNativeBilling()` (new, `lib/session-billing.ts`) is the one place that
  decides Hume-vs-fallback minutes for a Hume-native session. It is called from exactly
  two places:
  1. **`forceEndSession()`** (existing function, `lib/session-billing.ts`) — already the
     single shared force-end path used by `voice-gap-watchdog.ts`, `session-timer.ts`,
     and `app/api/sessions/end-call/route.ts`. Modify `forceEndSession()` so that,
     immediately before its existing `computeBilledMinutes()` call, it first calls
     `finalizeHumeNativeBilling()`. If that returns `{ source: 'hume', minutesUsed }`,
     use that number and skip `computeBilledMinutes()` entirely. If it returns
     `{ source: 'fallback' }` or `{ source: 'not_applicable' }`, proceed to call
     `computeBilledMinutes()` exactly as today. This means all three existing callers
     of `forceEndSession()` get the new behavior for free with zero changes to those
     three files.
  2. **`app/api/sessions/[id]/end/route.ts`** (manual end) — modified directly (it does
     not call `forceEndSession()` today; it duplicates similar logic inline). Add the
     same `finalizeHumeNativeBilling()` call in the same position, immediately before
     its existing `computeBilledMinutes()` call.
- **Idempotency guard**: add `.eq('status', 'completed')` exclusion (mirroring
  `forceEndSession()`'s existing `if (!session || session.status === 'completed') return`
  check) to `app/api/sessions/[id]/end/route.ts`, immediately after its existing
  session fetch (which already selects `status`). If the session is already
  `completed`, return a `200` with `{ minutesUsed: 0, newBalance: <current balance>,
  alreadyCompleted: true }` and perform no further writes — no audit event, no
  deduction, no ledger write. This exactly mirrors `forceEndSession()`'s `{ skipped:
  true }` semantics, adapted to this route's existing response shape.
- **Exact files/functions touched**:
  - `lib/session-billing.ts` — add `finalizeHumeNativeBilling()`; modify
    `forceEndSession()` to call it before `computeBilledMinutes()`; modify its
    `writeMinutesLedgerEvent()` call to include `billing_source` in `metadata`.
  - `lib/voice/hume-native/session-details.ts` — add `fetchHumeChatDuration()`.
  - `app/api/sessions/[id]/end/route.ts` — add the `status === 'completed'` guard;
    add the `finalizeHumeNativeBilling()` call before its `computeBilledMinutes()`
    call; add `billing_source` to its `writeMinutesLedgerEvent()` metadata.
  - `inngest/voice-gap-watchdog.ts`, `inngest/session-timer.ts`,
    `app/api/sessions/end-call/route.ts` — **zero changes**. They already call
    `forceEndSession()`, which gains the new behavior internally.

### 6.4 Fallback flagging for reconciliation (resolves CEO Q4)

**Recommendation: yes, flag it — minimal addition, no new column, no new table.**

- Add `billing_source: 'hume' | 'fallback_audit_log'` to the `metadata` JSONB field
  already written by `writeMinutesLedgerEvent()` in both call sites (`forceEndSession()`
  and the manual-end route), alongside the existing `reached_speak_verified` field.
  `minutes_ledger.metadata` is already a JSONB "free-form context" column per its own
  migration comment (`057_minutes_ledger.sql`) — this is exactly the forward-compatible
  extension point it was designed for. No migration required.
- When `source === 'hume'`, also record `hume_duration_seconds` in the same metadata
  object, for future audit/reconciliation against Hume's own dashboard.
- When `source === 'fallback'`, also record the specific `fallback_reason` code from
  Section 6.2 (e.g. `'timeout'`, `'no_hume_chat_id'`, `'http_404'`) in metadata, so a
  future reconciliation pass can distinguish "Hume never had data for this chat" from
  "we hit a transient timeout."
- This is purely additive observability — identical convention to how
  `reached_speak_verified` is already stored today. No new read path is required by
  this spec; it exists for future audit/reconciliation tooling only.

### 6.5 Data read/written summary

- **Read**: `sessions.hume_native_enabled`, `sessions.hume_chat_id`, `sessions.status`
  (existing columns, no new columns needed — `hume_chat_id` already exists per
  `056_hume_native_session_fields.sql`).
- **External API call**: `GET https://api.hume.ai/v0/evi/chats/{chat_id}` (new call
  site; endpoint already exists on Hume's side, just not previously called by this
  codebase for metadata-only reads).
- **Written**: `sessions.duration_mins`, `sessions.status`, `sessions.ended_at` — all
  existing columns, existing write pattern, unchanged shape. `minutes_ledger.metadata`
  gains two new optional keys (`billing_source`, and either `hume_duration_seconds` or
  `fallback_reason`) — no schema/migration change, since `metadata` is JSONB.
- **No changes whatsoever** to the `deduct_minutes` RPC, the `minutes_ledger` table
  schema, or the `session_billing_audit_log` table schema or write pattern
  (`writeAuditEvent()` is called exactly as today, for exactly the same event types).

## 7. Success Criteria (Acceptance Tests)

✓ **AC-1 (happy path, manual end)**: Given a Hume-native session (`hume_native_enabled
= true`) with a valid `hume_chat_id` whose Hume chat has ended, when the user clicks
"End Session," then `GET /v0/evi/chats/{chat_id}` is called once, `minutesUsed` is
computed as `ceil((end_timestamp - start_timestamp) / 1000 / 60)`, this value (not
`computeBilledMinutes()`'s value) is deducted, and the `minutes_ledger` row's metadata
contains `billing_source: 'hume'`.

✓ **AC-2 (happy path, force-end)**: Given the same session setup, when the
voice-gap-watchdog or session-timer force-ends the session via `forceEndSession()`,
then the same Hume-sourced minute computation is used (not the audit-log calculation),
and the ledger metadata shows `billing_source: 'hume'`.

✓ **AC-3 (Hume fetch fails, fallback path)**: Given a Hume-native session where
`GET /v0/evi/chats/{chat_id}` times out (>5s) or returns a non-2xx status, when the
session ends (via any of the four entry points), then `computeBilledMinutes()` (the
existing audit-log calculation) is used instead, a deduction is still written exactly
once, and the ledger metadata shows `billing_source: 'fallback_audit_log'` with a
`fallback_reason` code. Billing is never skipped.

✓ **AC-4 (race between manual end and watchdog — no double charge)**: Given a
Hume-native session, when a manual "End Session" call and a watchdog/timer force-end
both fire for the same session within the same short window (simulated race), then
exactly one of the two writes a deduction — whichever wins the race sets
`status = 'completed'` first — and the second call detects `status === 'completed'`
and returns `{ minutesUsed: 0, alreadyCompleted: true }` (manual-end route) or
`{ skipped: true }` (`forceEndSession()`) without writing any further audit event,
deduction, or ledger row.

✓ **AC-5 (Hume-native session that never reached speak_verified, zero-duration
interaction)**: Given a Hume-native session that never reached `speak_verified` in our
own audit log (e.g. the user disconnected before Clio's voice connection was
confirmed) but Hume's own chat record shows a nonzero `duration_seconds` (e.g. the
Hume WebSocket connected and later closed even though our speak-verification check
never fired), when the session ends, then Hume's duration is still used as the
authoritative source (per Arun's explicit decision that Hume-native billing now
measures full connection lifetime, not speak-verified-to-disconnect) — this is *not*
treated as a zero-minute edge case the way it is in the existing
`computeBilledMinutes()` path. If Hume's fetch fails for this same session, fallback to
`computeBilledMinutes()` applies its own existing zero-minute rule unchanged (AC-D3
behavior, untouched).

✓ **AC-6 (ElevenLabs/Custom-LLM path — billing model unchanged, guard added)**: Given a
non-Hume-native session (`hume_native_enabled = false` or the ElevenLabs/Custom-LLM
provider), when the session ends via manual "End Session," then
`finalizeHumeNativeBilling()` returns `{ source: 'not_applicable' }` immediately (no
Hume API call attempted), `computeBilledMinutes()`'s existing `speak_verified` →
`disconnected` calculation is used exactly as today, and the new
`status === 'completed'` guard on the manual-end route still prevents a double
deduction if this path also races with a force-end.

✓ **AC-7 (missing `hume_chat_id`)**: Given a Hume-native session where
`hume_native_config_id`/`hume_chat_id` was never successfully provisioned (null), when
the session ends, then no Hume API call is attempted, `finalizeHumeNativeBilling()`
returns `{ source: 'fallback', reason: 'no_hume_chat_id' }` immediately, and
`computeBilledMinutes()` is used.

✓ **AC-8 (empty/never-started chat)**: Given a Hume-native session whose Hume chat was
created but the call never actually connected (Hume metadata shows `start_timestamp`
present, `end_timestamp` absent, `status: 'ACTIVE'` or similar non-terminal state) at
the moment of end/force-end, then this is treated as "duration data unavailable"
(Section 6.2) and falls back to `computeBilledMinutes()` — never computed as a negative
or nonsensical duration.

## 8. Error States

- **Hume API unreachable / DNS failure / non-2xx**: caught inside
  `fetchHumeChatDuration()`, returned as a typed failure result (not thrown) so
  `finalizeHumeNativeBilling()` can fall back without any `try/catch` at the caller
  level needing new logic beyond what already exists. Logged via `console.warn` with
  the specific HTTP status/error, never thrown up to break the end-session response to
  the user.
- **`HUME_API_KEY` missing/placeholder**: treated identically to a fetch failure — no
  call attempted, immediate fallback, logged once.
- **Malformed Hume response (valid JSON, missing expected fields)**: treated as
  "duration data unavailable," fallback taken, logged with the specific missing field.
- **Fallback itself somehow unavailable** (e.g. `computeBilledMinutes()` throws — not
  expected, no change to that function): this is pre-existing behavior, entirely
  unchanged by this spec; not a new error surface introduced here.
- **Race producing a `status === 'completed'` short-circuit**: this is not an error —
  it is the intended idempotent no-op response (`200` with `alreadyCompleted: true` /
  `skipped: true`), per AC-4.

## 9. Edge Cases

- Hume-native session with `hume_chat_id` present but pointing to a chat that belongs
  to a *different* session (should not be possible given current provisioning, but if
  it occurred, the returned duration would simply be whatever that chat_id's metadata
  says — no additional cross-check against `sessions.id` is added in this spec; out of
  scope, flagged for future hardening only if it is ever observed in production).
  Same non-added-cross-check philosophy already governs `session-details.ts` today.
- A Hume-native session that is force-ended twice in rapid succession by two different
  Inngest job invocations of the *same* job (not just watchdog-vs-timer, but the same
  job retried) — already covered by the existing `status === 'completed'` check inside
  `forceEndSession()`, unaffected by this change.
- Very short Hume-native sessions (<1 minute of actual connection time): `Math.ceil()`
  rounds up to 1 minute, consistent with the existing rounding convention in
  `computeBilledMinutes()`.
- `minutes_balance` lower than the Hume-sourced `minutesUsed`: the existing
  `Math.min(minutesUsed, userRow?.minutes_balance ?? minutesUsed)` capping logic in
  both `forceEndSession()` and the manual-end route applies identically to
  Hume-sourced minutes as it does to fallback minutes — no new capping logic needed,
  same variable, same cap.
- Mobile vs desktop: not applicable — no UI surface.
- Slow network / Hume API timeout: explicitly covered by the 5s timeout + fallback
  (Section 6.2, AC-3).

## 10. Out of Scope

- Any change to the ElevenLabs/Custom-LLM billing model. That path keeps its exact
  current `speak_verified` → `disconnected` calculation, unchanged, forever, per this
  spec. It only receives the `status === 'completed'` idempotency guard (already
  present via `forceEndSession()` for its force-end paths; newly added to the manual
  end route for both providers as one shared code change, since the guard itself is
  provider-agnostic).
- Any UI/screen changes. None are needed and none are made.
- Any change to `minutes_ledger` or `deduct_minutes` write mechanics — only the value
  computed and passed into the existing write calls changes.
- Any change to the already-shipped graceful-session-end nudge feature
  (`hume_wrapup_nudge_pending`, the Hume-native branch inside `session-timer.ts`) — its
  sleep timing, nudge-sending logic, and grace-period structure are untouched. This
  spec only touches what happens *after* that job reaches its existing
  `forceEndSession()` call.
- Any change to the already-approved, separately in-progress SESSION-DURATION-01 fix
  (`planned_duration_mins` column, migration `060`) — that column is written once at
  session-creation time by unrelated code paths and is never read or written by this
  spec's changes. `duration_mins` (the actual-billed-minutes column) continues to be
  written by this spec's changes exactly as it is today, just with a different
  upstream source for the number in the Hume-native case.
- Backfilling historical Hume-native sessions with Hume-sourced durations. This spec
  applies only to sessions ending after this ships — no retroactive recomputation.
- Any change to `hume-native-nightly-cleanup.ts` or its archive/transcript fetch
  behavior. It continues to fetch full transcript events for archival purposes,
  entirely independent of the new metadata-only duration fetch introduced here.
- Any change to `getHumeSessionDetails()` in `session-details.ts` itself — the new
  `fetchHumeChatDuration()` is a new, separate exported function added to that file,
  not a modification of the existing function's behavior or return shape.

## 11. Open Questions

None.

## 12. Dependencies

- `sessions.hume_native_enabled` and `sessions.hume_chat_id` columns must exist —
  already shipped via `056_hume_native_session_fields.sql`. No migration required for
  this spec.
- `minutes_ledger` table and its JSONB `metadata` column must exist — already shipped
  via `057_minutes_ledger.sql`. No migration required.
- `session_billing_audit_log` and the existing `writeAuditEvent()` /
  `computeBilledMinutes()` functions must continue to exist and behave exactly as
  today — this spec calls them as a fallback, unmodified.
- `HUME_API_KEY` environment variable (already required for all other Hume-native
  functionality; this spec adds no new env var).
- No dependency on SESSION-DURATION-01 or the graceful-session-end nudge feature —
  both are explicitly unrelated and untouched (Section 10).

---

## CEO Approval

**Status: APPROVED**
**Date: 2026-07-05**

Reviewed against the Feature Brief (HUME-DURATION-BILLING-01-feature-brief.md). All 5
open questions resolved concretely (exact endpoint, exact timeout policy, exact call
sites, exact metadata schema) — Section 11 is genuinely empty. Scope confirmed correct:
Hume-native only, ElevenLabs path unchanged except the shared idempotency guard.
Centralized design (`finalizeHumeNativeBilling()` called from `forceEndSession()` and
the manual-end route) means the three existing force-end callers need zero changes, as
required. Non-negotiable constraints (deduct_minutes/minutes_ledger mechanics, graceful
nudge, SESSION-DURATION-01) confirmed untouched. Fallback is safe and non-blocking;
billing is never silently skipped. Cleared to proceed to a developer agent.

— CEO Agent, on behalf of Arun
