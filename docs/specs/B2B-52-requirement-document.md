# Widen Hume WS Reconnect Tolerance (Mitigation, Not a Root-Cause Fix) — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-30

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Per this project's standing rule that specs must be grounded in real code, every load-bearing claim
in the CEO brief
(`.claude/agents/clio/feature-briefs/B2B-52-hume-ws-retry-tolerance-widening.md`) was re-checked
directly against `lib/voice/hume-adapter.ts` by direct read, not assumed:

- **`MAX_RECONNECT = 3`** — confirmed at line 45: `private static readonly MAX_RECONNECT = 3`.
- **Backoff formula** — confirmed at line 152, inside `ws.onclose` (lines 128-157):
  `const delay = Math.pow(2, this.reconnectAttempts - 1) * 1000`, i.e. exponential doubling with no
  ceiling. `reconnectAttempts` is incremented (line 151) immediately before this computation, so the
  sequence across successive failed connects is 1s (attempt 1), 2s (attempt 2), 4s (attempt 3) — three
  waits, summing to 7s, matching the CEO brief's "~7 seconds of total retry budget" exactly.
- **Give-up condition** — confirmed at line 138: `event.code === 1008 ||
  this.reconnectAttempts >= HumeAdapter.MAX_RECONNECT`. Code 1008 (auth/policy) always gives up
  immediately regardless of attempt count — **this brief does not touch that branch**, only the
  attempt-count ceiling and the backoff delay computation reached when code is not 1008.
- **What "giving up" does** (lines 139-147, unchanged by this brief): logs to `console.error`, calls
  `this.config.reportError?.(...)` with the real close code/reason (the B2B-49 Track A diagnostic,
  commit `999a2ca`), calls `this.config.onError(...)`, then `this.config.onDisconnect()`. All four
  calls are **identical in this brief's design** to today — only *when* (how many attempts, how much
  elapsed time) this branch is reached changes, never what it does once reached.
- **`ws.onerror`** (lines 114-126) — confirmed unconditionally calls `this.config.reportError?.(...)`
  on every single error, whether pre-open or post-open, regardless of `reconnectAttempts`. This fires
  on every failed attempt today and will continue to fire on every failed attempt (now up to 5 instead
  of up to 4 total connect attempts) — untouched by this brief, confirmed no code path in this diff
  touches lines 114-126.
- **`status` state machine surfacing this to the user** — confirmed by direct read of
  `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`: `status` is typed
  `'connecting' | 'listening' | 'speaking' | 'error' | 'ended'` (line 92), initialized to `'connecting'`
  (same line), and only transitions to `'error'` inside the `onError` callback passed to
  `HumeAdapter`/`HumeAdapterConfig` (line 257: `setStatus('error')`) — which, per the trace above, is
  only invoked from `ws.onerror`'s post-open branch or `ws.onclose`'s give-up branch, never from a
  mid-retry state. There is **no intermediate "retrying" state** in this state machine today — the UI
  stays silently `'connecting'` (no visible banner or spinner distinct from the initial connect attempt,
  confirmed: the only `status === 'error'` consumers are the two banner renders at lines 451 and 479,
  both reading `"Voice connection issue — content is still visible."`) for the *entire* retry window,
  however long it is, then flips straight to `'error'` once retries are exhausted. This directly
  resolves the CEO brief's Question 2: extending the retry window requires zero UI/state-machine change
  — the silent-retry behavior the brief asks about already is today's behavior, and this brief's design
  (§6) does not alter it.

All CEO brief claims held up under independent re-verification. No corrections needed.

