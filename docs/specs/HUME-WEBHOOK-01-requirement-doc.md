# Hume EVI `chat_ended` Server-Side Corroboration — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-05

---

## 1. Purpose

Today, every signal we have about when and why a voice session ended is either client-side
(`hume-adapter.ts` detecting a WebSocket close) or inferred (the 30-second gap watchdog in
`inngest/voice-gap-watchdog.ts` timing out silently). Both depend on the Recall.ai bot's headless
browser staying alive long enough to notice and report its own disconnection. If that browser
process dies outright — not a clean WebSocket close, a full crash — nothing client-side ever fires,
and our only record is the watchdog's 30-second silence-based inference, which tells us a session
went quiet but never tells us *why*, from Hume's own point of view.

Hume EVI supports a Config-level `webhooks` field that, when subscribed to `chat_ended`, delivers a
signed, server-to-server notification the moment Hume itself considers a chat over — independent of
whether our client survived to report it. This feature adds that channel as a **cross-check, not a
replacement**: it writes Hume's authoritative `end_reason` (clean end, timeout, silence, error, etc.)
into our existing billing audit trail alongside — never instead of — the client-side `disconnected`
event.

Failure to build this: we continue to have zero visibility into the true cause of a session ending
in the rare case where the reporting client itself is the thing that failed. Support cannot
distinguish "the call just died" from "Hume timed out the user for inactivity" in that scenario.

## 2. User Story

As Clio's on-call/support engineer investigating a disputed or unexplained session end,
I want Hume's own record of why a chat ended (`end_reason`) logged next to our client-side audit
trail,
So that I can tell a customer or debug a report with "Hume confirms this ended due to X" instead of
"we think the client disconnected."

There is no end-user-facing story for this feature — it produces no UI, changes no session behavior,
and is invisible to the executive using Clio. It is purely a backend observability addition.

## 3. Trigger / Entry Point

- **Provisioning side (one-time, not per-request):** the `webhooks` field is added to the **base**
  production Hume Config (`4e0c7e15-bb03-40b2-aded-21813f19fc8d`). Because every per-session clone
  created by `provisionNativeConfig()` in `lib/voice/hume-native/config-provisioner.ts` inherits
  `webhooks` from the base config via the existing spread (`...inheritedFields`, see file lines
  88–92, 199–201), no code change is required in the provisioner for this field to propagate to
  every future clone automatically.
- **Runtime trigger (the new endpoint):** Hume's own servers call our new endpoint via an HTTP POST,
  asynchronously, whenever a chat under the base config (or any of its clones) starts or ends. This
  is not triggered by any user action, button click, or page load in our app — it is Hume-initiated,
  server-to-server.
- **Route:** `POST /api/webhooks/hume`
- **Auth/state required:** none from our own auth system (no Clerk session — this is a machine-to-
  machine webhook, same posture as `/api/webhooks/stripe` and `/api/webhooks/twilio`). The only gate
  is HMAC signature verification against `HUME_WEBHOOK_SECRET`.

## 4. Screen / Flow Description

There is no user-visible screen or flow. This section documents the server-side request/response
flow instead, step by step.

**State 1 — Hume sends `chat_started`:**
1. Hume POSTs a `chat_started` event to `/api/webhooks/hume`.
2. Endpoint verifies the HMAC signature. If valid, the event is accepted and a 200 is returned. No
   database write occurs and no business logic runs (per the CEO brief's explicit verdict: no new
   logic should hang off `chat_started`). This is subscribed only because Hume's webhook
   configuration is a single events array on one subscription — `chat_started` cannot be excluded
   independently of `chat_ended` without giving up `chat_ended` too.
3. If signature verification fails, endpoint returns 400 and logs the failure (no payload processed).

**State 2 — Hume sends `chat_ended`:**
1. Hume POSTs a `chat_ended` event to `/api/webhooks/hume` with `chat_id`, `config_id`,
   `duration_seconds`, `end_reason`.
2. Endpoint verifies the HMAC signature (`X-Hume-AI-Webhook-Signature` / `X-Hume-AI-Webhook-
   Timestamp`). If invalid, return 400 immediately — the payload is never parsed or processed past
   signature verification.
3. On valid signature, parse the JSON body and extract `chat_id`, `config_id`, `duration_seconds`,
   `end_reason`.
