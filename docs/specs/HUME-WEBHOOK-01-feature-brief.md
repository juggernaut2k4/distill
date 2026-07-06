# Feature Brief: HUME-WEBHOOK-01 — Hume EVI `chat_ended` Server-Side Corroboration

From: CEO (Arun)
To: Business Analyst Agent
Priority: P2
Date: 2026-07-05

---

## What Arun Said

Verbatim: "what all things we need. is only chat or call status sufficient or do you need to capture
glitches or failures? or more like transcript or config etc?"

Context: earlier this session we confirmed Hume EVI supports a Config-level `webhooks` field
(`{url, events}`, events = `chat_started` | `chat_ended` | `tool_call`), HMAC-SHA256-signed. The
`chat_ended` payload carries `chat_id`, `config_id`, `duration_seconds`, and `end_reason`
(`USER_ENDED` | `USER_TIMEOUT` | `MAX_DURATION_TIMEOUT` | `INACTIVITY_TIMEOUT` | `SILENCE_TIMEOUT` |
`ERROR`). It does not carry transcript or config body. Nothing has been built yet — this is a
documented capability, not a shipped one.

---

## The Problem Being Solved

We have three separate end-of-call signals today, all client- or Recall-side:

1. **`hume-adapter.ts`** (client, in the user's/bot's browser) — detects WebSocket close, classifies
   reconnect vs. terminal failure, calls `onDisconnect`/`onError`.
2. **`session-billing.ts` + `voice-gap-watchdog.ts`** (our own audit trail) — `gap_start`/`gap_end`/
   `disconnected` events written by the client, with a 30-second Inngest watchdog that force-ends a
   session if no `gap_end` follows a `gap_start`.
3. **Nightly archive job** (`hume-native-nightly-cleanup.ts`) — pulls the full transcript via
   `GET /v0/evi/chats/{id}/events`, next day, for archival — not real-time, not an end-detection
   signal.

None of these three is a signal that comes **from Hume itself, server-to-server, at the moment the
call ends**. All of our current end-detection depends on the client (the Recall.ai bot's headless
browser) staying alive long enough to notice its own WebSocket closed and write that fact down. If
the bot's browser process crashes outright — not a WebSocket close, a full process death — nothing
client-side ever fires, and we rely entirely on the 30s watchdog's silence-based inference, which
tells us a session went quiet but never tells us *why* from Hume's point of view.

The `chat_ended` webhook is Hume's own record of what happened to a chat, delivered independent of
whether our client survived to report it.

---

## What Success Looks Like

Answering Arun's question directly, point by point:

**1. What does the webhook add over what we already have?**
A server-side, Hume-authoritative signal for *when and why* a chat ended — specifically
`end_reason`. This is not redundant with our existing signals because ours are all inferred
client-side (WebSocket close codes, silence timeouts) or Recall-side (bot heartbeat). The webhook is
the one channel that still fires even if the reporting client itself is the thing that died.

**2. Does capturing "glitches or failures" require more than what's already in the payload?**
No — confirmed directly against Hume's documented payload shape. `end_reason` values `ERROR`,
`INACTIVITY_TIMEOUT`, `SILENCE_TIMEOUT`, `USER_TIMEOUT`, and `MAX_DURATION_TIMEOUT` already
distinguish a clean end (`USER_ENDED`) from every category of abnormal end. No additional payload
richness is needed and none should be invented — do not build speculative parsing for fields Hume
does not send.

**3. Do we need `tool_call` webhook events too?**
No. `hume-adapter.ts` already handles `tool_call` live over the WebSocket (lines 183–203: it
receives `tool_call`, dispatches to the registered handler, and sends `tool_response` back over the
same socket in real time). A webhook-delivered `tool_call` notification would arrive after the fact,
carries no ability to respond to Hume (the WebSocket round-trip is required for that), and only adds
a second, laggier copy of information we already have live. **Recommendation: exclude `tool_call`
from the webhook subscription.**

