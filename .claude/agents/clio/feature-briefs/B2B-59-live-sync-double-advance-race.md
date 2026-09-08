# Feature Brief: B2B-59 — Dual-signal page-advance race causes a double jump (page N → N+1 → N+2)

From: CEO (Arun)
To: Business Analyst Agent / Developer (P0 fast-track technical fix — no BA gate, same category as B2B-58)
Priority: P0
Date: 2026-07-31

**Numbering note:** checked `docs/b2b-pivot-status.md` and `.claude/agents/clio/feature-briefs/` directly before writing this — highest existing entry is B2B-58 (plus sub-letters B2B-57a/57b). B2B-59 was free at the time of writing. The Orchestrator mentioned a parallel sibling investigation may also be claiming a number — if B2B-59 collides with that dispatch, renumber this one, the content does not depend on the number.

---

## What Arun Said

On tonight's live call, right after B2B-58 shipped (the fix for the shared screen running one page ahead of narration), a NEW symptom appeared: page 1 navigates correctly, but when navigating to page 2, it goes to page 2 and then IMMEDIATELY jumps to page 3 — as if `show_visual`/`advance_tab` fired back-to-back. He wants root cause investigated, confidence confirmed, and an approach published before any fix ships — reviewing tonight to approve, then built overnight.

## The Problem Being Solved

A partner live-session participant sees the shared screen skip a page it was never narrated — page 3 appears while Clio is still talking about (or has only just started) page 2's material. This breaks the core promise of the inline-content delivery mode (Option 1): the screen must track what Clio is actually saying, one page at a time, never running ahead.

## Root Cause — VERIFIED, not just the working hypothesis

**The Orchestrator's hypothesis is confirmed correct in its core mechanism, with one factual correction to the framing it was given (see "Correction" below), and with an additional piece of evidence (a spec/test gap) that raises confidence further.**

### The mechanism (code-verified)

`app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` implements the B2B-19 "dual-signal" design: a transcript-watch (primary) and the `advance_tab` tool-call (backup) both feed one shared function:

```
function advanceOnTransition(transitionMarker: string) {
  if (firedMarkersRef.current.has(transitionMarker)) return   // dedup, keyed on MARKER STRING
  firedMarkersRef.current.add(transitionMarker)
  const next = Math.min(activeIndexRef.current + 1, count - 1)
  goToSection(next)
}
```

Both callers resolve `transitionMarker` the same way, at the moment each one is invoked:

```
// advance_tab tool handler:
const marker = inlinePages![activeIndexRef.current]?.transitionMarker

// transcript-watch (onMessage):
const marker = inlinePages![activeIndexRef.current]?.transitionMarker
```

This is the bug. The dedup is keyed correctly (one marker per page, per `lib/content/transition-markers.ts`), but **the marker each signal dedups against is re-resolved fresh, off a shared mutable `activeIndexRef.current`, at whatever moment that specific signal happens to be processed** — not pinned to the transition the signal was actually reporting on.

Sequence that produces the observed symptom:
1. Clio finishes page 1, speaks page 1's marker phrase, then calls `advance_tab`.
2. Signal A (whichever of the two arrives first — see below) resolves marker for page 1 (current index at that moment), advances index 0→1 (page 1→page 2), marks page-1's marker fired.
3. Signal B — a delayed echo of the *same* real "page 1 is done" moment — is processed. It re-resolves `activeIndexRef.current`, which has *already moved to 1* (page 2). It therefore computes **page 2's marker**, not page 1's. Page 2's marker has never fired, so the dedup does not catch it. `advanceOnTransition` runs again, advancing 1→2 (page 2 → page 3) — immediately, because signal B is processed a moment after signal A, not after Clio has said anything about page 2.

Net effect: one real "page done" event produces two page advances, because the dedup's implicit invariant — "both signals for the same transition resolve to the identical marker value" — is silently broken by the first signal's own side effect (mutating the index the second signal reads from).

### Which signal fires first, and why this isn't rare

Both signals arrive over the **same single Hume EVI WebSocket**, processed by the same synchronous `handleMessage()` switch in `lib/voice/hume-adapter.ts` (`assistant_message` → `onMessage('ai', text)`; `tool_call` → the tool handler). Per `lib/partner/live-render.ts`'s prompt instruction to the model:

> "...say this exact phrase naturally as part of your sentence: `[marker]`. Then call the `advance_tab` tool."

