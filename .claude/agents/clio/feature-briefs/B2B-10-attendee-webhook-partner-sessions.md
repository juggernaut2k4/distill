# Feature Brief: Attendee Webhook — Partner Session Support
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-15
ID: B2B-10 (next free number — B2B-01 through B2B-09 are all claimed; verified against
`.claude/agents/clio/feature-briefs/` directory listing and `docs/b2b-pivot-status.md`'s Live
Status table before assigning this one)

---

## What Arun Said

Correcting a framing error the dispatching task was about to make: `/api/attendee/webhook`
(`app/api/attendee/webhook/route.ts`) is **not** B2C-specific infrastructure that needs to be
rebuilt for B2B. It's Clio's general-purpose Attendee event handler, already working correctly
today for Clio's own direct coaching sessions. Attendee sends the exact same event types
(`bot.state_change`, `transcript.update`, `participant_events.join_leave`) no matter who
dispatched the bot. His instruction: **reuse this same, already-proven event-handling logic for
B2B partner sessions — extend/branch the existing handler to also recognize and update
`partner_sessions` rows. Don't say this needs a significant new build; it doesn't.**

Two things explicitly fenced off from this brief, per his instruction: (1) the webhook's
signature-verification hard-enforcement — tracked separately in `docs/b2b-pivot-status.md`'s
Backlog section, soft-verify mode is left exactly as-is; (2) this is not the same concern as
B2B-09 (session-content extraction via Hume's Chat History API) — that's conversation content,
this is bot/meeting mechanics. Both concerns touch "partner session lifecycle" but from different
vendors and different layers.

## The Problem Being Solved

Verified directly in code, not assumed: `handleEvent()` in `app/api/attendee/webhook/route.ts`
identifies which session an event belongs to via `event.bot_metadata?.user_id`, then looks up
`walkthrough_state` by that `user_id`. For a bot dispatched via the B2B partner flow
(`dispatchMeetingBot()` in `lib/partner/session-init.ts`), there is no `walkthrough_state` row —
so today, **every** Attendee webhook event for a partner session hits the `if (!walkthroughRow)`
branch, logs a warning, and returns. All three event types are silently no-op'd for partner
sessions: no bot-join confirmation, no fallback session-completion/billing safety net if the
client-side end-session call never fires, no participant-join handling. This has been true since
B2B-02 shipped `dispatchMeetingBot()` — not a regression, a gap that was never closed.

## What Success Looks Like

An Attendee webhook event for a partner-dispatched bot gets correctly routed to a `partner_sessions`
row and produces the appropriate, minimal, already-proven-pattern side effect — without touching a
single byte of the existing B2C code path or its behavior.

## Known Constraints

- Zero behavior change to the existing B2C path. The B2C lookup (`walkthrough_state` by `user_id`)
  must be tried first, unchanged, in every branch; the partner path is purely additive, tried only
  on B2C lookup miss.
- No signature-verification changes. Soft-verify mode stays exactly as it is.
- No duplication of B2B-09's scope (Hume-side conversation-content extraction). This brief is
  bot/meeting mechanics only: join/leave, state changes, whether to treat `transcript.update` as a
  no-op for partner sessions and why.
- Reuse existing primitives wherever they already do the job — do not reimplement billing,
  status transitions, or webhook dispatch that `lib/partner/live-render.ts`'s `handleSessionEnd()`
  already owns.

---

## Grounding — what was verified directly in code before writing this brief

**1. The correlation mechanism already exists — no new metadata tagging needed at dispatch time.**

I initially assumed (per the dispatching task's own framing) that `lib/partner/session-init.ts`
would need a new `clio_session_ref` tag added to bot metadata. Reading the actual call chain shows
this is already happening, just not documented as such:

- `dispatchMeetingBot()` (`lib/partner/session-init.ts:59`) calls:
  `provider.createBot(params.meetingUrl, params.clioSessionRef, params.renderUrl, params.clioSessionRef)`
  — the **second positional argument**, which `MeetingBotProvider.createBot()`'s signature names
  `userId`, is passed `params.clioSessionRef` (== `partner_sessions.id`), not a real user id. The
  function's own doc comment confirms this is deliberate: *"`partner_sessions.id` (==
  `clio_session_ref`) is passed in the `userId` parameter slot, confirmed safe by architecture.md
  Section 11 (opaque bot metadata only, never an identity check inside the provider)."*
- `attendeeProvider.createBot()` (`lib/meeting-bot/attendee.ts:71`) takes that `userId` value and
  writes it straight into Attendee's bot metadata: `metadata: { user_id: userId }`.
- Net effect: for a partner-dispatched bot, every Attendee webhook event's
  `event.bot_metadata.user_id` already contains the `partner_sessions.id` — not a Clerk user id,
  not a B2C `users.id`.

So the fix is **not** "add a new field and thread it through the dispatch call" — it's "in
`handleEvent()`, when the existing B2C `walkthrough_state` lookup by `user_id` misses, try
`partner_sessions` by `id = userId` before giving up." Zero changes needed to
`lib/partner/session-init.ts` or `lib/meeting-bot/attendee.ts`. This is exactly the kind of
already-built-but-undocumented reuse Arun's instruction was pointing at.

Collision risk is not real: Clerk/B2C user ids and `partner_sessions.id` (a `uuid_generate_v4()`
Postgres UUID, per migration `071:175`) come from disjoint, non-overlapping ID formats — a
B2C-lookup miss followed by a partner-lookup attempt cannot accidentally match the wrong row.

**2. `partner_sessions` already has every column this brief needs. No schema change.**

Migration `071:174-204`: `status` (`requested | bot_dispatch_failed | bot_active | completed |
failed`), `provider_bot_id`, `provider_name`, `error_message`, `created_at`/`updated_at` (with an
existing `updated_at` trigger), `ended_at`. That's already everything the webhook needs to write.
No new `bot_id`/sentiment/pending-transcript-equivalent columns required — those exist on
`walkthrough_state` because B2C needs them for mechanisms (live-conductor polling,
sentiment-driven script adaptation) that have no partner-session equivalent, per Constraint 3
below.

**3. `bot.state_change` → `joined_recording`: no DB write needed, unlike B2C.**

B2C's handler persists `bot_id` on `joined_recording` because that's the *only* place B2C's
`quality-evaluator` later fetches it from for transcript retrieval. For partner sessions,
`provider_bot_id` is already written at dispatch time (`dispatchMeetingBot()`,
`session-init.ts:65`) — before any webhook could possibly fire — and B2B-09's transcript
extraction (once approved) keys off Hume's own `chat_id`, captured client-side via
`PartnerRenderClient.tsx`'s `onConnect`, not off the Attendee bot id at all. So this event, for a
partner session, is confirmatory/observability-only: log it, no write required. State the
reasoning in the spec so a future reader doesn't wonder why this branch looks thinner than B2C's.

**4. `bot.state_change` → `ended`/`fatal_error`: this is where the real reconciliation question
lives, and it has a clean answer once you read the client-side path.**

`PartnerRenderClient.tsx`'s `endSessionOnce()` (fired on Hume's `end_session` tool call, on
component unmount, or on adapter disconnect — three call sites, deduped by `endedRef`) already
POSTs `/api/partner/render/end-session` with a **client-measured** `duration_minutes`
(`connectStartRef.current` to `Date.now()`). That route calls `handleSessionEnd()`
(`lib/partner/live-render.ts:196`), which is the single existing function that: sets
`partner_sessions.status = 'completed'` + `ended_at`, cancels the B2B-08 trial-cutoff job if
`test_mode`, and calls `recordBillableEvent()` for the real `usage.voice_minute` charge (which
also dispatches the partner-facing `session.completed` webhook — confirmed in
`webhook_dispatch_log`'s existing `CHECK` constraint, migration `071:238`). **This is the
authoritative, duration-accurate billing path today**, and it already works.

The Attendee `ended`/`fatal_error` webhook event fires independently of that client-side call —
Attendee doesn't know or care whether `PartnerRenderClient.tsx` successfully reported itself. Both
paths *can* fire for the same session (normal end: client-side fires reliably; abnormal end —
tab/process killed inside the headless Chromium before the `fetch` completes, network blip,
`fatal_error`: client-side may never fire at all).

Resolution, matching the "whichever fires first wins, idempotent" option named in the dispatching
task: the webhook path becomes a **fallback safety net**, not a second source of truth.
- On `ended`/`fatal_error`, re-fetch the `partner_sessions` row (already have it from the
  correlation lookup). If `status` is already `completed` or `failed` — the client-side path won,
  do nothing (this is the common case; log it as confirmation, don't touch billing).
- If `status` is still `bot_active` — the client-side path never landed. Call the **same**
  `handleSessionEnd()` the client-side route calls (no new billing logic, full reuse), computing
  `duration_minutes` from `(now() − partner_sessions.updated_at)` as the best available
  approximation, since `updated_at` reflects the last state transition (`bot_active`, written at
  dispatch time by `dispatchMeetingBot()`) and no more precise client-measured value exists once
  the client itself is presumed gone. This is a fallback-only approximation for what should be a
  rare path — document it as such, not as a precision guarantee.
- `fatal_error` should still bill for minutes actually used (parity with how `ended` is already
  billed) but should land as `status = 'failed'`, not `'completed'`, for support/observability
  accuracy — `handleSessionEnd()` currently hardcodes `'completed'`. BA should decide the cleanest
  implementation shape (extend `handleSessionEnd()` with an optional target-status parameter,
  default `'completed'`, vs. a thin wrapper that patches status after calling it) — this is a
  technical implementation choice, not a product question, left to the spec/dev stage.

**5. `transcript.update`: explicitly out of scope for partner sessions — not a gap, a boundary.**

B2C's `transcript.update` handler runs `analyzeTranscription()` and writes to
`user_session_context` (sentiment history, deferred/unresolved questions) — none of which exists
for partner sessions, and building equivalents would mean persisting partner end-user transcript
content in Clio's own database. That directly conflicts with `CORE_OBJECTIVES.md`'s Non-Negotiable
Data Boundary (approved this week as part of B2B-01) and is the same tension B2B-09 is already
sitting on an open escalation about, for the *content-extraction* use case specifically. This
brief does not reopen that question — it simply confirms the boundary holds here too: for a
partner session, `transcript.update` should be a no-op (log at most, matching the file's existing
"not forwarded" comment style for the B2C case), full stop. Sentiment/deferred-question tracking
for partner end users, if ever wanted, is a product decision for a future brief, not something to
build speculatively into this one.

**6. `participant_events.join_leave`: the one genuine product-shape + feasibility question. Named,
not guessed.**

B2C's handler writes a greeting (`Hi ${firstName}, welcome! Arun and I were just covering
"${topicTitle}".`) into `walkthrough_state.pending_transcript`, which `WalkthroughClient.tsx`
polls and forwards into the live Hume session. Two things stop this from being a copy-paste reuse
for partner sessions:

- **Product**: a partner's own branding/tone may not want "Arun and I" phrasing, or may not want
  any Clio-authored greeting at all — this is exactly the kind of role/context-appropriate-copy
  call Product Principle #3 exists for, and it's a real content decision, not a mechanical one.
- **Technical**: even setting the copy question aside, there is currently no delivery mechanism.
  `PartnerRenderClient.tsx` has no `pending_transcript`-equivalent polling loop — its own code
  comment (`PartnerRenderClient.tsx:148-152`) says explicitly that no partner-session equivalent of
  B2C's live-conductor forwarding exists yet. Building one would be new work, not the "reuse what's
  already proven" scope Arun asked for.

Recommendation, not a decision: build the literal minimum now — the event fires, gets routed to
the correct `partner_sessions` row, gets logged — and take no action (no greeting, no DB write).
Flag "should partner sessions get a join greeting, and if so what should it say and how would it
reach a live Hume session" as a named follow-on question for Arun, not bundled into this brief's
approved scope. This keeps the brief's actual deliverable (correlation + the two event types that
have clean, already-proven answers) unblocked.

---

## Questions for BA

None block dispatch — this brief has a fully worked technical design (see Grounding above). Two
items the BA spec should carry forward exactly as scoped, not reopen:

1. Section 11 must record the `participant_events.join_leave` no-op-for-now decision and its two
   named reasons (product-copy, no delivery mechanism) as an explicit deferred item for Arun —
   not as an unanswered open question blocking this spec. This brief's own scope is complete
   without it.
2. The `handleSessionEnd()` status-parameter question (Grounding item 4, last bullet) is a
   technical implementation choice for the spec/dev stage — BA should pick one approach and
   document it in the spec's API/data section rather than escalating it.

## Files the BA Should Ground the Spec Against

- `app/api/attendee/webhook/route.ts` — the file being extended; existing `handleEvent()`,
  `AttendeeWebhookEvent` type, and the three `switch` branches.
- `lib/partner/session-init.ts` — `dispatchMeetingBot()`, confirms the `userId`-slot correlation
  mechanism, no changes needed here.
- `lib/meeting-bot/attendee.ts` — `createBotBrowserMode()`, confirms `metadata: { user_id }` is
  what Attendee echoes back in webhook events.
- `lib/partner/live-render.ts` — `getPartnerSession()`, `handleSessionEnd()` (the function to
  reuse for the fallback-completion path).
- `app/api/partner/render/end-session/route.ts` and
  `app/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`'s `endSessionOnce()` — the
  existing client-side path this brief's webhook fallback must not conflict with or double-bill
  against.
- `supabase/migrations/071_b2b02_partner_accounts_and_api_keys.sql:174-214` — `partner_sessions`
  schema (no changes required, confirmed sufficient).
- `docs/specs/B2B-09-requirement-document.md` §10 (Out of Scope) — confirms the Attendee webhook
  signature bypass and this brief's scope are both explicitly outside B2B-09, and that B2B-09's
  concern (Hume conversation-content extraction) doesn't overlap with this brief's (Attendee
  bot/meeting mechanics).

## Success Criteria for the BA Spec

- Section 11 (Open Questions) empty.
- Explicit wire-level description of the new `handlePartnerSessionEvent()` branch (or equivalent),
  covering all three event types with the exact DB reads/writes (or explicit no-ops) as resolved
  above.
- Explicit statement, verified against the actual code (not assumed), that the existing B2C branch
  of `handleEvent()` is unmodified — same fields, same order, same fallback behavior.
- Test plan covering: B2C event unaffected (regression), partner event correctly correlated via
  `bot_metadata.user_id` → `partner_sessions.id`, `ended` webhook as a no-op when client-side
  already completed the session, `ended` webhook as the fallback completer when it didn't,
  `fatal_error` billing + status='failed', `transcript.update` no-op, `participant_events.join_leave`
  no-op (correlated + logged, no action taken).