**4. Recommended scope:**
- (a) Subscribe to `chat_started` + `chat_ended` only.
- (b) Add the `webhooks` field to the **base** Hume config via `config-provisioner.ts`, so it's
  inherited by every per-session clone automatically — consistent with how `event_messages`,
  `turn_detection`, `interruption`, `nudges`, and `timeouts` are already inherited today. Per the
  provisioner's own doc comment, `webhooks` is *already* spread from the base config into every
  clone (currently as an empty array) — so this is a one-field change to the base config, not new
  plumbing in the provisioner.
- (c) Build one new signed webhook receiver endpoint (e.g. `app/api/webhooks/hume/route.ts`) that
  verifies the HMAC signature and, on `chat_ended`, writes `end_reason` + `duration_seconds` into
  `session_billing_audit_log` as a new metadata field on a new event type (proposal:
  `hume_chat_ended`) — or attached as metadata on the existing `disconnected` row if a matching
  session/chat_id can be resolved at receipt time. This makes it a cross-check against, not a
  replacement for, client-side detection: if a session's own `disconnected` audit row is missing or
  came from the wall-clock/watchdog backstop rather than a clean client report, the webhook fills in
  Hume's authoritative reason after the fact.
- `chat_started` is subscribed alongside `chat_ended` only because Hume's webhook config is an
  events array on one subscription — there is no material feature use for `chat_started` beyond
  optional matching/logging; it should not trigger new business logic.

---

## Known Constraints

- Signature verification is non-negotiable — same standard already enforced for Stripe
  (`stripe.webhooks.constructEvent`) and Twilio (`validateRequest`) per CLAUDE.md. The receiver must
  verify `X-Hume-AI-Webhook-Signature` / `X-Hume-AI-Webhook-Timestamp` (HMAC-SHA256) before
  processing anything, and reject/400 on failure without processing the body.
- Must not touch the base production config's `language_model`, `voice`, or `tools` — this change is
  additive (one field: `webhooks`) on top of the existing provisioning logic. Given the extensive,
  hard-won GET/POST asymmetry work already documented in `config-provisioner.ts`'s file header (four
  prior provisioning bugs from spreading fields that don't round-trip), the BA/dev must re-verify
  `webhooks`' GET/POST shape symmetry before assuming a blind spread is safe — the file's own doc
  comment currently asserts it round-trips cleanly, but this must be checked against Hume's current
  schema before shipping, not assumed indefinitely.
- Must not duplicate or conflict with the nightly archive job's role. This feature is about
  real-time reliability of end-detection (a cross-check signal), not a second transcript/config
  puller. No transcript or config data is requested via this webhook and none should be persisted
  from it beyond `chat_id`, `config_id`, `duration_seconds`, `end_reason`.
- This is P2, not P0/P1: our existing three-layer detection (client + audit log + 30s watchdog)
  already works and already force-ends sessions reliably. This closes a specific, narrow gap (client
  process death before it can report) — it does not fix a currently-broken flow.

## Questions for BA

1. Confirm current Hume `webhooks` field GET/POST schema symmetry (does it round-trip cleanly today,
   as `config-provisioner.ts`'s doc comment currently assumes, or does it need explicit
   reconstruction like `voice`/`language_model`/`tools` did)?
2. Define the exact resolution path from an inbound `chat_ended` payload's `chat_id` back to our
   internal `session_id`/`user_id` (likely via the `hume_chat_id` already captured client-side on
   connect) — including the case where no matching session is found (stale config, test call, etc.).
3. Define the exact new column/event-type shape for surfacing `end_reason` in
   `session_billing_audit_log` (new `event_type` value vs. metadata on an existing row) — this is a
   product/schema decision, not ambiguous UX, but still needs one documented answer before dev
   starts.
4. Confirm webhook endpoint URL environment handling (preview vs. production Vercel URLs) — same
   pattern as existing Stripe/Twilio webhook URL configuration.

---