Clio is explicitly told to **speak the marker first, call the tool second**. That means the `assistant_message` event (text containing the marker, caught by the transcript-watch) structurally tends to arrive on the WebSocket *before* the `tool_call` event for `advance_tab`, for the same transition — not because of network jitter between two different pipelines, but because that's the order the model produces its own outputs within one turn. This turns the failure mode from "an occasional race" into something that will reproduce whenever **both** signals successfully fire for a transition (transcript-match succeeds AND the model reliably calls the tool) — which is not every transition (transcription matching and tool-calling aren't 100% reliable, which plausibly explains why page 1→2 was clean while page 2→3 doubled — a stochastic, not deterministic, difference), but is common enough to hit live sessions.

### Correction to the brief I was given

The escalation framed the transcript-watch signal as "the Attendee-relayed transcript, delivered via a separate webhook pipeline with its own latency." **This is incorrect and I want to flag it rather than carry it forward.** I checked both the code and the actual event stream:

- `matchesTransitionMarker` (the transcript-watch matcher) is called **only** from `PartnerRenderClient.tsx`'s `onMessage` callback, which is wired to `HumeAdapter`'s `assistant_message` WS event — the same direct Hume WebSocket the `tool_call` event arrives on. There is no Attendee webhook involved in this signal at all.
- `app/api/attendee/webhook/route.ts`'s `transcript.update` case for **partner sessions** (line 436-444) is an explicit no-op: `// No-op, log-only ... would mean persisting partner end-user transcript content, in tension with CORE_OBJECTIVES.md's Non-Negotiable Data Boundary`. It logs a transcript length and does nothing else. It plays no role in page advancement.

So the two racing signals are not "one fast direct path vs. one slow relayed path" — they're two handlers on the **same** WebSocket message stream, in the **same** single-threaded browser JS runtime (inside the Attendee bot's headless browser). This actually makes the bug *more* certain to reproduce under normal conditions than the original framing suggested (it doesn't depend on relay latency at all), not less.

### Evidence checked, and what I could/couldn't confirm from logs

Per the instruction, I pulled Vercel runtime logs for partner session `cd2ca361-639e-4104-b1c8-ba7ed3c75908` across 2026-07-31 03:05–03:31 UTC (both the full window and an error/warning-only filter):

- **Confirmed:** zero error/warning-level log entries anywhere in the session — no `reportClientError` calls, no Hume WS `onerror`/reconnect events (the B2B-52 reconnect-widening machinery never engaged). This rules out WS instability/reconnect as the cause of tonight's specific double-advance — it happened on a clean, uninterrupted connection, which points at the structural bug above rather than a connection-flakiness artifact.
- **Confirmed:** the Attendee webhook's `transcript.update` events for this session are logged continuously (every ~2-10s, length-only, per the Data Boundary rule) but are the no-op path described above — consistent with, and further evidence for, the correction above.
- **Could not confirm:** the actual relative order/timing of the `assistant_message` vs. `tool_call` WebSocket events for this session's page 2→3 transition. As anticipated in the brief I was given, that exchange happens entirely client-side, inside the Hume WebSocket, inside the Attendee bot's headless browser — there is no server-side log of it. The Attendee-relayed `transcript.update` timestamps that *are* logged don't tell us anything about this, since (per the correction) they're not on the causal path for this bug at all. This part of the root cause rests on architectural/code-level reasoning plus the prompt's explicit "speak, then call the tool" sequencing — not a direct trace.

### Additional finding: this exact race was specced but never actually tested

`docs/specs/B2B-19-requirement-document.md` explicitly anticipated this race and specified a test for it:

> **AT-Q-B-3 (the race test)** — Given the transcript-detection signal and the tool-call signal for the same `transition_marker_id` within N ms of each other, when both are processed, then the page advances exactly once... Verifiable by firing both handlers back-to-back against the shared `advanceOnTransition(markerId)` and asserting `goToSection` ran once.

I searched the test suite: **no test file exercises `advanceOnTransition`'s dedup behavior at all** (confirmed via grep across `tests/`). The B2B-58 test suite (`tests/unit/b2b58-show-visual-no-advance.test.ts`) explicitly scoped itself only to `show_visual`'s no-op behavior and separately noted `PartnerRenderClient.tsx` "isn't practically unit-testable via direct import/render," following the existing grep-checkable-source-text convention for this file — but no such test was written for `advanceOnTransition`/`firedMarkersRef` specifically. AT-Q-B-3 as described would likely have passed anyway (firing both handlers "back-to-back" with the index unchanged trivially dedupes) — it would not have caught this bug, because the bug only manifests when the index has already moved between the two calls, which "back-to-back" doesn't exercise. So this is a real, pre-existing gap between what B2B-19 specified and what was verified, not something anyone caught and waved through.

### Not caused by B2B-58

B2B-58's diff touched only `inlineTools.show_visual` (made it a no-op) and the prompt's rule 5 wording. `inlineTools.advance_tab`, the `onMessage`/transcript-watch wiring, and `advanceOnTransition` itself are untouched by B2B-58. This bug is pre-existing since B2B-19 shipped the dual-signal design — plausibly only now visible/isolable because B2B-58's fix removed the *other* bug (page running one section ahead for the whole session), which likely made a one-off double-advance impossible to distinguish from the general "always ahead" symptom. Tonight was very likely the first live test of the corrected single-signal-per-transition behavior, which is exactly when this latent bug would first become individually visible.

## What Success Looks Like

The shared screen advances exactly one page per real transition, regardless of whether one or both of the redundant signals (transcript-watch, `advance_tab`) fire for that transition, and regardless of how much time elapses between them or how many pages the participant has already moved through in between. The B2B-19 dual-signal redundancy design (deliberate, not to be simplified to one mechanism) is preserved — whichever signal is faster still resolves the transition; the other becomes a true no-op.

## Recommended Fix — with confidence level

**Recommendation: add a shared, time-based debounce/lock in `advanceOnTransition`, independent of and in addition to the existing per-marker dedup.**

Concretely: track the timestamp of the last successful advance (`lastAdvanceAtRef`). Any call into `advanceOnTransition` — regardless of which marker it resolves to, regardless of source — is ignored if it arrives within a short window (recommend starting at **2000ms**) of the previous successful advance. This closes the loophole completely and unconditionally: it does not matter that signal B recomputes a *different* (fresh, not-yet-fired) marker after the index moved, because the debounce doesn't key on the marker at all — it keys on "did a real advance just happen a moment ago."

Why this window is safe: rule 4 of the prompt template requires Clio to teach a section's content, then ask a verification question, then listen to and respond to the answer, before rule 5 permits calling `advance_tab` at all. Two *genuine* transitions inside a 2-second window is not achievable within that flow — there's no legitimate path to a real page N→N+1 followed by a real N+1→N+2 within 2 seconds of each other. A 2s (tunable) debounce cannot suppress a real transition; it can only suppress the specific double-fire this bug produces.

**Why I'm not recommending the other two options as the primary fix:**
- *Resolve the transcript-watch's marker against all not-yet-fired markers* (checking spoken text against every outstanding marker, not just "whatever's current") is a real improvement for the transcript-watch side specifically — since spoken text is self-describing, it would correctly identify marker N even after the index has already moved. But it does **not** fix the case where `advance_tab` is the *second*, delayed signal: the tool call carries no marker/page information at all from Hume, so there's no way to make it self-describing the way transcript text is. It would only close half the race.
- *Demote the transcript-watch to a true fallback (only trigger if `advance_tab` hasn't fired within a grace window)* directly contradicts the B2B-19 spec's explicit design intent — transcript-watch is documented as the **primary** signal, `advance_tab` as backup, specifically because transcript-watch was "the proven RTV-02/03... machinery" and considered the more reliable one. Inverting that priority is a real design change, not just a bug fix, and I don't think it's necessary — the debounce fixes the actual defect without touching which signal is primary.

I'd like the debounce to ship as the fix, and I'm open to also landing the "resolve against all not-yet-fired markers" change as defense-in-depth alongside it (cheap, strictly additive, and closes the transcript-side gap even further) — but the debounce alone is sufficient and is what I'd approve if only one change ships tonight.

**Confidence: high** that this is the root cause and that the debounce fixes it. Not "certain," because the exact WS-level signal ordering for tonight's specific incident isn't directly observable (see "Could not confirm" above) — the conclusion rests on code-level architectural analysis, the prompt's explicit speak-then-call-tool sequencing, the ruled-out WS-instability alternative, and an exact match to the observed symptom shape (page N → N, then immediately N+1) — not on a direct trace of the two events' timestamps.

## Known Constraints

- Do not simplify the dual-signal design to a single mechanism (explicit B2B-19 requirement).
- Fix must not reintroduce B2B-58's regression (page running ahead of narration) — the debounce only suppresses a *second* advance within the window; it never delays or blocks the *first* legitimate advance for a transition, so it's orthogonal to B2B-58.
- Template/Option 2 mode (`templateTools`) is unaffected and explicitly out of scope — it uses `resolveSectionIndex`/explicit `section_index`, not `advanceOnTransition`, confirmed unchanged.
- Live-session voice verification (does the fix actually hold up on a real call) is out of scope for a background dev agent without browser/voice access — same carve-out B2B-58 used. Needs a real or demo call before this is fully closed out, same as B2B-58's own still-pending item.

## Questions for BA

None — this is a technical race-condition fix with no product-shape/UX change, same fast-track category as B2B-58 (no BA gate). Recommend going straight to dev once Arun approves the debounce approach above.
