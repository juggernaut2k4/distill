# Brainstorm: Attendee + Hume-Native Live Session Architecture

**Status:** Investigation only. Nothing built. No spec approved yet. This document exists to
capture the full Q&A trail so the brainstorm can continue and be finalized later, per Arun's
explicit "spec before build" standing rule — no code changes have been made as part of any of
this.

**Date:** 2026-07-04

**Context:** Arun is exploring a pivot away from today's production stack (Recall.ai for the
meeting bot + ElevenLabs for voice, with our own Claude bridge as the CLM brain) toward a new
stack: **Attendee.dev (meeting bot) + Hume EVI running its own native/supplemental LLM** from a
single detailed upfront prompt, rather than our turn-by-turn custom-LLM bridge. Objective is to
trial this and decide whether to continue with it or fall back to the known-working Recall+
ElevenLabs stack. Per Arun's explicit instruction: while investigating this specific
architecture, no solution should recommend or default back to Recall/ElevenLabs — if something
is genuinely not possible in Attendee+Hume, that should be stated plainly, not routed around.

---

## Final Decision Summary (2026-07-04) — ready for BA spec

Everything below is confirmed with Arun across all 7 discussion items. This is the clean version
to hand to the BA for spec-writing. Detailed reasoning/history for each point is in the sections
further down.

1. **DB write load (item 1):** Not a concern. Confirmed safe at 100+ concurrent sessions.
2. **When we fetch action items/glitches (items 1b & 2):** After the session ends, not live. Pull
   the full transcript from Hume in one clean call once the call finishes; a nightly batch across
   all sessions is also fine. Have Claude read it and extract action items + glitches. Not yet
   spec'd or built.
3. **How Hume runs the session (item 3):** Give Hume one detailed prompt upfront, before the call
   starts. Hume then runs the entire conversation on its own — no per-turn steering from us.
   - Prompt is a **mostly-static template (>80% fixed)**; only **context** and **session content**
     change per session.
   - Template uses **bracketed placeholder tags** (e.g. `[CONTEXT]`, `[SESSION CONTENT]`) for easy
     find-and-replace when assembling each session's prompt.
   - **Size testing:** push our current/normal content size first as a real test; if Hume accepts
     it, that becomes the standing ceiling; only trim if it actually fails.
   - Scheduled sessions can have their prompt prepared and pushed to Hume ahead of time, not just
     at call-start.
4. **Visualization — how and when we switch visuals (item 4):**
   - We (our own system) watch Hume's live transcript stream and decide ourselves when Clio is
     wrapping up a section, then trigger the next visual. We do **not** rely on Hume announcing
     its own progress.
   - A few seconds of timing slack either way is acceptable.
   - **Non-negotiable:** none of this tracking may add lag or slow down Clio's responsiveness.
   - **New requirement — visualization PDF export:** the moment we decide to move to the next
     visual, save a snapshot of the current one; at session end, combine all snapshots into one
     PDF and email it to the user. Not yet spec'd or built.
5. **User profile + intent in the prompt (item 5):** Use the **full existing profile and detected
   intent** (no trimming) in the `[CONTEXT]` placeholder. This data already exists per user today
   — purely a wiring job, not new data collection. Same size-testing approach as point 3.
6/7. **Attendee + Hume only (items 6/7):** Already the live production setup — Recall/ElevenLabs
   are not in use. What's still needed to realize points 3-5 above: switch Hume's config from
   Custom LLM to Hume's own native/supplemental LLM, and build the prompt-assembly + transcript
   + visualization pieces described above.

**Two genuinely open technical unknowns, resolvable only by an actual test call — not by more
reading or discussion:**
- Does Hume accept a prompt at our normal/full size (behavior + context + full profile + full
  session content combined)?
- Does Hume's own LLM reliably call the visualization tools it's instructed to call, with no
  per-turn steering from us to keep it on track?

**Status:** Brainstorm complete on all 7 items. Nothing built. Per the standing rule, next step is
a written spec (BA), reviewed and approved, before any code is touched.

---

## Q1 — Real-time DB write-load for persisting every conversational line

**Arun's question:** "but the question is if we do save every line in realtime will it impact
our performance? if 100 sessions goes through will it impact our ability to write in db?"

**Answer:** Non-issue at 100 concurrent sessions.
- Realistic volume: ~20-40 utterances per 15-min session → roughly 1 insert every 25-45 seconds
  per session.
