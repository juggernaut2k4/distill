# Feature Brief: HUME-GROUND-TRUTH-01 — Hume as the Authoritative Data Source

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 (elevated from a prior P2, HUME-WEBHOOK-01, at Arun's explicit direction)
Date: 2026-07-06

---

## What Arun Said

Following last night's real test-call incident (Hume's own duration record wasn't ready yet when we
asked for it, so we silently fell back to a less accurate internal calculation), Arun's direction:

> "the data from hume config is very important for everything, in terms of transcripts, action item
> identification, glitch identification, if it does not work then our whole solution is a failure."

His proposed mechanism: use a Hume webhook to know precisely when a call has truly ended, then pull
Hume's own record for that session (we already know the config/chat ID going in, since we clone a
fresh Hume Config per session).

This is explicitly elevated from a previously-deferred low-priority item (HUME-WEBHOOK-01, filed
2026-07-05, P2, scoped narrowly to disconnect-diagnosis only) to a foundational architecture decision.

---

## The Problem Being Solved

Three systems depend on "what actually happened in this call" and today none of them use a
Hume-native, real-time, authoritative signal for the thing they most need:

1. **Billing** (`lib/session-billing.ts` → `finalizeHumeNativeBilling()`) — waits a flat 3 seconds,
   optionally retries once after 4 more seconds, then gives up and silently falls back to our own
   client-derived audit-log math (`computeBilledMinutes()`) if Hume's `GET /v0/evi/chats/{id}`
   metadata endpoint hasn't finalized `end_timestamp` yet. This is a timing guess, not a guarantee,
   and it's exactly what broke on last night's test call.
2. **Quality/glitch evaluation and deferred-question detection**
   (`inngest/session-quality-evaluator.ts`) — runs 2+ hours after a session ends, and reads the
   **Recall.ai** transcript, not Hume's. It identifies "Clio" vs "the user" with a keyword heuristic
   (whichever speaker label has more total words is assumed to be Clio) — not any ground-truth
   labeling from either vendor. This already produced one real false-negative last night ("no proper
   coaching speech detected").
3. **Nightly archival** (`inngest/hume-native-nightly-cleanup.ts`) — pulls Hume's real transcript via
   `GET /v0/evi/chats/{id}/events`, but only the next day, for cold storage, not for anything
   real-time.

None of these three currently has a **push-based, Hume-authoritative, real-time** "this call is over,
here is what happened" signal. All three either poll, guess, or wait a full day.

---

## Investigation Findings (verified directly against Hume's live docs today, not assumed)

### 1. The webhook exists and is well-specified

`chat_ended` (`POST` to our registered URL) payload, confirmed against
`dev.hume.ai/reference/empathic-voice-interface-evi/chat-webhooks/chat-ended`:
`chat_id`, `chat_group_id`, `config_id`, `custom_session_id`, `duration_seconds`, `end_reason`,
`end_time` (unix ms), and `caller_number` (Twilio-calling only, N/A for us).

**This is materially better than what our prior HUME-WEBHOOK-01 spec assumed.** That spec's own
feature brief said "It does not carry transcript or config body" — still true — but importantly
`duration_seconds` is already computed and delivered *in the push payload itself*. We do not need to
make a second `GET /v0/evi/chats/{id}` call to learn the duration once the webhook fires — the number
we currently poll for 3–7 seconds after the fact arrives for free, unprompted, in the webhook body.
This is the single biggest reason to make this a real architecture change rather than a nice-to-have
cross-check.

### 2. Signature verification — confirmed, matches our existing house style exactly

Headers: `X-Hume-AI-Webhook-Signature` (HMAC-SHA256) + `X-Hume-AI-Webhook-Timestamp`. This is the
same shape of problem we already solve twice in this codebase — `stripe.webhooks.constructEvent`
(`lib/stripe.ts`) and Twilio's `validateRequest` (`lib/delivery/sms.ts`, `lib/session-billing.ts`'s
own `verifyAuditToken` uses `crypto.timingSafeEqual` already). No new pattern needs to be invented;
BA should specify HMAC-SHA256 over `timestamp + '.' + rawBody` (or whatever Hume's docs specify as
the exact signed string — the developer must confirm the precise concatenation format against
Hume's docs at build time, not assume Stripe's format transfers) verified with
`crypto.timingSafeEqual`, fail-closed (400) on any mismatch, exactly like our other two webhooks.