4. Look up `sessions` where `hume_chat_id = chat_id`. Two outcomes:
   - **Match found:** write a new audit log row via `writeAuditEvent()` with `eventType:
     'hume_webhook_chat_ended'`, `sessionId` = the matched session's id, `userId` = the matched
     session's `user_id`, and `metadata: { end_reason, duration_seconds, config_id, chat_id }`.
   - **No match found** (stale config, test call made directly against the Hume dashboard, a chat
     under a config not tied to any session row): log a single line noting the unmatched `chat_id`
     and `end_reason` at `console.warn` level, and return 200 without writing to the audit log. This
     is not an error state — Hume will not retry a webhook we accept with 200, and an unmatched chat
     is an expected, non-actionable occurrence (see Section 9, Edge Cases).
5. Return `{ received: true }` with HTTP 200 in all cases where signature verification passed
   (matched or unmatched — both are "processed successfully" from Hume's perspective; only signature
   failure returns non-200, matching the Stripe/Twilio convention of never returning 5xx for handled
   application-level conditions).

No polling, no retry loop, no UI state — this is a single request/response webhook handler.

## 5. Visual Examples

Not applicable — no UI is produced by this feature. Per Section 4, this is a server-to-server
endpoint with no rendered screen. The "flow" is the request/response sequence documented above.

## 6. Data Requirements

**Read:**
- `sessions` table — `SELECT id, user_id FROM sessions WHERE hume_chat_id = $1` (existing column,
  added in migration `056_hume_native_session_fields.sql`, already indexed —
  `idx_sessions_hume_chat_id`).

**Written:**
- `session_billing_audit_log` — one new row per received `chat_ended` event where a matching session
  is found, via the existing `writeAuditEvent()` function in `lib/session-billing.ts`. Columns
  populated: `session_id`, `user_id`, `event_type` (new value: `hume_webhook_chat_ended`),
  `voice_provider` (`'hume'`), `metadata` (JSON: `{ end_reason, duration_seconds, config_id,
  chat_id }`), `occurred_at` (server timestamp at receipt — Hume's payload does not include its own
  end timestamp separately from `duration_seconds`, so receipt time is used, consistent with how
  every other audit row in this table is timestamped at write time unless explicitly overridden).
- No other table is written. No `sessions` row is updated by this endpoint — the existing
  `forceEndSession` / `/api/sessions/[id]/end` flow remains the sole path that sets
  `sessions.status`, `sessions.ended_at`, and `sessions.duration_mins`. This webhook never mutates
  session state, only appends an audit log row.

**Type change required (code, not schema):** `BillingAuditEventType` in `lib/session-billing.ts`
(currently `'bot_joined' | 'voice_connect_attempt' | 'speak_verified' | 'gap_start' | 'gap_end' |
'disconnected'`) must be extended to include `'hume_webhook_chat_ended'`. No migration needed —
`event_type` is stored as-is in the existing `session_billing_audit_log.event_type` column (verify
its underlying SQL type is `TEXT`, not a Postgres `ENUM`, before shipping — if it is a DB-level enum
type rather than a `CHECK` constraint or plain text column, a migration to add the new enum value
is required; if it is `TEXT` with an app-level `CHECK` constraint listing allowed values, that
`CHECK` constraint must be updated in a new migration to permit `hume_webhook_chat_ended`. This is
the one item a developer must confirm against the live schema before writing the insert — see
Section 12, Dependencies).

**APIs called:** none. This feature is a receiver only — it makes no outbound calls to Hume or any
other vendor.

**Environment variables (new):**
- `HUME_WEBHOOK_SECRET` — new env var, a **different** secret than `HUME_API_KEY` (per Hume's
  documented webhook signing scheme: the webhook signing secret is issued separately from the REST
  API key and is used only to compute/verify the HMAC-SHA256 signature on inbound webhook payloads,
  the same way `STRIPE_WEBHOOK_SECRET` is distinct from `STRIPE_SECRET_KEY`). Must be added to
  `.env.local.example` with a placeholder value `PLACEHOLDER_HUME_WEBHOOK_SECRET`, grouped near the
  existing Hume-related env vars.

**localStorage / sessionStorage:** none. This is a pure server-side endpoint.

## 7. Success Criteria (Acceptance Tests)

✓ Given a valid HMAC-signed `chat_ended` payload whose `chat_id` matches a `sessions` row's
`hume_chat_id`, when POSTed to `/api/webhooks/hume`, then a new row is written to
`session_billing_audit_log` with `event_type = 'hume_webhook_chat_ended'`, `session_id` and
`user_id` matching the resolved session, and `metadata.end_reason` equal to the payload's
`end_reason`, and the endpoint returns HTTP 200.

✓ Given a valid HMAC-signed `chat_ended` payload whose `chat_id` does NOT match any `sessions` row,
when POSTed to `/api/webhooks/hume`, then no row is written to `session_billing_audit_log`, a
warning is logged referencing the unmatched `chat_id`, and the endpoint returns HTTP 200 (not an
error).

