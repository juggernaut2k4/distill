# Fail-Closed Live-Transcript Relay Pre-Flight Gate (RTV-01) — Requirement Document
Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-10

---

## 1. Purpose

Phase 1 of Arun's transcript-driven real-time visualization series (`docs/brainstorm-realtime-transcript-driven-visualization.md`, requirements #1 and #19). Later phases will make the on-screen visualization depend on the app receiving Clio's **live transcript** as she speaks. If a live Hume-native session were allowed to start while that transcript relay is silently dead, the future tracker would run blind — worst case the wrong visual sits on screen for an entire session, or nothing advances, and a time-poor senior executive is stranded in a broken session with no error surfaced.

Arun's decision (brainstorm A3, requirement #19) is binary and zero-accepted-failure: **"If the tracker gets no data at all from Hume, the session must not start at all"** — show a polite message that the relay was unsuccessful, it will be looked into, and the session will be rescheduled. **Fail closed, not fail open.**

This feature adds exactly that: a **pre-flight relay-liveness gate** that, before a Hume-native session is allowed to reach its billing-bearing "live" state, verifies that Clio's transcript is actually reaching the app. If it is confirmed within a bounded time, the session proceeds exactly as today (the gate is invisible on the happy path). If it is not, the session is torn down before any minutes are billed, reverted to a re-launchable `scheduled` state, and the participant sees a calm, executive-appropriate "session rescheduled" message.

**Scope of the guarantee.** This phase builds only the *connectivity* half of Arun's requirement — a binary "is transcript data arriving at all" check, which is genuinely achievable as a hard, zero-failure gate. It deliberately does **not** build any marker generation, keyword tracking, template selection, or display logic (later phases, and their *semantic* accuracy is bounded-best-effort, not zero-failure — explicitly out of scope here per the Feature Brief).

Failure mode without this feature: later phases would ship a tracker with no way to know its input stream is alive, so a dead relay would degrade silently into a broken, mis-synced, or frozen visual experience during a real executive session — the exact outcome Arun's #19 exists to make impossible.

## 2. User Story

As an executive about to take a live Hume-native voice coaching session,
I want the session to refuse to start (and quietly reschedule itself) if Clio's live transcript is not actually reaching the platform,
So that I am never dropped into a session where the on-screen visuals are silently broken, and I am never charged minutes for a session that never truly ran.

Second, internal story:
As the platform's own billing and session bookkeeping,
I want a structurally guaranteed "the transcript relay is confirmed live" precondition gating the billing-start signal,
So that a session with a dead transcript relay can never reach `speak_verified` (billing start) and therefore always bills zero minutes.

(No new dashboard/marketing UI. The single new user-facing surface is one in-session "session rescheduled" screen — fully specified in Sections 4 and 5.)

## 3. Trigger / Entry Point

No new route, page, or button in the entry flow. The gate activates **inside the existing live-session connect flow** and only under a precise scope:

- **Where:** the `connect()` effect in `app/dashboard/walkthrough/WalkthroughClient.tsx` (the effect starting ~line 566), specifically inside its Hume branch (`if (VOICE_PROVIDER === 'hume')`, ~line 608), after `HumeAdapter.create(...)` resolves (~line 639).
- **When (all must hold):**
  1. `VOICE_PROVIDER === 'hume'` (`NEXT_PUBLIC_VOICE_PROVIDER=hume`), AND
  2. `HUME_NATIVE_ENABLED === true` (`NEXT_PUBLIC_HUME_NATIVE_ENABLED=true`), AND
  3. the new toggle `NEXT_PUBLIC_RELAY_PREFLIGHT_GATE_ENABLED === 'true'` (Section 5 / Q5), AND
  4. this is a **fresh** connection for the session — NOT a reconnect and NOT a mid-session resume (`!isReconnect && !isMidSession`, the same two flags the connect flow already computes at ~lines 576–580), AND
  5. billing has not already started for this session (`!speakVerifiedWrittenRef.current`).
- **User state:** the participant (a Recall.ai bot in the meeting, whose headless browser runs `WalkthroughClient`, with the human executive present in that meeting) has just had the session launched — i.e. `POST /api/sessions/[id]/start` already flipped the DB row to `status='active'` and minted the audit token, and `POST /api/recall/bot` launched the bot. The gate runs a moment later, when `WalkthroughClient` opens the Hume connection.

**Important framing of "started."** The DB `sessions.status='active'` flip happens earlier, at the "Launch AI Coach" click (`app/api/sessions/[id]/start/route.ts` ~line 102), before `WalkthroughClient` ever connects. The gate cannot and does not try to prevent that flip. What the gate prevents is the session reaching its **billing-bearing live state** — defined operationally as the `speak_verified` audit event (billing start). On a relay-dead block, the gate additionally *reverts* the premature `active` status back to `scheduled` (Section 4, State 4). Throughout this document, "the session must not start" means "must not reach `speak_verified`/billing, and must be reverted out of `active`."

