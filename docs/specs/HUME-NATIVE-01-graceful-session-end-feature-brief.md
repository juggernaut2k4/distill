# Feature Brief: HUME-NATIVE-01 — Graceful Session End (Time-Aware Wrap-Up Nudge)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-05

## What Arun Said

Confirmed from a real HUME-NATIVE-01 test call: Clio has no awareness that a session is
ending. The call gets forcibly killed from outside — mid-sentence if need be — with zero
warning to Clio and no chance for her to close gracefully. Arun's approved direction
(settled, not open for re-litigation):

1. Near the end of a session (not throughout), our system sends Clio ONE single message
   telling her time is almost up — wrap up now with a short summary and say goodbye, the
   same way she already closes out a normal, natural end-of-session.
2. Clio then ends the call herself, using the mechanism she already relies on at a normal
   end — Hume EVI's own built-in end-of-conversation detection, triggered by her saying
   goodbye (this is a Hume platform behavior, not something our code implements — confirmed
   by reading `prompt-template.ts` rule 8, which states the hang-up "is handled
   automatically the moment you say goodbye").
3. Keep a short grace period after the nudge as a safety net. If she hasn't wrapped up in
   time, the existing hard force-end mechanism still fires — but now purely as a backstop,
   not the first and only signal.
4. This is a single, one-time, near-end nudge. It does not reopen the "everything upfront,
   no mid-call injection" design principle for anything beyond this one narrow exception.

## The Problem Being Solved

Executives using Clio experience an abrupt, unprofessional call termination at the end of
every timed session — no closing summary, no goodbye, sometimes cut off mid-sentence. This
directly undermines the "executive UX standard" (Clio must feel crisp and purposeful, never
broken) and erodes trust in the product during exactly the moment (session close) that
should reinforce value delivered.

## What Success Looks Like

- With a configurable lead time before hard cutoff (recommend 2 minutes), Clio receives a
  one-time instruction to wrap up: summarize the 2 most important takeaways, then say a
  natural goodbye.
- Clio's own goodbye triggers Hume's built-in end-of-conversation hang-up — the call ends
  because she chose to end it, not because it was yanked from outside.
- If she doesn't close within the grace window (recommend same 1-minute backstop already in
  place today), the existing `forceEndSession()` / `session-timer.ts` mechanism fires exactly
  as it does today — unchanged, unmodified, fully intact as the last-resort safety net.
- If the nudge fails to send for any reason, nothing changes from today's behavior — the
  hard force-end still fires on schedule. This feature can only make endings better, never
  worse or less reliable.
- No change to billing/minute-calculation logic. No change to `lib/session-billing.ts`.

## Known Constraints (from Arun, non-negotiable)

- Must not touch billing/minute-calculation logic in `lib/session-billing.ts` — that area
  was fixed today (2026-07-05, the `computeBilledMinutes` current-cycle-scoping bugfix) and
  is out of scope here entirely.
- Must not reintroduce general mid-call steering. This is a single, one-time, near-end nudge
  — not ongoing turn-by-turn control. The existing "everything upfront, no mid-call
  injection" principle stays intact for every other purpose.
- Must not make session endings less reliable. If the nudge fails to send (WebSocket error,
  etc.), the existing hard force-end backstop must still fire on its current schedule,
  unaffected. A failure in this feature must never mean a session runs long or forever.
- Additive only — layer on top of existing, working infrastructure. Do not invent a new
  timer system.

## Grounding in Existing Code (for BA — do not re-investigate, build on this)

**Where this must NOT go:** `inngest/session-timer.ts` already sends a "1-minute warning" —
but it writes to `walkthrough_state.pending_transcript`, which is polled and injected via
`sendUserMessage` on the **ElevenLabs custom-LLM path**. This has no effect on HUME-NATIVE-01
calls. This existing warning path is unrelated to the mechanism this brief requires and
should not be reused or modified as part of this work — it serves a different voice provider
entirely.

**Where this SHOULD go:** `lib/voice/hume-adapter.ts` (`HumeAdapter` class) is the client-side
WebSocket wrapper for Hume EVI native mode, running inside the Recall.ai bot's headless
browser via `WalkthroughClient.tsx`. It already sends one `session_settings` WebSocket
message today, at connect-time (`openConnection()`, `this.ws.onopen`, line ~78), to forward
`custom_session_id`. This is the existing, working, already-proven mechanism for injecting
data into a live Hume-native call — the nudge should be a second, later `session_settings`
send over this same already-open WebSocket, not a new connection or new send pathway.

