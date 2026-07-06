# Hume as the Authoritative Data Source — `chat_ended` Fast-Path Billing + Evidence-Based Transcript Scope — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-06

---

## 1. Purpose

Last night's real test call exposed a concrete failure: Hume's own chat-duration record
(`GET /v0/evi/chats/{id}`) had not finalized `end_timestamp` yet when `finalizeHumeNativeBilling()`
polled for it in `lib/session-billing.ts`, so billing silently fell back to our own client-derived
audit-log math (`computeBilledMinutes()`). This is a timing guess, not a guarantee, and Arun's
direction following that incident was unambiguous: "the data from hume config is very important for
everything, in terms of transcripts, action item identification, glitch identification, if it does
not work then our whole solution is a failure."

This feature closes that gap by adding a Hume-native, push-based, real-time `chat_ended` webhook as a
**fast-path trigger** for billing finalization — removing the entire 3–7 second polling/guessing
window in `finalizeHumeNativeBilling()` for any session where the webhook arrives before our own
client-side detection completes. It also resolves, with direct evidence against Hume's live docs, a
previously open architectural question: **whether Hume's own transcript can ever replace Recall.ai's
transcript as the input to `session-quality-evaluator.ts`.** It cannot — Hume's transcript labels
speech as `USER` or `ASSISTANT` based on which side of the WebSocket sent it, not acoustic speaker
identification, so for any session with more than one human present, every human voice collapses into
a single `USER` role. Recall.ai's transcript, by contrast, already does real multi-speaker diarization
today. This is now a documented, evidence-based constraint on the system's architecture, not an
open question to revisit later.

This feature is additive to, and extends without contradicting, the prior `HUME-WEBHOOK-01` spec
(`docs/specs/HUME-WEBHOOK-01-requirement-doc.md`), which specified the webhook receiver endpoint,
signature verification, and audit-log write as a pure cross-check with no consumer wired to it. This
spec keeps every decision from that document and adds exactly one new piece of scope: **wiring the
already-planned `hume_webhook_chat_ended` audit row into `finalizeHumeNativeBilling()` as a fast-path
that skips polling when the row is already present.**

Failure to build this: billing keeps guessing with a 3–7 second polling window that can still lose
the race against Hume's own finalization (last night's exact failure mode), and Clio's own quality
evaluation and deferred-question detection remain undocumented on whether they could ever have used
a materially worse data source (a single-speaker-collapsed transcript) — a decision that must be
locked in explicitly, in writing, so it is never quietly attempted later without re-deriving this
evidence.

## 2. User Story

As Clio's billing system,
I want to use Hume's own authoritative `duration_seconds`, delivered unprompted in a signed
`chat_ended` webhook payload, the moment it is available for a given session,
So that billed minutes are correct on the first attempt, without a fixed guessing window, whenever
Hume's webhook arrives in time — and fall back to the existing, unchanged audit-log calculation
whenever it does not.

As Clio's on-call/support engineer investigating a disputed or unexplained session end,
I want Hume's own record of why a chat ended (`end_reason`) logged next to the client-side audit
trail, exactly as already specified in `HUME-WEBHOOK-01`,
So that I can tell a customer "Hume confirms this ended due to X" instead of "we think the client
disconnected."

As the engineer maintaining `session-quality-evaluator.ts`,
I want a definitive, evidence-backed answer on whether Hume's transcript could ever replace
Recall.ai's transcript as an input to quality/glitch evaluation,
So that no future changes attempt an unsafe substitution based on an assumption, and the current
"most-verbose-speaker = Clio" heuristic in Recall.ai's transcript is understood to remain the
correct (if imperfect) approach, with its own fix explicitly named as separate, future, out-of-scope
work.

There is no end-user-facing story for this feature. It produces no UI, changes no session behavior
visible to the executive using Clio, and does not alter what minutes are ultimately billed relative
to today's fallback path — it only changes *how fast and how often* the more-authoritative number
is used instead of the fallback.

## 3. Trigger / Entry Point

This feature has two independent trigger paths, both already partially specified by `HUME-WEBHOOK-01`
and extended here:

- **Webhook receipt (unchanged from `HUME-WEBHOOK-01`):** Hume's own servers POST to
  `POST /api/webhooks/hume` asynchronously, server-to-server, whenever a chat under the base
  production Config (or any of its per-session clones) starts or ends. Not triggered by any user
  action in our app. Auth/state: none from Clerk — HMAC signature verification against
  `HUME_WEBHOOK_SECRET` is the only gate, identical posture to `/api/webhooks/stripe` and
  `/api/webhooks/twilio`.