Scope guardrail (Feature Brief #16, RESOLVED): Hume-native only. The ElevenLabs branch and the Hume-Custom-LLM (`LIVE-01`) branch of `WalkthroughClient` are **untouched**. Summary-mode vs full-script does not change the relay semantics (Clio deterministically speaks first in both native sub-modes — see Section 4, State 2), so the gate is correct for native mode regardless of `HUME_NATIVE_SUMMARY_MODE`; the `HUME_NATIVE_SUMMARY_MODE` value (a server-only var) is not read client-side and is not a gate condition.

## 4. Screen / Flow Description

The gate is a small state machine layered onto the existing connect flow. Six states, described end-to-end.

**State 0 — Pre-connect (unchanged).**
`POST /api/sessions/[id]/start` has set `sessions.status='active'`, minted the audit token, seeded the wall-clock timer. `POST /api/recall/bot` launched the bot. `WalkthroughClient` mounts inside the bot's headless browser. Nothing visual yet beyond the existing bot-warmup overlay / "Your session will begin shortly…" idle state.

**State 1 — Connection opening (unchanged sequence, one addition).**
Inside `connect()`'s Hume branch:
1. `writeAuditEvent(userId, 'voice_connect_attempt', …)` — informational only (unchanged, ~line 605).
2. `POST /api/hume-native/provision-config` — the existing `CONTENT-POP-01` content-readiness hard gate. On failure it returns non-2xx and `connect()` throws (no silent fallback). **Unchanged; runs before the relay gate.**
3. `HumeAdapter.create({ … })` opens the WebSocket and registers `onConnect` / `onMessage` / `tools`. **Unchanged.**
4. **(New)** The moment `HumeAdapter.create(...)` resolves and `adapterRef.current = hume` is set, on a fresh connect meeting all Section 3 conditions, the **relay-confirm timeout is armed** (`relayConfirmTimeoutRef`, `RELAY_CONFIRM_TIMEOUT_MS = 20000`). See Section 4a for exact ordering.

**State 2 — Waiting for relay confirmation (new, invisible; happy path resolves here in ~2–6s).**
Clio's opening turn is generated server-side and streamed back as Hume `assistant_message` events. In Hume-native mode Clio always speaks first — Hume auto-triggers her greeting on chat start (this is the exact behavior `HUME-SPEAK-01` restored; the pre-emptive `session_settings` send is skipped for native mode precisely so Hume's own greeting inference fires — see `lib/voice/hume-adapter.ts` lines 86–99). No participant utterance is required.

- The **relay-confirmed condition (RC)** is: `WalkthroughClient` receives at least one `onMessage(text, source)` callback with `source === 'ai'` **and** `text.trim().length > 0` since this connection attempt began. This is Clio's first transcribed spoken words reaching the app — precisely the stream the future tracker will consume (`HumeAdapter` fires `onMessage(_, 'ai')` only for non-empty `assistant_message` content — `hume-adapter.ts` line 181).
- On the happy path, the first non-empty `assistant_message` arrives within a few seconds → RC satisfied → `relayConfirmTimeoutRef` cleared → the (deferred) billing-start proceeds (State 3). The participant sees only the normal session — no relay-gate UI ever appears.

**State 3 — Relay confirmed → session proceeds exactly as today (happy path).**
1. RC satisfied clears the timeout and marks `relayConfirmedRef.current = true`.
2. Billing start (`speak_verified`) is written **now** (see Section 4a for why it is deferred to this instant when the toggle is on). From here the session is byte-for-byte identical to today: `show_visual`/`advance_tab`/`end_session` tools, silence handling, reconnect logic, wrap-up nudge, teardown — all unchanged.
3. On any subsequent reconnect within the same session, the gate does **not** re-run (Section 3 condition 4/5): relay-confirmation is presumed once billing has started, exactly as reconnects presume the session is already live today.

**State 4 — Relay NOT confirmed within the bound → BLOCK + reschedule (new).**
If `RELAY_CONFIRM_TIMEOUT_MS` elapses with RC never satisfied (no non-empty `ai` transcript ever arrived — dead relay, or `chat_metadata` arrived but no assistant transcript ever did):
1. Set `sessionEndedRef.current = true` **first**, so the existing `onDisconnect` auto-reconnect logic (`WalkthroughClient` ~lines 688–702) will not attempt to reconnect this dead session.
2. Close the Hume WebSocket: `adapterRef.current?.endSession()`.
3. Call the new teardown+reschedule endpoint `POST /api/sessions/relay-blocked` with `{ userId, token: auditTokenRef.current }` (fire-and-forget, same shape as `endCallOnServer`). This endpoint (Section 6) deletes the Recall.ai bot, tears down `walkthrough_state`, and reverts the session `active → scheduled` with `started_at = null` — writing **no** billing event and **no** minutes deduction.
4. Set new client state `relayBlocked = true` → renders the "Session Rescheduled" screen (State 5 / Section 5). This state is mutually exclusive with, and takes precedence over, the existing `connectionError` "Unable to Connect" modal, so the two never appear together.
5. Billing invariant: because `speak_verified` was gated behind RC (Section 4a) and RC never fired, `speak_verified` is never written → zero minutes billed (Section 7, AC-6).

