# Feature Brief: HUME-NATIVE-01 — Hume-Native LLM Live Session Architecture

**From:** CEO (Arun) · **To:** Business Analyst Agent · **Priority:** P1 · **Date:** 2026-07-04
**Toggle-gated. Default OFF. Falls back to the current Custom-LLM-bridge architecture (LIVE-01).
Trial-and-decide: this is explicitly a test Arun will evaluate before committing to it.**

## What Arun said

Trial a fundamentally different way of running the live coaching session's brain. Today, Attendee.dev
(the meeting bot, already live in production) pairs with Hume EVI configured in **Custom Language
Model (CLM)** mode — Hume handles transport/STT/TTS only, while our own Claude-powered bridge
(`app/api/clio/chat/completions/route.ts`, built under LIVE-01) makes every turn-by-turn decision:
what to say next, when to advance a tab, when to end the call.

Arun wants to try the opposite model: switch Hume's Config from Custom LLM to **Hume's own native/
supplemental LLM** (e.g. Claude or GPT selected inside Hume's own config, not routed through our
bridge), and give it **one detailed prompt upfront, before the call starts**. From that point, Hume
runs the entire conversation on its own — no per-turn steering from our code at all.

This is an explicit trial, not a committed migration. Objective: build it safely behind a toggle, run
a real test call, and decide afterward whether to continue with Hume-native or stay on the current
Custom-LLM-bridge (LIVE-01) approach. Per Arun's explicit instruction during the brainstorm: nothing
in this spec should fall back to or route around Attendee+Hume — Recall.ai and ElevenLabs are out of
scope entirely (see "Explicitly out of scope" below).

## The problem being solved

The current Custom-LLM-bridge approach (LIVE-01) requires our own code to steer every turn: deciding
what content to surface, watching for stuck tabs, forcing advances, detecting session-end phrases.
This is powerful but effortful to build and maintain, and every new capability (visualization timing,
silence handling, session-end detection) has had to be hand-built and debugged inside our bridge
(see the multiple LIVE-01 follow-up fixes already shipped: silence/no-response handling, visual retry
logic, fallback text cleanup).

Arun wants to know whether handing the entire conversation to Hume's own LLM — with a single, well-
constructed upfront prompt carrying full context, full user profile, full detected intent, and the
session content — produces a comparably good (or better) live coaching experience with less
turn-by-turn engineering on our side. This can only be answered by building the toggle-gated path and
running a live test call; it cannot be decided from documentation alone (two explicit unknowns below).

## What success looks like

- A toggle exists that, when ON, runs a live session entirely through Attendee+Hume with Hume's
  Language Model set to native/supplemental mode, carrying one upfront prompt assembled from a
  mostly-static template plus per-session context and content — no per-turn message steering from our
  code during the call.
- The prompt template is a real, versioned artifact: >80% fixed (behavior rules, tone, structure), with
  bracketed placeholder tags (e.g. `[CONTEXT]`, `[SESSION CONTENT]`) marking the per-session variable
  portions, so assembling a session's prompt is a find-and-replace operation, not a rebuild.
- The `[CONTEXT]` placeholder carries the **full** existing user profile (via the existing
  `buildProfileContextForClio()` serializer) and the **full** existing detected intent (from
  `ice-breaker-analyzer.ts` / `user_learning_profiles`) — no trimming, no new data collection.
- For scheduled sessions, the prompt can be assembled and pushed to Hume's Config API ahead of the
  meeting time, not only at call-start.
- Our own system (not Hume) watches the live transcript stream and independently decides when to
  switch visuals — a few seconds of slack either way is acceptable, but this tracking must add zero
  perceptible lag to Hume's responsiveness.
- After a session ends, a batch/cron job pulls the full transcript from Hume's Chat History API
  (`GET /v0/evi/chats/{id}/events`) in one call, and Claude extracts action items and any glitches from
  it. This does not need to be real-time.