- At 100 concurrent sessions: worst-case burst ~100 writes in a single second if perfectly
  synchronized; realistic sustained rate ~2-3 writes/sec.
- Checked actual infra: Supabase project `hello-clio` (`nqxlpcshouboplhnuvrh`) runs Postgres 17.6,
  `max_connections: 60` — an entry-level tier that already handles far more write pressure than
  this today via `walkthrough_state` (polled every 1s for the whole session, plus dozens of
  server-side UPDATEs per session for nav/visual/tab transitions on a single row).
- Batching (buffer + flush every N seconds) was considered but rejected as unnecessary complexity
  at this scale — real per-line inserts are simpler and safe. Batching would only be worth
  revisiting if session volume grew 10-50x past 100 concurrent, or if rows carried heavy payloads
  instead of plain text.
- Important correction made at this point in the conversation: no utterance is persisted
  anywhere today — `hume-adapter.ts` only fires an in-memory callback for console logging/nav
  parsing, then discards it. Real-time persistence would be new capability, not a change to an
  existing bottleneck.

---

## Q2 — Simplification: post-session-only transcript access is sufficient

**Arun's statement/question:** "for me i m ok to fetch the action items after the session. action
items can even be fetched for all the conversations through a cron job so for me its not
something i want in realtime if we can read the transcript later."

**Answer:** This removes the need for real-time capture entirely. Investigated whether a
post-session transcript could just be pulled via API instead of streamed live. Found:
- **Important correction discovered here:** the live Google Meet coaching sessions run on
  **ElevenLabs**, not Hume — Hume is a separate, unrelated voice path elsewhere in the app. So the
  original Hume `assistant_message` discovery applied to a different part of the product.
- Both Recall webhook handlers (`app/api/recall/webhook/route.ts`,
  `app/api/attendee/webhook/route.ts`) already receive Clio's own spoken lines from Recall's live
  transcript — proven because the code explicitly filters out `speaker.includes('clio')`.
- Simplest path recommended at the time: un-filter the existing webhook, write both speakers'
  turns to a new `transcript_lines` table, run a nightly cron job to extract action items. This
  recommendation was **superseded by Arun's next message**, which clarified he wants to move off
  Recall/ElevenLabs entirely (see Q6-Q7 below).

---

## Q3 — Can a detailed prompt be generated and pushed to Hume so Hume runs the whole call?

**Arun's question:** "when user session starts - if user enters google meeting and launch session
then this detailed prompt should be generated then pushed to hume ai and let hume ai do the rest
after joining the call. if scheduled then this prompt can be sent before the meeting so hume ai
joins on time with the content and runs the session. is it possible?"

**Answer (revised after Arun's correction below):** Feasible — what looked like a blocker is
actually confirming evidence for the native-LLM approach, not an obstacle to it.
- **Central fact:** Clio's live Hume path today is wired as a **Custom Language Model (CLM)** —
  Hume's EVI config's Language Model is set to Custom, pointing at our own Claude bridge
  (`/api/clio/chat/completions`). Hume is transport/STT/TTS only; our code is the brain. This is
  true for Hume just as it is for ElevenLabs today.
- Hume's actual mechanism for a system prompt is **not** a live socket message sent at connect
  time — it's a **Config-level resource** (`POST /v0/evi/configs` / `.../configs/{id}/versions`),
  set up in advance, then referenced by `config_id` when the bot connects.
- **Originally mis-framed as a blocker:** `lib/voice/hume-adapter.ts:273-280` documents that Hume
  rejects `session_settings.system_prompt` over the socket with error E0716 — but the code comment
  itself scopes this precisely: *"whenever a custom LLM is configured — **which this app always
  uses for Hume**."* That second clause is the tell: this is a consequence of our specific
  Custom-LLM setup, not a general Hume restriction.
- **Arun's correction, confirmed correct:** this ties directly to the earlier documented incident
  ([[project_live01_night_session_2026_07_03_04]]) where Hume rejected a tools + custom-LLM combo,
  fixed by clearing both manually in Hume's dashboard. Same root pattern both times: Custom LLM
  mode is the trigger, not "Hume" as a platform. Switching the config's Language Model to Hume's
  own native/supplemental LLM removes the precondition both restrictions are keyed on — so
  `system_prompt` injection should work normally in native mode, and this is no longer a blocker
  for the approach Arun wants, it's supporting evidence for why native mode is the right call.
- **Caveat, not yet fully closed:** whether tool configs specifically are unrestricted under native
  mode (as opposed to just system_prompt injection) is an inference from the Custom-LLM pattern,
  not something confirmed against Hume's own docs (no live Hume doc fetch has been done, and the
  codebase has no comment describing native-mode tool behavior). Needs a direct doc check or a
  live test before being treated as fully proven.