✓ Given a `chat_ended` payload with an invalid or missing `X-Hume-AI-Webhook-Signature` (or a
timestamp outside the accepted tolerance window), when POSTed to `/api/webhooks/hume`, then the
endpoint returns HTTP 400, no database write occurs, and the payload body is never parsed.

✓ Given a valid HMAC-signed `chat_started` payload, when POSTed to `/api/webhooks/hume`, then the
endpoint returns HTTP 200, no row is written to any table, and no business logic beyond signature
verification runs.

✓ Given the base Hume Config (`4e0c7e15-bb03-40b2-aded-21813f19fc8d`) has had its `webhooks` field
set to `{ url: '<app-url>/api/webhooks/hume', events: ['chat_started', 'chat_ended'] }`, when a new
per-session clone is provisioned via `provisionNativeConfig()`, then a `GET
/v0/evi/configs/{cloneId}` against the newly created clone shows the same `webhooks` value inherited
from the base config, with no code change required in `config-provisioner.ts` beyond the base
config update itself.

✓ Given a `chat_ended` webhook is received for a session that ALSO has a normal client-side
`disconnected` audit row for the same cycle, when both rows exist in `session_billing_audit_log`,
then `computeBilledMinutes()` in `lib/session-billing.ts` is unaffected — the new
`hume_webhook_chat_ended` event type is not one of the event types `computeBilledMinutes` filters or
sums over (`speak_verified`, `disconnected`, `gap_start`, `gap_end`), so billed-minute calculation
for that session produces the identical result with or without the new row present.

✓ Given `HUME_WEBHOOK_SECRET` is unset or still a `PLACEHOLDER_` value (dev/preview environment),
when a `chat_ended` payload is POSTed to `/api/webhooks/hume`, then the endpoint treats this the same
way `stripe`/`twilio` webhook handlers treat their own placeholder-secret case — signature
verification is attempted and fails closed (returns 400), it does NOT silently accept unverified
payloads just because the secret is a placeholder. (This differs deliberately from the Stripe mock-
mode convenience path, because this endpoint has no user-facing flow that would otherwise be blocked
in local dev — there is nothing depending on this webhook succeeding locally, so fail-closed is safe
and preferred over adding a mock-acceptance branch.)

## 8. Error States

- **Invalid/missing signature:** return HTTP 400 with a generic JSON error body (e.g. `{ error:
  'Invalid signature' }`). Never echo the received signature or secret back in any response or log
  line.
- **Malformed JSON body (signature valid but body unparseable):** return HTTP 400. Log the parse
  failure (message only, not the raw secret) at `console.error`.
- **Unknown/unhandled event type** (anything other than `chat_started` or `chat_ended` — should not
  occur given the subscription is scoped to exactly those two, but Hume could in principle add new
  event types to an existing subscription in the future): log at `console.warn` noting the
  unexpected `event.type`, do nothing else, return HTTP 200. Never throw on an unrecognized type.
- **Supabase lookup or insert failure** (network blip, transient DB error): follow the exact
  convention already established in `writeAuditEvent()` (lib/session-billing.ts lines 110–115) — log
  the error via `console.error` and continue; never let an audit-log write failure crash the request
  handler or cause a non-200 response back to Hume (a 5xx would cause Hume to retry, which is not
  desired here since this is best-effort cross-check logging, not a billing-critical write).
- **Slow network / no explicit loading state:** not applicable — this is a synchronous webhook
  request/response with no client waiting on a UI. If the Supabase write takes longer than Hume's
  webhook timeout tolerance, that is an infrastructure concern (same as any other webhook receiver
  in this codebase) and not a new failure mode introduced by this feature.

## 9. Edge Cases

- **Unmatched `chat_id`** (test call made directly in the Hume dashboard against the base config, or
  a config used outside our session flow): handled explicitly in Section 4/7 — logged, no write,
  200 returned. Not an error.
- **Duplicate `chat_ended` delivery** (Hume redelivers the same event, e.g. due to a timeout on their
  side before receiving our 200): results in a second `hume_webhook_chat_ended` audit row for the
  same session with identical metadata. This is acceptable and consistent with the audit log's
  append-only, no-dedup design elsewhere (e.g. `computeBilledMinutes` already defensively handles
  multiple `disconnected` rows per session). No idempotency key or dedup logic is required for this
  event type, since it is never used in billing math (see the 6th acceptance test above) — a
  duplicate row only affects support/debug readability, not billed minutes.
