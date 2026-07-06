# Clio Not Speaking First (Hume-Native Voice Sessions) — Requirement Document
Version: 1.1
Status: APPROVED
Author: Business Analyst Agent (finalized by CEO Agent)
Date: 2026-07-06

## 1. Purpose

Clio's live voice-coaching sessions on the Hume-native (supplemental-LLM) path — the currently-enabled production path — are supposed to open with Clio speaking a warm greeting and orientation, per the prompt template's own Behavioral Rule 1 ("Open the session warmly, briefly orient the participant... Do not ask what they want to cover"). Today, Clio does not speak first: the session opens silently and waits on the participant.

Without this fix, every Hume-native session opens broken. The participant joins a call where the AI coach says nothing, has no idea whether the system is working, and is put in the position of having to prompt Clio to begin — which directly contradicts the product's design (a coach who runs the session, not a chatbot waiting for input). This is P0 because it affects the very first moment of every paid session currently running on the enabled path.

## 2. User Story

As an executive user starting a scheduled Clio coaching session (Hume-native/native voice path),
I want Clio to speak first — greeting me warmly and orienting me to today's agenda — the moment the call connects,
So that I know the system is working, feel coached rather than interrogated, and the session opens the way the product is designed to.

## 3. Trigger / Entry Point

- Not a UI page — this is voice-agent runtime behavior inside the existing live-session experience at `app/dashboard/walkthrough/WalkthroughClient.tsx` (both the user-facing dashboard route and the Recall.ai bot's headless `botView` render of the same component).
- Activates automatically the moment a Hume-native voice session's WebSocket connects — i.e., whenever `NEXT_PUBLIC_HUME_NATIVE_ENABLED=true` (current Production/Preview state) and `VOICE_PROVIDER === 'hume'`, immediately after `HumeAdapter.create()` succeeds and the WebSocket handshake completes (`ws.onopen`).
- No user action triggers it — it is expected to fire automatically, before the participant says anything.
- State required: an active `sessions` row exists for the user (status `active`), `walkthrough_state` has non-empty `sections`/`training_scripts`/`topic_title` (or the self-heal path in `provision-config/route.ts` successfully backfills them), and a fresh Hume Config has been provisioned via `POST /api/hume-native/provision-config`.

## 4. Screen / Flow Description

No new screen. Existing flow, annotated with the exact defect:

**Step 1 — Connect sequence (client, `WalkthroughClient.tsx` lines ~564–605):**
User's mic permission is requested, `HumeAdapter.create()` is called with a `configId` that — because `HUME_NATIVE_ENABLED` is true — was just correctly fetched via `POST /api/hume-native/provision-config` and awaited before use (this part of the wiring is correct; see Section 11 confirmation below, not a defect).

**Step 2 — WebSocket opens (`lib/voice/hume-adapter.ts`, `openConnection()`, lines 51–85):**
The instant the WebSocket's `onopen` fires — before Hume has sent `chat_metadata` back to the client, before any greeting turn has occurred — the client unconditionally sends:
```json
{ "type": "session_settings", "custom_session_id": "<userId>" }
```
This send is unconditional for every Hume call site (Custom-LLM bridge AND Hume-native) — `openConnection()` has no branch distinguishing the two modes.

**Step 3 — Defect:** Hume's own "EVI Starts conversation" behavior (which normally fires the first LLM turn immediately upon WS connect, before any client message arrives) is either delayed, cancelled, or not re-triggered by this `session_settings` send arriving first on the wire. The result: Clio never produces the inferred opening greeting that `on_new_chat: { enabled: true, text: '' }` is documented to produce on its own. The call sits silent until the participant speaks.

**Step 4 — What the user currently experiences:** join the call, mic is live, no audio from Clio, no visual feedback distinguishing "connected and about to greet you" from "broken." User must speak first for anything to happen.

## 5. Visual Examples

Not applicable — this is voice-agent behavior with no screen-state change. Per the CEO brief, no UI is affected.

## 6. Data Requirements

- **Read:** `sessions` row (`id`, `live_conductor_content`, `status`) keyed by `user_id`; `walkthrough_state` row (`topic_title`, `sections`, `training_scripts`) keyed by `user_id`; `user_learning_profiles` + `session_insights` (via `buildIntentContextForHumeNative`) for prompt context.
- **Write:** `sessions.hume_native_config_id`, `sessions.hume_native_enabled` (set after successful provisioning, in `provision-config/route.ts`); `sessions.hume_chat_id` (set on `onConnect`, via `POST /api/hume-native/session-chat-id`).
- **API calls:** `POST /api/hume-native/provision-config` (client → server, provisions fresh Hume Config); `POST https://api.hume.ai/v0/evi/configs` (server → Hume, config creation); WebSocket `wss://api.hume.ai/v0/evi/chat?...&config_id=...` (client → Hume, live session).
- **No client-side storage** (localStorage/sessionStorage) is involved in this defect or its fix.

## 7. Success Criteria (Acceptance Tests)

✓ Given a fresh Hume-native session (fresh page load, `isReconnect=false`, `isMidSession=false`), when the WebSocket connects, then Clio produces spoken audio (an `assistant_message`/`audio_output` event sequence) within a bounded wait window without the participant having spoken first.

✓ Given the same fresh session, when Clio's first utterance is inspected (via transcript/`assistant_message.message.content`), then it constitutes a greeting/orientation consistent with prompt-template.ts Rule 1 (warm opening, references today's agenda, does not ask "what do you want to cover").