- Getting "Hume runs the whole call on its own LLM from one upfront prompt" requires switching the
  Language Model from Custom → Hume's own native/supplemental LLM option (e.g. Claude/GPT selected
  inside Hume's config) — a mode switch, not an addition. The CLM route would no longer be in the
  loop for that call at all.
- For scheduled sessions: "sending in advance" is a real, meaningful action in this model — a REST
  write to Hume's Config API before the meeting, not just "have it ready in our DB."
- Bot/meeting plumbing (Attendee/Recall wiring) is unaffected either way — this is entirely a
  config + adapter-behavior change.

---

## Q4 — How would visualization be built and streamed if Hume runs the conversation?

**Arun's question:** "if above is good, then tell me how will you build your visualization and
stream it? do you need any visualization built and stream that image when the trigger comes?"

**Answer:** Feasible, and tool-calling is the right mechanism — not trigger-word parsing.
- Hume's tool-calling is confirmed to work identically in both CLM and supplemental-LLM modes —
  same `tool_call`/`tool_response` WebSocket pattern already implemented in `hume-adapter.ts` and
  already used for `advance_tab`/`show_visual`/`end_session` today.
- This means switching to Hume's native LLM does **not** require inventing a new
  visualization-trigger mechanism — the existing tool-call wire protocol carries over; it would
  just be Hume's own reasoning invoking the tool instead of our CLM bridge deciding it.
- Latency is unchanged by this pivot: visual generation retries up to ~40s worst case today
  (`live-conductor-visual.ts`), a property of the generation call itself, not of which LLM drives
  the conversation.
- **Real gap identified:** today's stuck-tab backstop (force-advance after N turns without a tool
  call) lives entirely in our own bridge code (`live-conductor-bridge.ts`, `NUDGE_AT_TURN`/
  `FORCE_AT_TURN`). If Hume's own LLM runs the show, this backstop disappears unless deliberately
  rebuilt as tool-response-side server logic — it does not carry over automatically.

---

## Q5 — Injecting user profile and detected intent into the upfront prompt

**Arun's question:** "when generating the prompt we should be very mindful and due diligent in
sending the user profile and specifically should instruct hume to give examples and talk based on
the user profile. we also analyze the user intent during the call right and that will become a
user profile and that specific intent also should be sent to hume so hume understand that clio
needs to answer those aspects first while explaining things."

**Answer:** Yes — the data already exists; this is a wiring job, not new modeling.
- `user_learning_profiles` (`lib/learning/user-profile.ts`) already has the relevant fields:
  `businessFocusLens`, `reasoningStyle`, `abstractionComfort`, `questionDepthPattern`,
  `learningMotivation`, `riskTolerance`, `vocabFingerprint`, `perDomainGaps`,
  `perDomainInterests`, `profileSummary`, `crossDomainBridges`, `profileConfidence`.