**State 5 — "Session Rescheduled" screen (new, user-facing — the one new screen).**
A calm full-screen overlay (Section 5 wireframe + copy) telling the participant the live connection to their coach could not be established, the team has been notified and will look into it, and the session has been rescheduled — no raw error text, and **no "retry now" action** (fail-closed: we do not invite the user to hammer a dead relay). This is deliberately different in tone, color, and affordance from the existing red technical "Unable to Connect" modal (Section 5 contrasts them explicitly).

**State 6 — Hard backstop (unchanged, pre-existing).**
The wall-clock `inngest/session-timer.ts` backstop still exists and would force-end the (already reverted) session harmlessly if anything above failed; `forceEndSession` is idempotent and a no-op on a non-`active` row. No change.

## 4a. Exact position of the gate relative to existing signals (resolves Q2)

Ordering within `connect()`'s Hume branch, fresh connect, toggle ON:

```
provision-config (CONTENT-POP-01 content gate)     [existing, unchanged — runs FIRST]
        │  (throws on failure → no session, no billing)
        ▼
HumeAdapter.create(...) resolves                    [existing]
        │
        ▼
adapterRef.current = hume                           [existing]
        │
        ├─► ARM relayConfirmTimeoutRef (20s)         [NEW — gate arms here]
        │
        ├─► register hume.onSpeakVerified(cb)        [existing call site ~line 888, BEHAVIOR CHANGED when toggle ON]
        │       cb: if toggle ON → set speakVerifiedPendingRef = true   (DEFER the audit write)
        │           if toggle OFF → write speak_verified NOW            (today's exact behavior)
        │
        ▼
onMessage(text,'ai') with non-empty text  ── first occurrence ──► RC SATISFIED
        │       - clear relayConfirmTimeoutRef
        │       - relayConfirmedRef = true
        │       - if speakVerifiedPendingRef && !speakVerifiedWrittenRef:
        │              write speak_verified NOW  ◄── BILLING STARTS, strictly AFTER relay confirmed
        │
   (or) relayConfirmTimeoutRef elapses first ──────────────────► BLOCK (State 4)
                - speak_verified never written → zero minutes
```

Why billing structurally cannot precede relay confirmation (the load-bearing guarantee):
- Today, `speak_verified` (the sole billing-start event — `AUTOGEN-01` Part D) is written synchronously inside the `onSpeakVerified` callback, which `HumeAdapter` fires on the first `assistant_message` **regardless of whether that message carried non-empty transcript text** (`hume-adapter.ts` lines 175–178 fire `speakVerifiedCallback` before the text check on line 181).
- When the toggle is ON, that callback no longer writes; it only sets `speakVerifiedPendingRef`. The write is moved to the RC handler, which fires only on a **non-empty** `ai` transcript. Because a non-empty `ai` `onMessage` is a strict superset of the raw `assistant_message` that triggers `onSpeakVerified`, in the happy path RC and the pending speak-verified coincide on the same message and billing writes essentially simultaneously — just reordered to be provably *after* transcript confirmation.
- This also closes a latent hole: an `assistant_message` with empty content would today fire `speak_verified` (billing) even though no transcript reached the app. Under the gate, that empty message does not satisfy RC, so billing is withheld until a real transcript arrives or the timeout blocks — never billing a transcript-dead session.

Relationship to the other existing gates (must not be weakened — Feature Brief Known Constraints):
- **`CONTENT-POP-01`** (content-readiness, `provision-config/route.ts`) runs strictly **before** `HumeAdapter.create`, so before the relay gate. Unchanged. A content-unready session never reaches the relay gate at all.
- **`speak_verified` billing-start** (`AUTOGEN-01`) is not removed or weakened — it is made *contingent* on relay confirmation (a strictly stronger precondition). When the toggle is OFF it is byte-for-byte today's behavior.
- **`onConnect` (`chat_metadata`)** is explicitly **not** sufficient proof (per `hume-adapter.ts` design notes it only proves metadata was received, not that transcript data flows) and is not used as the relay signal.

## 5. Visual Examples

Two distinct screen states are relevant: the NEW "Session Rescheduled" screen, and the EXISTING "Unable to Connect" modal it must be distinguishable from.