**Q4 (should this wait on Arun's go-ahead before BA starts) is resolved, not left open**: the BA
Agent was dispatched for this brief with the Orchestrator's own instruction stating "Arun has given
blanket approval to build a resilience mitigation for this" — so the CEO's recommended gate has
already been satisfied upstream of this document; nothing further is needed here.

## 1. Purpose

Tonight (2026-07-29/30), the same confirmed Hume EVI WebSocket failure signature (`ws.onerror` before
ever reaching `onopen`, exhausting all 3 reconnect attempts within ~7 seconds, ending in `ws.onclose`
code 1006) recurred identically across three live test sessions within roughly one hour, interleaved
with sessions that connected perfectly fine on identical, unmodified code. This is confirmed NOT a
code regression (§0 of the CEO brief traced zero relevant commits between working and failing
sessions) — it is intermittent Hume-side WebSocket instability, most plausibly a transient
account-level rate/concurrency effect from the unusually high volume of rapid back-to-back test
dispatches tonight. Given that, a ~7-second total retry budget may simply be too short a window to
plausibly ride out a brief Hume-side hiccup before Clio gives up and shows a real participant the
"Voice connection issue" banner.

This is a bounded resilience mitigation, not a fix for the underlying instability (there is no known
code-level root cause on Clio's side to fix — see B2B-49 Track A, still open). It widens the amount of
time Clio is willing to keep retrying before concluding the connection is genuinely dead, on the theory
that a materially longer (but still bounded, still reasonably short) retry window has a meaningfully
better chance of riding through a transient Hume-side blip than today's ~7 seconds does.

Failure without this: every time Hume has a few seconds of transient instability — which tonight's
evidence suggests is a real, recurring condition under load, not a one-off — a live participant in a
real meeting hits the "Voice connection issue" banner and permanently loses voice for that session,
even though the exact same connection might well have succeeded on a 4th or 5th attempt a few seconds
later.

## 2. User Story

As **a real participant in a live Clio session whose Hume connection hits a transient failure**,
I want Clio to keep trying to reconnect for a materially longer window than today before giving up,
so that a brief, self-resolving Hume-side hiccup doesn't permanently cost me voice for the entire
session when one or two more retries, spaced a little further apart, might well have succeeded.

As **Arun**,
I want this widened retry window to still be bounded and still fail in exactly the way it does today
(same banner copy, same diagnostic reporting) once truly exhausted,
so that a genuinely dead connection is never masked indefinitely, and I keep the exact B2B-49 Track A
visibility into real close codes/reasons I already have today — this change must be invisible to that
diagnostic pipeline, not a rework of it.

## 3. Trigger / Entry Point

No new trigger, no new route, no new UI. This brief changes only the internal constants/timing that
govern when `HumeAdapter`'s existing, already-firing `ws.onclose` handler (`lib/voice/hume-adapter.ts`,
lines 128-157) decides to retry vs. give up. The trigger for this code path — a Hume WebSocket closing
abnormally after `openConnection()` was called — is unchanged; only the number of times it retries and
how long it waits between retries changes.

## 4. Screen / Flow Description

No screen/flow change. Per §0's confirmed trace, `status` has no intermediate visible state for a
retry-in-progress today, and this brief does not add one (see §6.3 for why). The one and only
user-visible surface this brief affects is *how long* a real participant might wait, in total, before
either (a) the connection recovers and voice starts working with no visible indication a retry ever
happened, or (b) the existing "Voice connection issue — content is still visible." banner appears
(`PartnerRenderClient.tsx` lines 451-455 / 479-483) — unchanged copy, unchanged trigger condition
(`status === 'error'`), only reached later than it is today.

## 5. Visual Examples

Not applicable — no visual/UI change. Per `CLAUDE.md`'s standing responsive-by-default rule: this
brief touches zero `.tsx` markup/layout (only `lib/voice/hume-adapter.ts`'s internal constants), so it
does not trigger that rule's "any future work that touches a screen" obligation.

## 6. Data Requirements

No new data read, written, or transmitted. No new API calls, no new environment variables, no schema
change. This is a pure in-memory constant/timing change inside one existing file.

### 6.1 The widened retry policy — concrete values, with reasoning

**Decision: extend `MAX_RECONNECT` from 3 to 5, and cap the exponential backoff delay at 8 seconds per
retry (introducing a ceiling, not just extending the uncapped exponential curve further).**

Resulting per-attempt delay sequence (`Math.min(Math.pow(2, this.reconnectAttempts - 1) * 1000, 8000)`):

| Reconnect attempt # | Delay before this attempt | Cumulative elapsed wait |
|---|---|---|
| 1 | 1,000 ms (1s) | 1s |
| 2 | 2,000 ms (2s) | 3s |
| 3 | 4,000 ms (4s) | 7s |
| 4 | 8,000 ms (8s) — capped (uncapped would be 8s anyway, so no divergence yet) | 15s |
| 5 | 8,000 ms (8s) — capped (uncapped would be 16s; capped saves 8s here) | 23s |

Total elapsed retry-wait budget before giving up: **23 seconds** (sum of the five delays), plus the
network round-trip time of each of the 5 connect attempts themselves. Per tonight's observed failure
pattern (`ws.onerror` firing before `onopen` — i.e., failures are fast, not slow timeouts), the added
per-attempt overhead is small; total time-to-give-up in practice is expected to land in the
**~23-27 second** range.

**Reasoning for these specific numbers:**

1. **Why 5 attempts, not fewer or more.** The CEO brief's own suggested range was "5-6 attempts /
   ~20-30s total." 5 attempts landing at 23s total sits inside that band with room to spare before the
   30s ceiling, while still being a meaningfully larger number of independent chances for a transient
   Hume-side condition (e.g., a momentary rate-limit window) to clear between one attempt and the next,
   versus today's 3.
2. **Why cap at 8 seconds per single wait, rather than letting the exponential curve run uncapped to
   5 attempts (which would be 1s→2s→4s→8s→16s, summing to 31s).** The dispatch instruction for this
   brief explicitly asked for a reasoned choice between "extend the same curve" and "introduce a cap,"
   not a default. A capped curve is the better fit here for two independent reasons:
   - It keeps the total budget inside the CEO brief's own 20-30s recommended band (31s uncapped would
     overshoot it) without reducing the attempt count below 5.
   - It bounds the single longest gap a participant could sit through between two attempts to 8
     seconds rather than 16. Since §0 confirms there is no visible "retrying" indicator distinct from
     silent `'connecting'` today, the participant experience during any single wait is identical either
     way (nothing visibly changes) — but a shorter per-attempt ceiling means more retry *attempts*
     happen within a smaller worst-case single gap, which is strictly more chances to recover without
     meaningfully changing the total wall-clock budget (23s vs. 31s, both well under "a minute-plus").
3. **Why not go higher (e.g., 6+ attempts or a 30s+ ceiling).** Per the CEO brief's own explicit
   balancing concern: by the time this code path is running, Attendee's bot has already joined the
   meeting, so a real human participant is sitting in a live call waiting to hear Clio speak. 23-27
   seconds is already a long silent wait for someone expecting an AI voice assistant to start talking;
   pushing toward or past a full minute (as an uncapped 6-attempt curve — 1+2+4+8+16+32=63s — would) is
   a materially worse failure mode than giving up a little sooner and showing the existing, honest
   "Voice connection issue — content is still visible" fallback, which at least tells the participant
   what's happening and that the content is still usable.
4. **Why this specific formula (`Math.min(..., 8000)`) rather than a fixed non-exponential delay.**
   Keeping the exponential shape for the first three attempts (1s/2s/4s — identical to today) preserves
   today's fast-retry behavior for the common case where a reconnect just needs a brief moment (e.g., a
   single dropped frame), and only the two additional attempts introduced by this brief use the new 8s
   ceiling — the smallest possible diff to the existing formula (one `Math.min(...)` wrapper, one
   changed constant) rather than a redesigned backoff scheme.