✓ **(Added 2026-07-06, per Arun's direct scope decision)** Given the same fresh session, when Clio's first utterance is inspected, then it addresses the primary signed-up user by their first name (sourced from Clerk via the application, the same source the ElevenLabs path already uses) — not a generic "hello" with no name. This is a must-have acceptance criterion, verified across all 5 consecutive manual QA sessions in acceptance test 5 below, not just the "speaks first" behavior alone.

✓ **(Optional, non-blocking)** If greeting other meeting participants by name is included in the build (only if genuinely low-effort, per Section 10), verify it does not delay Clio's opening line to the primary user and does not regress any acceptance test above. This criterion is not required for sign-off.

✓ Given a **reconnect** mid-session (`isReconnect=true`), when the WebSocket reconnects, then Clio does NOT re-deliver the full opening greeting again (existing reconnect suppression behavior for the Custom-LLM/ElevenLabs path must not regress; Hume-native's equivalent behavior, if any is added by the fix, must also respect this).

✓ Given the fix is applied, when a Custom-LLM-bridge (non-native) Hume session connects (hypothetically, if `NEXT_PUBLIC_HUME_NATIVE_ENABLED=false`), then its existing `custom_session_id` `session_settings` send and behavior are byte-for-byte unchanged — this fix must not touch or regress that path.

✓ Given the fix is applied, when a Hume-native session's assembled prompt is inspected, then Rule 1 through Rule 10 of `HUME_NATIVE_PROMPT_TEMPLATE` remain textually unchanged (unless the CEO/Arun explicitly approves a rule-1 wording adjustment as part of the chosen fix option — see Section 11).

✓ Given the fix is applied, when 5 consecutive fresh Hume-native sessions are started end-to-end (manual QA, since Hume's inference/timing has no deterministic test harness available in this codebase), then Clio speaks first in all 5 — not "most" — before any further work is considered complete.

## 8. Error States

- If `POST /api/hume-native/provision-config` fails (non-2xx): existing behavior is preserved — the client throws and surfaces a connect failure; no silent fallback to Custom-LLM mode (already correct per BA spec for HUME-NATIVE-01, unrelated to this bug).
- If Hume's own greeting inference fails even after the fix (e.g., some sessions still open silently): there is currently **no client-side fallback or timeout-triggered nudge** for the Hume-native path. This is a gap — Section 11 raises whether a fallback (e.g., a delayed manual nudge if no `assistant_message` arrives within N seconds) should be added as a safety net regardless of which root-cause fix is chosen.
- If the WebSocket disconnects before any greeting is produced: existing reconnect/backoff logic in `hume-adapter.ts` (lines 92–117) already handles this; no change needed there.

## 9. Edge Cases

- First-ever session for a user (no prior `session_insights`/`user_learning_profiles` row) — `buildIntentContextForHumeNative` already returns `''` cleanly in this case; prompt assembly is unaffected by this fix.
- Reconnect mid-session (Attendee bot page reload) — must not re-trigger a second full opening greeting. Today this is handled for the ElevenLabs path via `isReconnect || isMidSession` gating the `firstMessage` field; **Hume-native has no equivalent client-side greeting-suppression mechanism today**, because it currently has no client-side greeting-triggering mechanism at all (Hume was supposed to self-infer via `on_new_chat`). Whichever fix option is chosen must account for reconnect behavior explicitly, not silently.
- Self-heal path fires (`CONTENT-POP-01` — `walkthrough_state` was empty and had to be regenerated synchronously) — this delays when `provision-config` returns, but does not change the connect-then-greet sequence once it does return; not a special case for this bug.
- Bot view (`botView=true`, headless Recall.ai browser) vs. normal dashboard view — both render the same `WalkthroughClient` connect logic; the bug reproduces identically in both, since the defect is inside `HumeAdapter.openConnection()`, not in `botView`-specific code.

## 10. Out of Scope

- The separate ElevenLabs/Custom-LLM path in the same file (`Conversation.startSession(...)`, its `firstMessage` field, `greeting` variable at lines ~832–852) — explicitly not touched, per CEO brief.
- The Custom-LLM bridge (`app/api/clio/chat/completions`, `hume-adapter.ts`'s existing non-native behavior) — must not regress, per standing rule.
- Any change to `topic selection`, `LLM topic gen`, or `session gen` — none of this fix touches those systems.
- Any new UI/screen — confirmed none required.
- **Greeting other meeting participants by name (non-primary-user attendees) — explicitly OPTIONAL, not required, per Arun's direct scope decision 2026-07-06.** The existing `participant.joined` → `pending_transcript` mechanism in `app/api/recall/webhook/route.ts` (lines 129–148) is wired to the **ElevenLabs path only** — it is not automatically reusable for Hume-native without separate wiring (confirmed by code read during this pass). If it later turns out to be low-effort to extend to Hume-native, it MAY be included, but it must never block, delay, or add meaningful risk/complexity to this spec's core requirement. Do not let this drive any Q1 decision below.

## 11. Open Questions

**Root cause (this section documents findings, not questions — verified empirically against the codebase, not guessed):**

Verified root cause: `lib/voice/hume-adapter.ts`'s `openConnection()` method sends a `session_settings` message (`{ type: 'session_settings', custom_session_id: <userId> }`) unconditionally on `ws.onopen`, for **every** Hume call site — including the new Hume-native path — before Hume's `chat_metadata` event and before any assistant turn occurs. This send was added in commit `5bcf278` (2026-07-01) and revised in commit `5b6184a` (2026-07-03) specifically to win a race against Hume's own "EVI Starts conversation" auto-greeting LLM call, which the commit message for `5bcf278` states fires "the instant the WS handshake completes." That fix was written and tuned entirely for the **Custom-LLM bridge path** (to make `custom_session_id` reach `/api/clio/chat/completions`), months before HUME-NATIVE-01 (native/supplemental-LLM mode) existed as a concept in this codebase. When HUME-NATIVE-01 was later built, `openConnection()` was not branched for native vs. non-native mode — the same unconditional `session_settings` send on `onopen` now also fires for native-mode sessions, where it serves no purpose (native mode has no Custom-LLM bridge to forward `custom_session_id` to) but still arrives on the wire at the exact moment identified in `5bcf278`'s own commit message as "before the greeting LLM call is dispatched." This lines up precisely with the observed symptom (silence) and with the documented purpose of the code that causes it (deliberately racing ahead of Hume's own greeting trigger). Hume's own docs, fetched directly during this investigation (dev.hume.ai/docs/speech-to-speech-evi/configuration/session-settings and .../event-messages), confirm `on_new_chat` infers and speaks a greeting automatically, but do **not** document any interaction between a `session_settings` message sent immediately post-connect and that inferred-greeting behavior — so the causal mechanism on Hume's side (why this send suppresses/delays the greeting) is inferred from timing and code history, not confirmed by Hume's documentation or by direct instrumented reproduction against Hume's live API in this session. This is flagged honestly below, not glossed over.

This rules out the CEO brief's hypotheses (a) stale config_id (verified: `provisionRes.json()` is awaited and the fresh `configId` is correctly passed to `HumeAdapter.create()` — no timing gap or fallback to the base `NEXT_PUBLIC_HUME_CONFIG_ID` occurs when native mode is enabled) and (c) reconnect-branching (verified: `isMidSession` correctly evaluates `false` on a genuinely fresh session, since `currentSectionIndexRef` initializes from `initialState.current_section_index ?? 0`). It also does not require blaming recent commits `a7a42d2`/`68af0af` — neither touches `hume-adapter.ts`'s connect/greeting sequence; `68af0af` only affects post-session billing lookups, `a7a42d2` only touches prompt-template.ts's closing-behavior text and adds transcript-analysis code, not connect-time behavior.

**Q1 — RESOLVED 2026-07-06 by Arun (direct decision, relayed via CEO): Option A.**
Branch `openConnection()` in `lib/voice/hume-adapter.ts` to skip the pre-emptive `session_settings` (`custom_session_id`) send specifically for Hume-native sessions. That send was built for the old Custom-LLM bridge path to race ahead of Hume's own auto-greeting, and is now unintentionally suppressing Hume-native's own LLM-driven greeting (Rule 1 already instructs Clio to open warmly and speak first — this fix only stops interfering with that). The ElevenLabs/Custom-LLM path keeps this send exactly as-is, byte-for-byte unchanged. No edit to `prompt-template.ts` Rule 1 wording is required as part of this decision.

Rationale for the record — the two candidate directions that were presented:

- **Option A — Branch `openConnection()` by mode.** Skip the `session_settings` send entirely for Hume-native sessions (it serves no purpose there — there is no Custom-LLM bridge to forward `custom_session_id` to), while leaving the Custom-LLM bridge path's existing `session_settings` send completely untouched. This directly removes the mechanism identified above as the most likely cause, with the least behavior change, and requires no edit to `prompt-template.ts` or Rule 1's wording. Risk: if the true Hume-side mechanism turns out to be something else (e.g., prompt-shape/inference reliability, per the CEO brief's hypothesis (b)), this alone may not fully resolve it and a second iteration would be needed.
- **Option B — Give Hume-native an explicit non-empty `on_new_chat` greeting text** in `config-provisioner.ts` (line ~294, currently `{ enabled: true, text: '' }`) instead of relying on inference, in addition to or instead of Option A. This is more deterministic (removes reliance on Hume's inference behavior entirely) but requires: (i) confirming this doesn't conflict with prompt-template.ts Rule 1, which currently instructs the LLM itself to "open the session warmly, briefly orient the participant" — a hardcoded `on_new_chat` text is a different mechanism (Hume's event-message system) than the LLM-driven Rule 1 instruction, and running both risks either a double-greeting or an inconsistent one; (ii) determining HOW to personalize a hardcoded greeting (name, topic) for Hume-native, since `on_new_chat.text` is a static string set once per Config at provisioning time in `config-provisioner.ts` — not a Claude-LLM-driven output — meaning per-session personalization is achievable (config-provisioner.ts already has the session's `topicTitleForContent` and could source a name via the profile if Q2 below is resolved) but would need explicit string interpolation into that field, structurally different from how the ElevenLabs path's `greeting` variable is built inline in `WalkthroughClient.tsx`.

This was a product-level reliability-vs-design-purity tradeoff that only Arun could make. Arun chose Option A (see above) — keep Hume's own LLM fully in charge of the greeting per Rule 1's existing design, and stop the code from unintentionally interfering with it.

**Q2 — RESOLVED 2026-07-06 by Arun (direct decision, relayed via CEO):**
Scope is now confirmed: the primary signed-up user's first name (sourced from our own application/Clerk — confirmed reachable today via the same mechanism the ElevenLabs path already uses, no Recall.ai dependency needed) **must** be available and injected into the Hume-native prompt/context, and Clio must speak first with that name the instant the call connects. This is a must-have, not a nice-to-have. Greeting other meeting participants by name remains explicitly optional (see Section 10) and must never block this requirement.

Verified: `lib/learning/user-profile.ts`'s `UserLearningProfile` type and `buildProfileContextForClio()` contain no name field whatsoever (no `first_name`, `firstName`, or `name` of any kind) — this is a genuine gap, separate from the ElevenLabs path, which already has `userFirstName` piped in via a prop and used in its `greeting` variable at the `WalkthroughClient.tsx` call site. **Closing this gap is now in scope for this spec** (not a follow-up ticket) because it is required for the core acceptance criterion (Clio speaks the user's name on connect). Concretely, this requires:
1. Sourcing the primary user's first name the same way the ElevenLabs path already does (via Clerk, already piped as `userFirstName` prop into `WalkthroughClient.tsx`) — no new integration needed, just reuse for the Hume-native branch.
2. Getting that name into whichever fix mechanism Q1 selects — if Option A (Hume's own LLM speaks Rule 1 from prompt content), the name must be interpolated into the assembled system prompt in `prompt-template.ts`/`config-provisioner.ts` context-building step. If Option B (hardcoded `on_new_chat.text`), the name must be string-interpolated into that static field at provisioning time in `config-provisioner.ts` (which already has access to per-session data at provisioning time, e.g. `topicTitleForContent` — same pattern applies to name).
3. Either way, this must be resolved as part of whichever Q1 option is chosen — it is not a separate build phase.

**Q3 — RESOLVED 2026-07-06 by Arun (direct decision, relayed via CEO): engineering judgment call, non-blocking.**
Arun's guidance: include a client-side fallback/timeout nudge for Hume-native only if it is low-risk/low-effort to add alongside the Option A fix; otherwise skip it and note it as a future consideration. This does not gate the build. The developer agent should implement Option A + Q2 name-threading first, and only add a fallback nudge if it can be done cheaply without adding new state-machine complexity or risk to the core fix. If skipped, it should be logged in `BACKLOG.md` as a future consideration, not treated as an unresolved question.

## 12. Dependencies

- Confirmed root cause requires no schema changes and no new tables.
- Fix (whichever option is chosen) is confined to `lib/voice/hume-adapter.ts` (`openConnection()`, mode-branching) and/or `lib/voice/hume-native/config-provisioner.ts` (`event_messages.on_new_chat.text`) and/or `lib/voice/hume-native/prompt-template.ts` (Rule 1 wording, only if Option B is chosen and a wording conflict is found).
- **Q2 resolved 2026-07-06:** name-gap closure is now bundled into this spec's build, not deferred. Requires piping the primary user's first name (Clerk-sourced, mirroring how `userFirstName` already reaches `WalkthroughClient` for the ElevenLabs path) into whichever Q1 fix mechanism is chosen — either the assembled system prompt (Option A) or the hardcoded `on_new_chat.text` (Option B, string-interpolated at provisioning time in `config-provisioner.ts`). No new external integration or credential needed — this is wiring an already-available value into a new destination.
- Greeting other meeting participants by name remains explicitly out of scope / optional (Section 10) and is not a dependency of this spec.
- No third-party credential or API key blockers — `HUME_API_KEY` and `NEXT_PUBLIC_HUME_CONFIG_ID` are already configured and working in Production per the CEO brief.
- Manual QA (5 consecutive live sessions, per acceptance test 5) is a hard dependency before this can be marked done, since Hume's greeting-inference behavior has no deterministic automated test available in this codebase.

---

**Status: APPROVED — 2026-07-06 (CEO Agent, on Arun's direct decision).** Q1, Q2, and Q3 are all resolved. Section 11 has no remaining open questions. Cleared to build: Option A branch in `lib/voice/hume-adapter.ts`, first-name threading into the Hume-native prompt context per Q2, and an optional low-effort fallback nudge per Q3 (developer's judgment, non-blocking, log in BACKLOG.md if skipped).