- A purpose-built serializer already exists for exactly this: `buildProfileContextForClio()`
  (built specifically for injecting into Clio's live prompt).
- Intent detection from live calls already exists and is already persisted, not transient:
  `inngest/ice-breaker-analyzer.ts` extracts `learning_intent`, `knowledge_level`,
  `organizational_context`, `urgency`, `primary_driver` from the transcript and writes it into
  `user_learning_profiles.business_focus_lens` / `.learning_motivation`, plus a `session_insights`
  row with `extracted_signals`.
- **Real, unresolved unknown:** neither Hume's system-prompt nor CLM docs disclose a hard
  character/token limit for the Config `system_prompt`. Our existing session context alone already
  runs to ~41k chars sent to Claude — combining behavior rules + content + profile + intent into
  ONE Hume Config prompt could land in a similar or larger range, and this has never been tested
  against Hume's actual limit.

**Overall verdict after Q3-Q5:** not spec-ready yet. Recommended a small technical spike first
(one test Hume Config with the mode switched to native/supplemental LLM, carrying a large
synthetic prompt, plus a live tool-call round-trip test) before BA writes a full requirement doc.

---

## Decision — prompt template structure and size testing (2026-07-04)

Confirmed with Arun, in plain terms:
- The upfront prompt is a **mostly-static template (>80% fixed)** — behavior rules, tone,
  structure. Only the **context** and **session content** portions change per user/session.
- The template uses **placeholder tags in brackets** (e.g. `[CONTEXT]`, `[SESSION CONTENT]`)
  marking exactly where to drop in the per-session content — makes assembly a simple
  find-and-replace rather than rebuilding the prompt from scratch each time.
- **Size testing approach:** push our normal/current content size first, with no upfront
  trimming. If Hume accepts it without issue, that becomes the standard size going forward
  (a ceiling we then generate content to match every time). Only if it fails or struggles do we
  trim down and find the real ceiling from there.

## Decision — user profile + intent in the prompt (2026-07-04)

Confirmed with Arun: use the **full existing user profile and detected intent**, not a trimmed
version, dropped into the `[CONTEXT]` placeholder from the template decision above. This data
already exists per user today — no new collection needed, just wiring it into the new template.
Same size-testing approach applies: test at full/normal size first, trim only if Hume actually
struggles with it.

---

## Q6/Q7 — Attendee + Hume ONLY: inventory, toggle feasibility, punch list, transcript fetching

**Arun's clarification and instruction:** "now you are confusing me. I want to use hume and not
elevenlabs. we are trying out a solution with attendee and hume only, we need a toggle and should
perform only with it. recall and elevenlabs should be turned off... i want to try the solution and
decide if we need to continue with attendee or switch it back to recall and elevenlabs... for any
features dont use elevenlabs or recall, show me the solutions for fetching the transcript only
using hume or attendee... dont recommend me solution again with recall or elevenlabs... our
objective is to find how to make this work and we give up if absolutely no way to make this work."

His four questions, verbatim:
1. What areas do we still use recall and elevenlabs?
2. If yes, we need to turn them off for this solution with attendee and hume to work.
3. The hume solution should use hume native llm and follow the prompt structure we discussed. Can
   we do that with the toggle or not?
4. For any features don't use elevenlabs or recall — show solutions for fetching the transcript
   only using hume or attendee.
(A fifth statement — "i want to try the solution and decide if we need to continue with attendee
or switch back" — is intent, not a technical question, and informed how the punch-list answer was
framed.)

**Answer:**

**1. Inventory.** Two independent, already-built toggles:
- `MEETING_BOT_PROVIDER` (`recall` default / `attendee` / `agentcall`) in `lib/meeting-bot/
  provider.ts`.
- `NEXT_PUBLIC_VOICE_PROVIDER` (`elevenlabs` default / `hume`).
Recall-specific code (`lib/meeting-bot/recall.ts`, `lib/recall.ts`, `app/api/recall/*`) and
ElevenLabs-specific code (`lib/voice/elevenlabs-adapter.ts`) are both simply not called when the
toggles are set to `attendee`/`hume` — dormant, not requiring deletion. One genuine gap: Attendee's
**relay** audio mode (`lib/voice/relay-handler.ts`) is 100% ElevenLabs-hardcoded and has no Hume
equivalent — only Attendee's **browser** mode (loading `WalkthroughClient.tsx` in headless
Chromium, which already has a real, non-stub Hume branch) works with Hume today.
**Correction (Arun, next message):** the claim "Recall+ElevenLabs is what's live in production
right now" was **wrong**, and the mistake was methodological, not a guess that happened to be
off. The investigation read the `?? 'recall'` / `?? 'elevenlabs'` fallback defaults in
`lib/meeting-bot/provider.ts` and `WalkthroughClient.tsx`, and reported those code-level defaults
as if they described the deployed reality — without ever checking Vercel's actual configured env
var values. Arun confirmed he set `MEETING_BOT_PROVIDER=attendee` and
`NEXT_PUBLIC_VOICE_PROVIDER=hume` in production days prior and the app has been running that way
since. A follow-up attempt to independently verify the literal deployed values hit a hard wall:
the investigation sandbox redacts secret/env values at the byte level (confirmed by
`ANTHROPIC_API_KEY` coming back as an impossible empty string via `vercel env pull`) — so the
literal values could not be independently re-confirmed from within that environment, though
nothing contradicted Arun's account (Vercel var timestamps matched, no counter-evidence found).
**Standing correction for this document: treat Attendee+Hume as the actual current production
configuration, not a dormant/untested toggle** — the "never run together" framing below should be
read as "this investigation could not independently verify live behavior," not "this combination
is inactive."