### 6.2 The exact diff (both changes confined to `lib/voice/hume-adapter.ts`)

```diff
--- a/lib/voice/hume-adapter.ts
+++ b/lib/voice/hume-adapter.ts
@@ -42,7 +42,12 @@ export class HumeAdapter implements VoiceSessionAdapter {
   private intentionalClose = false
   private reconnectAttempts = 0
-  private static readonly MAX_RECONNECT = 3
+  // B2B-52 — widened from 3 to 5 (and the backoff below capped at 8s/attempt) after tonight's
+  // confirmed Hume-side WS instability (3 sessions hit ws.onerror/onclose(1006) within ~1hr on
+  // unmodified code — see docs/specs/B2B-52-requirement-document.md §0/§1). This is a bounded
+  // resilience mitigation, not a fix for a code-level bug — B2B-49 Track A's root-cause
+  // investigation remains open. Total retry-wait budget: 1+2+4+8+8 = 23s (§6.1), up from ~7s.
+  private static readonly MAX_RECONNECT = 5
+  private static readonly MAX_RECONNECT_DELAY_MS = 8000
```

```diff
@@ -148,9 +153,10 @@ export class HumeAdapter implements VoiceSessionAdapter {
         }

-        // Exponential backoff: 1 s → 2 s → 4 s
+        // Exponential backoff, capped: 1s → 2s → 4s → 8s → 8s (B2B-52 — see MAX_RECONNECT comment
+        // above for the reasoning behind both the attempt count and the 8s cap).
         this.reconnectAttempts++
-        const delay = Math.pow(2, this.reconnectAttempts - 1) * 1000
+        const delay = Math.min(Math.pow(2, this.reconnectAttempts - 1) * 1000, HumeAdapter.MAX_RECONNECT_DELAY_MS)
         console.warn(`[HumeAdapter] WS closed (code ${event.code}, reason: ${event.reason || 'none'}) — reconnect attempt ${this.reconnectAttempts}/${HumeAdapter.MAX_RECONNECT} in ${delay}ms`)
         setTimeout(() => {
           this.openConnection().catch(() => { /* onclose handles further retries */ })
         }, delay)
```