- **Billing finalization (extended by this spec):** `finalizeHumeNativeBilling()` in
  `lib/session-billing.ts` is called from two existing call sites — `forceEndSession()` (line 395)
  and `POST /api/sessions/[id]/end` (line 79 of `app/api/sessions/[id]/end/route.ts`) — both already
  unconditionally invoked whenever a session ends, for both Hume-native and non-Hume-native sessions
  (the function itself branches on `hume_native_enabled`). No new caller is introduced; the existing
  two call sites are unchanged in shape. What changes is the internal sequence `finalizeHumeNativeBilling()`
  executes before it ever calls `fetchHumeChatDuration()` — see Section 4 and Decision 1 below.

## 4. Screen / Flow Description

There is no user-visible screen or flow. This section documents the two server-side flows this
feature touches: the webhook receiver (unchanged from `HUME-WEBHOOK-01`, restated briefly for
completeness) and the restructured billing-finalization sequence (new in this spec).

### Flow A — Webhook receipt (unchanged from HUME-WEBHOOK-01; see that document's Section 4 for the
full state-by-state description). Summary for context:

1. Hume POSTs `chat_started` or `chat_ended` to `/api/webhooks/hume`.
2. Signature verified (`X-Hume-AI-Webhook-Signature` / `X-Hume-AI-Webhook-Timestamp`, HMAC-SHA256). Invalid → 400, body never parsed.
3. `chat_started` → 200, no DB write, no business logic (unchanged verdict).
4. `chat_ended` → resolve `chat_id` → `sessions.hume_chat_id` → `session_id`/`user_id`.
   - Match found: write one row to `session_billing_audit_log` via `writeAuditEvent()` with
     `eventType: 'hume_webhook_chat_ended'`, `metadata: { end_reason, duration_seconds, config_id, chat_id }`.
   - No match: log a warning, return 200, no write (not an error — see Edge Cases).

### Flow B — Billing finalization (`finalizeHumeNativeBilling()`, restructured)

This is the one concrete architectural decision this spec adds. Today (`lib/session-billing.ts`
lines 273–327), the function's sequence for a Hume-native session with a `hume_chat_id` is:
`delay(3000)` → `fetchHumeChatDuration()` → if `missing_timestamps`, `delay(4000)` → retry once →
fall back if still failing.

**New sequence, restructured in-place inside the existing `finalizeHumeNativeBilling()` function
(no new exported function, no new call sites — see Decision 1 for why):**

1. Entry checks unchanged: if `!humeNativeEnabled` → `{ source: 'not_applicable' }`. If no
   `humeChatId` → `{ source: 'fallback', reason: 'no_hume_chat_id' }`. Both exactly as today.
2. **New first step, before any `delay()` or `fetchHumeChatDuration()` call:** query
   `session_billing_audit_log` for the most recent row matching
   `session_id = sessionId AND event_type = 'hume_webhook_chat_ended'`, ordered by `occurred_at`
   descending, limit 1 (reuses the same `getAuditLog()`-style query pattern already used elsewhere in
   this file — a direct Supabase `select` filtered and ordered, not a new abstraction).
   - **If found:** read `metadata.duration_seconds` from that row. Skip `delay()` entirely — no 3s
     or 7s wait. Compute `minutesUsed = Math.max(0, Math.ceil(duration_seconds / 60))` and return
     `{ source: 'hume', minutesUsed, durationSeconds: duration_seconds, retryUsed: false,
     totalWaitMs: 0 }`. The result's shape is unchanged (`FinalizeHumeNativeBillingResult`'s `'hume'`
     variant), so both existing callers (`forceEndSession`, `/api/sessions/[id]/end`) require zero
     code changes — they already only branch on `humeResult.source === 'hume'` vs. everything else.
   - **If not found:** fall through to the existing sequence unchanged — `delay(3000)` →
     `fetchHumeChatDuration()` → conditional retry → fallback. This is the common case today (webhook
     latency is undocumented and the webhook may simply not have arrived yet), and it is byte-for-byte
     identical to current behavior.
3. If the audit-log check itself fails (Supabase error), treat this the same as "not found" — log the
   error via `console.error` and fall through to the existing polling sequence. The webhook check must
   never itself become a new failure mode that blocks billing (see Error States).