- At the moment our system decides to switch away from a visual, it captures a snapshot of the visual
  being retired. At session end, all snapshots from that session are compiled into a single PDF and
  emailed to the user.
- Toggle OFF (default) leaves the current LIVE-01 Custom-LLM-bridge architecture and today's production
  Attendee+Hume setup completely unaffected.
- At the end of a live test call, Arun has clear, first-hand evidence on the two open unknowns below —
  enough to decide continue-with-Hume-native vs. revert-to-Custom-LLM-bridge.

## Known constraints (non-negotiable, confirmed by Arun across the full brainstorm)

1. **DB write load is a non-issue — nothing to build here.** Confirmed safe at 100+ concurrent
   sessions on the current Supabase tier (`hello-clio`, Postgres 17.6, `max_connections: 60`). This
   point exists in the brief only to confirm no architectural blocker exists; it does not translate
   into a feature requirement.
2. **Post-session-only action items and glitches — never live/real-time.** Pull the full transcript
   from Hume's Chat History API once a session ends; batch/cron across all of a day's sessions is
   explicitly acceptable. Claude reads the transcript and extracts action items + glitches. This is a
   net-new capability today — no utterance from a Hume-native session is currently persisted anywhere.
   Requires capturing and storing `chat_id` on the `sessions` table (currently not captured; the value
   is already available in the existing `onConnect` callback).