**NEW — "Session Rescheduled" overlay (State 5).** Full-screen, dark (`#080808`/90 backdrop), centered card on `#111111` with a subtle amber-not-red accent (calm, executive-appropriate — this is not an alarm, it is a graceful deferral). No raw error string. No "retry" button. Rendered by `WalkthroughClient` alongside the existing `sessionComplete`/`connectionError` overlays (~lines 1714–1753), gated on the new `relayBlocked` state and taking precedence over `connectionError`.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                          ◷                                   │
│                (amber clock/calendar glyph)                  │
│                                                              │
│              We've rescheduled this session                 │
│                                                              │
│     We couldn't establish a stable live connection to      │
│     your coach just now, so we've stopped here rather       │
│     than run a degraded session.                            │
│                                                              │
│     Our team has been notified and is looking into it.      │
│     This session has been returned to your schedule —       │
│     you can start it again in a moment, and you have not    │
│     been charged any minutes for this attempt.              │
│                                                              │
│            [ Return to my sessions ]                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Exact copy (verbatim, load-bearing):
- Heading: **"We've rescheduled this session"**
- Body ¶1: "We couldn't establish a stable live connection to your coach just now, so we've stopped here rather than run a degraded session."
- Body ¶2: "Our team has been notified and is looking into it. This session has been returned to your schedule — you can start it again in a moment, and you have not been charged any minutes for this attempt."
- Single action, secondary style (bordered, not solid): **"Return to my sessions"** → navigates to `/dashboard/sessions` (`window.location.href = '/dashboard/sessions'`). In the Recall.ai bot's headless browser this button is inert-but-harmless (the human sees the message on the shared screen); the human relaunches from their own dashboard.

Styling tokens (per project design system): backdrop `bg-[#080808]/90`, card `bg-[#111111] border border-[#333333] rounded-xl p-8 max-w-md`, heading `text-white text-xl font-semibold`, body `text-[#94A3B8] text-sm leading-relaxed`, accent glyph `text-[#F59E0B]`, button `border border-[#333333] text-[#94A3B8] hover:text-white hover:border-[#555555]`. Framer Motion fade-in (`initial opacity 0 → animate opacity 1`), matching the existing overlays.

**EXISTING — "Unable to Connect" modal (for contrast; unchanged).** Red dot, technical heading, raw `connectionError` string in monospace, and a solid-purple **"Refresh & Try Again"** button (retry-oriented). ~lines 1729–1753.

```
┌──────────────────────────────────────────────┐
│  ● Unable to Connect                         │
│                                              │
│  Clio could not establish a stable           │
│  connection after 6 attempts. This is        │
│  usually a temporary issue…                  │
│  <raw error string, monospace>               │
│                                              │
│  [ Refresh & Try Again ]  (solid purple)     │
└──────────────────────────────────────────────┘
```

How they differ, and why it matters:
| | Existing "Unable to Connect" | NEW "Session Rescheduled" |
|---|---|---|
| Trigger | WS drop / connect failure after 6 reconnect attempts (`connectionError`) | Relay-confirm timeout: socket/metadata may be fine but **transcript never flowed** (`relayBlocked`) |
| Tone / color | Red, technical, alarming | Amber, calm, reassuring |
| Raw error shown | Yes (monospace) | No |
| Primary action | "Refresh & Try Again" (invites retry) | "Return to my sessions" (no retry — fail-closed) |
| Billing implication | Not asserted | Explicitly "not been charged any minutes" |
| Session state after | Left as-is | Reverted to `scheduled`, relaunchable |

Precedence rule: when `relayBlocked` is true, the `connectionError` overlay must not render (the relay block already tore the connection down, which will also set `connectionError` via `onDisconnect`; `relayBlocked` wins). Implement as `{connectionError && !sessionComplete && !relayBlocked && (…)}` on the existing modal, plus the new `{relayBlocked && (…)}` block.

## 6. Data Requirements

**Reads (existing, unchanged):** `walkthrough_state` (`session_id`, `audit_token`, `bot_id`) keyed by `userId` — as `end-call` already does.

