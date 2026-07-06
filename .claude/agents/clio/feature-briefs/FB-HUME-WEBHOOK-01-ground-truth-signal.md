# FB-HUME-WEBHOOK-01 — Hume Server-Side Webhook as Ground-Truth Signal

**Status:** Feature Brief (CEO Agent) — for BA spec-writing
**Author:** CEO Agent (on Arun's instruction, broadened per "think broadly and identify")
**Date:** 2026-07-05
**Depends on / relates to:** AUTOGEN-01 (`lib/session-billing.ts`, `minutes_ledger`), HUME-NATIVE-01 (config provisioning + nightly cleanup), VOICE-01 (Hume keep-alive bug), `fix(hume)` WebSocket close-reason fix (e8407806)

---

## 1. Why this brief exists

The original ask was narrow: use Hume's server-side webhook (`chat_started`, `chat_ended` with `end_reason`) to get a better disconnect-reason signal for glitch/failure diagnosis, since today we only see what the client's WebSocket `onclose` handler observed — which the 2026-07-02 fix (e8407806) improved but did not make authoritative. Hume's webhook is **ground truth from Hume's own servers**, independent of whether the user's browser, network, or our own client code ever got a chance to report anything.

Arun asked us not to scope this narrowly. Below is the full realistic set of uses for that same signal across the product, followed by a clear now-vs-later recommendation.

---

## 2. What the signal actually is

Hume EVI supports webhooks for chat lifecycle events (confirm exact payload shape with Hume docs at spec time — not yet verified against their current API version):
- `chat_started` — fires when Hume's server actually opens a chat session
- `chat_ended` — fires when Hume's server closes it, carrying `end_reason` (e.g. normal end, timeout, error, client disconnect)

This is **server-side and independent of our client**. Today, every signal we have about a Hume session's lifecycle — `voice_connect_attempt`, `speak_verified`, `disconnected` in `session_billing_audit_log` (`lib/session-billing.ts`), and `sessions.ended_at` — originates from the browser (WalkthroughClient.tsx / HumeAdapter) or our own server routes reacting to browser calls. None of it is corroborated by Hume itself. That is the structural gap this webhook closes.

---

## 3. Full set of use cases considered

### 3.1 Disconnect/glitch diagnosis (the original ask)
Use `end_reason` to distinguish "Hume ended it deliberately" vs "network/client failure" vs "our own bug" — richer and more trustworthy than the client `onclose` code/reason alone, which e8407806 fixed the *display* of but which can still be wrong or entirely absent if the browser tab dies, loses network, or the WS event never fires.

### 3.2 Silent-failure detection at provisioning (`chat_started` beyond confirmation)
`lib/voice/hume-native/config-provisioner.ts` provisions a Hume config right before a chat starts. Today, "connect looked successful client-side" is inferred from the client reaching `voice_connect_attempt` / `speak_verified` — there is no server-side confirmation that Hume's side actually opened a chat at all. A real failure mode this closes: client-side code believes it issued a valid connect and moves forward (or silently hangs) while Hume never actually started a chat — e.g. a config that provisioned successfully but is subtly invalid, or a race between config-write and connect. Absence of `chat_started` within N seconds of our own `voice_connect_attempt` is a directly actionable, currently invisible signal.

### 3.3 Billing/minutes-ledger cross-check (`session-billing.ts`, `minutes_ledger`)
This is the most consequential use case found. Billed minutes today are computed **exclusively** from `session_billing_audit_log` rows written by client/server code reacting to client behavior (`computeBilledMinutes()` in `lib/session-billing.ts`, lines 151–224) — `speak_verified` start, `disconnected` end, gaps in between. There is a real, non-theoretical risk class here:
- If the browser tab is killed, the OS sleeps, or the network drops without a clean WS close, our `disconnected` event may never get written (or gets written late via the 30s gap watchdog / `forceEndSession`), while Hume's own `chat_ended` fired immediately and truthfully.
- Conversely, if `speak_verified` was ever written incorrectly (bug, replay, clock skew) with no matching real Hume session, we'd bill for time Hume never actually spent.
- The `session_billing_audit_log` is explicitly designed to be "dispute-defensible" (per its own code comments) — but right now it can only be disputed against itself. A Hume-side `chat_started`/`chat_ended` pair is an **independent second witness**, exactly what a dispute-defensible system should have.

This does not mean changing how minutes are billed today (that logic is deliberately audit-log-derived and should not be touched without its own BA spec — see AUTOGEN-01's explicit AC-D3 design intent). It means: store the Hume-side timestamps/end_reason alongside the existing audit log as a **reconciliation source**, and flag (not silently correct) sessions where the two diverge beyond a tolerance (e.g. Hume says chat ended 40 minutes before our `disconnected` row exists — that's a real discrepancy worth surfacing to support/billing ops, not auto-refunding).

### 3.4 Nightly archive job trigger (`inngest/hume-native-nightly-cleanup.ts`)
Investigated directly: this job's eligibility query is `ended_at IS NOT NULL AND ended_at < NOW() - 1 hour AND hume_config_archived_at IS NULL` — i.e., it already depends entirely on our own `sessions.ended_at`, which is itself only ever set by `forceEndSession()` / `/api/sessions/[id]/end`, both client/audit-log-triggered. If `ended_at` is late or never gets set (the exact failure mode in 3.3), config archival is also late or never happens — this job inherits the same blind spot.
Using `chat_ended` as an **earlier-arriving parallel trigger** (webhook fires the moment Hume's server closes the chat, no dependency on the client ever calling back) would make eligibility detection strictly more reliable, not just faster. This is a real, concrete improvement, not a speculative one — it's the same underlying gap as 3.3, applied to a second consumer.

### 3.5 Support/debugging tooling
Real use, smaller and more deferrable. A future support/debug view (referenced already in `getAuditLog()`'s own comment as "the future user-facing minute-breakdown view") could show Hume's own timeline next to ours for support agents investigating a specific user's complaint ("my session cut off early"). Valuable, but there's no existing screen or admin page this plugs into today — building the display surface is out of scope for this brief; only the underlying data capture matters now.

### 3.6 Cross-user quality monitoring
Real, but organizationally premature. At current usage volume there's no dashboard or alerting layer that aggregates `end_reason` across many users to detect e.g. "10% of sessions this week ended in a Hume-side error, not a user hangup" — that's a monitoring/observability initiative, not a webhook-plumbing one. Worth naming for later; would depend on 3.1–3.4's data existing first.

---

## 4. Recommendation: build now vs defer

**Build now (this brief's scope):**
1. **Webhook endpoint + signature verification** — receive and durably store `chat_started` / `chat_ended` (+ `end_reason`) events, keyed to our `session_id` (need a reliable correlation key from Hume — likely their `chat_id`/`chat_group_id`, must confirm exact join key with Hume docs before BA spec is written).
2. **3.1 (disconnect diagnosis)** — the original ask. Immediate value, no new product surface.
3. **3.2 (silent-provisioning-failure detection)** — cheap once the webhook exists; directly protects against a real, currently-invisible failure mode in the connect flow.
4. **3.3 (billing reconciliation, flag-only)** — store Hume timestamps alongside the audit log; add a divergence check that logs/flags, not auto-corrects. This directly strengthens the "dispute-defensible" property AUTOGEN-01 already claims to have, and the underlying data capture is nearly free once #1 exists — deferring it would mean re-deriving the same webhook plumbing later anyway.
5. **3.4 (archive job trigger)** — use `chat_ended` as an additional/earlier trigger condition alongside the existing `ended_at` check in the nightly cleanup job. Small, isolated change to one existing query.

**Name but defer:**
6. **3.5 (support/debug UI)** — no display surface exists yet; build the data capture now, defer the screen until a real support workflow needs it.
7. **3.6 (cross-user quality monitoring/alerting)** — organizationally premature at current volume; revisit once 1–5 are shipped and there's enough data to make a dashboard worth building.

Rationale for the cut line: everything in "build now" shares one webhook endpoint and one storage table — the marginal cost of 2–5 once 1 exists is small, and 3/4 close a real, already-identified blind spot in billing and archival that would otherwise persist silently. 6/7 require new UI or new monitoring infrastructure with no current consumer — building them now would be speculative.

---

## 5. Open questions for BA spec (Section 11 must be empty before dev starts)

- Exact Hume webhook payload shape and signature-verification mechanism for the current Hume EVI API version (confirm against Hume's live docs — do not assume ElevenLabs' webhook shape carries over).
- Reliable correlation key between a Hume `chat_id`/webhook payload and our internal `session_id`.
- Divergence tolerance threshold for 3.3 (how much time gap between Hume's `chat_ended` and our `disconnected` row counts as "flag this").
- Whether flagged billing divergences need a notification path (e.g. Slack/log-only vs. an admin-visible queue) — Arun to decide, this is a product decision not a technical one.

---

## 6. Direct answer to Arun's original question

Yes — build the Hume webhook now, and don't scope it to disconnect-diagnosis alone. The same `chat_started`/`chat_ended` signal is a real, independent ground-truth source for four things at once: (1) disconnect/glitch diagnosis, (2) catching a silent "config provisioned but Hume never actually started the chat" failure, (3) a reconciliation cross-check against `session-billing.ts`/`minutes_ledger` (flag divergences, don't auto-correct billing), and (4) an earlier, more reliable trigger for the nightly archive job in `inngest/hume-native-nightly-cleanup.ts`, which today depends solely on our own `ended_at`. Support-tooling display and cross-user quality monitoring are real future uses but should be named and deferred — they need new UI/monitoring surfaces that don't exist yet and have no current consumer. One webhook endpoint, one storage table, four consumers — worth building broad now rather than re-deriving the same plumbing later.