**Timing source, already uncorrupted:** `app/api/sessions/[id]/start/route.ts` reads
`session.duration_mins` *before* any force-end has touched the row, and passes it **by
value** into the `clio/session.started` Inngest event payload
(`effectiveDurationMins` → `event.data.durationMins`). `inngest/session-timer.ts` then works
entirely from this captured event-payload value, not from a live re-read of the `sessions`
table. This means the ACTION-ITEMS-2026-07-06 item #2/#3 bug (duration_mins getting
overwritten with actual-minutes-billed after a force-end) **does not affect this event's own
copy of the planned duration** — the timer job's snapshot was taken before any corruption
could occur, and it never re-reads the column afterward. This feature can proceed
independently of the #2/#3 fix; flag this reasoning in the spec so BA/Eng don't block
unnecessarily, but note it explicitly as an assumption to verify against the real Inngest
step code before build (confirm no other step in the job re-reads `duration_mins` live).

**Existing backstop, unmodified:** `forceEndSession()` in `lib/session-billing.ts` is the
shared, billing-critical, already-hardened hard-end path (used by both the wall-clock timer
and the voice-gap watchdog). It is idempotent (no-ops if session already `completed`). This
feature must call it exactly as-is, unmodified, as the backstop — never touch its internals.

**Existing hang-up precedent:** `prompt-template.ts` rule 8 already instructs Clio, at a
session's natural end, to "briefly summarize... two sentences... say a clear, natural
goodbye... ending the call is handled automatically the moment you say goodbye" — this is
Hume EVI's own built-in end-of-conversation detection, not our code. The nudge's job is
simply to trigger this same, already-defined behavior a little early.

## Questions for BA

1. **Trigger mechanism (confirm/refine):** Recommend piggybacking on the EXISTING
   `session-timer.ts` job rather than a new timer. Today it sleeps `(durationMins - 1)`
   minutes, then does the (irrelevant-to-Hume) `pending_transcript` write, then sleeps 1 more
   minute, then force-ends. Proposed change **for Hume-native sessions specifically**:
   replace (or branch, by `voice_provider`) that ElevenLabs-only warning step with a new
   step that emits an Inngest event (e.g. `clio/session.wrapup-nudge`) that the client-side
   `HumeAdapter` — or whatever server/client bridge already exists for this session — can act
   on to send the `session_settings` nudge. Define exactly how a *server-side* Inngest step
   reaches a *client-side* open WebSocket (there is no direct path today — likely needs a
   short-poll or realtime channel the bot's browser already watches, e.g. reusing the same
   `walkthrough_state` row as a signal, but with a Hume-specific field/event flag rather than
   `pending_transcript`). This is the single biggest open design question — spec it
   precisely.
2. **Lead time:** confirm 2 minutes before hard cutoff (vs. today's 1 minute for the
   ElevenLabs path). Should this differ by provider, or be unified? Recommend keeping Hume's
   lead time slightly longer than ElevenLabs's since Hume's wrap-up depends on EVI's own
   end-of-conversation detection firing after Clio's goodbye, which may take a few seconds
   longer than ElevenLabs's `end_session` tool call.
3. **Exact nudge text:** draft the literal string sent via `session_settings` (mirroring the
   spirit of the existing ElevenLabs warning text: "You have approximately N minutes
   remaining... summarize the 2 most important takeaways, then say a warm goodbye").
   Confirm whether `session_settings` supports injecting arbitrary instruction text
   mid-call the same way `system_prompt` injection was rejected (E0716) in Custom-LLM mode —
   re-confirm which specific `session_settings` sub-field is safe to use in native mode (the
   brief's technical-fact grounding says the WS message itself is not blocked, but the exact
   payload shape needs nailing down against Hume's docs before Eng builds).
4. **Retry policy:** if the WebSocket send fails (send call throws, or socket is in a bad
   state), is a single retry attempted, or does it fail silently and rely entirely on the
   backstop? Recommend: one immediate retry, then silent fallback to backstop — never block
   or delay the backstop timer waiting on nudge delivery.
5. **Grace period length:** confirm whether the existing 1-minute post-warning sleep in
   `session-timer.ts` is reused as-is for the Hume path, or whether Hume needs a different
   grace window given EVI's own goodbye-detection latency.
6. **Scope of `session-timer.ts` change:** confirm this should branch on `voice_provider`
   (stored per session/user — already a typed field, `VoiceProvider = 'elevenlabs' | 'hume'`,
   per `lib/session-billing.ts`) inside the same job, rather than forking a parallel job —
   simplest reuse of existing infrastructure per Arun's instruction not to invent a new timer
   system.