No polling, no new async wait, no UI state for the new branch — a single additional Supabase read
inserted before the function's existing `delay()` call.

## 5. Visual Examples

Not applicable — this is a backend-only feature. No UI, screen, wireframe, or user-visible state is
produced by either the webhook receiver (Flow A) or the billing-finalization change (Flow B). This is
consistent with `HUME-WEBHOOK-01`'s own Section 5, which this spec does not alter.

## 6. Data Requirements

**Read (new, in `finalizeHumeNativeBilling()`):**
- `session_billing_audit_log` — `SELECT metadata, occurred_at FROM session_billing_audit_log WHERE
  session_id = $1 AND event_type = 'hume_webhook_chat_ended' ORDER BY occurred_at DESC LIMIT 1`. Uses
  the existing `idx_session_billing_audit_session_time` index (`session_id, occurred_at ASC` —
  usable for this query since Postgres can scan a B-tree index in either direction; no new index
  required).

**Read (unchanged from HUME-WEBHOOK-01):**
- `sessions` — `SELECT id, user_id FROM sessions WHERE hume_chat_id = $1` (webhook's own
  `chat_id` → `session_id` resolution, migration `056_hume_native_session_fields.sql`, already
  indexed via `idx_sessions_hume_chat_id`).

**Written (unchanged from HUME-WEBHOOK-01):**
- `session_billing_audit_log` — one row per received `chat_ended` event with a matching session,
  via `writeAuditEvent()`, `event_type = 'hume_webhook_chat_ended'`, `metadata: { end_reason,
  duration_seconds, config_id, chat_id }`.
- No `sessions` row is updated by the webhook handler itself — `forceEndSession()` /
  `/api/sessions/[id]/end` remain the sole writers of `sessions.status`, `ended_at`, `duration_mins`.

**Written (unchanged, downstream consumer):** `finalizeHumeNativeBilling()`'s new fast-path branch
writes nothing new itself — it only changes which data it reads before returning a result in the same
shape its two existing callers already consume. Those callers' own writes (`sessions` update,
`deduct_minutes` RPC, `minutes_ledger` insert via `writeMinutesLedgerEvent()`) are entirely unchanged.

**Schema/type change required (code, confirmed by direct inspection — not a build-time unknown):**

`session_billing_audit_log.event_type` is confirmed, by reading migration
`051_session_billing_audit_log.sql` (lines 16–24) directly, to be a plain `TEXT` column with an
app-level `CHECK` constraint (`CHECK (event_type IN ('bot_joined', 'voice_connect_attempt',
'speak_verified', 'gap_start', 'gap_end', 'disconnected'))`) — **not** a Postgres-level `ENUM` type.
This resolves definitively, by inspection, what the prior `HUME-WEBHOOK-01` spec correctly flagged as
needing verification before shipping. Because it is a `CHECK` constraint, a new migration is required
before any `hume_webhook_chat_ended` row can be inserted:

```sql
-- Migration: 0NN_hume_webhook_chat_ended_event_type.sql
ALTER TABLE session_billing_audit_log DROP CONSTRAINT session_billing_audit_log_event_type_check;
ALTER TABLE session_billing_audit_log ADD CONSTRAINT session_billing_audit_log_event_type_check
  CHECK (event_type IN (
    'bot_joined',
    'voice_connect_attempt',
    'speak_verified',
    'gap_start',
    'gap_end',
    'disconnected',
    'hume_webhook_chat_ended'
  ));
```

(Exact constraint name must be confirmed against the live schema via `\d session_billing_audit_log`
or the Supabase dashboard before writing this migration — Postgres auto-generates constraint names
following the `{table}_{column}_check` convention used above when none is explicitly named in the
`CREATE TABLE` statement, which is the case in `051_session_billing_audit_log.sql`; the developer
must verify this name matches before shipping the `DROP CONSTRAINT` line, since a mismatched name
fails the migration outright with a clear Postgres error rather than silently doing nothing.)

`BillingAuditEventType` in `lib/session-billing.ts` (line 81, currently `'bot_joined' |
'voice_connect_attempt' | 'speak_verified' | 'gap_start' | 'gap_end' | 'disconnected'`) must be
extended to include `'hume_webhook_chat_ended'` — a one-line type change, matching the migration
above.