That is the entire functional diff. No other line in `hume-adapter.ts` changes. Specifically confirmed
**unchanged**, per the CEO brief's Known Constraints and this brief's own scope:

- The give-up condition itself (line 138: `event.code === 1008 ||
  this.reconnectAttempts >= HumeAdapter.MAX_RECONNECT`) — same comparison, only the right-hand
  constant's value changes (3 → 5).
- Everything inside the give-up branch (lines 139-147) — `console.error`, `reportError?.(...)` with the
  real close code/reason (B2B-49 Track A), `onError(...)`, `onDisconnect()` — byte-for-byte identical.
- `ws.onerror` (lines 114-126) — byte-for-byte identical; still fires `reportError?.(...)` on every
  failed attempt, pre- or post-open, exactly as today.
- Code 1008 handling — still gives up immediately, no retry, regardless of `MAX_RECONNECT`'s new value
  (auth/policy errors are not what this brief is about; retrying a 1008 would never help).
- `openConnection()`'s connect sequence, the `session_settings` send on open, token/Config handling,
  mic capture, audio playback — none of this brief's diff touches anything above line 148 or below line
  158 of the file.
- `PartnerRenderClient.tsx` — zero changes. The banner copy, the `status === 'error'` trigger condition,
  and the fallback-to-visual-only behavior are all unchanged (per the CEO brief's explicit constraint
  and §0's confirmed trace that no intermediate UI state exists to add or remove).
- `lib/partner/live-render.ts`'s `isFirstPartyDemoPageUrl()`/`resolveInlineSessionRender()` and
  `PartnerRenderClient.tsx`'s `sourceUrl` iframe branch — confirmed nowhere near this brief's one
  touched file.

### 6.3 Why no on-screen state change is introduced (resolves CEO brief Question 2 explicitly)

Considered and rejected: adding a new `'retrying'` (or similar) value to `PartnerRenderClient.tsx`'s
`status` union to visibly distinguish "still trying, don't worry yet" from the initial connect attempt.
Rejected because:

1. It would be a genuine UI/product-shape change (a new visible state a real participant sees) layered
   on top of what the CEO brief scoped as "a pure technical/resilience change — no product-shape
   decision, no new UI, no new user-facing copy beyond what already exists" (per this brief's own
   Constraints). Adding one would step outside that scope without a CEO-approved reason to.
