# Graceful Session End (Time-Aware Wrap-Up Nudge) — Requirement Document
Version: 1.0
Status: APPROVED (CEO addendum resolved all open design questions; see Section 11)
Author: Business Analyst Agent
Date: 2026-07-05

## 1. Purpose

Executives using Clio over Hume EVI native voice sessions currently experience an abrupt,
unprofessional call termination at the end of every timed session: no closing summary, no
goodbye, and — because the hard cutoff can land mid-sentence — sometimes a call that is cut off
while Clio is still speaking. This directly damages the "executive UX standard" (crisp, never
broken) at exactly the moment — session close — that should reinforce the value delivered.

This feature gives Clio (the Hume-native LLM) advance, one-time notice that the session is
nearing its end, so she can naturally summarize the two most important takeaways and say a real
goodbye — which, per the existing prompt template (rule 8), automatically triggers Hume EVI's own
built-in end-of-conversation hang-up. The call then ends because Clio chose to end it, not
because it was severed from outside.

Without this feature: every Hume-native session ends via the hard force-end backstop, with no
graceful wrap-up, indefinitely, for every user, on every session.

## 2. User Story

As an executive using Clio for a live Hume-native voice session,
I want the session to close with a brief summary and a natural goodbye instead of being cut off
abruptly,
So that the ending of every session reinforces trust and polish rather than undermining it.

(Single user type — this is a backend/voice-orchestration change with no new UI for the end user
to interact with; the "user-facing" surface is entirely the change in how the call sounds and
behaves at its end.)

## 3. Trigger / Entry Point

- **Not a route or button.** This is a server-side timing change inside the existing Inngest job
  `inngest/session-timer.ts`, which already runs for every session (triggered by the
  `clio/session.started` event, emitted from `app/api/sessions/[id]/start/route.ts` when a
  session begins).
- **Activates only for Hume-native sessions.** The job branches on `voice_provider` (the existing
  typed field `VoiceProvider = 'elevenlabs' | 'hume'` defined in `lib/session-billing.ts`,
  persisted per session). When `voice_provider === 'hume'` AND the session is running in
  HUME-NATIVE-01 mode (i.e. was provisioned via `provisionNativeConfig` —
  `lib/voice/hume-native/config-provisioner.ts` — as opposed to the older Custom-LLM/LIVE-01 Hume
  path), the new nudge step runs. For every other case (ElevenLabs sessions, and
  Custom-LLM-mode Hume sessions if any still exist), the existing `pending_transcript`-based
  1-minute-warning step runs completely unchanged — this feature does not alter that path at
  all.
- **State required:** the session must already be in progress (an active `walkthrough_state` row
  keyed by `user_id`, an open Hume EVI native WebSocket connection in the Recall.ai bot's headless
  browser via `HumeAdapter`, and the `clio/session.started` Inngest job already running with its
  captured `durationMins`).

## 4. Screen / Flow Description

There is no new screen. The "flow" is entirely server timing + one WebSocket message + the voice
model's own behavior. Described step by step:

**State 1 — Session running normally (no visible change).**
Identical to today: the Hume-native session proceeds, `session-timer.ts` is asleep, waiting.

**State 2 — Nudge fires (~2 minutes before hard cutoff).**
1. `session-timer.ts`'s sleep completes at `durationMins - 2` minutes (Hume-native branch only;
   see Section 6 for why 2 minutes vs. the existing 1-minute ElevenLabs lead time).
2. The job checks the session isn't already `completed` (same guard the existing warning step
   uses).
3. The job writes a new field, `hume_wrapup_nudge_pending = true` (boolean, default `false`), to
   the same `walkthrough_state` row the user's bot already has (see Section 6, Data Requirements,
   for the exact column). This is a **new, Hume-specific field** — it does NOT reuse
   `pending_transcript` (that field is ElevenLabs-only, per the CEO's brief; reusing it would make
   the client (mis)treat the nudge as a user transcript to forward via `sendUserMessage`, which is
   the wrong code path entirely for Hume).
4. The existing client-side poll in `WalkthroughClient.tsx` (`GET /api/walkthrough-state/[userId]`
   on a 2-second `setInterval`, already running unconditionally for every session type) picks up
   `hume_wrapup_nudge_pending: true` on its next poll cycle (worst case ~2 seconds after the
   server write).