**APIs called:** none new. `finalizeHumeNativeBilling()`'s new fast-path branch makes zero outbound
calls (it reads from Supabase only) — this is strictly less network activity than today's path,
which always calls `fetchHumeChatDuration()` (an outbound Hume API call) after its `delay()`.

**Environment variables:** `HUME_WEBHOOK_SECRET` — unchanged from `HUME_WEBHOOK_SECRET`'s existing
specification in `HUME-WEBHOOK-01` Section 6 (placeholder value `PLACEHOLDER_HUME_WEBHOOK_SECRET` in
`.env.local.example`, real value from Hume's dashboard in production). No new env var is introduced
by this spec.

**localStorage / sessionStorage:** none. Pure server-side.

## 7. Success Criteria (Acceptance Tests)

✓ Given a Hume-native session whose `session_billing_audit_log` already contains a
`hume_webhook_chat_ended` row (webhook arrived before the session's own end-of-call flow ran), when
`finalizeHumeNativeBilling()` is called for that session, then it returns
`{ source: 'hume', minutesUsed: Math.ceil(webhookDurationSeconds / 60), durationSeconds:
webhookDurationSeconds, retryUsed: false, totalWaitMs: 0 }` without calling `delay()` or
`fetchHumeChatDuration()` at all, and without any outbound HTTP request to Hume's API.

✓ Given a Hume-native session whose `session_billing_audit_log` does NOT contain a
`hume_webhook_chat_ended` row (webhook has not arrived, or never will), when
`finalizeHumeNativeBilling()` is called for that session, then it falls through to the exact existing
sequence unchanged — `delay(3000)` → `fetchHumeChatDuration()` → conditional retry on
`missing_timestamps` → fallback — producing byte-for-byte identical behavior and return values to the
pre-this-feature implementation.

✓ Given a Hume-native session with BOTH a `hume_webhook_chat_ended` row present in the audit log AND
Hume's `GET /v0/evi/chats/{id}` metadata endpoint independently confirming the chat has ended, when
`finalizeHumeNativeBilling()` is called, then the webhook's `duration_seconds` value is used (fast
path always wins over polling when both are available) and no call to `fetchHumeChatDuration()` is
made — the fast path is checked first and short-circuits, per Section 4 item 2.

✓ Given a non-Hume-native session (ElevenLabs/Custom-LLM), when `finalizeHumeNativeBilling()` is
called, then it returns `{ source: 'not_applicable' }` immediately — the new audit-log check for
`hume_webhook_chat_ended` is never executed, since the `!humeNativeEnabled` branch returns before
reaching it, exactly as today.

✓ Given the new Supabase query for a `hume_webhook_chat_ended` row itself fails (network error,
transient DB error), when `finalizeHumeNativeBilling()` is called, then the error is logged via
`console.error` and execution falls through to the existing `delay()` → `fetchHumeChatDuration()`
sequence — the function never throws, never returns early with an error, and never skips billing
because of this new read failing.

✓ Given a valid HMAC-signed `chat_ended` payload whose `chat_id` matches a `sessions` row's
`hume_chat_id`, when POSTed to `/api/webhooks/hume`, then a new row is written to
`session_billing_audit_log` with `event_type = 'hume_webhook_chat_ended'` and the endpoint returns
HTTP 200 — unchanged acceptance test from `HUME-WEBHOOK-01` Section 7, restated because it is the
direct precondition for every acceptance test above.

✓ Given the `session_billing_audit_log.event_type` CHECK constraint has NOT yet been migrated to
permit `hume_webhook_chat_ended` (migration not yet applied), when the webhook handler attempts to
write a `hume_webhook_chat_ended` row, then the insert fails with a Postgres CHECK-violation error,
`writeAuditEvent()`'s existing non-fatal error handling logs it via `console.error` and continues
(per its own established convention — see Error States), and the webhook endpoint still returns
HTTP 200 to Hume (a missing audit row must never cause Hume to retry). This acceptance test exists
specifically to confirm the migration is a hard prerequisite for the fast path ever activating, not
merely a nice-to-have — without it, every `finalizeHumeNativeBilling()` call silently behaves exactly
as it does today (falls through to polling), which is a safe, non-broken degraded state, not a
failure.

✓ Given a session that reaches `disconnected` via the client-side flow (`forceEndSession()` or
`/api/sessions/[id]/end`) strictly before Hume's `chat_ended` webhook has been received for that
session's `chat_id`, when `finalizeHumeNativeBilling()` runs as part of that end-of-call flow, then it
finds no `hume_webhook_chat_ended` row (none exists yet), falls through to the existing polling
sequence, and behaves exactly as it does today — the feature never blocks or delays billing waiting
for a webhook that has not arrived, per the "never blocking" principle in Decision 1.

## 8. Error States

- **Webhook signature invalid/missing:** unchanged from `HUME-WEBHOOK-01` — HTTP 400, generic JSON
  error body, no payload processing, no secret ever echoed in response or log.
- **Webhook body malformed:** unchanged — HTTP 400, parse failure logged (message only) via
  `console.error`.
- **Webhook `chat_id` has no matching `sessions` row:** unchanged — logged at `console.warn`, no
  write, HTTP 200 returned (not an error — see Edge Cases).
- **Webhook Supabase insert failure:** unchanged — `writeAuditEvent()`'s existing non-fatal
  convention (log via `console.error`, continue, never a 5xx back to Hume).
- **New: audit-log read failure inside `finalizeHumeNativeBilling()`'s fast-path check:** log via
  `console.error` with the session id and error message (no secrets), then fall through to the
  existing `delay()` → `fetchHumeChatDuration()` sequence exactly as if no webhook row existed. This
  must never throw, never abort billing, and never surface as an error to either calling route
  (`forceEndSession()` or `/api/sessions/[id]/end`) — both of those callers already handle
  `finalizeHumeNativeBilling()` returning a `'fallback'`-shaped result gracefully.
- **New: CHECK constraint migration not yet applied when a `chat_ended` webhook arrives:** the
  webhook's `writeAuditEvent()` insert fails with a Postgres constraint-violation error. This is
  caught by `writeAuditEvent()`'s existing generic error handling (logs `error.message` via
  `console.error`, does not throw) — the webhook endpoint still returns HTTP 200. Net effect: the
  fast path in `finalizeHumeNativeBilling()` simply never finds a row to fast-path on, and every
  session behaves exactly as it does today until the migration is applied. This is a degraded-but-safe
  state, not a broken one (see the corresponding acceptance test above).