- **`chat_ended` arrives before the client's own `disconnected` row** (possible if Hume's webhook
  delivery is faster than our own client round-trip): both rows still land in the audit log in
  whatever order they arrive; `occurred_at` on each reflects actual receipt time. No ordering
  guarantee or reconciliation step is needed for this feature's scope.
- **`chat_ended` never arrives at all** (Hume-side delivery failure, network partition to Hume's
  webhook infra): no error surfaces from our side — the existing three-layer detection (client +
  audit log + 30s watchdog) continues to function exactly as it does today, completely unaffected.
  This webhook is additive; its absence changes nothing about existing behavior.
- **First-time provisioning of the base config's `webhooks` field vs. already-provisioned clones
  created before this change ships:** any session using a Hume Config clone created before the base
  config's `webhooks` field is set will never send a webhook for that session (the clone was
  provisioned before the field existed on the base config it copied from). This is expected and
  requires no backfill — it only affects historical/in-flight sessions at the moment of the change,
  not future ones.
- **Mobile vs. desktop:** not applicable — no UI, no client-facing surface.
- **Twilio/Stripe webhook endpoints as precedent for concurrent traffic:** this endpoint follows the
  same statelessness as those two — no shared in-memory state, safe under concurrent delivery.

## 10. Out of Scope

Explicitly excluded from this feature, per the CEO brief's own verdicts:

- **`tool_call` webhook events.** `hume-adapter.ts` already handles `tool_call` live over the
  existing WebSocket with real-time `tool_response` round-trips; a webhook-delivered copy would
  arrive after the fact and cannot respond to Hume. Not subscribed, not built.
- **Any change to nightly-archive-job trigger timing** (`inngest/hume-native-nightly-cleanup.ts`).
  That job's eligibility window is keyed off `sessions.ended_at`, set synchronously by our own
  `forceEndSession` — it has no race with this webhook and is not modified in any way.
- **Billing-ledger cross-check or reconciliation logic.** `computeBilledMinutes()` continues to
  derive billed minutes strictly from our own audit log (`speak_verified` → `disconnected`, minus
  gaps) exactly as it does today. Hume's `duration_seconds` is logged as metadata only and is never
  read by, compared against, or wired into any billing calculation. A future "sanity-check ceiling"
  comparison is explicitly named as a candidate for a separate, later spec — not built here.
- **Any new UI.** No dashboard, admin view, or support tool surfaces the new `end_reason` data in
  this ship. A future support/debug view reading this metadata is named as a candidate follow-up,
  not built here.
- **Any change to `hume-adapter.ts`'s existing client-side disconnect/reconnect classification
  logic**, or to the 30-second gap watchdog (`inngest/voice-gap-watchdog.ts`). This feature adds a
  parallel, independent signal; it does not touch, replace, or influence either.
- **Any change to the base config's `voice`, `language_model`, or `tools`/`builtin_tools` fields.**
  The only change to the base config is the addition of the `webhooks` field.
- **Alerting/monitoring on `end_reason: ERROR` volume.** Named as a possible future
  metrics/dashboard follow-up; no alerting hook is added now.

## 11. Open Questions

None.

Resolution notes for what would otherwise have been open questions (all resolved by direct
inspection of `config-provisioner.ts` as it exists today, per the task instructions):

- **`webhooks` GET/POST symmetry:** confirmed by reading the file's current header comment (lines
  88–92) and the destructuring block (lines 181–197) — `webhooks` is NOT among the fields explicitly
  destructured out and reconstructed (unlike `voice`, `language_model`, `tools`, `builtin_tools`,
  `event_messages`, `timeouts`, `turn_detection`, `interruption`, `nudges`). It remains in
  `inheritedFields` and is spread through as-is. The file's own doc comment explicitly asserts this
  round-trips cleanly today (empty array in the base config, same shape both directions). Because
  this is a live, current-state assertion in the file being modified in this same feature's scope,
  and because the base config's `webhooks` value is being changed from an empty array to a populated
  one as part of this feature, the developer building this MUST re-verify via a live `GET
  /v0/evi/configs/{baseConfigId}` immediately after setting `webhooks` on the base config, and again
  immediately after provisioning one test clone, that the populated (non-empty) `webhooks` value
  round-trips identically — the doc comment's assertion was verified against an *empty array*, not
  a populated `{url, events}` object, and Hume's schema could in principle treat a populated object
  differently than an empty array even if the top-level field is nominally the same type. This is a
  build-time verification step (Section 12, Dependencies), not an open product question — the
  answer either confirms the current spread is sufficient or requires the developer to add
  `webhooks` to the explicit-reconstruction block, and the fallback approach for either outcome is
  fully specified in Section 4, item "Whether adding the `webhooks` field... requires a one-time
  manual dashboard action" below.