**2. Turning Recall/ElevenLabs off.** Yes, achievable today via the two env toggles
(`MEETING_BOT_PROVIDER=attendee`, `NEXT_PUBLIC_VOICE_PROVIDER=hume`), no new code required for
this step alone. One caveat needing live verification, not just code-reading: Attendee's webhook
discards the participant transcript stream with an ElevenLabs-flavored comment/rationale; the
underlying behavior happens to also be correct for Hume (both hear audio directly via the same
browser tab's mic capture) but this is an accidental match, not a verified one.

**3. Hume-native LLM + prompt structure via the toggle.** No — this is a different axis than the
existing toggle covers (confirmed, consistent with Q3 above). The toggle only ever switches audio
vendor; the CLM brain stays in charge either way today. Achieving Hume-native-LLM mode needs:
   - New (small, low-risk) code to provision a Hume Config via their REST API, switching the
     Language Model off Custom onto a Hume-native option — proven feasible since a GET against
     this same API already works via an existing debug endpoint.
   - Mostly-reusable code to assemble the mega-prompt from `buildProfileContextForClio()` and the
     existing `buildAllClioDocs` context-assembly logic.
   - One real, unanswered question: once Hume owns the LLM, there is no CLM turn to intercept
     anymore — how (or whether) anything can be injected mid-call is unknown from docs and needs a
     live test.

**4. Minimal punch list to a first trial call**, in dependency order, risk flagged:
   1. Run Attendee+Hume with both toggles set; confirm audio actually flows both directions in a
      real Google Meet — untested combination, real risk.
   2. Write the Config-provisioning code (switch off Custom LLM).
   3. Assemble a first rough mega-prompt from existing functions; push it via step 2's code.
   4. **Unknown:** does Hume accept a prompt this large? No documented limit; first test call is
      the only way to find out.
   5. **Unknown:** does Hume's own LLM actually invoke `show_visual`/`advance_tab`-equivalent tool
      calls appropriately from just the upfront prompt, with no per-turn steering?
   6. **Unknown:** is there any mid-call injection mechanism at all in Hume-native mode, or does
      the trial have to run as one static prompt for the whole call?
   Steps 1-3 are known plumbing; steps 4-6 are the real unknowns that determine viability — the
   first test call should be treated as diagnostic, not a working demo.

**5. Transcript fetching using only Hume or Attendee.**
   - Hume's Chat History API (`GET /v0/evi/chats/{id}/events`) already works today (proven via an
     existing debug endpoint) and returns both `USER_MESSAGE` and `AGENT_MESSAGE` events with role
     + text, keyed by `chat_id`.
   - We do not currently store `chat_id` anywhere on `sessions` — small, well-defined gap (capture
     it in the existing `onConnect` callback which already receives it; add one column + one
     write).
   - Attendee does have its own live transcript webhook, but it's ASR-only and would not capture
     Clio's side at all once Hume is doing speech synthesis — it stitches together an incomplete
     picture and is the wrong source here.
   - **Recommendation:** use Hume's Chat History API as the single source of truth for
     post-session transcripts in this architecture. Needs: the `chat_id` capture gap closed, plus
     a server-side job (e.g. Inngest) that pulls the transcript once the session ends and feeds it
     into action-item extraction.

---

## Decision — how we detect Clio's live position in the content (2026-07-04)

Confirmed with Arun, in plain terms:

- **Everything is given to Hume once, upfront, before the call starts:** background context,
  full session content, and a time goal per section (e.g. "cover this in ~2-3 minutes"). Nothing
  is sent to Hume again once the call is running.
- **We watch the live transcript ourselves and decide when to switch the visual** — we do not
  rely on Hume announcing its own progress. When it looks like Clio is wrapping up one section, we
  start preparing the next visual. Being a few seconds early or late is fine.
- **Non-negotiable:** this tracking must never slow down or add lag to Hume's responsiveness —
  Clio must stay fast and natural regardless of what we're doing in the background.

## Decision — action items and glitch detection (2026-07-04)