- **Webhook `duration_seconds` missing or non-numeric in the stored `metadata`** (malformed payload
  that somehow passed signature verification — should not occur given Hume's documented payload
  shape, but defensively handled): the fast-path check in `finalizeHumeNativeBilling()` must validate
  `typeof metadata.duration_seconds === 'number'` before using it. If invalid, treat this identically
  to "no row found" — log a `console.warn` noting the malformed metadata for that session, and fall
  through to the existing polling sequence. Never pass `NaN` or `undefined` into the
  `Math.ceil(duration_seconds / 60)` calculation.
- **Slow network / loading state:** not applicable to either flow — both are synchronous
  request/response (webhook) or synchronous internal function calls (billing finalization) with no
  client-facing UI waiting.

## 9. Edge Cases

- **Webhook arrives, but after `finalizeHumeNativeBilling()` has already run and returned a fallback
  result for that session:** this is expected and does not need reconciliation. The webhook's
  `hume_webhook_chat_ended` audit row is still written (Flow A is independent of Flow B's timing), it
  is simply never read by a `finalizeHumeNativeBilling()` call that already completed. The session's
  billed minutes remain whatever `computeBilledMinutes()` (the fallback) already produced — this
  feature does not retroactively re-bill a session once `forceEndSession()` / `/end` has already
  finalized it. This is an intentional, accepted limitation: the fast path only helps when the webhook
  wins the race against the client-side end-of-call flow, which is expected to be the common case
  specifically for the "client process died" scenario this whole feature line was motivated by (the
  client-side flow may never run at all in that case, or may run much later via the 30s watchdog),
  and is not expected to reliably win the race for a normal, clean session end where the client's own
  `disconnected` write happens near-instantly.
- **Webhook never arrives for a given session** (Hume-side delivery failure/outage — no published
  SLA): `finalizeHumeNativeBilling()` always falls through to the existing polling sequence,
  unaffected. This is the single most important edge case motivating Decision 1 (webhook as
  fast-path, never sole trigger) — see Section 4.
- **Duplicate `chat_ended` webhook delivery for the same session:** results in two
  `hume_webhook_chat_ended` rows with identical metadata (unchanged from `HUME-WEBHOOK-01` Section
  9). The new fast-path query in `finalizeHumeNativeBilling()` orders by `occurred_at DESC LIMIT 1`,
  so it simply reads whichever row is most recent — since both rows carry the same
  `duration_seconds` value from the same underlying Hume chat, this has no effect on the computed
  minutes.
- **A session has a `hume_webhook_chat_ended` row from a PRIOR connect/disconnect cycle** (the same
  `sessions` row reused across multiple voice drop/reconnect cycles, the exact scenario the
  2026-07-05 bugfix comment in `computeBilledMinutes()` — lines 168–187 — already handles for
  `speak_verified`/`disconnected` pairs): the new fast-path query filters only on
  `session_id = sessionId AND event_type = 'hume_webhook_chat_ended'`, with no cycle-scoping. This is
  a real gap and must be resolved: **the fast-path query must additionally filter `occurred_at` to be
  after the most recent prior-cycle `disconnected` row**, using the same `priorCycleEndAt` derivation
  already implemented in `computeBilledMinutes()` (lines 188–192) — a webhook row from an earlier,
  already-billed cycle must never be used to fast-path the current cycle's billing. Concretely: before
  querying for `hume_webhook_chat_ended`, run the same "find the second-to-last `disconnected` row"
  logic already present in `computeBilledMinutes()`, and add `AND occurred_at > priorCycleEndAt` to
  the fast-path query when a prior cycle exists. This is not a new design decision — it is directly
  reusing an existing, already-tested pattern in the same file for the same class of problem (stale
  rows from a reused session id), so no new architectural judgment call is introduced by this edge
  case, only a direct application of existing logic to a new query.
- **Base Config `webhooks` field not yet provisioned, or a session's Config clone predates the base
  Config update:** unchanged from `HUME-WEBHOOK-01` — that session simply never produces a
  `hume_webhook_chat_ended` row, and `finalizeHumeNativeBilling()`'s fast-path check finds nothing,
  falling through to the existing polling path with zero behavior change.
- **Mobile vs. desktop:** not applicable — no UI, no client-facing surface for either flow.
- **A Hume-native session where `humeNativeEnabled`/`humeChatId` are passed explicitly as function
  parameters (as `/api/sessions/[id]/end/route.ts` does, lines 79–83) vs. looked up internally (as
  `forceEndSession()` does, by omitting them):** no behavior difference — the new fast-path check runs
  identically regardless of which code path supplied `humeNativeEnabled`/`humeChatId`, since it only
  depends on `sessionId`, which both callers always provide.

## 10. Out of Scope

Explicitly excluded from this feature:

- **Fixing `session-quality-evaluator.ts`'s "most-verbose-speaker = Clio" heuristic**
  (`speakerWordCount`-based sort at lines 640–649, which assumes whichever speaker talks most in the
  Recall.ai transcript is Clio). This is a real, separate, smaller bug — explicitly named here as a
  future, standalone follow-up item, not bundled into this webhook/billing spec. Nothing in this
  feature touches, reads from, or depends on that heuristic; it continues operating exactly as it
  does today. (Per the CEO brief's explicit instruction, Decision 2, and Questions-for-BA item 5.)
- **Any change to which transcript `session-quality-evaluator.ts` sources from.** It continues to
  source exclusively from Recall.ai's transcript for all analysis that depends on knowing what a
  specific human said (checkpoint-response classification via `classifyResponse()`, the 6 quality
  criteria in `evaluateQualityCriteria()`, deferred-question detection via
  `detectDeferredQuestions()` / `detectHumeNativeDeferredQuestions()`). Hume's own transcript is never
  wired into this file as an input, per the evidence in Section 1/Purpose — it structurally cannot
  distinguish multiple human speakers, so substituting it would silently degrade every one of these
  analyses for any session with more than one human participant.
- **Using Hume's transcript as a cross-check/correction source for the "who is Clio" heuristic.** The
  CEO brief names this as Hume's one piece of unique transcript value (an unambiguous `ASSISTANT`-role
  record of exactly what Clio said), but explicitly scopes it as a smaller, separate future fix, not
  built here.
- **Any billing-ledger cross-check or reconciliation logic comparing Hume's `duration_seconds`
  against `computeBilledMinutes()`'s output.** Per `HUME-WEBHOOK-01`'s already-established Out of
  Scope (still holds): `computeBilledMinutes()` is not modified by this feature at all — it remains
  the unchanged fallback path. The only use of Hume's `duration_seconds` is as a *replacement* source
  when the fast path activates, never as a *comparison* against the fallback's own math. A future
  "sanity-check ceiling" comparison remains a named, separate future candidate.
- **Any change to the nightly archive job's (`inngest/hume-native-nightly-cleanup.ts`) trigger
  condition or timing.** Unchanged from `HUME-WEBHOOK-01`'s Out of Scope — that job's eligibility
  window remains keyed off `sessions.ended_at`, with no race or coupling introduced by this feature.
- **Any change to `hume-adapter.ts`'s client-side disconnect/reconnect classification, or the 30-second
  gap watchdog (`inngest/voice-gap-watchdog.ts`).** Both remain fully in place, unmodified, as
  permanent backstops — per Decision 1, this feature is additive only and never removes or weakens any
  existing detection layer.
- **`tool_call` webhook events.** Unchanged from `HUME-WEBHOOK-01` — not subscribed, not built;
  `hume-adapter.ts` already handles `tool_call` live over the WebSocket.
- **Any new UI, dashboard, or support/debug view surfacing `end_reason` or webhook-sourced billing
  data.** Named as a future candidate follow-up in `HUME-WEBHOOK-01`, unchanged here.
- **Alerting/monitoring on `end_reason: ERROR` volume, or on fast-path activation rate.** No alerting
  hook is added. A future metrics/dashboard follow-up could track "% of sessions billed via the
  webhook fast path vs. the polling fallback" as a health signal, but this is not built now.
- **Retroactively re-billing a session whose webhook arrived after `finalizeHumeNativeBilling()` had
  already completed for that session** (see Edge Cases). No reconciliation job is built for this.

## 11. Open Questions

None.

Every item that could have been an open question is resolved below, either by direct evidence already
established in the CEO brief's investigation, by direct inspection of the current codebase, or by a
clearly stated build-time technical verification step (not a product ambiguity) — following the same
resolution pattern used throughout the prior `HUME-WEBHOOK-01` spec.

- **Does Hume's transcript replace Recall.ai's transcript?** Resolved with direct evidence, not a
  judgment call: confirmed against `dev.hume.ai/docs/speech-to-speech-evi/features/chat-history` that
  Hume's `USER`/`ASSISTANT` labeling is WebSocket-side-based, not acoustic diarization. Since
  Recall.ai's bot bridges all room audio into Hume as a single input stream, Hume cannot distinguish
  between multiple human speakers in a room. Answer: no, never, for any multi-human session — see
  Section 10.
- **Does `finalizeHumeNativeBilling()` get a new exported function, or is it restructured in place to
  check for a webhook row before polling?** Resolved: restructured in place (Section 4, Decision 1).
  Justification against the actual current code: both existing call sites
  (`forceEndSession()` line 395, `/api/sessions/[id]/end` line 79) already call
  `finalizeHumeNativeBilling()` unconditionally and already branch only on the returned
  `FinalizeHumeNativeBillingResult.source` field. A new fast-path branch inside the same function that
  returns the same `{ source: 'hume', ... }` shape requires zero changes to either caller — they
  already handle a `'hume'`-sourced result correctly today (it's the exact same shape the polling path
  already returns on success). Introducing a second exported function would require both callers to
  learn a new call sequence (check webhook row → call new function if absent → call
  old function) for no benefit, since the whole point is that this check must happen automatically,
  every time, with no caller opting in or out.
- **What is the exact HMAC signed-string format Hume uses?** The brief's own investigation confirms
  the header shape (`X-Hume-AI-Webhook-Signature` HMAC-SHA256, `X-Hume-AI-Webhook-Timestamp`) but not
  the literal concatenation format for the signed string. This spec's answer, matching the standard
  most webhook providers (including Stripe) use and the most likely format given the two-header
  shape: **`signedString = timestamp + '.' + rawBody`**, HMAC-SHA256 keyed on `HUME_WEBHOOK_SECRET`,
  compared against the signature header using `crypto.timingSafeEqual` (mirroring the existing
  pattern already used for `verifyAuditToken()` in this same file, `lib/session-billing.ts` lines
  62–69). This is stated here as the spec's concrete answer so the developer has a definite starting
  point, but it is explicitly flagged as the **one item requiring live verification against a real
  Hume test webhook delivery during build** — before shipping, the developer must send one real test
  event from Hume's dashboard (or trigger one live) and confirm the computed signature matches what
  Hume sends, adjusting the concatenation format if it does not (e.g. if Hume omits the `.` separator,
  or signs a JSON-stringified object containing both fields instead of a plain concatenation). This is
  a technical build-time verification step with a fully specified fallback investigation path (read
  the raw failing signature comparison, try the two or three most common alternate formats), not an
  unresolved product question — directly following the same reasoning pattern the prior spec used for
  the `webhooks` field GET/POST round-trip verification (that spec's Section 11, second-to-last
  bullet).
- **Is `session_billing_audit_log.event_type` `TEXT`/CHECK or a DB-level `ENUM`?** Resolved
  definitively, not deferred to build-time, by directly reading migration
  `051_session_billing_audit_log.sql` (lines 16–24) in this task: it is `TEXT` with an app-level
  `CHECK` constraint. A migration adding `hume_webhook_chat_ended` to that `CHECK` constraint is
  required (exact SQL provided in Section 6). The only remaining build-time detail is confirming the
  Postgres-auto-generated constraint name (`session_billing_audit_log_event_type_check`, following
  the standard unnamed-constraint convention) against the live schema before running the `DROP
  CONSTRAINT` — a trivial, low-risk verification (a `\d session_billing_audit_log` or a Supabase
  dashboard check), not a product ambiguity.
- **Should the fast-path check be scoped to the current billing cycle, given a session id can be
  reused across multiple connect/disconnect cycles?** Resolved by direct application of existing code
  in the same file: yes, using the identical `priorCycleEndAt` derivation already implemented and
  tested in `computeBilledMinutes()` (lines 188–192). See Section 9, third bullet, for the exact
  mechanism. This is not a new design decision — it is reusing an already-proven pattern for
  structurally the same problem (stale rows from a reused session id).

## 12. Dependencies

- **Migration required before the fast path can ever activate:** the `session_billing_audit_log`
  `CHECK` constraint update (Section 6) must be applied before any `hume_webhook_chat_ended` row can
  be inserted. Until applied, the webhook's insert fails (logged, non-fatal, HTTP 200 still returned
  to Hume per existing convention), and `finalizeHumeNativeBilling()` simply never finds a row to
  fast-path on — every session continues to use the existing polling/fallback sequence exactly as it
  does today. This is not a blocking dependency for building and merging the code (the code degrades
  safely without it), only for the fast path to ever actually engage.