### 3. Registration is per-Config, and we already have the plumbing

Webhooks are a field (`{url, events}`) on the EVI Config object itself, set at Config-creation time.
`config-provisioner.ts` already spreads `webhooks` from the base config into every per-session clone
today (currently empty array) — confirmed directly in the file (`provisionNativeConfig`, lines
104-108, 219-244). This means: set `webhooks` once on the **base** production config
(`NEXT_PUBLIC_HUME_CONFIG_ID`), and every future per-session clone inherits it automatically with
**zero code change** to the provisioner itself. This was already correctly identified in the prior
HUME-WEBHOOK-01 spec and remains accurate.

### 4. Latency/SLA — genuinely unknown, and this matters for the architecture decision

Hume's docs do not publish a delivery-latency SLA or a retry-on-failure guarantee for webhook
delivery. This is a real gap in what we can promise. Practical implication: **the webhook must not be
the only mechanism** — if Hume's webhook infrastructure has an outage, is delayed, or never fires for
a given chat, we cannot let billing or quality-evaluation hang waiting for it indefinitely. This
directly shapes the architecture recommendation below (see "Decision 1").

### 5. Transcript speaker-labeling — the decisive finding, resolved with evidence

This was flagged as the most important open question, and it has a clear, evidence-based answer:

Hume's own chat transcript (`GET /v0/evi/chats/{id}/events`, `USER_MESSAGE` / `AGENT_MESSAGE` event
types) labels speech as `USER` or `ASSISTANT` **based on which side of the WebSocket sent it, not
acoustic speaker identification.** Confirmed directly against
`dev.hume.ai/docs/speech-to-speech-evi/features/chat-history`: this is not diarization. If multiple
humans are in a room and only one audio stream reaches Hume (which is our exact setup — Recall.ai's
bot captures room audio and bridges it to Hume as a single input stream), **Hume has no mechanism to
distinguish between different human speakers** — every human voice in the room collapses into a
single `USER` role.

This means: for any session with more than one human participant, Hume's transcript cannot tell us
which specific person said what. Recall.ai's transcript, by contrast, already does real multi-speaker
diarization today (`session-quality-evaluator.ts`'s `RecallUtterance.speaker` field, confirmed in the
existing code, currently used with a crude "whichever speaker talks most is Clio" heuristic — which
is itself a real, separate, smaller bug worth fixing, but not blocking this decision).

**This resolves the replace-vs-supplement question decisively: Hume's transcript cannot replace
Recall.ai's for any session with multiple humans present, because Hume literally cannot tell those
humans apart. It can only ever run alongside Recall.ai's, as a source of what Clio herself said/heard
with certainty (the `ASSISTANT` role is unambiguous, since only Clio's audio is ever synthesized
server-side) — not as a full substitute transcript source.**

---

## Recommended Architecture (my recommendation, for BA to spec in full)

### Decision 1 — Webhook as a fast-path trigger, not a replacement for existing detection

Build the `chat_ended` webhook as an **additional, faster-arriving trigger** for billing finalization
and quality-evaluation eligibility — running *alongside*, not replacing, the existing client-side
disconnect detection, the 30s gap watchdog, and the nightly archive job's own `ended_at`-based
eligibility query.

