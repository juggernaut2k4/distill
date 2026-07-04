# Feature Brief: LIVE-01 — Real-Time Teaching Architecture (Script-less Live Conductor)

**From:** CEO (Arun) · **To:** Business Analyst Agent · **Priority:** P1 · **Date:** 2026-07-03
**Toggle-gated. Default OFF. Falls back to the current script + pre-generated visual system.**

## What Arun said

Stop generating a fixed, word-for-word script for live sessions. Instead:
- Generate content once per topic (whole-topic background) and once per tab (focused content).
- Give the live voice AI (Hume, brain = Claude via our custom-LLM bridge) both layers plus the user's
  profile, and let it teach naturally and answer questions, rather than reciting a script.
- Give it explicit control signals (tools) instead of today's fragile text-pattern hacks — it says
  when it's done with a tab and ready to move on, and when the session should end.
- Generate the tab's visual live, at the moment of transition, instead of pre-building it from a
  template library. While the new visual is generating, the AI keeps talking (natural transition/
  conclusion chat) so the wait is invisible to the user.
- Keep everything behind a toggle so this can be tried safely and reverted instantly if it doesn't
  work well.

## The problem being solved

Today's script-based approach:
- Requires generating a precise, word-for-word script ahead of time — expensive, rigid, and prone to
  desync bugs between what's said and what's shown (multiple such bugs fixed today).
- Can't adapt live to a user's actual questions beyond what the script anticipated.
- Uses brittle text-pattern matching (checking spoken words for "bye"/"see you" etc.) to detect
  session boundaries and tab transitions — already caused one real production bug fixed today.

## What success looks like

- A live session where Clio speaks naturally about the current tab's content (not reading a script),
  can answer questions using the wider topic context, and transitions between tabs and ends the
  session via explicit signals, not guessed from her words.
- The visual for each tab is generated live, tailored to the user's role/industry, with no visible
  "loading" gap — the transition conversation covers the generation time.
- All of this is OFF by default. Existing sessions work exactly as they do today unless the toggle is
  explicitly turned on for testing.

## Known constraints (non-negotiable, confirmed by Arun)

1. **Two content layers, not a script:**
   - Whole-topic background context — generated once, fixed for the entire session, does not change
     as tabs advance.
   - Current tab content — replaced (not appended) on every tab transition, so the live AI's working
     context does not grow unbounded across a long session.
2. **Transition mechanic:**
   - When a tab's content is wrapping up, the AI begins a natural conclusion/segue.
   - At that same moment, the next tab's visual generation starts in the background.
   - The AI's conclusion/segue speech is what covers the generation latency — it should keep talking
     naturally until the new visual is ready, then move into the new tab's real content.
   - Starting assumption: **10 seconds** of transition buffer. This is a tunable default, not a fixed
     rule — adjust based on real observed generation latency once tested live. Optimize so the user
     never perceives a "waiting for the screen" pause.