- **`HUME-WEBHOOK-01`'s own dependencies remain in force, unchanged:** `HUME_WEBHOOK_SECRET` must be
  provisioned (placeholder in `.env.local.example`, real value in Vercel production); the base Hume
  Config's `webhooks` field must be updated to subscribe `chat_started` + `chat_ended` pointing at
  `https://distill-peach.vercel.app/api/webhooks/hume`; the webhook endpoint
  (`app/api/webhooks/hume/route.ts`) must be deployed before the base Config update, per that spec's
  recommended ordering (Section 12). None of this is re-specified here — this feature depends on
  `HUME-WEBHOOK-01` shipping first or simultaneously, since the fast path in
  `finalizeHumeNativeBilling()` has nothing to read until webhook rows exist.
- **`BillingAuditEventType` type extension** (`lib/session-billing.ts` line 81) must land in the same
  change as the migration — a one-line addition, no separate rollout ordering concern since both are
  code, not infra.
- **HMAC signed-string format verification against a real Hume webhook delivery** (Section 11) must
  happen during build, before the webhook receiver is trusted with production traffic. This blocks
  `HUME-WEBHOOK-01`'s own endpoint from accepting real signed traffic correctly, which transitively
  blocks this feature's fast path from ever having real data to read — but does not block writing or
  merging either feature's code.
- **CEO must confirm before merge:** none. Every decision in this spec is either a technical
  implementation detail resolved by direct code inspection (Section 6, Section 11) or a technical
  verification step with a fully specified fallback (the HMAC format, Section 11) — there is no
  product/UX decision in this spec requiring Arun's or the CEO agent's sign-off beyond the standard
  CEO review of this document itself, per the governance model's approval gate.
- **Requires `sessions.hume_chat_id` to already be populated** before a `chat_ended` webhook can
  resolve to a match — unchanged precondition from `HUME-WEBHOOK-01`, already true today for any
  session running in Hume-native mode.