3. **Prompt architecture — mostly-static template, upfront only, no mid-call injection.**
   - Behavior rules, tone, and structure are fixed (>80% of the template).
   - Only `[CONTEXT]` (full user profile + full detected intent) and `[SESSION CONTENT]` (whole-topic
     background + per-tab content, matching what's already generated under LIVE-01) vary per session.
   - The whole prompt is provisioned as a **Hume Config** via Hume's REST API
     (`POST /v0/evi/configs` / `.../configs/{id}/versions`), with the Config's Language Model switched
     off Custom onto Hume's native/supplemental option. This is a mode switch, not an addition — the
     Custom-LLM bridge is not in the loop for a Hume-native call at all.
   - Scheduled sessions may have their prompt assembled and pushed to Hume ahead of the meeting time,
     not only at call-start.
   - **Size discipline:** push the prompt at normal/current full size first (behavior rules + full
     context + full profile + full session content combined) as the real test. If Hume accepts it, that
     becomes the standing size ceiling going forward. Only trim if Hume actually rejects or visibly
     struggles with it — do not pre-emptively shrink content in anticipation of a limit that has not
     been confirmed to exist.
   - Nothing is sent to Hume again once the call is running — everything is upfront, by design. Mid-call
     injection is explicitly out of scope (see below), not an open question to resolve.
4. **Visualization — our own system decides transitions; Hume does not self-report.**
   - Our system watches Hume's live transcript stream and independently judges when Clio is wrapping up
     a section, then triggers the next visual — the same tool-call wire protocol already implemented in
     `hume-adapter.ts` for `show_visual`/`advance_tab`/`end_session` carries over; only which side
     initiates it changes (Hume's own reasoning invokes the tool, not our bridge deciding for it).
   - A few seconds of timing slack either way is acceptable.
   - **Non-negotiable:** none of this tracking may add lag or slow down Hume's responsiveness. Clio must
     stay fast and natural regardless of what's happening in the background.
   - **New requirement — visualization PDF export:** at the exact moment our system decides to move off
     a visual, capture a snapshot of it. At session end, compile that session's snapshots into a single
     PDF and email it to the user. Capture method, storage location, PDF assembly approach, and email
     delivery mechanism (likely reusing the existing Resend integration) must all be fully documented in
     the BA spec — this is a net-new requirement with no prior implementation to reference.
5. **User profile + detected intent — full injection, wiring only, no new modeling.**
   - `user_learning_profiles` already holds the relevant fields (`businessFocusLens`, `reasoningStyle`,
     `abstractionComfort`, `questionDepthPattern`, `learningMotivation`, `riskTolerance`,
     `vocabFingerprint`, `perDomainGaps`, `perDomainInterests`, `profileSummary`, `crossDomainBridges`,
     `profileConfidence`), already serialized for exactly this purpose by
     `buildProfileContextForClio()`.
   - Intent detection already runs and already persists via `inngest/ice-breaker-analyzer.ts`
     (`learning_intent`, `knowledge_level`, `organizational_context`, `urgency`, `primary_driver`),
     written into `user_learning_profiles` plus a `session_insights` row.
   - Use the full, untrimmed version of both in the `[CONTEXT]` placeholder. Same size-testing
     discipline as point 3: full size first, trim only if Hume struggles.
6. **Scope is Attendee + Hume only — this is confirmed production, not a side trial.** Two existing,
   independent toggles are already in place: `MEETING_BOT_PROVIDER` (`attendee`) and
   `NEXT_PUBLIC_VOICE_PROVIDER` (`hume`) — Arun has confirmed these are the actual live production
   configuration today, not a dormant/untested path. Recall.ai and ElevenLabs code paths remain
   dormant and untouched; do not delete them, do not route any part of this feature through them, and
   do not propose them as a fallback anywhere in the spec.
7. **Rollout — toggle-gated, additive, isolated.** The existing `MEETING_BOT_PROVIDER`/
   `NEXT_PUBLIC_VOICE_PROVIDER` toggles only ever switch the audio/transport vendor — the CLM brain
   stays in charge either way today, and switching those toggles alone does **not** achieve Hume-native
   mode. This feature needs its **own** toggle (naming convention to match `NEXT_PUBLIC_LIVE_CONDUCTOR_
   ENABLED` from LIVE-01) that governs whether a session's Hume Config is provisioned in native/
   supplemental mode versus today's Custom-LLM-bridge mode. Default OFF. Toggle OFF must leave the
   current LIVE-01 architecture and today's production behavior fully intact — per the LIVE-01
   precedent, build genuine isolation (new module(s), invoked conditionally), not an inline if/else
   sharing refs and duplicated logic blocks with the existing path.

## Two explicitly flagged technical unknowns — the BA spec (and/or an early build phase) MUST include
a validation step for these, not assume an answer

1. **Does Hume accept the full prompt at normal/production size?** (behavior rules + full context +
   full profile + full session content combined in one upfront Config). No documented limit exists in
   Hume's docs; this is only resolvable by a live test call. The spec must define what "accept" means
   (e.g. does the Config save successfully, does the call actually start, does quality degrade) and
   what the fallback/trim path looks like if it fails.
2. **Does Hume's own LLM reliably fire the visualization tool calls it's instructed to make, with no
   per-turn steering from our side?** Tool-calling is confirmed to work identically in both CLM and
   supplemental-LLM modes at the wire-protocol level, but whether Hume's own reasoning actually invokes
   `show_visual`/`advance_tab`-equivalent tools appropriately, unprompted per-turn, is unverified. The
   spec must define what a pass/fail test call looks like and what happens if tool calls are unreliable
   (e.g. does the feature stay toggle-gated indefinitely, is there a lighter-weight nudge mechanism
   worth exploring in a later spec).

Both of these should likely be framed as an early validation/spike phase within the build sequence —
build the minimum plumbing needed to run one real test call, run it, get a clear answer, and only then
proceed to the full build (or stop, per Arun's explicit "we give up if absolutely no way to make this
work" instruction from the brainstorm).

## Non-negotiable constraints (standing project rules, carried forward)

- **Must not impact any already-working functionality.** Topic selection, LLM topic/curriculum
  generation, the existing LIVE-01 Custom-LLM-bridge path, the old script + template rendering
  pipeline, billing, and any other part of the product not named in this brief must be untouched.
- **No existing code deleted without explicit approval.** Recall.ai and ElevenLabs code paths are
  dormant, not to be removed as part of this work (per standing memory: "No impact on existing, no
  delete without approval").
- **Must not regress the current Attendee+Hume production setup** while this is being built. Follow
  the LIVE-01 precedent: toggle-gated, default OFF, isolated module(s) — not an inline branch sharing
  state with the existing path — so the new native-LLM path can be tested without disrupting what the
  app relies on today.
- **Spec before build, no exceptions.** No code is written until this Feature Brief is turned into a
  full BA requirement document (all 12 sections, zero open questions) and CEO-approved.

## Explicitly out of scope for this first spec

- Any new user profile fields or new data collection — the brainstorm confirmed existing profile and
  intent data is sufficient; do not invent additions.
- Any mid-call context injection mechanism. The brainstorm resolved this as moot — everything goes to
  Hume once, upfront, by design. Whether Hume technically supports mid-call injection is not something
  this spec should investigate or build against.
- Any change to Recall.ai or ElevenLabs code, infrastructure, or removal work. Per Arun: "that's already
  done," not something this spec should touch.
- The stuck-tab/backstop forced-advance logic that exists in the current bridge
  (`live-conductor-bridge.ts`, `NUDGE_AT_TURN`/`FORCE_AT_TURN`) — this does not carry over automatically
  to Hume-native mode and is explicitly not being rebuilt in this pass; our own transcript-watching
  visualization logic (constraint 4 above) is the replacement mechanism, not a forced-advance backstop.
- A final go/no-go decision on continuing with Hume-native vs. reverting — that is Arun's decision to
  make after the live test call, not something this spec should predetermine.

## Files likely involved (for BA/engineering reference — not exhaustive, BA to confirm)

- `lib/voice/hume-adapter.ts` — tool-call wiring, Config connection, `chat_id` capture from `onConnect`
- New: Hume Config provisioning code (REST API — `POST /v0/evi/configs` / `.../configs/{id}/versions`,
  switching Language Model off Custom) — a GET against this API already works via an existing debug
  endpoint, confirming feasibility of the write path
- New: prompt-template assembly module (mostly-static template + `[CONTEXT]`/`[SESSION CONTENT]`
  placeholder replacement), reusing `buildProfileContextForClio()` and existing `buildAllClioDocs`
  context-assembly logic
- New: transcript-watching visualization-transition module (our own live monitoring, replacing
  Hume-self-report reliance)
- New: post-session transcript fetch + action-item/glitch extraction job (likely Inngest, pulling from
  Hume's Chat History API `GET /v0/evi/chats/{id}/events`)
- New: visualization snapshot capture + end-of-session PDF assembly + email delivery (likely reusing
  Resend, per existing email infrastructure)
- `app/dashboard/walkthrough/WalkthroughClient.tsx` — toggle wiring, isolated from existing LIVE-01
  branch per the isolation requirement above
- `sessions` table — new column for `chat_id`
- Existing (untouched, dormant): `lib/meeting-bot/recall.ts`, `lib/recall.ts`, `app/api/recall/*`,
  `lib/voice/elevenlabs-adapter.ts`, `lib/voice/relay-handler.ts`

## Questions for BA

1. Define the exact toggle name/scope and where in the request path it branches (must mirror the
   LIVE-01 isolation precedent — branch above content/Config generation, in its own module).
2. Define the validation/spike phase precisely: what constitutes pass/fail for each of the two flagged
   unknowns, and what the spec requires to happen in each failure case.
3. Define the prompt template's exact structure, placeholder tag list, and versioning/storage location.
4. Define the visualization snapshot capture mechanism (what triggers a snapshot, what format, where
   stored) and the PDF assembly + email trigger point (session-end event, delivery timing).
5. Define the schema/migration for storing `chat_id` on `sessions`, and the post-session transcript-pull
   job's trigger (webhook-driven at session end vs. cron/batch) and retry/failure behavior.
6. Define acceptance tests and edge cases per the standard 12-section format (e.g. Hume Config
   provisioning failure, prompt rejected for size, tool calls not firing, session ending with the
   toggle mid-flip, scheduled session whose Config push fails ahead of time).