## Broader Use-Case Analysis (beyond the core `chat_ended` corroboration)

The core recommendation above (subscribe `chat_started` + `chat_ended` only, as a reliability
backstop for client-process-death cases) stands as scoped and sufficient. Four adjacent questions
were raised about whether the webhook unlocks value elsewhere in the system. Verdicts below, each
grounded in the actual code paths in `lib/session-billing.ts` and
`inngest/hume-native-nightly-cleanup.ts`.

**1. Silent post-provisioning failure detection via `chat_started`**
*Not warranted.* `chat_started` firing (or not firing) tells us Hume accepted the WebSocket
handshake — it does not tell us anything `bot_joined` / `voice_connect_attempt` /
`speak_verified` in `session_billing_audit_log` don't already tell us, and those three already
form a strictly more granular pipeline (connect attempted → connect confirmed working). A silent
provisioning failure (e.g. bad config, bot never reaches `speak_verified`) is already the explicit
`reachedSpeakVerified: false` branch in `computeBilledMinutes` — it bills zero minutes and is
visible today without this webhook. Adding `chat_started`-triggered logic would duplicate that
signal one layer up with less detail, not add a new failure mode. Per the brief itself, no new
business logic should hang off `chat_started`.

**2. Billing / minutes-ledger cross-check value**
*Future candidate, not now.* `computeBilledMinutes` derives billed minutes purely from our own
audit log (`speak_verified` → `disconnected`, minus gaps) and is explicitly designed to never fall
back to wall-clock or external timestamps (AC-D3, and the 2026-07-05 bugfix comment shows how
carefully cycle-scoping is already handled). Hume's `duration_seconds` in `chat_ended` measures a
*different* interval — the whole chat session including pre-`speak_verified` connect time and any
mid-call gaps — so it is not a like-for-like cross-check against billed minutes and using it
directly would produce confusing false-positive "discrepancies." It has narrow future value as a
**sanity-check ceiling** (billed minutes should never exceed Hume's own reported chat duration) if
billing disputes ever need a second independent number, but that's a distinct, small follow-up spec
with its own comparison logic — not something to fold into this webhook's scope now.

**3. Nightly-archive-job trigger-timing improvement**
*Not warranted.* The nightly job's 1-hour eligibility window (`ended_at < NOW() - INTERVAL '1
hour'`) is keyed off `sessions.ended_at`, which our own `forceEndSession` sets synchronously when a
session completes — it does not wait on any Hume signal and has no race with one. `chat_ended`
would arrive at essentially the same moment `disconnected` is written client-side (or, in the crash
case this brief targets, up to the 30s watchdog delay later) — nowhere near enough to justify
restructuring a job whose entire timing model is intentionally decoupled from real-time signals
(it runs nightly, batched, DST-corrected, precisely because it's an archival job, not a live one).
Wiring `chat_ended` into it would couple two systems designed to stay decoupled for no timing gain.

**4. Other product areas (support/monitoring tooling)**
*Worth naming as a future candidate, not building now.* The one clean win is a support-facing
**dispute/debug view**: when a customer disputes billed minutes or reports "the call just died,"
having Hume's own `end_reason` (`ERROR` / `INACTIVITY_TIMEOUT` / `SILENCE_TIMEOUT` /
`USER_TIMEOUT` / `MAX_DURATION_TIMEOUT` / `USER_ENDED`) sitting next to our audit trail turns "we
think the client disconnected" into "Hume confirms this ended due to X." That's real support-team
value, but it's a UI/tooling follow-up (surfacing a field that this brief already proposes storing
in `session_billing_audit_log`), not new scope for the webhook receiver itself. No monitoring/
alerting hook is warranted beyond that — `onFailure` alerting already exists at the Inngest-job
level (see `hume-native-nightly-cleanup.ts`), and `end_reason: ERROR` volume, if it ever needs
active alerting, should be a metrics/dashboard follow-up, not logic added to this webhook now.
