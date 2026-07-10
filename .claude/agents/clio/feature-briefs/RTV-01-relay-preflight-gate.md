# Feature Brief: RTV-01 — Fail-Closed Live-Transcript Relay Pre-Flight Gate
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-09

## Series context (read once, applies to RTV-01 → RTV-05)
This is Phase 1 of five phases delivering Arun's "transcript-driven real-time
visualization" system. The authoritative, fully-resolved requirements are in
`docs/brainstorm-realtime-transcript-driven-visualization.md`, Section 7
(20 numbered items). Do not re-litigate anything marked RESOLVED/CONFIRMED/
FINAL there. This brief covers **requirement #1 (live transcript access) and
#19 (relay connectivity is a hard pre-flight gate)** only. Everything else
(marker generation, tracking, templates, display) is a later phase — do not
design it here.

**Scope guardrail for the whole series (#16, RESOLVED):** Hume-native only —
`NEXT_PUBLIC_VOICE_PROVIDER=hume` AND `NEXT_PUBLIC_HUME_NATIVE_ENABLED=true`,
and only for summary-mode sessions (`HUME_NATIVE_SUMMARY_MODE=true`). Do not
touch the ElevenLabs or Hume-Custom-LLM paths.

## What Arun Said
The tracker must never silently run on a broken relay. Arun's exact position
(brainstorm A3, requirement #19): **"If the tracker gets no data at all from
Hume, the session must not start at all"** — show a polite message that the
relay was unsuccessful, it will be fixed, and the session will be rescheduled.
**Fail closed, not fail open.** This is a genuinely new, hard, zero-accepted-
failure requirement. There is no existing pre-flight check of this kind in the
codebase today.

Critically: this is a *binary, connectivity* guarantee (either transcript data
is reaching the app or it isn't) — distinct from the later phases' *semantic*
tracking accuracy, which is bounded-best-effort, not zero-failure. RTV-01 is
the achievable, hard-guarantee half. Build only that half here.

## The Problem Being Solved
The later phases make the on-screen visualization depend on the app receiving
Clio's live transcript. If a session starts while that relay is silently dead,
the tracker would run blind — worst case, the wrong visual sits on screen for
an entire session, or nothing advances, with no error surfaced to the
participant. A time-poor senior executive would be left in a broken session.
Arun's decision is to refuse to start such a session at all, and reschedule,
rather than deliver a degraded one.

## What Success Looks Like
- A defined, operational notion of **"the relay is confirmed working"** exists
  and is checked BEFORE a summary-mode Hume-native session is allowed to reach
  its "started" state. The BA must design what this check actually is
  concretely (see Questions) — an initial handshake / heartbeat / first-data-
  received confirmation — not a hand-wave.
- If the relay is NOT confirmed within a defined bound, the session does not
  start. The participant sees a **polite, executive-appropriate message**: the
  live relay could not be established, it will be looked into, and the session
  will be rescheduled. No half-started session, no silent degradation.
- If the relay IS confirmed, the session proceeds exactly as today — this gate
  is invisible on the happy path and adds no perceptible friction.
- The gate is **toggle-gated**, default OFF, following the established
  `SESSCTX-01` / `SESSION-END-01` additive pattern. OFF = today's exact
  behavior, byte-for-byte (no pre-flight check, session starts as now). This
  must be an explicit, testable acceptance criterion.
- The reschedule path reuses existing session-lifecycle / scheduling mechanisms
  wherever they exist — do not invent a parallel rescheduling system. The BA
  must find and document what "reschedule" concretely means against the current
  `sessions` table lifecycle and any existing reschedule/scheduling code.

## Known Constraints (do not expand scope)
- No marker generation, no tracking, no templates, no display logic in this
  phase. This phase only answers: "is the relay alive? if not, don't start,
  reschedule, tell the user politely."
- Do not weaken or bypass any existing session-start safety (`CONTENT-POP-01`
  content-readiness gate in `provision-config/route.ts`, billing-start
  `speak_verified` signal in `hume-adapter.ts`). This gate is additive and
  sits alongside them — the BA must document the exact ordering relative to
  those existing gates.
- Fail closed only. There is deliberately no "start anyway" fallback for the
  relay-dead case — that is the whole point of the requirement. Do not add one.
- Billing must not start for a session that never started. Confirm the gate
  fires before the `AUTOGEN-01` `speak_verified` billing-start signal, so a
  relay-blocked session bills zero minutes.

## Grounding already gathered (do not re-derive — use this)
Read the actual current source before writing this brief:
- `app/dashboard/walkthrough/WalkthroughClient.tsx` — the live session client.
  - The `connect()` effect (~line 566+) is where the Hume-native session is
    established: it POSTs `/api/hume-native/provision-config`, then
    `HumeAdapter.create(...)`. This is the natural place a pre-flight gate
    would sit.
  - **Live transcript arrives two ways today** and the BA must decide which
    one(s) constitute "the relay":
    (a) Clio's own speech → `onMessage(text, source)` with `source === 'ai'`
        (the `HumeAdapter.onMessage` callback, ~line 714). This is the same
        stream farewell-detection and NAV-command parsing already consume.
    (b) The participant's speech → reaches the agent via the Recall.ai
        transcript webhook feeding `sendUserMessage`/`pending_transcript`
        (this component runs inside the Recall.ai bot's headless browser).
  - `onSpeakVerified` (~line 888) and `onConnect` (chat_metadata, ~line 645)
    are existing "the session is actually live" signals — precedent for what a
    confirmation signal looks like, but note (per `hume-adapter.ts` comments)
    `onConnect` alone only proves metadata was received, not that data flows.
- `lib/voice/hume-adapter.ts` — `handleMessage()` shows the exact Hume EVI
  message types (`chat_metadata`, `assistant_message`, `user_message`,
  `tool_call`, etc.). `onMessage` fires on `assistant_message`/`user_message`.
  `hasReceivedChatMetadata` + first `assistant_message` is the existing
  two-signal proof-of-life pattern (`onSpeakVerified`). A relay-alive check
  should be designed in the same spirit but must specifically prove *transcript
  data* is arriving, not merely that the socket opened.
- `app/api/hume-native/provision-config/route.ts` — the existing hard
  fail-closed precedent: on unavailable content it returns non-2xx and the
  client does NOT silently fall back (`CONTENT-POP-01`). RTV-01's relay gate
  should mirror this "block, don't degrade" posture.
- `sessions` table (project `nqxlpcshouboplhnuvrh`): has `status`, `started_at`,
  `scheduled_at`, `ended_at`, `follow_up_needed`, `follow_up_session_id`,
  `duration_mins`, `minutes_used`. `walkthrough_state` has `status`. The BA
  should locate the existing code that transitions a session to
  started/active and any existing reschedule mechanism (check
  `inngest/session-meeting-setup.ts`, `app/api/sessions/[id]/start`,
  `app/api/sessions/end-call`, and the retake/reschedule work referenced in
  `docs/specs/retake-completed-session.md` / `REVERT-01`) before inventing new
  columns.

## Questions for BA
1. **Define "relay confirmed working" operationally.** Exactly what signal,
   from which stream (Clio-speech `onMessage source:'ai'`, participant
   transcript webhook, or both), within what time bound, counts as proof the
   relay is delivering data? State the precise condition and the timeout, and
   justify why it genuinely proves live transcript flow (not just socket open /
   metadata received). This is the load-bearing design decision of this phase.
2. **Where the gate sits in the connect sequence.** Relative to
   provision-config, `HumeAdapter.create`, `onConnect`, `onSpeakVerified`, and
   the billing-start signal — document the exact ordering and why the session
   cannot reach "started"/billing until the relay is confirmed.
3. **The polite blocked-session UX.** Exact copy and the exact screen/state the
   participant sees (executive-appropriate, per the product design standard).
   What component renders it, and how does it differ from the existing
   connection-error / "Unable to Connect" modal already in WalkthroughClient?
4. **The reschedule action.** What "the session will be rescheduled" concretely
   does against the current `sessions` lifecycle — reuse existing
   reschedule/retake/scheduling code; specify the exact status transition and
   any notification. Do not build a new scheduler.
5. **Toggle.** Exact env var name (follow the existing pattern), default OFF,
   where it is read (client, since this is in the connect flow), and the
   explicit acceptance criterion that OFF = today's exact behavior.
6. **Billing safety.** Explicit, testable acceptance criterion that a
   relay-blocked session bills zero minutes (fires before `speak_verified`).
7. **False-negative risk.** What is the risk the gate wrongly blocks a session
   whose relay was actually fine (e.g. a slow first utterance)? How does the
   timeout design bound this without weakening the fail-closed guarantee?

## Process
Write the full 12-section Requirement Document. Wireframe/UX required for the
blocked-session message (Question 3) — this IS a user-facing screen, so it must
be documented to the ">= 3 lines + example" standard, not a stub. Section 11
(Open Questions) must be empty before this returns to CEO for approval.
Suggested id: `RTV-01-relay-preflight-gate`.