**Writes:**
- **No new columns, no migration.** Reuses existing `sessions` columns (`status`, `started_at`) and `walkthrough_state` columns already written by `forceEndSession`.
- The new `POST /api/sessions/relay-blocked` endpoint writes:
  - `sessions`: `status = 'scheduled'`, `started_at = null` for the resolved active session. **No** `ended_at`, **no** `duration_mins`, **no** `deduct_minutes` RPC, **no** `disconnected` audit event — a relay-blocked session is not "completed," it is "un-started," so nothing about it touches billing.
  - `walkthrough_state` (keyed by `userId`): the same teardown fields `forceEndSession` clears — `bot_id = null`, `meeting_url = null`, `status = 'idle'`, `sections = null`, `training_scripts = null`, `session_brief/topic_context/session_script/clio_session_context = null`, `topic_title/topic_id = null`, `visual_spec = null`, `current_section_index = 0`, `pending_transcript = null`, `audit_token = null` (rotate the token out so it can't be replayed).

**External APIs called:**
- Recall.ai bot deletion: `getMeetingBotProvider().deleteBot(botId)` — the exact primitive `forceEndSession` already uses (`lib/session-billing.ts` line 453). Through the approved provider SDK. Non-fatal on error (log, continue), same as `forceEndSession`.
- No Anthropic / Hume / Stripe / Twilio calls added.

**localStorage / sessionStorage:** none.

**New client state / refs in `WalkthroughClient.tsx`:**
- `relayConfirmTimeoutRef: useRef<ReturnType<typeof setTimeout> | null>(null)` — the armed timeout; cleared on RC, on block, on `end`/unmount.
- `relayConfirmedRef: useRef(false)` — RC latch.
- `speakVerifiedPendingRef: useRef(false)` — set by the deferred `onSpeakVerified` callback (toggle ON); consumed by the RC handler to write billing.
- `relayBlocked: useState(false)` — drives the new overlay.
- Module constants: `RELAY_PREFLIGHT_GATE_ENABLED = process.env.NEXT_PUBLIC_RELAY_PREFLIGHT_GATE_ENABLED === 'true'`; `RELAY_CONFIRM_TIMEOUT_MS = 20000`.

**New endpoint:** `POST /api/sessions/relay-blocked/route.ts` — auth model mirrors `app/api/sessions/end-call/route.ts` byte-for-byte: `z.object({ userId: z.string().min(1), token: z.string().min(1) })`; resolve `session_id` + `audit_token` from `walkthrough_state` by `userId`; `verifyAuditToken(token, …)` fail-closed 401; resolve active session; perform the writes above; return `{ ok: true }` (or `{ ok:false }` non-fatally, never throwing to the caller). It does **not** import or call `forceEndSession` (that path bills + completes) — it reuses the same *primitives* (`verifyAuditToken`, `getMeetingBotProvider().deleteBot`, the `walkthrough_state` teardown shape) with the reschedule-specific `sessions` write.

## 7. Success Criteria (Acceptance Tests)

Gherkin-style; all testable by QA (unit/integration for the client state machine + endpoint, and one live Hume-native run).

✓ **AC-1 (happy path, gate invisible).** Given the toggle is ON and a fresh Hume-native session, when Clio's first non-empty `assistant_message` (`onMessage(text,'ai')`, `text.trim().length>0`) arrives within 20s of `HumeAdapter.create` resolving, then `relayConfirmTimeoutRef` is cleared, `relayConfirmedRef` becomes true, `speak_verified` is written exactly once, and the session proceeds with no `relayBlocked` UI ever shown — behavior otherwise identical to today.

✓ **AC-2 (relay dead → block).** Given the toggle is ON and a fresh Hume-native session where no non-empty `ai` `onMessage` ever arrives, when 20s elapse, then: `sessionEndedRef` is set true, the Hume WS is closed, `POST /api/sessions/relay-blocked` is called, `relayBlocked` becomes true, and the "Session Rescheduled" overlay renders. No auto-reconnect is attempted.

✓ **AC-3 (billing-start is gated, ordering).** Given the toggle is ON, when the adapter's `onSpeakVerified` fires (on the first `assistant_message`) but before any non-empty `ai` `onMessage`, then `speak_verified` is NOT yet written (`speakVerifiedPendingRef` set, no audit write); it is written only when RC is subsequently satisfied — proving billing never precedes relay confirmation.

✓ **AC-4 (empty-transcript hole closed).** Given the toggle is ON and the only `assistant_message`(s) received carry empty content (fire `onSpeakVerified` but not `onMessage('ai')`), when 20s elapse, then the session is blocked (AC-2 outcome) and `speak_verified` is never written — a transcript-dead session cannot bill via an empty assistant message.

✓ **AC-5 (reschedule state transition).** Given a relay-blocked session, when `POST /api/sessions/relay-blocked` completes, then the `sessions` row has `status='scheduled'` and `started_at=null`, the `walkthrough_state` row is torn down (`bot_id=null`, `status='idle'`, `audit_token=null`), and the Recall.ai `deleteBot` was invoked — with no `ended_at`, no `duration_mins` change, and no `deduct_minutes` call.

✓ **AC-6 (zero minutes billed — the hard guarantee).** Given a relay-blocked session, when the flow completes, then no `speak_verified` and no `disconnected` audit events exist for it, `computeBilledMinutes` for it would return 0, no `minutes_ledger` deduction row is written, and the user's `minutes_balance` is unchanged from before the attempt.

✓ **AC-7 (toggle OFF = byte-identical to today).** Given `NEXT_PUBLIC_RELAY_PREFLIGHT_GATE_ENABLED` is unset or any value other than the exact string `'true'`, when any Hume-native (or ElevenLabs, or Custom-LLM) session runs, then: no relay-confirm timeout is armed, `speak_verified` is written immediately inside `onSpeakVerified` exactly as today, `relayBlocked` can never become true, the new overlay never renders, and the connect sequence is identical to current production. (Verified by asserting the code path with the flag off makes zero new writes/timers and the `onSpeakVerified` callback body is today's.)

✓ **AC-8 (reconnect is never re-gated).** Given a session that already reached `speak_verified` (billing started), when the WebSocket drops and `WalkthroughClient` reconnects (`isReconnect`/`isMidSession`), then the relay gate does NOT arm, does NOT defer billing, and cannot block — the mid-session reconnect behaves exactly as today.

✓ **AC-9 (auth fail-closed on the endpoint).** Given a `POST /api/sessions/relay-blocked` with a missing/invalid `token`, when processed, then it returns 401 and performs no bot deletion, no `walkthrough_state` teardown, and no `sessions` status change — identical fail-closed posture to `end-call`.

✓ **AC-10 (scope isolation).** Given `VOICE_PROVIDER='elevenlabs'` OR (`hume` with `HUME_NATIVE_ENABLED=false`), when a session runs with the toggle ON, then the relay gate never arms (Section 3 conditions unmet) and those paths are unaffected.

✓ **AC-11 (precedence with existing modal).** Given a relay block that also causes `onDisconnect` to set `connectionError`, when the UI renders, then only the "Session Rescheduled" overlay shows and the red "Unable to Connect" modal is suppressed.

## 8. Error States

- **`POST /api/sessions/relay-blocked` fetch fails or is slow (network):** fire-and-forget, `.catch()` logs; never throws into `connect()`. The block UI still renders (client state is set independently of the endpoint result). The wall-clock `session-timer.ts` backstop remains the ultimate cleanup for the bot/`active` row if the endpoint never lands (it force-ends idempotently; a subsequent `scheduled` revert is not applied in that fallback, but the session is off `active` and unbilled beyond the timer's own zero-minutes computation since no `speak_verified` exists).
- **`deleteBot` throws inside the endpoint:** caught and logged non-fatally (same as `forceEndSession` line 454–456); the `sessions`/`walkthrough_state` writes still proceed so the session is reverted regardless.
- **`auditTokenRef.current` is null at block time (token not yet loaded):** the endpoint call is still attempted; server returns 401 and the block UI still shows. Mirrors `endCallOnServer`'s existing "attempt anyway, non-fatal" contract (`WalkthroughClient` ~lines 145–147). The wall-clock backstop covers cleanup.
- **RC arrives in the same tick the timeout fires (race):** the RC handler clears the timeout first thing; if the timeout callback already ran, it checks `relayConfirmedRef` / `sessionEndedRef` and no-ops if RC already latched — exactly the guard pattern the existing `farewellFallbackTimeoutRef` callback uses (`WalkthroughClient` ~line 754). Whichever wins, only one of {proceed, block} executes.
- **`HumeAdapter.create` itself throws (socket never opens):** existing connect `try/catch` handles it (reconnect/`connectionError`) — the relay gate never arms, and no `speak_verified` is written, so no billing. Not this feature's concern; unchanged.
- **provision-config returns non-2xx:** existing `CONTENT-POP-01` hard fail — `connect()` throws before the gate. Unchanged.
- **Slow but alive first utterance (false-negative risk):** see Section 9 / Q7.

## 9. Edge Cases

- **Slow first utterance (Q7 — false-negative bound).** Risk: the relay was fine but Clio's first transcript landed after 20s, wrongly blocking. Mitigations: (1) the 20s bound is ~3–10× typical first-utterance latency (2–6s observed for greeting generation + TTS); (2) the timer starts at `HumeAdapter.create` resolution (post-socket-open) so it measures the transcript window, not TCP/handshake setup; (3) RC is satisfied by the *earliest possible* positive signal (first non-empty `ai` word), not a later checkpoint; (4) `HumeAdapter`'s own internal reconnects (`hume-adapter.ts` MAX_RECONNECT=3, 1→2→4s backoff) are spanned by the single outer 20s window, and a transcript delivered after such a reconnect still satisfies RC. Residual false-negatives are bounded and *recoverable*: the session is reverted to `scheduled` and relaunchable, and — critically — is never mis-billed. This is the deliberate fail-closed bias (Feature Brief): prefer rescheduling a healthy session over running a broken one. The 20s value is a named constant, trivially tunable if field data warrants.
- **Participant stays silent through the opening (by design).** RC depends only on **Clio's** stream, never the participant's — so a silent executive never causes a false block. This is why the participant transcript webhook is deliberately NOT part of the relay signal (Q1 rationale, Section 11).
- **First-time vs returning user:** identical — the gate keys off transcript flow, not user history.
- **Reconnect / mid-session resume:** never gated (AC-8) — Clio has already spoken, relay already proven, billing already started.
- **Very short sessions (`duration_mins <= 2`):** unaffected — the gate concerns only the first ~20s connect window; the wall-clock timer is untouched.
- **Mobile vs desktop:** the overlay is responsive (`max-w-md`, centered), same as existing overlays; the human sees it via the bot's shared screen regardless of their own device.
- **Toggle flipped OFF mid-session:** the constant is read once at connect; a session already past the gate is unaffected. New connects read the new value. No partial-state hazard.
- **Two rapid launches / stale token:** the endpoint resolves the *current* active session for the user and requires the current `audit_token`; a stale token 401s (AC-9), so it can never revert the wrong session.

## 10. Out of Scope

- All later-phase RTV work: marker/keyword generation (#3), position tracking (#2/#4), template selection/library (#9/#11), pre-fetch/display triggers (#7/#8), the display-authority toggle (#18). This phase only answers "is the transcript relay alive; if not, don't start, reschedule, tell the user politely."
- Any change to ElevenLabs or Hume-Custom-LLM (`LIVE-01`) paths.
- Any change to `forceEndSession`, `computeBilledMinutes`, `finalizeHumeNativeBilling`, or the `speak_verified` *definition* (it is only made contingent, never redefined).
- Any change to `CONTENT-POP-01` (`provision-config`), the wall-clock `session-timer.ts` backstop, the silence-handling escalation, the wrap-up nudge, or `SESSION-END-01` farewell/`end_session` logic.
- Building a new scheduler or auto-picking a new session time. "Reschedule" = revert to the existing `scheduled` status (relaunchable) via the existing lifecycle. Auto-selecting a *future* `scheduled_at` and/or sending an immediate "relay failed" email are NOT built here (see CEO-escalation note returned separately with a recommendation).
- Any admin/ops dashboard to observe relay-block events (relies on existing `console.warn`/log diagnosability, consistent with SESSION-END-01).
- No DB migration, no new env var beyond the single toggle.

## 11. Open Questions

None. Every question in the Feature Brief is resolved below with the evidence behind it.

**Q1 — "Relay confirmed working," operationally.** The relay is **the Clio-speech transcript stream**: `WalkthroughClient` receiving at least one `onMessage(text, source)` with `source === 'ai'` and `text.trim().length > 0`, within **20s** (`RELAY_CONFIRM_TIMEOUT_MS`) of `HumeAdapter.create` resolving on a fresh connect. This genuinely proves *live transcript flow* (not merely an open socket or received metadata) because: (a) it is the exact byte stream the later-phase tracker will consume, so confirming it confirms the tracker's own input; (b) `HumeAdapter` fires `onMessage(_, 'ai')` only for a non-empty `assistant_message` (`hume-adapter.ts` line 181) — i.e. actual transcribed words, strictly stronger than `chat_metadata`/`onConnect` (which the adapter's own notes flag as proving only that metadata arrived) and strictly stronger than the raw `assistant_message` that triggers `speak_verified` (which may be empty). We deliberately do **not** require the participant transcript webhook: (i) the tracker watches Clio, not the participant, so participant data would not prove the relevant stream is alive; (ii) requiring participant speech would make the gate depend on human timing and could block a perfectly healthy session or hang indefinitely. Clio deterministically speaks first in Hume-native mode (auto-greeting, `HUME-SPEAK-01`), so her first utterance is the earliest, most reliable, directly-relevant proof.

**Q2 — Gate position.** Fully specified in Section 4a: arms immediately after `HumeAdapter.create` resolves (after `provision-config`/`CONTENT-POP-01`, after `HumeAdapter.create`, alongside the `onConnect`/`onSpeakVerified` registration); `speak_verified` (billing) is deferred and written only in the RC handler, so the session cannot reach billing until the relay is confirmed. On timeout it blocks before any `speak_verified`.

**Q3 — Blocked-session UX.** Fully specified in Section 5 (verbatim copy, wireframe, tokens, component, and the explicit contrast table vs the existing red "Unable to Connect" modal, plus the precedence rule).

**Q4 — Reschedule action.** Reuses existing lifecycle primitives, no new scheduler: new `POST /api/sessions/relay-blocked` reuses `verifyAuditToken` + `getMeetingBotProvider().deleteBot` + the `walkthrough_state` teardown shape from `forceEndSession`, and performs the exact status transition `active → scheduled` with `started_at = null` (the same `scheduled` state the normal "Launch AI Coach" path — `sessions/[id]/start`, per `REVERT-01` — already relaunches from). It writes no billing. `scheduled_at` is left unchanged in v1 so the session immediately re-appears as launchable (default decision; the "auto-set a future time + notify by email" option is escalated to CEO with a recommendation, and is not required for a complete, buildable v1).

**Q5 — Toggle.** `NEXT_PUBLIC_RELAY_PREFLIGHT_GATE_ENABLED`, read client-side (this lives in the connect flow), strict-equality `=== 'true'` so anything else (unset/`false`/typo) is OFF — the same fail-safe default pattern as `HUME_NATIVE_SUMMARY_MODE`/`HUME_NATIVE_ENABLED`. Default OFF. OFF = today's exact behavior, asserted as AC-7 (no timer, no deferral, immediate `speak_verified`, no new state/overlay reachable).

**Q6 — Billing safety.** `speak_verified` is the sole billing-start event and is gated behind RC; on block it is never written, so `computeBilledMinutes` yields 0 and no deduction/ledger write occurs (AC-6). Testable and explicit.

**Q7 — False-negative risk.** Bounded and recoverable — full analysis in Section 9 (20s ≫ typical latency; timer measures the transcript window; earliest-possible RC signal; spans internal reconnects; residual false-negative → relaunchable + unbilled, never mis-charged). Fail-closed bias is intentional and does not weaken the guarantee.

## 12. Dependencies

- **No new external dependency, no new credential.** Reuses the existing Recall.ai provider (`getMeetingBotProvider().deleteBot`), the existing audit-token auth (`verifyAuditToken`, minted by `sessions/[id]/start`), and the existing Hume `onMessage`/`onSpeakVerified` plumbing — all already live in production.
- **No DB migration.** Reuses existing `sessions.status`/`sessions.started_at` and the `walkthrough_state` teardown columns.
- **One new env var** (the toggle), default OFF — documented in `.env.local.example` as `NEXT_PUBLIC_RELAY_PREFLIGHT_GATE_ENABLED=PLACEHOLDER_false` (a `NEXT_PUBLIC_` client var, so it must be present at build time in the environment where the gate is to be exercised).
- **Must be true before build:** the Hume-native path (`NEXT_PUBLIC_VOICE_PROVIDER=hume` + `NEXT_PUBLIC_HUME_NATIVE_ENABLED=true`) is the only path this touches; it is already live behind those flags. No other feature must ship first.
- **Files touched:**
  - `app/dashboard/walkthrough/WalkthroughClient.tsx` — new constants/refs/state, gate arm after `HumeAdapter.create`, deferred `onSpeakVerified` + RC-triggered billing write inside the Hume-branch `onMessage('ai')` handler, block path, new overlay + precedence guard on the existing `connectionError` overlay. (No change to ElevenLabs/Custom-LLM blocks, `show_visual`, `advance_tab`, `end_session`, silence handling, wrap-up nudge, reconnect logic.)
  - `app/api/sessions/relay-blocked/route.ts` — new endpoint (mirrors `end-call` auth; reschedule-specific writes).
  - `.env.local.example` — document the toggle.
- Unmodified but depended on as-is: `lib/session-billing.ts` (`forceEndSession`, `verifyAuditToken`, primitives), `lib/voice/hume-adapter.ts` (`onMessage`/`onSpeakVerified` — no change needed), `app/api/hume-native/provision-config/route.ts`, `inngest/session-timer.ts`.

## CEO Review

Status: **APPROVED** — 2026-07-10, CEO Agent. Cleared to build → test → deploy per Arun's standing authorization for this series.

Review notes:
- Section 11 empty; all 7 Feature-Brief questions resolved with line-cited evidence against real source. 11 testable acceptance criteria. Fail-closed guarantee is airtight; the deferred-`speak_verified` design provably prevents billing before relay confirmation and additionally closes the latent empty-`assistant_message` billing hole — a genuine improvement.
- **CEO decision on the one escalated item (reschedule-time policy):** Ship the document's v1 default — on a relay block, revert the session to `scheduled` (relaunchable), leave `scheduled_at` unchanged, and use the in-session overlay as the only notice. This is the faithful, literal implementation of Arun's requirement #19 ("a polite message that the relay was unsuccessful… the session will be rescheduled"). Auto-selecting a future `scheduled_at` and sending an immediate "relay failed" email are **deliberately NOT built in v1** — they edge into scheduler logic Arun scoped out, and per the "implement literally, don't over-build" principle they are unwarranted until field data shows relay blocks actually occur.
- **Backlog (fast-follow, not blocking):** if production shows real relay-block frequency, add an immediate "relay failed, rescheduled" notification (reuse `sendSessionsConfirmedEmail`/the reminder path) and optionally a `scheduled_at` bump. Log under the RTV series backlog.
- This phase does NOT touch the template-design approval gate (that is RTV-04). No Arun sign-off required to build/ship RTV-01.