Confirmed with Arun, in plain terms: fetch action items and glitches **after the session ends**,
not live. Once a call finishes, pull the full two-sided transcript from Hume in one clean call and
have Claude read through it to extract action items and any glitches. No real-time work needed
during the call — matches Arun's earlier stated preference (even a nightly batch across all of
that day's sessions is acceptable). Noted to write a proper spec and build this when this
architecture is implemented — not yet spec'd or built.

## New requirement — visualization PDF export — **REMOVED FROM SCOPE 2026-07-13**

~~Arun's requirement, noted for a future spec, not yet built: at the moment we decide to move to
the next visual, save a snapshot of the current one. At the end of the session, combine all the
snapshots into a single PDF and email it to the user.~~

**Superseded by the B2C→B2B pivot (see `docs/brainstorm-b2b-platform-pivot.md`).** Under the pivot,
Clio no longer owns the end-user relationship or delivers anything directly to end users — partner
platforms (Pluralsight, Capgemini, etc.) do. A PDF recap emailed to the user is now the partner's
feature to build if they want it, not Clio's. Explicitly out of scope, not just deferred.

---

## Open items — resolved vs. still open (updated 2026-07-13)

**Resolved by decision, no longer open:**
- Mid-call context injection: moot — Arun decided everything goes to Hume once, upfront; nothing
  is pushed mid-call by design, so whether Hume supports it is no longer load-bearing.
- Stuck-tab/backstop pacing logic: resolved — we track Clio's position ourselves via the live
  transcript rather than relying on Hume to self-report or on a forced backstop.
- **Prompt size (2026-07-13): CONFIRMED by Arun — Hume accepts the prompt at full/normal size.**
  (Orchestrator note: logging as owner-confirmed; if this came from an actual test call rather
  than a working assumption, worth noting the source for future reference, but proceeding either
  way per Arun's direction.)
- **Visualization triggering (2026-07-13): CONFIRMED, and this doc's own "genuinely open" framing
  below was wrong/inconsistent — corrected.** Arun confirmed explicitly: **Hume's native LLM does
  NOT trigger visual changes via its own tool-calling.** We (server-side) watch the live transcript
  ourselves and trigger the switch directly — same mechanism as the already-resolved
  stuck-tab/backstop decision above, just not fully carried through to this section before. This
  makes the "does Hume's own LLM reliably fire tool calls" question **moot for visualization** —
  we don't depend on Hume's native reasoning to initiate that action at all.

**Answered 2026-07-13 — narrows but does not fully close the tool-calling question:**
- `end_session` is handed to Hume's own native-mode tool-calling — Hume decides when the session
  should end and invokes the tool itself, unlike visualization (server-driven, above). So there
  IS still a real, narrower dependency on Hume's native reasoning reliably firing a tool call — just
  scoped to this one action instead of the many frequent, precisely-timed calls visualization would
  have needed. Per this doc's own Q4 finding, the tool-calling *wire mechanism* is already confirmed
  to work identically in CLM and native mode (`hume-adapter.ts`'s existing `tool_call`/
  `tool_response` pattern) — what's unverified is Hume's own *judgment* on when to call it, not
  whether the mechanism functions.
- **Recommended regardless of test results:** build a server-side backstop (e.g. a max-session-
  duration timeout that force-ends the call) so a missed/late `end_session` tool call can't leave a
  bot stuck in a live meeting indefinitely. This is good defensive engineering independent of how
  reliable Hume's judgment turns out to be, and turns an open unknown into a managed risk rather
  than a blocker.

**Not yet spec'd or built (remaining new requirement from this brainstorm):**
- Post-session action-item and glitch extraction from the full Hume transcript (via Hume's Chat
  History API, `GET /v0/evi/chats/{id}/events`) — still in scope, unchanged.

**Status as of 2026-07-13:** prompt-size and visualization-triggering are resolved by direct owner
confirmation. `end_session` tool-calling reliability is a narrower, real, still-open question —
mitigated by a recommended timeout backstop rather than requiring a dedicated spike to block on.
Per the standing rule, this can reasonably move to a CEO Agent Feature Brief → BA spec now, with
the backstop requirement and the transcript-based action-item extraction feature both written into
the spec, and `end_session` reliability tracked as a monitored risk during the first real sessions
rather than gated behind a pre-spec test call.
