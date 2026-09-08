# Feature Brief: Widget-Render Live Call UI — Mic/Bot Pills, Mute, End Session, Progress, Timer, Connection & Network Status

From: CEO (Arun)
To: Business Analyst Agent (not required for build — see Verdict below; BA loop only needed if Arun's answer to the one open question changes shape)
Priority: P1
Date: 2026-08-03

## What Arun Said

Relayed verbatim by the Orchestrator, per this project's known CEO-agent-relay handling note in
`docs/b2b-pivot-status.md` / `CLAUDE.md` (treated as direct input, same as every prior B2B-70/71/72
widget-render brief tonight) — a design-brainstorm exchange that Arun explicitly closed out with a
final approval, not an idea still in discussion:

Turn 1 (on the mic/bot-speaking pill visual, after the Orchestrator proposed emoji-based icons):
"mic pill and bot speaking pill - i dont prefer the emoji icons. how about vertical hamburger like
buttons inside a circle that each bar goes small and big based on the volume. what do you think"

Turn 2 (final approval of all six items, after the Orchestrator confirmed the circular-badge-with-bars
direction):
"mute/unmute is good
end session idea is good
page progress - lets show 1/5 or 2/5 etc. even if it moves back still we show correctly as 1/5 or
whatever the page number is
timer idea is good
connection status indicator is good too
live captions not needed
network quality - small bars 3 reduced to 1 or one bar with green, yellow or red is also fine."

Approved scope — 8 additions to `WidgetRenderClient.tsx` only (item 8, "live captions", explicitly
rejected and dropped):

1. Mic-level pill — circular dark badge, 3–4 vertical bars, real mic amplitude.
2. Bot-speaking pill — same visual, real output-audio amplitude while Clio speaks.
3. Mute/unmute button — toggles the mic track.
4. Real "End session" button inside the widget component itself.
5. Page progress indicator ("1 of 5" etc.) — tracks whatever's actually on screen, including during
   an on-topic jump, never freezes or silently skips.
6. Elapsed session timer, counting up from connect.
7. Connection status indicator (dot/label) reflecting existing component state.
8. Network quality indicator (3-bar-reducing-to-1 OR single red/yellow/green — Arun's call which).

## The Problem Being Solved

The widget-render channel (B2B-70/71/72) currently gives a live participant almost no situational
awareness during a call: no visible confirmation their mic is being heard, no visible confirmation
Clio is actually speaking (vs. frozen/stalled), no way to mute or end the call without asking Clio
verbally or closing the tab, no sense of how far through the content they are, no sense of how long
they've been on the call, and no signal at all if the connection degrades. For a reseller's real end
user (not an internal tester), this is a bare content player with a live mic — it needs the baseline
situational chrome any real-time voice product has.

## What Success Looks Like

A participant in a live widget session can, at a glance: see their mic is picking up their voice
(real amplitude, not decorative animation), see when Clio is actually speaking, mute themselves,
end the call from a real button, see which page of the session they're on at all times (including
during an on-topic jump), see how long they've been on the call, see whether they're connected, and
get an honest (not fabricated) signal if the connection is degraded.

## Known Constraints

- Scope is `WidgetRenderClient.tsx` only. `PartnerRenderClient.tsx`, `openai-realtime-prompt-template.ts`,
  `lib/meeting-bot/*`, and every other do-not-touch file from prior widget-render briefs stay untouched
  — confirmed below.
- No decorative/fake animation on the mic or bot-speaking bars — must be driven by real amplitude data.
- No fabricated network-quality number — if no real signal exists, say so and use the most honest
  proxy available, or none.
- Dark-UI-consistent visual treatment (matches the existing black background, no bright accent
  competing with content) — Arun's own framing in Turn 1.

## CEO Independent Verification (re-checked directly against live source, not the relay's description)

Read in full: `app/(with-clerk)/widget-render/[clio_session_ref]/WidgetRenderClient.tsx`,
`lib/voice/hume-adapter.ts`, `lib/voice/openai-realtime-adapter.ts`, `lib/voice/adapter.ts`, and
confirmed no-collision on the next feature-brief ID via directory listing + grep across
`docs/b2b-pivot-status.md`, `BACKLOG.md`, and `.claude/agents/clio/feature-briefs/`.

1. **Mic pill (real signal):** `WidgetRenderClient.tsx` line 166 already does
   `navigator.mediaDevices.getUserMedia({ audio: true })` and holds the resulting `MediaStreamTrack`
   in `micStream`, passed to both adapters as `mediaStream`. An `AnalyserNode` can be attached to this
   stream directly inside the component (`new AudioContext()` → `createMediaStreamSource(micStream)`
   → `createAnalyser()`) with **zero adapter changes** — this is real, already-available amplitude
   data, not an assumption.

2. **Bot-speaking pill (real signal) — CONFIRMED requires a small adapter extension, not assumption-free:**
   Both adapters own a **private** `audioCtx`/`gainNode` and play audio by connecting an
   `AudioBufferSourceNode` straight to `gainNode → destination`
   (`openai-realtime-adapter.ts` line 696; `hume-adapter.ts` line 308). Neither exposes this graph
   today, and `WidgetRenderClient.tsx` only holds the adapter through the shared `VoiceSessionAdapter`
   interface (`lib/voice/adapter.ts`), which has no audio-graph accessor. Getting real output amplitude
   requires one small, additive change to **both** adapters plus the shared interface: insert an
   `AnalyserNode` into the existing `gainNode → destination` chain and expose it via a new **optional**
   interface member, e.g. `getOutputAnalyser?(): AnalyserNode | null`. This is not new engineering
   risk — it's the exact same pattern already used three times in this file for
   `sendWrapUpNudge?`/`waitForPlaybackCaughtUp?`/`triggerRecoveryNudge?` (optional, additive,
   `PartnerRenderClient.tsx`'s existing `adapter?.method?.()` call sites are provably unaffected
   because they never call a method that doesn't exist for them). No product-shape decision here —
   purely a "how," not a "what."

3. **Mute/unmute (no adapter changes needed):** Both adapters already implement
   `setMicMuted(muted: boolean)` (`openai-realtime-adapter.ts` line 889, `hume-adapter.ts` line 392),
   which sets `track.enabled` on every audio track. The button is a straight call to
   `adapterRef.current?.setMicMuted(...)` plus local UI state — confirmed, no gap.
   **Open sub-question flagged to Arun below (not decided here) — see "Question for Arun."**

4. **End session button (no gap):** `endSessionOnce()` already exists exactly as described
   (`WidgetRenderClient.tsx` lines 390–411) — sets `status` to `'ended'` (which already triggers the
   B2B-72 "Thanks for joining" screen), best-effort ends the adapter, and posts to
   `/api/partner/render/end-session`. The button is a direct call to this existing function. Confirmed
   no ambiguity.

5. **Page progress (mapping confirmed correct):** The component already holds exactly the two pieces
   of state the brief needs to distinguish — `progressIndexRef` (a ref, touched only by `advance_tab`,
   forward-only per `computeNextProgressIndex`, line 108) vs. `displayedIndex`/`displayedIndexRef`
   (reactive state, touched by **both** `advance_tab` and the B2B-71 on-topic jump via the shared
   `scrollToIndex` helper, lines 109–110, 144–149). Arun's own wording ("even if it moves back still we
   show correctly as 1/5") maps exactly onto `displayedIndex` — confirmed by re-reading the live file,
   not assumed from the relay. The counter is `${displayedIndex + 1} of ${count}`. No ambiguity.

6. **Elapsed timer (confirmed, standard pattern):** `connectStartRef` (line 100) is a `useRef<number |
   null>`, set once real connection begins (line 169) — not reactive, so it cannot drive a live-updating
   display by itself. Standard fix: a separate `useState<number>` tick updated once per second via
   `setInterval`, reading `Date.now() - connectStartRef.current`. `connectStartRef` itself stays exactly
   as-is (still feeds `endSessionOnce()`'s billing-duration calculation, untouched) — this is additive,
   not a reuse-vs-rebuild fork requiring a decision.

7. **Connection status (confirmed, zero new signal):** `status` (line 95) already has the exact literal
   union needed: `'connecting' | 'listening' | 'speaking' | 'error' | 'ended'`. This item is purely a new
   visual surfacing of existing state. No gap.

8. **Network quality (CONFIRMED: no real transport-level signal exists in either adapter today) —**
   Both adapters connect via a plain `new WebSocket(...)` (`openai-realtime-adapter.ts` line 255,
   `hume-adapter.ts` line 79). Grepped both files in full: **no `RTCPeerConnection` anywhere in either
   adapter** — there is no WebRTC transport and therefore no `getStats()` packet-loss/jitter/RTT data
   available from either provider today. This confirms the relay's suspicion; it is not an assumption.
   - **OpenAI Realtime**: already has a live diagnostic stream — `onDiagnostic` fires today for
     `ws_error`, `ws_close` (with `reconnectAttempt`/`willReconnect`/`delayMs`), `response_created`,
     `response_done`, `realtime_error`, `unhandled_event`. `WidgetRenderClient.tsx` already receives
     this callback but currently only forwards it to a server-side capture endpoint
     (`voice-diagnostic-capture`, lines 276–283) — it never feeds local UI state. A coarse,
     honest connection-quality proxy (green = connected/no errors; yellow = mid-reconnect backoff;
     red = `ws_error`/exhausted-retry `ws_close`) is buildable **today with zero adapter changes** —
     purely wiring the existing callback into a piece of local state.
   - **Hume**: has **no equivalent live hook at all**. `HumeAdapter` only exposes `reportError`
     (fire-and-forget to server-side logging, never reaches the UI) and the terminal `onError`/
     `onDisconnect` callbacks — there is nothing today the widget component can read live to build even
     a coarse proxy for Hume sessions. Achieving Hume parity requires one small, additive change to
     `hume-adapter.ts`: add an optional `onDiagnostic`-style callback (mirroring OpenAI's, itself added
     for exactly this class of purpose) that reports `ws.onerror`/reconnect-attempt events live, not
     just to `reportError`. This is real, scoped, non-trivial-but-small new work — documented here per
     Arun's own instruction that this does not need his re-approval, just documentation. Until that
     lands, Hume-provider widget sessions get a plain "connected / reconnecting / disconnected" status
     derived from existing `onConnect`/`onDisconnect`/`onError` only (still honest, just coarser than
     OpenAI's).
   - **CEO's visual pick** (Arun explicitly delegated this choice): single dot, green/yellow/red,
     labeled "Connection" rather than "Network quality" — this is honestly a connection-health proxy,
     not a measured network-quality metric, and the label should say what it actually is.

## Verdict Per Item — Carve-Out Eligibility

Precedent: B2B-43/44/45/47/49/50/72 established a "CEO-brief-only, no full BA spec" carve-out for
narrowly-scoped, Arun-specified widget-render additions where the behavior is already spelled out in
sufficient detail with no product-shape invention left to a developer.

| # | Item | Carve-out? | Why |
|---|------|-----------|-----|
| 1 | Mic pill | **Yes** | Visual fully specified (Turn 1), real signal already available, zero adapter changes. |
| 2 | Bot-speaking pill | **Yes** | Visual fully specified, matches #1. Requires a small additive adapter extension (§2 above) — engineering "how," not a product "what." No ambiguity for a developer to guess at. |
| 3 | Mute/unmute — the button itself | **Yes** | Toggle behavior fully specified, existing `setMicMuted` covers it. |
| 3b | Mute/unmute — tell Clio or not | **NO — held for Arun.** See Question below. This is a real product-behavior fork with a genuine cross-provider technical asymmetry (§ Question), not a UI detail. |
| 4 | End session button | **Yes** | Trivial, calls an existing function verbatim. |
| 5 | Page progress | **Yes** | Arun specified the exact behavior including the moves-back case; mapping independently confirmed correct against live code. |
| 6 | Elapsed timer | **Yes** | Standard, unambiguous implementation; no product decision. |
| 7 | Connection status | **Yes** | Pure surfacing of existing state; Arun didn't even need to specify the states, they already exist. |
| 8 | Network quality | **Yes** | Arun explicitly authorized either visual and this brief documents (not silently assumes) the real technical gap and its honest fallback, per his own stated bar. |

**Overall: the batch qualifies for the CEO-brief-only carve-out**, with one narrow exception carved
out of item 3 (the "tell the model" sub-question) that must go back to Arun before *that specific
piece* is built. Everything else — items 1, 2, 3 (button only), 4, 5, 6, 7, 8 — is cleared for the
Orchestrator to build directly from this brief. No BA Requirement Document is needed for this batch;
nothing here has undocumented product-shape ambiguity of the kind the BA gate exists to catch.

## Decisions Made Here (documented, not needing Arun's re-approval per his own instruction)

- Visual language for items 1/2: circular dark badge (bg-surface-equivalent, thin border, no bright
  accent), 3–4 vertical bars, height driven by `AnalyserNode` frequency/time-domain data, normalized
  and clamped so a silent mic doesn't render literally-zero (flat dead bars read as broken, not idle).
- Item 6: implemented as a derived 1-second-tick state off the existing `connectStartRef`, not a
  parallel duration source.
- Item 8: labeled "Connection" with a single dot (not the 3-bar variant) since the underlying signal is
  connection-health, not measured network quality — an honest label for an honest proxy. OpenAI gets a
  real live proxy from day one; Hume gets a coarser one now (connected/reconnecting/disconnected) with
  a documented, scoped adapter addition needed for parity later.
- New optional `VoiceSessionAdapter` interface members required (`getOutputAnalyser?()` for item 2,
  and eventually a live diagnostic hook for Hume for full item-8 parity) follow the exact
  `sendWrapUpNudge?`/`waitForPlaybackCaughtUp?`/`triggerRecoveryNudge?` pattern already established in
  `lib/voice/adapter.ts` — optional, additive, provably non-breaking to `PartnerRenderClient.tsx`.

## Question for Arun (blocking only item 3b — everything else can proceed now)

**Should Clio be told when the participant mutes their mic, or should the UI mute silently with no
signal to the model?**

Why this needs your call, not a default I pick myself: this affects a live conversation's correctness,
and the two providers genuinely differ in what a "tell Clio" implementation would cost:
- **OpenAI Realtime** has a clean, additive path: `injectContext()` is a real, functional, non-destructive
  system-role message today — telling it "the user just muted/unmuted their mic" costs nothing else.
- **Hume** has no equivalent additive path. Its `injectContext()` is a deliberate permanent no-op
  (Hume rejects `session_settings.system_prompt` under the Custom-LLM config this bridge always uses).
  The only live-instruction mechanism available, `sendWrapUpNudge()`, **replaces the entire active
  prompt** rather than appending to it, and this exact component already uses that same single-shot
  mechanism for the join-greeting flow — a second, unrelated use of it for mute-state signaling risks
  colliding with an in-flight greeting nudge.

**Options considered:**
1. Silent mute everywhere (today's implicit default for every other mute-style control in this app) —
   simplest, zero collision risk, but Clio may ask a direct verification question into dead air and
   either wait forever or repeat herself, which is the exact failure class this component's own
   `POST_TOOL_NUDGE_MS`/`triggerRecoveryNudge` machinery already exists to prevent for a *different*
   cause (silence after a tool call).
2. Tell Clio on OpenAI only (clean, safe); leave Hume silent-mute-only until a non-destructive
   instruction-injection path exists for Hume native mode.
3. Build a queued/debounced Hume signal via `sendWrapUpNudge()` now, accepting the join-greeting
   collision risk (bounded, since the greeting flow already has its own single-retry-then-clear logic)
   in exchange for parity from day one.

**Recommendation:** Option 2. It gets the real behavioral benefit (Clio doesn't talk into a muted mic
mid-question) on the provider where it's genuinely safe today, and treats Hume parity as its own
small, later, explicitly-scoped addition rather than risking today's just-stabilized Hume join-greeting
flow for a first version of an unrelated feature — consistent with Arun's own stated risk posture on
this exact component (B2B-71's "create a separate file... prove it out first" reasoning).

Please confirm option 2, or tell me which you'd prefer, and I'll update this brief before the
Orchestrator builds item 3b. Items 1, 2, 3 (mute button itself), 4, 5, 6, 7, and 8 do not depend on
this answer and can be built now.

## Files Expected to Change

- `app/(with-clerk)/widget-render/[clio_session_ref]/WidgetRenderClient.tsx` (all 8 UI additions,
  new local state for amplitude/timer/connection-quality, wiring)
- `lib/voice/adapter.ts` (one new optional interface member: `getOutputAnalyser?()`)
- `lib/voice/openai-realtime-adapter.ts` (implement `getOutputAnalyser()`; already has `onDiagnostic`
  wiring needed for item 8, no further change there)
- `lib/voice/hume-adapter.ts` (implement `getOutputAnalyser()`; item-8 Hume-parity diagnostic hook is
  explicitly deferred, not part of this batch's build — documented above, not silently dropped)

**Confirmed untouched:** `PartnerRenderClient.tsx`, `openai-realtime-prompt-template.ts`,
`lib/meeting-bot/*`, `app/api/partner/v1/sessions/route.ts`, and every other do-not-touch file carried
forward from B2B-70/71/72 — nothing in this batch's file list overlaps with any of them.