2. Today's actual behavior — silently staying in `'connecting'` for the entire retry window, then
   flipping straight to `'error'` — is not something this brief is asked to fix; the CEO brief's
   Question 2 explicitly offered "silent extended retrying with no visible change" as an acceptable
   option, and §0's confirmed trace shows that is already exactly what happens today, just for a
   shorter window. Widening the window changes only the duration of already-existing, already-accepted
   silent behavior.
3. Introducing a new state would require touching `PartnerRenderClient.tsx`, which this brief's Known
   Constraints direct away from ("do not change the banner copy or fallback behavior — only the retry
   budget before that state is reached").

## 7. Success Criteria (Acceptance Tests)

✓ AT-1: Given a Hume WebSocket connection fails to open and closes with a non-1008 code (e.g. 1006)
five times in a row, when `HumeAdapter`'s `ws.onclose` handler runs after the 5th failure, then
`reconnectAttempts` equals 5, `reconnectAttempts >= MAX_RECONNECT` is true, and the give-up branch
fires — `config.reportError`, `config.onError`, and `config.onDisconnect` are each called exactly once,
with the same message/argument shapes they produce today (no signature or content change).

✓ AT-2: Given the same failure sequence as AT-1, when each of the 5 reconnect delays is inspected, then
they equal, in order, 1000ms, 2000ms, 4000ms, 8000ms, 8000ms — confirming both the unchanged first-three
exponential values and the new 8000ms cap applied to attempts 4 and 5.

✓ AT-3: Given a Hume WebSocket fails to open exactly 2 times and then succeeds on the 3rd attempt, when
`ws.onopen` fires for that 3rd attempt, then `reconnectAttempts` resets to 0 (existing, unchanged
behavior at line 83) and no give-up branch ever fires — confirming the widened ceiling does not change
behavior for a connection that recovers before exhausting attempts, identical to today's behavior for
a within-budget recovery.

✓ AT-4: Given a Hume WebSocket closes with code 1008 on the very first attempt, when `ws.onclose` runs,
then the give-up branch fires immediately (no retry, no delay, no `setTimeout` call) — confirming the
1008 short-circuit is untouched by the `MAX_RECONNECT` change.

✓ AT-5: Given the failure sequence from AT-1, when `ws.onerror` fires on each of the (up to) 5 failed
connection attempts, then `config.reportError` is called once per `onerror` event with the same message
strings the code produces today ("Hume WebSocket onerror (during connect, before open...)" or "...
(after open)") — confirming the B2B-49 Track A diagnostic still fires on every attempt, unaffected by
the widened retry count.

✓ AT-6: Given the failure sequence from AT-1 runs to exhaustion, when the give-up branch's
`config.reportError` call fires, then its message string is byte-for-byte identical in shape to today's
("Hume EVI WebSocket closed — code ${event.code}, reason: ${reason}") — confirming B2B-49 Track A's
diagnostic reporting still fires correctly, unmodified, once retries are exhausted under the new,
longer window (per this brief's explicit test-plan requirement).

✓ AT-7: Given `MAX_RECONNECT` is now 5, when the source is inspected, then `MAX_RECONNECT_DELAY_MS` is
exactly 8000 and the delay computation is `Math.min(Math.pow(2, reconnectAttempts - 1) * 1000, 8000)`
— confirming the exact formula this spec calls for, not an approximation.

## 8. Error States

No new error states are introduced. Every error/failure path this brief touches was already an error
path today (`ws.onerror`, `ws.onclose` with a non-1008 abnormal code) — this brief only changes how
many times that existing path retries and how long it waits between retries before reaching the same,
unchanged terminal error handling described in §6.2. No new failure mode is possible as a result of
this change that was not already possible today.

## 9. Edge Cases

- **A connection that recovers on attempt 4 or 5 (i.e., within the newly-added budget, but beyond
  today's old 3-attempt ceiling)** — this is the entire point of the change: a session that would have
  hit the error banner today (gave up after attempt 3) now has two more chances to recover silently.
  Covered by AT-3's logic extended to attempts 4-5.
- **A connection that still fails after all 5 attempts** — behaves identically to today's give-up path,
  just reached ~16 seconds later in wall-clock time (23s vs. ~7s). Covered by AT-1/AT-6.
- **Code 1008 arriving on a later attempt (e.g., attempt 3 of 5), not just the first** — the
  `event.code === 1008` check is unconditional or'd with the attempt-count check (line 138, unchanged),
  so a 1008 on any attempt still gives up immediately regardless of how many attempts remain in the
  widened budget. No new test needed beyond AT-4's first-attempt case — the code path is identical
  regardless of which attempt number it occurs on.
- **A participant who disconnects/leaves mid-retry** (component unmounts, `endSession()` called) —
  unaffected by this brief: `intentionalClose` (line 132-135) is checked before the retry logic is ever
  reached and short-circuits to `onDisconnect()` with no retry scheduled, exactly as today; this brief's
  diff sits entirely below that check.
- **Multiple back-to-back sessions during a high-volume test window (tonight's actual triggering
  condition)** — each session's `HumeAdapter` instance has its own independent `reconnectAttempts`
  counter; this brief does not add or need any cross-session coordination or rate-limiting on Clio's
  side — it only affects how patient a single session's own adapter is with its own retries.
- **Mobile vs. desktop** — not applicable; `HumeAdapter` and its retry logic run identically regardless
  of viewport, and this brief has no UI surface (§5).

## 10. Out of Scope

- **The Track B root-cause investigation** (why Hume WS instability happens at all) — B2B-49 remains
  open and unresolved by this brief, per the CEO brief's explicit instruction not to present this as
  "the fix." This brief is a mitigation only.
- **Any change to what happens on a successful connection** — `ws.onopen`, the `session_settings` send,
  token/Config provisioning, mic capture start — all untouched (§6.2).
- **Any change to the B2B-49 Track A diagnostic reporting mechanism itself** (`reportError` callback
  shape, what triggers it, its message content) — only *when* it can fire (now up to 5 times instead of
  up to 4) changes; the mechanism itself is untouched (§6.2, AT-5/AT-6).
- **Any new visible "retrying" UI state** — considered and explicitly rejected, §6.3.
- **`lib/partner/live-render.ts`'s `isFirstPartyDemoPageUrl()`/`resolveInlineSessionRender()` and
  `PartnerRenderClient.tsx`'s `sourceUrl` iframe branch** — confirmed nowhere near this brief's one
  touched file, per the CEO brief's explicit protection (same standing constraint as B2B-49/B2B-50/
  B2B-51 tonight).
- **Making the retry count/backoff configurable** (env var, per-partner setting, etc.) — hardcoded
  constants, matching how `MAX_RECONNECT` was already hardcoded before this brief; no product
  requirement for tunability.
- **Code 1008's immediate-give-up behavior** — untouched; not part of this brief's scope, which is
  specifically about the transient/retryable-failure budget.

## 11. Open Questions

None. All 4 of the CEO brief's "Questions for BA" are resolved above with concrete, reasoned decisions:

1. Widened retry ceiling and its rationale — §6.1 (5 attempts, 8s cap, 23s total budget).
2. On-screen state during extended retry — §6.3 (unchanged: silent `'connecting'` throughout, per
   confirmed existing behavior; no new state introduced, with reasoning for why not).
3. Exact current values to change, verified directly against source — §0 (`MAX_RECONNECT = 3` at line
   45; backoff formula at line 152; both confirmed by direct read before writing this spec).
4. Whether to wait on Arun's go-ahead before BA starts — §0 (resolved: the Orchestrator's dispatch for
   this BA task already stated blanket approval was given; no further gate needed here).

## 12. Dependencies

- **No new libraries, no new environment variables, no new vendor, no schema/migration change.** Pure
  in-memory constant/timing change inside one existing file (`lib/voice/hume-adapter.ts`).
- **Depends on** the B2B-49 Track A diagnostic (`reportError` callback, commit `999a2ca`) continuing to
  exist and fire exactly as it does today — confirmed unmodified by this brief (§6.2, AT-5/AT-6).
- **No dependency on or interaction with** B2B-49 Track B (root-cause investigation, still open),
  B2B-50, or B2B-51 — independently shippable.

## 13. Test Plan

New unit test file: `tests/unit/b2b52-hume-reconnect-tolerance.test.ts`.

- **Convention followed**: `tests/unit/voice-adapters.test.ts` already establishes the pattern for unit
  testing `HumeAdapter` directly — constructing it via `new HumeAdapter(config)` with a plain mock
  `HumeAdapterConfig` (all callbacks as `vi.fn()`), and casting to access private members/methods where
  the public API doesn't expose what's under test (that file accesses `handleMessage`; this one needs
  `openConnection`, `reconnectAttempts`, and to drive `ws.onclose`/`ws.onerror` directly). No existing
  test in this repo drives `HumeAdapter`'s actual WebSocket-open/retry path end-to-end (`voice-adapters.
  test.ts` deliberately bypasses `openConnection()` per its own header comment) — this is the first test
  file to do so, following the same "construct directly, reach into private internals via a typed cast"
  convention rather than inventing a new one.
- **Environment**: `vitest.config.ts` runs `environment: 'node'` (no jsdom, no browser `WebSocket`
  global) — this test file must install a minimal mock `WebSocket` class on `globalThis.WebSocket`
  before each test (constructor stores `onopen`/`onerror`/`onclose`/`onmessage` assignment targets and
  exposes test-controlled trigger methods — e.g. `triggerClose(code)` — rather than a real network
  socket), and restore/clear it afterward. No `AudioContext`/`MediaRecorder` real implementation is
  needed for this test's scope — `openConnection()`'s audio-context creation block only needs a
  minimal stub object with a no-throw `createGain()`/`connect()` shape, matching the level of mocking
  `voice-adapters.test.ts` already uses for `mediaStream: {} as MediaStream`.
- **Timer control**: `vi.useFakeTimers()` (established convention — `session-billing-hume-retry.test.ts`
  line 38 already uses this in this repo) to assert on the exact `setTimeout` delay values passed at
  each retry (AT-2) without the test suite actually waiting 23 real seconds, and to advance time
  deterministically between each simulated `ws.onclose` to drive the next attempt.
- **Covers**: AT-1 through AT-7 above, specifically:
  - Drive 5 consecutive simulated `ws.onclose(code: 1006)` events, asserting the `setTimeout` delay
    argument at each step equals the AT-2 sequence (1000/2000/4000/8000/8000), and that
    `config.reportError`/`config.onError`/`config.onDisconnect` fire exactly once, only after the 5th,
    with unchanged message content (AT-1, AT-6).
  - Drive 2 failures then a simulated `ws.onopen`, asserting `reconnectAttempts` resets to 0 and no
    give-up callbacks fire (AT-3).
  - Drive a single `ws.onclose(code: 1008)`, asserting immediate give-up with no `setTimeout` call
    (AT-4).
  - Drive `ws.onerror` at each simulated failed attempt, asserting `config.reportError` is called once
    per attempt with unchanged message shape (AT-5).
  - A direct assertion on the class's static `MAX_RECONNECT` (5) and `MAX_RECONNECT_DELAY_MS` (8000)
    values (AT-7).
- **No E2E test added** — this is pure timing/retry-count logic inside one class with no UI surface
  (§5); a live, real-Hume-account E2E reproduction of transient WS instability is not practically
  constructible in this repo's test suite (the failure this brief mitigates is Hume-side and
  intermittent by nature). Real-world confirmation of the mitigation's effectiveness will come from
  observing whether B2B-49 Track A's diagnostic continues to fire as frequently in future high-volume
  test windows — an operational/monitoring concern, not something this test plan can assert.