5. On seeing this flag `true` (and only when the active adapter is a `HumeAdapter` instance, i.e.
   `VOICE_PROVIDER === 'hume'` and native mode is active), the client sends one additional
   `session_settings` WebSocket message over the *already-open* Hume connection (the same
   `this.ws.send(JSON.stringify({...}))` pattern already used once at connect-time in
   `hume-adapter.ts` lines 78–81), carrying the wrap-up instruction text (Section 6, item 3, exact
   string).
6. The client immediately calls `PATCH /api/walkthrough-state/[userId]` with the new flag reset to
   `false` (mirroring the existing `pending_transcript` clear-after-send pattern already used at
   lines 1240/1257 of `WalkthroughClient.tsx`), so the nudge is never re-sent on a later poll.
7. Clio (Hume's own native LLM, running the existing prompt template) receives this as a
   `session_settings` update and, per rule 8 of `lib/voice/hume-native/prompt-template.ts`
   (already shipped, unmodified), briefly summarizes two takeaways and says a natural goodbye.
8. Clio's goodbye is detected by Hume EVI's own built-in end-of-conversation logic (a Hume
   platform behavior, not app code) and the call ends.

**State 3 — Grace period / backstop (only if State 2 doesn't result in a closed call).**
1. `session-timer.ts` continues its existing sleep (final 2 minutes — see Section 6 for why the
   grace window is being widened, not reused as-is, for the Hume-native branch).
2. If the session is not yet `completed` when that sleep ends, the existing, completely
   unmodified `forceEndSession()` (`lib/session-billing.ts`) fires exactly as it does today —
   deletes the bot, clears `walkthrough_state`, computes billed minutes from the audit log, marks
   the session `completed`.
3. This is idempotent and identical to current production behavior; nothing about this feature
   changes what `forceEndSession()` does or how minutes are computed.

**State 4 — Nudge fails to reach the client (WebSocket error, adapter not open, etc.).**
1. If the client's `session_settings.send()` call throws, or the WebSocket is not in `OPEN`
   state, one immediate retry is attempted (Section 6, item 4).
2. If the retry also fails, the client logs the failure and takes no further action — no error is
   surfaced to the user, no additional retries, nothing blocks or delays the `session-timer.ts`
   backstop sleep. The backstop fires on schedule as if the nudge had never been attempted.

## 5. Visual Examples

No new visible UI. There is one audible-only "screen" from the user's perspective — the sound of
the call, which changes from an abrupt cutoff to a spoken summary + goodbye:

```
┌─────────────────────────────────────────────────────────┐
│  (No visual change to any dashboard/walkthrough screen)  │
│                                                           │
│  Before (today):                                         │
│  ...Clio speaking mid-sentence... [CALL DROPS]           │
│                                                           │
│  After (this feature):                                   │
│  ...Clio: "So the key takeaways today were X and Y.      │
│  It was great working with you — take care, talk soon."  │
│  [Hume EVI auto-hangs-up on goodbye detection]            │
└─────────────────────────────────────────────────────────┘
```

No wireframe changes to `WalkthroughClient.tsx`'s rendered output are required by this feature —
see Section 10, Out of Scope.

## 6. Data Requirements

**Read from the database:**
- `walkthrough_state.user_id`, `.status` (existing) — to confirm the row exists and the session
  isn't already torn down.
- `sessions.status`, `sessions.voice_provider` (existing) — the timer job's existing guard
  already reads `sessions.status`; this feature additionally reads `voice_provider` to decide
  which branch to run. `voice_provider` is already a persisted, typed column per
  `lib/session-billing.ts`.
- `clio/session.started` Inngest event payload — already carries `durationMins`
  (`effectiveDurationMins`, captured pre-corruption in `app/api/sessions/[id]/start/route.ts` line
  ~80, before any force-end can touch the row — per the CEO's addendum, this event's own copy is
  never re-read live from `sessions.duration_mins`, so ACTION-ITEMS-2026-07-06 #2/#3 does not
  block this work).

**Written to the database:**
- `walkthrough_state.hume_wrapup_nudge_pending` (**new column**, `boolean`, `default false`,
  `not null`) — set to `true` by `session-timer.ts`'s new step; set back to `false` by the client
  via the existing `PATCH /api/walkthrough-state/[userId]` pattern once the nudge has been sent
  (or once a retry has been attempted and given up on — the flag must be cleared either way, so a
  failed nudge never gets silently re-sent forever on subsequent polls).
- No changes to any billing table, `delivery_log`-equivalent, or `sessions.duration_mins`/
  `actual_minutes_billed`. `lib/session-billing.ts` is not modified in any way.

**APIs / endpoints:**
- `GET /api/walkthrough-state/[userId]` (existing, unmodified route file, **new field added to
  its already-generic `select('*')` response** — no route code change needed since it already
  selects and returns the full row; only the new column plus the `WalkthroughState` TypeScript
  interface in `WalkthroughClient.tsx` need to include the new field).
- `PATCH /api/walkthrough-state/[userId]` (existing route) — **requires a small, additive code
  change**: today it unconditionally clears `pending_transcript`. It must also accept and clear
  `hume_wrapup_nudge_pending` (e.g. via a request body flag distinguishing which field to clear,
  or by always clearing both — implementation detail for Eng, either is acceptable since clearing
  an already-false flag is a no-op).
- Hume EVI WebSocket (existing open connection managed by `HumeAdapter`) — one additional
  `session_settings` send, no new connection.
- `lib/voice/hume-native/config-provisioner.ts` — **no change**. `timeouts.max_duration` remains
  exactly as it is today (hardcoded `{ enabled: false }`); this feature does not touch Config
  provisioning at all (see Section 10, Out of Scope — Arun decided not to use Hume's native
  `timeouts.max_duration` setting; the approach is now two layers only: the live nudge, and the
  existing `forceEndSession()` backstop).

**localStorage / sessionStorage:** none used by this feature.

## 7. Success Criteria (Acceptance Tests)

✓ Given a Hume-native session with `durationMins = 20`, when 18 minutes have elapsed, then
`walkthrough_state.hume_wrapup_nudge_pending` is set to `true` by `session-timer.ts`.

✓ Given `hume_wrapup_nudge_pending = true` and an open Hume-native WebSocket connection, when the
client's next poll (within 2 seconds) reads the flag, then exactly one `session_settings` message
containing the wrap-up instruction is sent over the existing WebSocket, and the flag is cleared
back to `false` via `PATCH`.

✓ Given the wrap-up nudge was delivered, when Clio (Hume's native LLM) processes it, then she
summarizes two takeaways and says a goodbye phrase matching the existing farewell-detection list
in `WalkthroughClient.tsx` (`FAREWELL_PHRASES`), and Hume EVI's own built-in hang-up ends the call
without `forceEndSession()` ever needing to fire.

✓ Given the nudge WebSocket send throws an exception (simulated by closing the socket
early/forcing an error), when the client attempts to send, then exactly one immediate retry is
attempted, and if that also fails, no further retries occur and no error is shown to the user —
the session continues uninterrupted until the existing backstop fires on schedule.

✓ Given `hume_wrapup_nudge_pending` was never set (e.g. `session-timer.ts` itself fails or is
delayed) or the nudge was sent but Clio never says a qualifying goodbye phrase, when the full
grace window elapses, then `forceEndSession()` fires exactly as it does today, with identical
billing/minute computation to current production behavior.

✓ Given an ElevenLabs session (any `voice_provider !== 'hume'`) or a Hume Custom-LLM/LIVE-01
session, when `session-timer.ts` runs, then it behaves exactly as it does today — no
`hume_wrapup_nudge_pending` field is ever written, and the existing `pending_transcript` warning
step is unaffected.

## 8. Error States

- **Nudge WebSocket send fails (throws or socket not `OPEN`):** one immediate retry; if that also
  fails, log client-side (`console.warn`) and silently continue — no user-visible error, no
  change to `agentStatus`/`connectionError` state. The backstop remains the safety net.
- **`session-timer.ts` step itself fails (e.g. Supabase write error) before setting the flag:**
  the step is wrapped in the same `step.run()` pattern as the existing warning step; Inngest's
  existing `retries: 1` job-level config applies. If it still fails, the flag is simply never
  set — the client never sees `hume_wrapup_nudge_pending: true`, no nudge is sent, and the
  existing backstop (State 3) fires on schedule exactly as if this feature did not exist. This is
  the intended degrade-to-current-behavior path required by the CEO's brief ("if the nudge fails
  to send for any reason, nothing changes from today's behavior").
- **Client polls but the Hume adapter is not currently open (e.g. mid-reconnect when the nudge
  flag arrives):** the client checks `adapterRef.current?.isOpen()` (existing method on
  `HumeAdapter`) before attempting the `session_settings` send. If not open, treat as a failed
  send — one retry on the next poll cycle only if the flag is still `true` (it will be, since it
  wasn't successfully cleared); if the adapter is still not open by the time the backstop's grace
  window elapses, the backstop fires regardless.
- **`walkthrough_state` row missing entirely (session torn down early):** the existing guard
  already present in `session-timer.ts` (checking `sessions.status === 'completed'`) skips the
  write entirely — no error thrown, matches current behavior for the existing warning step.

## 9. Edge Cases

- **Very short sessions (`durationMins <= 2`):** the existing warning step already special-cases
  `durationMins > 1` before sleeping; the Hume-native branch must apply the equivalent guard for
  its longer (2-minute) lead time — if `durationMins <= 2`, skip the pre-nudge sleep entirely and
  send the nudge immediately (or, if `durationMins` is so short the grace window would exceed the
  session, keep the existing backstop as the sole mechanism). Eng must mirror the existing
  `durationMins > 1` conditional structure with the adjusted threshold.
- **User reconnects (mid-session Hume WebSocket drop/reconnect) right as the nudge flag is set:**
  the flag persists in `walkthrough_state` until cleared, so a reconnecting client will still see
  and act on it on its first successful poll after reconnecting — no nudge is lost due to a
  reconnect racing the timer.
- **Session ends naturally (Clio says goodbye) before the nudge would ever fire:** `session-timer.ts`
  is already cancelled via its existing `cancelOn: [{ event: 'clio/session.ended', ... }]` config —
  unchanged, so the nudge step simply never runs. No conflict.
- **Multiple browser tabs / bot reload right as nudge is pending:** the flag is per-`user_id`
  (single active session per user, consistent with existing `walkthrough_state` design) — no
  new multi-tab concern beyond what already exists for `pending_transcript`.

## 10. Out of Scope

- Any change to how minutes are calculated, deducted, or displayed. `lib/session-billing.ts`
  (including `computeBilledMinutes` and `forceEndSession()`) is not touched by this feature in
  any way.
- **Enabling Hume's native `timeouts.max_duration` setting.** Arun has decided not to use this
  layer at all. `lib/voice/hume-native/config-provisioner.ts` is not modified by this feature —
  `timeouts.max_duration` stays exactly as it is today (`{ enabled: false }`), and
  `on_max_duration_timeout` stays disabled (`{ enabled: false, text: null }`). The approach is two
  layers only: (1) the live WebSocket nudge triggering Clio's own goodbye, and (2) the existing,
  untouched `forceEndSession()`/`session-timer.ts` backstop as the sole safety net. No
  `ProvisionNativeConfigParams` change, no `plannedDurationSecs` field, no Hume Configs API call
  change of any kind.
- Any UI change beyond the minimal, non-visual data plumbing needed to relay the signal (a new
  DB column read via an already-existing generic `select('*')`/poll cycle). No new screens, no
  new visible indicators, no changes to `SessionStack`, `ConceptVisualizer`, or any rendered
  component.
- The ElevenLabs delivery path and the Hume Custom-LLM (LIVE-01) path — both continue to use
  their existing, entirely unmodified `pending_transcript`-based 1-minute warning exactly as
  today.
- General mid-call steering, ongoing turn-by-turn LLM control, or any other injection beyond this
  single, one-time, near-end nudge. The "everything upfront, no mid-call injection" principle
  remains intact for all other purposes.
- Fixing the `duration_mins` corruption bug tracked separately in
  `docs/ACTION-ITEMS-2026-07-06.md` items #2/#3 — confirmed independent of this feature per the
  CEO's addendum (the Inngest event's captured `durationMins` value is never re-read live from
  the `sessions` table by any step in this job).
- Any retry/backoff policy beyond the single immediate retry specified in Section 8 — no
  exponential backoff, no queuing, no persistence of failed nudge attempts across polls beyond
  what the flag itself naturally provides.

## 11. Open Questions

None. All design questions raised in the original CEO brief (Section "Questions for BA," items
1–6) have been definitively resolved by the CEO's addendum and grounded against existing code in
this document:

1. **Trigger mechanism:** resolved — branch inside the existing `session-timer.ts` job by
   `voice_provider`; new Inngest step writes a new `walkthrough_state.hume_wrapup_nudge_pending`
   boolean field (not a reuse of `pending_transcript`, which is ElevenLabs-specific).
2. **Server-to-client relay:** resolved — the existing `GET /api/walkthrough-state/[userId]`
   poll, already running unconditionally in `WalkthroughClient.tsx` on a 2-second
   `setInterval`, is the reused channel. No new polling mechanism, no Supabase Realtime, no new
   endpoint.
3. **Exact nudge content/payload shape:** resolved — a second `session_settings` WebSocket send
   over the already-open Hume connection (same message type and send pattern already used once
   at connect-time in `hume-adapter.ts`), since HUME-NATIVE-01 sessions use Hume's own
   native/supplemental LLM (not the Custom-LLM bridge where `session_settings.system_prompt`
   is rejected with E0716 — that rejection is specific to Custom-LLM mode per the existing code
   comment in `hume-adapter.ts`).
4. **`timeouts.max_duration` provisioning change:** resolved — **not part of this feature's
   scope.** Arun decided against using Hume's native `timeouts.max_duration` setting entirely;
   `config-provisioner.ts` is not modified. The design is two layers only: the live nudge (primary)
   and the existing `forceEndSession()`/`session-timer.ts` backstop (sole safety net).
5. **Retry policy:** resolved — one immediate retry on send failure, then silent fallback to the
   backstop; never blocks or delays `session-timer.ts`'s existing sleep/force-end sequence.
6. **Grace period / lead time:** resolved — 2-minute lead time for the Hume-native branch
   (vs. 1 minute for the existing ElevenLabs path), to account for Hume EVI's own
   end-of-conversation detection latency after Clio's goodbye. The existing ElevenLabs branch's
   1-minute lead time and grace window are entirely unchanged.

## 12. Dependencies

- `inngest/session-timer.ts` must already be running and correctly triggered by
  `clio/session.started` for every session — existing, no change to this trigger.
- `lib/session-billing.ts`'s `forceEndSession()` must remain exactly as-is — this feature depends
  on it as an unmodified backstop; it does not modify it.
- `lib/voice/hume-adapter.ts`'s existing `session_settings` connect-time send pattern (lines
  78–81) is the precedent this feature's second send must follow — no changes to `HumeAdapter`'s
  connection/reconnect logic are required, only a new call site for a second send, plus reading
  the existing `isOpen()` method before sending.
- `walkthrough_state` table requires a new migration adding `hume_wrapup_nudge_pending boolean not
  null default false`.
- The existing `WalkthroughState` TypeScript interface in `WalkthroughClient.tsx` must be extended
  with the new optional field, following the same pattern as every other field in that interface.
- `lib/voice/hume-native/prompt-template.ts` rule 8 (already shipped) is depended on as-is — this
  feature triggers that existing behavior early; no change to the prompt template is required.

## CEO Approval

**Status: APPROVED**
**Date: 2026-07-05 (re-reviewed following scope change)**

**Scope change applied in this review:** Arun decided not to use Hume's native
`timeouts.max_duration` setting at all. The design is now two layers, not three:

1. **Primary:** the live nudge over the existing WebSocket connection ~1–2 minutes before end,
   Clio generates a real content-aware closing summary and says goodbye (triggering Hume's
   existing hang-up behavior).
2. **Backstop:** the existing `forceEndSession()`/`session-timer.ts` mechanism, fully untouched,
   as the sole safety net if the nudge fails for any reason.

The `config-provisioner.ts` change proposing `timeouts.max_duration: { enabled: true,
duration_secs: Math.min(plannedDurationSecs, 1800) }` has been **removed from scope** in this
document (Sections 6, 7, 8, 9, 10, 11, and 12 all edited to strip that layer). No
`ProvisionNativeConfigParams`/`plannedDurationSecs` change remains anywhere in this spec.
`config-provisioner.ts` is confirmed untouched by this feature.

Review checks, re-run against the two-layer design:

1. Two-layer approach matches Arun's latest instruction exactly — no substitutions, no
   re-litigation of already-settled parts of scope.
2. Section 11 is genuinely empty of unresolved questions, and item 4 now correctly states the
   `timeouts.max_duration` layer is out of scope rather than describing a change that isn't
   happening.
3. Section 11 is genuinely empty. The server-to-client relay reuses the existing, already-running
   2-second poll in `WalkthroughClient.tsx` — not a newly invented channel.
4. `lib/session-billing.ts` is confirmed untouched in Sections 6, 9, 10, and 12. Purely additive.
5. The backstop is proven to fire on schedule under every failure mode enumerated in Section 8
   (send throws, socket closed, timer step fails, row missing) — a nudge failure never blocks or
   delays it. This is now the *sole* safety net, and the doc is internally consistent about that
   (no lingering references to a second, Hume-native ceiling layer).

No code has been written yet. This spec is cleared for the Developer/Engineer agent to build
against, as-is, with no further product or UX interpretation required.

— CEO Agent, on behalf of Arun