Reasoning: Hume documents no delivery SLA. If we made the webhook the *sole* trigger, a Hume-side
outage or delayed delivery would silently stall billing finalization for real sessions with no
backstop — trading one class of unreliability (guessing how long to wait) for a worse one (waiting
forever, or on nothing). The current three-layer detection (client + audit log + watchdog) already
works and force-ends sessions reliably; this webhook closes the "client process died outright" gap
and, critically, **removes the entire 3–7 second guessing window in `finalizeHumeNativeBilling()`**
since `duration_seconds` arrives unprompted in the webhook payload itself — no more polling
`fetchHumeChatDuration()` at all once the webhook has fired for that session. If the webhook hasn't
arrived by the time our own client-side detection completes (the common case, since webhook latency
is undocumented and could arrive after our own detection), the existing fallback path
(`computeBilledMinutes()`) runs exactly as it does today. Net effect: **best available number, always
available, faster and more often authoritative than today, never blocking.**

### Decision 2 — Hume's transcript supplements, never replaces, Recall.ai's transcript

Per the evidence above, this is not a judgment call — Hume literally cannot diarize multiple human
speakers. `session-quality-evaluator.ts` must continue to source its transcript from Recall.ai for
all analysis that depends on knowing what a specific human said (checkpoint-response classification,
quality criteria, deferred-question detection). Hume's own transcript's one piece of unique value is
an unambiguous, un-guessed `ASSISTANT`-role record of exactly what Clio said — useful as a
cross-check/correction source if Recall.ai's "who is Clio" heuristic (currently: whichever speaker
talks most) is ever wrong, but this is a smaller, separate fix, not a replacement of the whole
pipeline. BA should scope the current heuristic-fix as an explicitly separate, smaller follow-up
item, not bundle it into this webhook spec.

### Decision 3 — One webhook endpoint, three consumers, additive only

Single new route (`app/api/webhooks/hume/route.ts`), verifies signature, resolves `chat_id` →
`session_id` via the existing `sessions.hume_chat_id` column, and on `chat_ended`:
- Writes an audit-log row with Hume's authoritative `end_reason` + `duration_seconds` (supplements
  `session_billing_audit_log`, per the prior HUME-WEBHOOK-01 spec's already-correct design).
- If billing hasn't already been finalized for that session, uses the webhook's `duration_seconds`
  directly instead of `finalizeHumeNativeBilling()`'s polling loop.
- Does not touch quality-evaluation transcript sourcing (Decision 2) or the nightly archive job's
  trigger condition (kept decoupled, per the prior spec's reasoning, which still holds).

---

## Known Constraints

- Must follow the exact signature-verification standard already used for Stripe/Twilio in this
  codebase (fail-closed, HMAC, no plaintext secret ever logged).
- Must not become a single point of failure — every existing detection layer stays in place
  unchanged as a backstop.
- Must not claim Hume's transcript can replace Recall.ai's — this is now a documented, evidence-based
  architectural constraint, not an open question.
- This is now P0. Full spec required before any code — no shortcuts on Section 11.

## Questions for BA

1. Write the full requirement doc per governance (12 sections, wireframe/example N/A since this is
   backend-only, but every data flow, error state, and edge case must be concrete).
2. Specify the exact `chat_ended` → billing-finalization integration point in
   `lib/session-billing.ts` (does the webhook handler call a new exported function, or does
   `finalizeHumeNativeBilling()` itself get restructured to check for an already-received webhook
   row before polling? Recommend the latter — check audit log for a `hume_webhook_chat_ended` row
   first, skip the 3-7s poll entirely if found, per Decision 1).
3. Specify the exact `HUME_WEBHOOK_SECRET` provisioning and the literal signed-string format Hume
   uses (confirm against Hume's docs at build time — do not assume Stripe's `t=...,v1=...` format
   transfers verbatim).
4. Confirm whether `session_billing_audit_log.event_type` is `TEXT`/CHECK or a DB-level `ENUM` (this
   was already flagged as a build-time check in the prior spec — still applies).
5. Explicitly document, in Section 10 (Out of Scope), that fixing `session-quality-evaluator.ts`'s
   "most-verbose-speaker = Clio" heuristic is NOT in scope for this spec — name it as a follow-up.