3. **Explicit control via tools, not text detection:**
   - The AI must have a tool call to signal "I am done with this tab, advancing to the next."
   - The AI must have a tool call to signal "this session should end now" (reusing the existing
     `end_session` tool already defined in the custom-LLM bridge's tool list).
   - Existing text-based farewell detection (fixed earlier today as a stopgap) should remain only as a
     dumb safety net underneath, not the primary mechanism, once these tools exist.
4. **Visualization delivery mechanism does not change:**
   - Still rendered inside the existing shared webpage, still delivered into the meeting via the
     existing headless-browser meeting bot (Attendee.dev/Recall.ai). Only the CONTENT rendered on
     that page changes (live-generated instead of template-driven) — no new video/rendering
     technology, no new meeting-bot infrastructure.
5. **User profile context:** the visual-generation call receives the same tab content plus the user's
   role/industry, so the same tab produces a genuinely different visual for different professions.
6. **Explicitly out of scope for this spec** (deferred per Arun's direction, 2026-07-03):
   - Deferring hard/deep questions to a future session (draft exists at
     `docs/brainstorm/DEFER-TO-SESSION-draft.md` — separate future spec).
   - Live time-remaining/timer awareness injected into the AI's context (to be discussed once this
     implementation is complete).
7. **Rollout:** toggle-gated, default OFF, existing script + pre-generated-visual system fully intact
   and unaffected when the toggle is off. This touches the single most fragile part of the product
   (live voice) — the toggle is a hard requirement, not a nice-to-have.

## Section 11 — RESOLVED 2026-07-03

Per Arun's explicit direction ("you build from the user intent... those things I can tell you the
feedback when I test it"), the questions below are resolved as build-ready decisions rather than left
open. All are tunable defaults, not fixed rules — Arun's live testing feedback is the mechanism for
adjusting them, per the toggle-gated, reversible nature of this whole feature.

1. **Toggle name and scope — RESOLVED:** `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED` (boolean, global env
   var), matching the existing `NEXT_PUBLIC_TOPIC01_ENABLED` convention. Default `false`/unset.
2. **Tool schema — RESOLVED:** new `advance_tab` tool (Anthropic tool def, added alongside the
   existing `show_visual`/`end_session` in `CLIO_TOOLS`). Calling it triggers the next tab's visual
   generation as a side effect inside the route handler (async, non-blocking) — the model's own
   conclusion/segue speech, generated in the same turn, is what covers the generation latency.
3. **Common behavior prompt — RESOLVED:** none exists today; draft a new, standalone "Clio behavior"
   prompt fragment as part of this build (not a reuse of any existing inline fragment). Lives in a
   dedicated constant so it's easy to iterate on independent of topic/tab content.
4. **Topic-context size cap — RESOLVED (tunable default):** ~1,500–2,000 words for the whole-topic
   background layer. Same philosophy as the 10-second transition buffer — a documented starting
   point, adjusted based on real usage (Q&amp;A quality vs. per-turn cost) once tested live.
5. **Visual generation call shape — RESOLVED:** build a new, simpler, generic live-visual format and
   a new renderer, rather than teaching the live model to pick among the 19 existing bespoke
   templates and shape data per-schema live. The 19-template system (`components/templates/renderers/*.tsx`,
   `lib/templates/selector.ts`) stays fully intact and untouched for the existing pre-generated path —
   this keeps the new live path's engineering scope small and isolated, and avoids asking a live model
   to make a template-selection judgment call under time pressure. The new generic renderer should
   support a small set of flexible shapes (e.g. headline + up to 3-4 key items + a "so what" line) —
   simple enough to render reliably from freshly generated content every time.
6. **Failure handling — RESOLVED:** if live visual generation exceeds the transition buffer, fall back
   to a text-only state for that tab (no visual, Clio continues speaking normally) rather than stalling
   further or falling back to the old template pipeline mid-session. Least disruptive, no need to keep
   the legacy pipeline warm as a live fallback path.

**Toggle branch point (per review's feasibility caveat):** the toggle must branch above content
generation, not just at the transport/adapter layer (unlike the Hume/ElevenLabs toggle, which only
branches at the connection layer while sharing one content pipeline). Concretely: wherever session
content generation is invoked (`lib/content/session-content-generator.ts` / the pipeline step that
calls it), check the flag BEFORE deciding whether to run the old script-generation path or skip
straight to the new two-layer (topic-background + tab-content) generation. This is a new branching
pattern for this codebase — implement it explicitly and document it, don't assume it falls out of the
transport-layer toggle for free.

**IMPORTANT — do not copy the existing Hume/ElevenLabs toggle's isolation pattern.** A deeper check
of `WalkthroughClient.tsx` found that toggle is NOT cleanly isolated at the orchestration level despite
appearances: both provider branches live inside one large shared function, reading/writing the same
component-level refs (`sectionsRef`, `trainingScriptsRef`, billing/audit state, etc.), with several
~70-line logic blocks (e.g. the `show_visual` tool handler) duplicated near-verbatim between branches
rather than shared or isolated. `docs/voice-provider-toggle.md`'s "completely untouched" claim is true
only for the underlying adapter *files* (`hume-adapter.ts`/`elevenlabs-adapter.ts`), not for this
orchestration file. For LIVE-01's toggle, build genuine isolation: the new live-conductor path (system
prompt construction, new tools, live visual generation, transition handling) should live in its own
module(s), invoked conditionally, not inlined as an `if/else` sharing all the same refs and duplicated
logic blocks as the existing path. This is a real safety requirement given this project explicitly
promised "toggle OFF = existing system fully intact" — don't let it become true in name only.

**Visualization architecture — build a genuinely new, simple path, do not touch the 22-template system.**
Deeper investigation confirmed the existing pipeline is more layered than the original brief assumed:
`VisualizationSpec` (headline + 3 items + so-what) is only a *seed* — the real rendered output requires
a further `generateTemplateData()` LLM call that produces a full template-specific data shape (one of
22 variants in `lib/templates/types.ts`), which only then gets dispatched to a renderer component by
`TemplateRenderer.tsx`. Reusing that system live would mean replicating an entire second LLM call class
(template selection + rich data shaping) inside the live transition window — far more complex and risky
than intended. Confirmed decision: build ONE new, simple, generic renderer component + a single live
generation call that produces exactly the data that new renderer needs (headline + up to 3-4 items +
so-what, matching `VisualizationSpec`'s spirit) — do not attempt to make the live path emit any of the
22 existing template types. The existing template system stays fully reserved for the old/default path.

## Files likely involved

- `app/api/clio/chat/completions/route.ts` — the live conductor rebuild (system prompt construction,
  new tools)
- `lib/voice/hume-adapter.ts` — tool-call wiring
- `lib/content/session-content-generator.ts`, `lib/content/script-generator.ts` — content pipeline
  changes (topic-background + tab-content generation, script generation removed for the new path)
- `components/templates/renderers/*.tsx`, `lib/templates/useFlowLayout.ts` — potentially reused or
  bypassed depending on BA's answer to Question 5
- `app/dashboard/walkthrough/WalkthroughClient.tsx` — toggle wiring, transition/loading state handling

## Dependencies already confirmed in place (from today's work)

- `show_visual` and `end_session` tools already exist in the custom-LLM bridge's tool list.
- The Hume identity/context propagation bug (userId not reaching the bridge) is already fixed
  (commit `5b6184a`) — the live conductor can rely on correctly knowing which user/session it's
  serving.
- SCR-01's plan-adaptation infrastructure (`inngest/adapt-plan.ts`) is confirmed live — relevant
  background for the deferred "defer to future session" work, not this spec's build scope.