- **Base config modification method:** resolved — via `config-provisioner.ts`'s own pattern, applied
  once to the BASE config directly (not per-clone, and not via a one-time manual dashboard edit).
  Specifically: a one-time script/manual API call performs `POST
  https://api.hume.ai/v0/evi/configs/{baseConfigId}` (Hume's config update semantics create a new
  version of the same config id) with the base config's current full reconstructed body (same shape
  the provisioner already knows how to build) plus the new `webhooks` field:
  `{ url: '<NEXT_PUBLIC_APP_URL>/api/webhooks/hume', events: ['chat_started', 'chat_ended'] }`. This
  is done once, by a developer, using the same explicit-field-reconstruction values already codified
  in `config-provisioner.ts` (so the base config's own `voice`/`language_model`/`tools`/etc. are
  never accidentally altered by this one-time update — the developer reuses the exact literal values
  already in the provisioner file, not a fresh GET-spread). This is preferred over a manual dashboard
  action because it is scriptable, reviewable, and reproducible if the base config ever needs to be
  recreated; a manual dashboard action is acceptable ONLY as a one-time fallback if Hume's dashboard
  UI supports editing the `webhooks` field directly and the developer confirms doing so does not
  reset any other field — but the API-call approach is the specified default.
- **Webhook URL / environment handling:** resolved — same pattern already used by the Twilio webhook
  route (`app/api/webhooks/twilio/route.ts` line 19): `` `${process.env.NEXT_PUBLIC_APP_URL ??
  'https://distill-peach.vercel.app'}/api/webhooks/hume` ``. Per Arun's note, the app's actual live
  domain is `distill-peach.vercel.app` (hello-clio.com is a future domain, not yet live — see prior
  session memory). The base config's `webhooks.url` value registered with Hume must be the
  production URL: `https://distill-peach.vercel.app/api/webhooks/hume`. This is a single fixed value
  registered once on the base config (Hume webhooks are not re-registered per-request), so there is
  no preview-vs-production branching logic needed in the endpoint itself — only in choosing what URL
  value to register with Hume when the base config is updated (production URL only; no separate
  preview webhook subscription is in scope).
- **`chat_id` → `session_id`/`user_id` resolution path:** resolved — via the existing
  `sessions.hume_chat_id` column (migration `056_hume_native_session_fields.sql`, already indexed),
  the same column already populated client-side today via `POST
  /api/hume-native/session-chat-id`. No new column or resolution mechanism is needed.
- **Audit log event-type shape:** resolved — a new `event_type` value, `hume_webhook_chat_ended`
  (not metadata bolted onto the existing `disconnected` row), consistent with `writeAuditEvent()`'s
  existing one-event-per-row, append-only convention. See Section 6 for the required
  `BillingAuditEventType` type extension and the schema-level check the developer must perform
  before the insert (`TEXT`/`CHECK` vs. DB-level `ENUM` on `event_type`).

## 12. Dependencies

- `HUME_WEBHOOK_SECRET` env var must be added to `.env.local.example` (placeholder value) and to the
  real Vercel production environment (real value, obtained from Hume's dashboard when configuring
  the webhook subscription) before the endpoint can verify real traffic. Until then, per Section 7's
  fail-closed acceptance test, the endpoint safely rejects all inbound payloads rather than
  processing unverified ones — this is not a blocking dependency for building and merging the code,
  only for it to actually accept live Hume traffic.
- The base Hume Config update (adding `webhooks`) must be performed (Section 11, second bullet)
  before Hume will ever send a webhook for any session — this can happen independently of, and
  either before or after, the new endpoint code ships, since Hume will simply have nowhere to send
  events until both the config change and the deployed endpoint exist. Recommended order: ship and
  deploy the endpoint first, then update the base config, so there is no window where Hume is
  configured to call a URL that doesn't exist yet.
- Developer must confirm, before writing the insert, whether `session_billing_audit_log.event_type`
  is a plain `TEXT`/`CHECK`-constrained column or a Postgres `ENUM` type (Section 6) — if the latter,
  a small migration adding `hume_webhook_chat_ended` as a permitted value is a prerequisite for the
  insert to succeed at all.
- Requires `sessions.hume_chat_id` to already be populated for a given session before that session's
  `chat_ended` webhook can resolve to a match — this is already true today for any session running in
  Hume-native mode (populated via the existing `session-chat-id` route on connect), so no new
  upstream dependency is introduced; the "unmatched" edge case (Section 9) already covers sessions
  where this value was never captured.
