# Feature Brief: RTV-03 — Live Position-Tracking State Machine + Transition Cues (Observe-Only)
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-09

## Series context
Phase 3 of five. Authoritative requirements:
`docs/brainstorm-realtime-transcript-driven-visualization.md` Section 7. This
brief covers **#2 (approximate position tracking), #4 (tracking logic /
state machine), #6 (quick-summary-before-transition prompt instruction), the
runtime half of #17 (bookend literal-word cues in the prompt), and #7's
detection trigger (but NOT the content pre-fetch itself — see below).**

**Hard scope boundary — this phase is OBSERVE-ONLY.** The tracker runs, tracks
which topic is being taught, and logs its conclusions. It does NOT control the
display and does NOT trigger content generation in this phase. The existing
`show_visual` path remains the sole authority for the actual screen the entire
time. The point of this phase is to validate tracking accuracy in production,
inert, against real improvised sessions before anything depends on it — the
same de-risking pattern as `SESSION-END-01`'s demoted fallback and `SESSCTX-01`.
Pre-fetch (#7 action) and display switching (#8/#18) are RTV-05.

**Depends on RTV-02** (marker sets must be stored and readable). Do not start
building until RTV-02 is approved and its marker storage shape is fixed.

Scope guardrail: Hume-native summary-mode only (#16), non-bookend sections for
content markers; bookends use their literal-word cues (#17).

## What Arun Said
- **#2 (scope simplified, CONFIRMED):** the tracker's ONLY job is: which of the
  N known session topics is currently being discussed. Not fine-grained
  position within a topic, not word-level tracking — a plain classification
  among a fixed, known set of topics. It must work against *improvised* speech
  (Arun: "we are not going to use any scripted speech"), because summary mode
  means Clio improvises her wording.
- **#4 (CONFIRMED, simplified):** a small forward-only state machine. N states
  (one per topic), one marker set per state (from RTV-02). Watch recent spoken
  words for marker hits; a hit for the *next* topic's markers advances the
  state by one. **Forward-only — never jumps backward, never skips ahead
  speculatively.** Single-hit-decisive (from #3): one hit of one qualifying
  marker concludes the transition; no corroboration.
- **#6 (CONFIRMED, scoped narrowly):** add a prompt instruction telling Clio to
  give a quick, natural summary before moving from one topic to the next — the
  designed verbal checkpoint the tracker listens for. Kept SEPARATE from the
  earlier pacing/signposting brainstorm thread (Arun, A2) — do not merge them.
- **#17 runtime half:** add a prompt instruction forcing Clio to explicitly say
  the word "Overview" / "Summary" right before delivering that bookend's
  content. The tracker treats those literal words as the bookend markers.
- **#7 detection only:** the tracker must detect the "quick summary" checkpoint
  (the pre-fetch trigger point) and the "next topic title" point (the display
  trigger point) and LOG them — proving it can, without acting on them yet.
- **Bounded, self-correcting accuracy (#19, A3):** semantic accuracy can't be
  promised mathematically perfect against improvised speech, so it is
  engineered to a tight, self-correcting, bounded worst case: forward-only
  progression, never more than one topic out of sync, self-corrects at the next
  reliable signal. This phase must MEASURE how close to that bound we actually
  get, in real sessions, so RTV-05 can be trusted to make it authoritative.

## The Problem Being Solved
Everything downstream (pre-fetch timing, precise display switching) depends on
knowing which topic Clio is on, derived from her live improvised speech. That
semantic match is the single highest-risk component of the whole system. Arun
demands correctness with a defined process to ensure it — so we validate it in
isolation, observably, before it is ever allowed to move a real screen. If
tracking is not reliably within its bounded worst case in real sessions, we
learn that here, cheaply, with zero user-visible impact — not in RTV-05 when it
controls the display.

## What Success Looks Like
- A runtime tracker consumes Clio's live speech (the existing
  `onMessage(text, source:'ai')` stream) and, using RTV-02's marker sets for
  the current session, maintains a forward-only current-topic state.
- Detection is single-hit-decisive and forward-only exactly as #3/#4 specify.
- The tracker recognizes the two designed cues: the quick-summary checkpoint
  (pre-fetch trigger point) and the next-topic-title point (display trigger
  point), and logs each with enough detail to evaluate timing accuracy.
- New prompt instructions ship (behind the same toggle): (a) #6 quick-summary-
  before-transition, (b) #17 say-"Overview"/"Summary"-before-bookend. These are
  additive to the existing `HUME_NATIVE_PROMPT_TEMPLATE` fixed rules — the BA
  must place them without breaking the ~7,000-char voice-styling guardrail in
  `prompt-template.ts` and must bump `PROMPT_TEMPLATE_VERSION`.
- **Observe-only is enforced and testable:** with this phase's toggle ON, the
  on-screen display behavior is byte-identical to today (`show_visual` still
  drives everything). The tracker's output exists only in logs / a debug
  surface. This is an explicit acceptance criterion — the tracker must be
  provably inert with respect to the screen.
- A way to review, for a completed real session: the tracker's topic-by-topic
  conclusions and cue detections vs. what actually happened (for measuring the
  bounded-worst-case claim). This is the primary deliverable of the phase — the
  evidence base Arun's "defined process to ensure correctness" requires.
- Toggle-gated, default OFF, additive, nothing deleted.

## Known Constraints (do not expand scope)
- OBSERVE-ONLY. No display control, no content pre-fetch/generation in this
  phase. If the BA finds itself speccing a screen switch or a generation call,
  it has left scope.
- Forward-only, single-hit-decisive, never-backward, never-skip — do not invent
  a richer/continuous tracking model. #2 explicitly simplified this to
  bucket-classification among a known list.
- Prompt instruction #6 stays narrowly scoped to visualization-transition
  timing — do NOT merge with the deferred pacing/signposting thread.
- Do not touch ElevenLabs / Hume-Custom-LLM. The prompt changes go only into
  the Hume-native template. `buildSessionScript()` (used by other providers)
  stays byte-identical.
- Reuse the existing live-speech listening mechanism (the same one
  farewell-detection and NAV-command parsing already use) — this is NOT a new
  Hume integration (#1, RESOLVED).

## Grounding already gathered (do not re-derive — use this)
- `app/dashboard/walkthrough/WalkthroughClient.tsx`, `onMessage` callback in
  the Hume-native block (~line 714): `source === 'ai'` gives Clio's live
  per-utterance text. This block ALREADY runs, on this same stream: NAV-command
  parsing (`parseNavCommand`), farewell detection (`isFarewellMessage`,
  first-message-skip via `aiMessageCountRef`), and silence tracking. The tracker
  is a sibling consumer here. `currentSectionIndexRef` / `sectionsRef` /
  `trainingScriptsRef` give the current known topic list at runtime. This is the
  precedent and the exact insertion point.
- `isFarewellMessage()` (~line 361) + `FAREWELL_PHRASES` show the existing
  word-boundary phrase-matching approach and the "skip the opening greeting"
  gotcha — directly reusable pattern shape for marker matching, and a cautionary
  precedent (`SESSION-END-01` demoted farewell matching from authoritative to
  gated fallback because raw phrase-matching on live speech is fragile; RTV-03's
  markers are engineered — via RTV-02 — to be far more precise, but the tracker
  must still be observe-only until proven).
- `lib/voice/hume-native/prompt-template.ts` — `HUME_NATIVE_PROMPT_TEMPLATE`
  fixed rules (1-10), `PROMPT_TEMPLATE_VERSION` ('v5' currently), and the
  documented ~7,000-char voice-styling guardrail (`HUME_VOICE_STYLING_CHAR_LIMIT`,
  `TONE_INSTRUCTION_ANCHOR`) that any prompt edit must not push the tone block
  past. New instructions #6/#17 must be placed with that constraint in mind.
- `lib/clio-context-builder.ts` `buildSessionSummary()` already emits the
  bookend sections and the "what to cover" lines — the #17 cue instruction and
  the #6 transition instruction need to be consistent with how summary-mode
  content is already framed there.
- **RTV-02 is built, approved, merged (commit `f00fa40`), migration applied in
  production — this is the real, final, locked contract, not a placeholder.**
  `lib/content/session-markers.ts` exports `generateSessionMarkers()`, called
  from `inngest/session-content-pipeline.ts` (gated on
  `RTV_MARKER_GENERATION_ENABLED`) and written to two additive columns on
  `sessions`:
  - `sessions.session_markers` (`jsonb`, nullable) — shape:
    `{ version: 1, generator: 'rtv-02', generated_at, source: 'live_conductor_content', rtv_eligible: boolean, rtv_ineligible_reason: string|null, topics: SessionMarkerEntry[] }`.
    Each entry: `{ section_index, type: 'SessionOverview'|'SessionSummary'|'topic', subtopic_slug, subtopic_title?, is_bookend, source_level?, golden_word: string|null, markers: [{ word, literal?: true, within_topic_freq?, rank? }] }`.
    Bookend markers are literally `{ word: 'overview', literal: true }` /
    `{ word: 'summary', literal: true }` at `section_index` 0 and `N+1` — this
    is the literal-word data RTV-03 reacts to for #17.
  - `sessions.rtv_eligible` (`boolean`, nullable) — `NULL`/`false` ⇒ RTV-03 must
    NOT take over tracking for this session (today's `show_visual` path stays
    authoritative, per RTV-02's own design). Only `true` means every
    non-bookend topic has ≥1 golden word.
  - `section_index` space matches `show_visual({ section_index })` exactly:
    `0` = Overview, `1..N` = topics in tab order, `N+1` = Summary.
  - Both columns live on the same active `sessions` row
    `provision-config/route.ts` already resolves at connect time.
  - All `word` values are stored lowercased/normalized — the tracker must
    lowercase incoming transcript tokens identically before matching.
  - The self-heal path in `provision-config/route.ts` deliberately sets
    `rtv_eligible: false` on self-healed sessions and never calls
    `generateSessionMarkers` synchronously — treat self-healed sessions as
    ineligible, same as any other `rtv_eligible=false` session.

## Questions for BA
1. **State machine spec.** Exact data structure (N states, per-state marker
   set, current-state pointer), the forward-only advance rule, the
   single-hit-decisive match logic (tokenization / word-boundary matching of
   recent utterances against the next state's markers), and how the opening
   greeting and bookends are handled (mirroring the farewell first-message-skip
   gotcha).
2. **Cue detection & logging.** How the quick-summary checkpoint and the
   next-topic-title point are each detected and logged, with what timing detail,
   so RTV-05's future triggers can be trusted. (Detection + logging only — no
   action.)
3. **Prompt instructions #6 and #17.** Exact instruction text for both, exact
   placement in `HUME_NATIVE_PROMPT_TEMPLATE`, `PROMPT_TEMPLATE_VERSION` bump,
   and proof the ~7,000-char voice-styling guardrail still holds after
   insertion.
4. **Observe-only enforcement.** How the spec guarantees (and how QA verifies)
   the tracker cannot move the screen in this phase — the exact separation
   between the tracker's output and any display write.
5. **Accuracy-measurement surface.** The concrete way a completed session's
   tracker conclusions + cue detections are reviewed against ground truth, so
   we can evaluate the "never more than one topic out of sync, self-corrects"
   claim before RTV-05. This is the phase's key deliverable — spec it fully.
6. **Self-correction behavior.** Exactly what happens when a marker hit is
   missed, arrives late, or arrives for a non-adjacent topic — how forward-only
   + single-hit keeps the worst case bounded, and how the next reliable signal
   self-corrects. Enumerate these cases as testable edge cases.
7. **Toggle.** Env var name, default OFF, explicit acceptance criterion that ON
   leaves the on-screen display byte-identical to today (observe-only).

## Process
Write the full 12-section Requirement Document. Document the debug/measurement
surface concretely (Question 5). Section 11 must be empty before returning to
CEO. Suggested id: `RTV-03-live-position-tracking`.
