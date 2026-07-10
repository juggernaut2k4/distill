# RTV-03: Live Position-Tracking State Machine + Transition Cues (Observe-Only) — Requirement Document
Version: 1.0
Status: APPROVED (CEO Agent, 2026-07-10)
Author: Business Analyst Agent
Date: 2026-07-10

> **CEO Review — APPROVED, 2026-07-10.** Cleared to build → test → deploy per Arun's standing
> authorization for this series. Section 11 confirmed empty — all seven of the Feature Brief's
> questions resolved with evidence, not deferred. Spot-checked the load-bearing citations directly
> against live source rather than accepting them on the BA's word: `onMessage` Hume-native callback
> confirmed at `WalkthroughClient.tsx` line 741 (brief estimated ~714 — the doc caught and corrected
> the drift); `PROMPT_TEMPLATE_VERSION` confirmed `'v5'` in `prompt-template.ts` today, bumping to
> `'v6'` as specified; `TONE_INSTRUCTION_ANCHOR`/`HUME_VOICE_STYLING_CHAR_LIMIT` guardrail confirmed
> to sit before the insertion point for new rules 11/12, so the anchor's position is provably
> unaffected. RTV-02 dependency confirmed real and merged (commit `f00fa40`), with the exact
> `sessions.session_markers`/`rtv_eligible` shape this spec builds on independently re-verified live
> against Supabase project `nqxlpcshouboplhnuvrh` (11 sessions today, 0 with markers populated — RTV-03
> is provably inert on all of today's data via the `rtv_eligible` gate alone).
>
> **CEO decision on the depth-2 lookahead (a real design tension the BA surfaced, not invented):**
> ACCEPTED. Arun's literal wording ("a hit for the next topic's markers advances by one") would, if
> followed with a strict depth-1 window, leave the tracker permanently stuck the moment any single
> topic's golden word is never spoken — directly contradicting his own "never more than one topic out
> of sync, self-corrects" requirement. The BA's resolution — watching `current+1` and `current+2`
> simultaneously, with a `current+2` hit (absent a `current+1` hit) logged distinctly as a `gap_jump`
> correction — is the right call: it is what makes "never more than one topic out of sync" true by
> construction rather than aspirational, the depth cap is justified (not arbitrary — a deeper window
> would permit exactly the speculative-skip-ahead behavior Arun ruled out), and it stays within BA
> technical authority since it is an algorithmic resolution of a stated correctness requirement, not a
> product/UX judgment call requiring escalation.
>
> **CEO decision on the shared quick-summary/next-topic detection signal:** ACCEPTED, with the
> limitation correctly disclosed rather than hidden (Section 10, Question 2) — this phase cannot yet
> measure genuine pre-fetch lead time since both cues fire off the same golden-word hit. Not
> introducing a second, forced-literal marker for rule 11 is the right scope discipline: Arun's own
> wording keeps rule 11 "a quick, *natural* summary," deliberately not literal-word-forced like rule
> 12's bookend cue, so inventing one now would be unrequested scope expansion. The accuracy report
> this phase produces is exactly the evidence RTV-05 needs to decide, later, whether that limitation
> is worth closing.
>
> **Scope verified:** genuinely observe-only — no display-control call, no content-generation call,
> anywhere in the spec. The tracker's refs (`rtvStateRef`, `rtvTopicsRef`) are structurally isolated
> from the display-side refs (`currentSectionIndexRef`, `sectionsRef`), mirroring the same isolation
> pattern already established for `LIVE-01`'s `liveConductorRef` — this is a real architectural
> guarantee, not just a stated intention. Correctly Hume-native-only (Arun's A5); `buildSessionScript()`
> and the ElevenLabs/Custom-LLM paths are untouched.
>
> This phase does not touch the template-design approval gate (that is RTV-04). No further Arun
> sign-off required to build/ship RTV-03.

## 0. Grounding note (read before the spec)

Everything in this document is checked directly against the live codebase and the live Supabase
project (`nqxlpcshouboplhnuvrh`), not against the brief's line-number citations alone. Corrections
to the brief's grounding, and the exact facts this spec is built on:

- The Hume-native `onMessage` callback is registered at **line 741** of
  `app/dashboard/walkthrough/WalkthroughClient.tsx` (`onMessage: (text, source) => {`), not line 714
  as the brief estimated — same block, close by. `source === 'ai'` fires on lines 746/756/768. NAV
  parsing runs at lines 768–783, farewell detection at 784–808. This is confirmed to be the **only**
  Hume-native per-utterance text stream in the file — there is a second `onMessage` at line 1250, but
  it is the ElevenLabs-path handler (different `Conversation` object, different message shape
  `{ message, source }`), out of scope per RTV-03's Hume-native-only mandate.
- `isFarewellMessage()` is at line 371 (not ~361), `FAREWELL_PHRASES` at line 346. Confirmed: word-
  boundary regex matching (`new RegExp('\\bphrase\\b')` on a lowercased string), and the first-AI-
  message skip via `aiMessageCountRef` (line 480, incremented at line 792) — exactly as the brief
  described.
- `currentSectionIndexRef`, `sectionsRef`, `trainingScriptsRef` (lines 483–486) are indexed **directly**
  by `section_index` — confirmed by reading the `show_visual` tool handler itself (lines 812–899):
  `sections[idx]` and `trainingScriptsRef.current[idx]` are read with `idx` set straight from
  `section_index`, never offset. This means these three runtime refs are arrays of length `N+2`,
  index `0` = Session Overview, `1..N` = topics, `N+1` = Session Summary — **exactly** RTV-02's
  `section_index` space. This is the tracker's runtime home.
- `lib/voice/hume-native/prompt-template.ts`: `PROMPT_TEMPLATE_VERSION = 'v5'` (line 15, confirmed
  current). `HUME_NATIVE_PROMPT_TEMPLATE` currently has exactly 10 numbered behavioral rules (lines
  68–133). `TONE_INSTRUCTION_ANCHOR = 'speak naturally, warmly, and with authority'` (line 165) sits at
  **character ~150** of the template (line 53, the second sentence of the intro paragraph) — i.e.
  before rule 1, before the `[CONTEXT]`/`[SESSION CONTENT]` placeholders, before anything this spec
  adds. `HUME_VOICE_STYLING_CHAR_LIMIT = 7000` (line 168).
- `lib/clio-context-builder.ts`: `buildSessionSummary()` (line 336) confirmed to special-case
  bookends (full scripted content, unabridged, per existing rules 1/8) and to reduce every non-bookend
  section to a compact "what to cover" line plus improvised-verification instructions. This is the
  live summary-mode content Clio actually teaches from today.
- **RTV-02 schema, confirmed live via direct SQL against project `nqxlpcshouboplhnuvrh`:**
  `sessions.session_markers` is `jsonb`, nullable; `sessions.rtv_eligible` is `boolean`, nullable —
  matches the brief's described shape exactly. Directly queried: **11 sessions exist today; zero have
  `session_markers` populated** (`RTV_MARKER_GENERATION_ENABLED` is off in the current environment, or
  no session has run through the pipeline since RTV-02 merged). This matters operationally: RTV-03 will
  be provably inert on every session that exists today, by the `rtv_eligible === true` gate alone,
  until RTV-02 generation is actually turned on for new sessions — no separate "kill switch" is needed
  to protect existing data.
- `lib/content/session-markers.ts` — `generateSessionMarkers()`, `tokenize()` (exported, deterministic:
  NFKC-normalize, lowercase, split on whitespace/punctuation except internal hyphens/dots, drop
  numbers/short tokens/stopwords), `RTV02_STOPWORDS`. Bookend entries: `{ section_index: 0,
  type: 'SessionOverview', markers: [{ word: 'overview', literal: true }] }` and
  `{ section_index: N+1, type: 'SessionSummary', markers: [{ word: 'summary', literal: true }] }`.
  Neither `overview` nor `summary` is in `RTV02_STOPWORDS` — both tokenize cleanly.
- `app/api/hume-native/provision-config/route.ts` — confirmed this is the **only** place that resolves
  the active `sessions` row (by `user_id` + `status = 'active'`) for a Hume-native connect, and the
  only place that persists per-session flags like `hume_native_enabled` back onto that row (lines
  462–468). The client (`WalkthroughClient.tsx`) never learns `sessionId` on its own — it only gets
  back what this route returns. This is confirmed to be the correct, and only, place to also hand the
  client its marker set for this session.
- **`session_billing_audit_log`** (migration `051_session_billing_audit_log.sql`) confirmed live
  schema: `id, session_id, user_id, event_type, voice_provider, metadata (jsonb), occurred_at,
  created_at`. `lib/session-billing.ts`'s `writeAuditEvent()` (line 107) is documented as **the only
  function in the codebase permitted to write to this table** — no update/delete path exists anywhere,
  which is what makes it dispute-defensible for billing. It already accepts an optional
  `metadata: Record<string, unknown>` (line 112) — the column exists and is already used by other
  event types; adding new event types with their own metadata shape is purely additive. Confirmed via
  `computeBilledMinutes()` (line 166) that all read paths over this table filter by **specific known
  `event_type` strings** (`speak_verified`, `disconnected`, `gap_start`, `gap_end`) — never "read every
  row generically" — so new `rtv03_*` event types are silently ignored by billing logic with zero risk
  of interference. `bot_joined` (written server-side in `app/api/sessions/[id]/start/route.ts:112`,
  confirmed) gives a real wall-clock anchor point for this session's audio start.
- `app/api/sessions/audit-event/route.ts` — the client-writable whitelist (`ClientWritableEventType`,
  a `z.enum`) and `BodySchema` currently accept `{ userId, eventType, provider?, token }` — **no
  metadata field is exposed to the client today**, even though the underlying table/function support
  it. This is the one gap this spec must close (additively) to let the tracker log anything useful.
- `inngest/session-quality-evaluator.ts` (FB-008, runs every 15 minutes, evaluates sessions that ended
  2–2.25 hours earlier) **already fetches the full Recall.ai transcript** for every completed session:
  `GET https://api.recall.ai/api/v1/bot/{recall_bot_id}/transcript` → `RecallUtterance[] { speaker,
  words: RecallWord[] { text, start_time, end_time } }` (lines 20–29, 601–629). It already identifies
  which speaker is Clio via a word-count heuristic (more verbose speaker = Clio, lines 640–652) and
  concatenates her utterances into `clioText`. This is the **exact existing ground-truth mechanism**
  RTV-03's accuracy report needs — no new transcript infrastructure is required.
- No `rtv_*`-prefixed table exists yet in the live schema (confirmed via `information_schema.tables`
  query). `session_insights` and `session_billing_audit_log` are the only two audit/analysis tables
  available; neither needs a shape change beyond what's specified below.
- Confirmed `docs/brainstorm-realtime-transcript-driven-visualization.md` Section 7's `#6` and `#17`
  are **row numbers in that requirements table**, not rule numbers inside
  `HUME_NATIVE_PROMPT_TEMPLATE` (which only has 10 rules today). This spec adds new rules **11 and
  12** to the template to implement brainstorm items #6 and #17's runtime half, respectively.

---

## 1. Purpose

Everything planned for the rest of the RTV series — pre-fetching the next topic's visualization
content early, and eventually switching the on-screen display in sync with Clio's live, improvised
speech — depends on one thing: reliably knowing which of a session's known topics Clio is currently
teaching, derived only from her live, unscripted words. That semantic judgment is the single
highest-risk piece of the whole system, because it must work against speech that is not known in
advance (summary mode, live in production, means Clio improvises her own wording for every non-bookend
topic).

RTV-03 exists to build that judgment — a small, forward-only tracker — and prove it works, in real
production sessions, **before it is ever allowed to touch anything a user sees.** It runs, watches
Clio's real speech, concludes which topic she's on, and writes that conclusion to a log. Nothing else.
If the tracker's conclusions turn out to drift, get stuck, or jump around unpredictably, that is
something this phase is specifically built to catch and measure — cheaply, invisibly to the
participant — rather than discovering it later when a real screen depends on it.

Without this phase: RTV-05 (or any future phase that wires tracking to the display or to content
generation) would be flying blind — betting real user-visible behavior on an untested heuristic
running against live, non-deterministic speech, with no evidence of how well it actually performs.

## 2. User Story

As **Arun (product owner and the "defined process to ensure correctness" requester)**,
I want to see, after any real coached session, exactly how closely the tracker's topic-by-topic
conclusions and cue timings matched what Clio actually said and when,
so that I can decide — with real evidence, not a promise — whether RTV-03's tracking approach is
trustworthy enough to let RTV-05 build on it.

As **a future RTV-05 developer**,
I want a running tracker that already logs its state transitions and the two designed transition
cues in a structured, queryable form,
so that I can build the pre-fetch and display-switch logic on top of a signal that has already been
measured in production, instead of starting from zero.

(There is no third, end-user-facing story: this phase is explicitly observe-only. A session
participant experiences **zero difference** whether this feature is on or off.)

## 3. Trigger / Entry Point

- **No new URL route and no new page.** This is a backend/runtime feature living entirely inside the
  existing Hume-native voice session lifecycle in `app/dashboard/walkthrough/WalkthroughClient.tsx`
  (and its bot-view counterpart at `app/walkthrough/[userId]/page.tsx`, which renders the same client
  component) — the same page a participant is already in for any Clio-coached session.
- **Activating conditions (all four must hold, evaluated at connect time):**
  1. `VOICE_PROVIDER === 'hume'` and `HUME_NATIVE_ENABLED === true` (existing toggles, unchanged) —
     RTV-03 is Hume-native only, per Arun's A5.
  2. `HUME_NATIVE_SUMMARY_MODE === 'true'` (existing server-side toggle, read in
     `provision-config/route.ts` line 60, unchanged) — RTV-03 targets improvised (summary-mode)
     speech specifically; scripted-mode sessions are out of scope (see Section 10).
  3. **New** `NEXT_PUBLIC_RTV_TRACKING_ENABLED === 'true'` (strict equality, same fail-safe pattern as
     every other toggle in this file — unset/false/typo all resolve to OFF).
  4. The active session's `sessions.rtv_eligible === true` (existing RTV-02 column — `NULL`/`false`
     blocks activation; this is what keeps RTV-03 inert on today's 11 existing sessions, and on any
     future self-healed session, with no additional code needed).
- If any condition is false, the tracker object is never created. Nothing about connect, prompt
  assembly, or the live session changes in any observable way.
- **Where activation is decided:** server-side, inside `app/api/hume-native/provision-config/route.ts`
  (the one place that already resolves this session's row and already gates other Hume-native
  behavior on `HUME_NATIVE_ENABLED`/`HUME_NATIVE_SUMMARY_MODE`). The route's JSON response gets one new,
  additive, optional field (`rtv03`) that is present only when all four conditions hold — see Section 6.
  The client only ever instantiates the tracker if this field is present; it never re-derives
  eligibility itself.

## 4. Screen / Flow Description

**There is no new or changed screen.** This is the entire point of the phase (Hard scope boundary:
observe-only). The participant's screen, at every moment, is driven exclusively by the existing
`show_visual` tool call → `POST /api/walkthrough-state/[userId]` (`command: 'scroll_to'`) → the
existing 2-second poll loop — completely unmodified by this feature, in code or in behavior.

What *does* happen, invisibly, is an internal event sequence. Documenting it here in place of a UI flow
(per Section 4's instruction to describe every state precisely):

1. **Session connect.** `provision-config` resolves the active session, checks the four activating
   conditions (Section 3), and — if all hold — includes `rtv03: { sessionId, topics }` in its response
   (the same `SessionMarkerEntry[]` array RTV-02 already generated and stored on `sessions.session_markers`).
2. **Tracker initialization (client-side, in `WalkthroughClient.tsx`).** A new ref,
   `rtvStateRef = useRef<number>(0)`, is created and seeded to `0` (Session Overview) — **not** derived
   from any spoken word (see Section 4a below on why state 0 needs no detection event). A second ref,
   `rtvTopicsRef = useRef<SessionMarkerEntry[]>(rtv03.topics)`, holds the marker data for lookups. Both
   are deliberately separate objects from `currentSectionIndexRef`/`sectionsRef` — the tracker only ever
   reads the display-side refs (never writes them), and the display side never reads the tracker's refs.
   This separation **is** the observe-only enforcement mechanism (see Section 4b / Question 4 below).
3. **Per-utterance matching.** On every `onMessage(text, 'ai')` call (the existing Hume-native handler,
   line 741) — after the existing NAV-command and farewell-detection logic runs, unchanged — the tracker
   (if instantiated) runs one additional, independent check: tokenize `text` with the exact same
   `tokenize()` function RTV-02 used to build the markers (imported directly from
   `lib/content/session-markers.ts`, never reimplemented, so live-matching normalization is guaranteed
   identical to authoring-time normalization), then test the resulting tokens against the marker sets of
   state `rtvStateRef.current + 1` and state `rtvStateRef.current + 2` (see Section 4a for why depth 2,
   not "the next topic" alone).
4. **On a qualifying hit,** the state advances (to `+1` or `+2`, whichever matched — never further), and
   three rows are written, fire-and-forget, to `session_billing_audit_log` via the existing
   `writeAuditEvent()` pattern (Section 6). Nothing else happens. No fetch to
   `/api/walkthrough-state/[userId]`. No write to `sectionsRef`/`currentSectionIndexRef`. No call to any
   content-generation endpoint.
5. **Session ends.** The tracker's refs are simply garbage-collected with the rest of component state,
   same as `sectionsRef` etc. today. The only durable artifact is the audit-log rows already written.
6. **Later (batch, offline):** the new accuracy-report job (Section 6/7, extending the existing FB-008
   cron) reconstructs ground truth from the real Recall.ai transcript and compares it against the
   tracker's logged conclusions, producing a stored report Arun can review.

### 4a. State machine spec (Question 1)

- **States:** `0..N+1` (`N+2` total), one state per `SessionMarkerEntry` in
  `sessions.session_markers.topics`, indexed by `section_index` — identical to the runtime
  `sectionsRef`/`trainingScriptsRef` index space confirmed in Section 0. State `0` = Session Overview,
  states `1..N` = topics in tab order, state `N+1` = Session Summary.
- **Per-state marker set:** `topics[state].markers` (array of `{ word, literal?, within_topic_freq?,
  rank? }`), read straight from the session's own `session_markers` — no separate marker store.
- **Current-state pointer:** `rtvStateRef.current`, a plain number. Seeded to `0` at tracker
  initialization (Step 2 above) — **not** produced by any detection event. This is the direct analogue
  of `isFarewellMessage`'s first-AI-message skip, but for a structurally different reason: farewell
  detection skips message #1 because a greeting can *accidentally* contain farewell-shaped language.
  RTV-03's state `0` needs no detection at all because there is no state *before* 0 to transition
  *from* — the tracker starts inside the Overview by construction, the same way `currentSectionIndexRef`
  itself starts at `0`. The first thing the tracker ever needs to *detect* is the transition **out of**
  state 0, via a hit on state 1's (or state 2's) markers — exactly like every other transition.
- **Forward-only advance rule, with a bounded, evidence-based resolution of a real tension in the
  brief:** Arun's literal words (brief, "What Arun Said" #4) are "a hit for the *next* topic's markers
  advances the state by one." Taken completely literally (checking only `current+1`'s markers, ever),
  this **cannot** deliver on Arun's own accuracy bound (A3/#19: "never more than one topic out of sync,
  self-corrects at the next reliable signal") in the case where topic `current+1`'s golden word is
  never actually said (RTV-02's "cannot-miss" guarantee makes this rare, but rare is not never, and
  improvised speech is exactly where "rare" edge cases live) — because if the tracker only ever checks
  `current+1`, and Clio moves on to teach topic `current+2` without ever uttering topic `current+1`'s
  golden word, the tracker has literally no marker set left to match against and freezes at `current`
  for the rest of the session, silently violating "never more than one topic out of sync." That failure
  mode is exactly what this phase exists to catch — so the design must not permit it by construction.
  **Resolution (a technical/algorithmic decision, within BA authority per this project's
  governance model — not a product/UX ambiguity):** the tracker checks a **fixed-depth-2 lookahead
  window** — `current+1` **and** `current+2`'s marker sets, simultaneously, every utterance — with this
  exact rule:
  - A hit on `current+1`'s markers → advance by 1. This is the normal, expected, single-hit-decisive
    case exactly as Arun described, and covers the overwhelming majority of transitions given RTV-02's
    cannot-miss guarantee.
  - A hit on `current+2`'s markers, with `current+1` never having been hit → advance directly to
    `current+2` in one step, logged distinctly as `correction_type: 'gap_jump'` (Section 6) rather than
    silently folded into the normal case. This is the one bounded exception that makes "never more than
    one topic out of sync" actually true: the tracker can fall behind by at most one full topic
    (`current+1` is being taught for real, tracker still shows `current`) before self-correcting the
    instant `current+2`'s own golden word is heard.
  - Depth is capped at exactly 2, not "all remaining states." A deeper window (checking `current+3`,
    `current+4`, ...) would let a single stray word skip arbitrarily far ahead after a long silent gap
    — which is precisely the "skips ahead speculatively" behavior Arun explicitly ruled out. Capping at
    2 is not an arbitrary implementation choice; it is what makes the "never more than one topic out of
    sync" bound arithmetically hold.
  - A hit for any state at depth 3+ (or any state ≤ `current`) is structurally never checked at all —
    there is no code path that tests recent words against those marker sets — so it is always ignored,
    with no special-case logic required. This also makes "never jumps backward" true by construction,
    not by a runtime check.
  - Single-hit-decisive holds for both the depth-1 and depth-2 case: exactly one qualifying marker word
    appearing once is sufficient in either case — no corroboration is required in either branch. This
    spec does not add corroboration; it only widens which *specific* future states are eligible to
    trigger a hit, capped at depth 2 for the reason above.
- **Bookend handling:** states `0` and `N+1` use their literal, single-word markers (`overview`/
  `summary`) exactly as RTV-02 stored them — matched with the same word-boundary approach
  `isFarewellMessage()` already uses (lowercase, then `tokenize()`, which already performs
  word-splitting — a token-set membership check is equivalent to and simpler than a regex
  word-boundary test here, since `tokenize()` already isolates whole tokens). No difference in
  mechanism from a topic state; the only special thing about bookends is that their marker set has
  exactly one literal word instead of a set of golden-word candidates, and that word only exists in the
  transcript because of new prompt rule 12 (Question 3) forcing Clio to say it.
- **Matching granularity:** each `onMessage(text, 'ai')` utterance is tokenized and checked
  independently — no cross-utterance buffering or sliding window. This mirrors the exact limitation the
  existing farewell/NAV detection already accepts (a multi-word farewell phrase split across two
  separate Hume utterance boundaries would already be missed today); RTV-03 introduces no new or
  different limitation here, and single golden words are far less likely to be split mid-word than a
  multi-word phrase is to be split mid-phrase.

### 4b. Observe-only enforcement (Question 4)

- **Structural separation, not a runtime flag check.** The tracker's only side effect is a fire-and-
  forget `fetch()` to `/api/sessions/audit-event` (extended per Section 6). It never calls `fetch()`
  against `/api/walkthrough-state/[userId]`, never touches `screenQueueRef`, never assigns to
  `sectionsRef.current`, `trainingScriptsRef.current`, or `currentSectionIndexRef.current` — it only
  ever *reads* `sectionsRef.current`/`trainingScriptsRef.current` (for the existing, unmodified
  `show_visual` handler's own use — the tracker does not even need to read them; it works entirely off
  `rtvTopicsRef`, which is populated once from the `provision-config` response and never touches the
  display refs at all).
- **QA-verifiable, three ways:**
  1. **Code review gate:** the tracker module (a new, isolated file, e.g.
     `lib/content/rtv03-tracker.ts`, mirroring how `lib/content/live-conductor-client.ts` is already an
     isolated, sibling module per the existing LIVE-01 comment convention at the top of
     `WalkthroughClient.tsx`) must contain zero references to `/api/walkthrough-state`,
     `screenQueueRef`, or any setter for `sectionsRef`/`currentSectionIndexRef`. This is a one-line grep
     check any reviewer or CI step can run.
  2. **Live A/B screen-recording diff:** run the identical session content twice, toggle OFF then ON
     (all four Section 3 conditions true the second time), screen-record both, and diff frame-by-frame.
     Every `show_visual` transition must occur at the same real-world moment in both recordings (driven
     only by Clio's actual tool calls, which are unmodified). Any observed difference is a defect.
  3. **Automated unit assertion:** a test asserting `rtvStateRef` and `currentSectionIndexRef` are
     distinct `useRef` objects, and that no code path in the tracker module or in `onMessage` assigns
     one from the other's value (i.e., `rtvStateRef.current = currentSectionIndexRef.current` never
     appears, and vice versa).
- This is the exact same class of guarantee `LIVE-01`'s existing comment already documents for
  `liveConductorRef` ("a separate ref object... so the two paths never share mutable state") — RTV-03
  reuses that established isolation pattern rather than inventing a new one.

## 5. Visual Examples

There is no on-screen UI for this feature — the hard scope boundary is observe-only, and no admin
dashboard is being requested (see Section 10). The one new artifact a human ever looks at is a JSON
report (Section 6/7's accuracy report), reviewed by Arun via a simple authenticated `GET` endpoint,
the same way `app/api/admin/qa-session-context/route.ts` is already reviewed today (raw JSON, Clerk-
authenticated, no dedicated page). Rendered here as a text wireframe of that JSON shape, since no
literal screen exists to wireframe:

```
GET /api/admin/rtv03-accuracy-report?sessionId=<uuid>
Authorization: Clerk session (existing `auth()` gate, same as qa-session-context route)

{
  "session_id": "…",
  "generated_at": "2026-07-10T09:14:22Z",
  "rtv_eligible": true,
  "topics_total": 5,
  "topics_matched": 4,
  "max_topics_out_of_sync": 1,
  "self_correction_events": 1,
  "mean_abs_delta_seconds": 6.2,
  "median_abs_delta_seconds": 3.8,
  "max_delta_seconds": 41.0,
  "per_topic": [
    {
      "section_index": 1,
      "subtopic_title": "What Generative AI Is",
      "ground_truth_first_mention_time_s": 38.4,
      "tracker_detected_time_s": 41.1,
      "delta_seconds": 2.7,
      "matched_word": "transformer",
      "correction_type": "normal"
    },
    {
      "section_index": 2,
      "subtopic_title": "The Foundation Model Landscape",
      "ground_truth_first_mention_time_s": 190.0,
      "tracker_detected_time_s": 231.5,
      "delta_seconds": 41.5,
      "matched_word": "gemini",
      "correction_type": "gap_jump",
      "note": "topic 1's own golden word was never detected in this session — tracker caught up on topic 2's hit"
    }
  ]
}
```

There is no wireframe for a second screen state because there is only one: the report either exists
(session was RTV-03-eligible and has completed + been evaluated) or it doesn't (see Section 8, error
states, for the "not yet available" and "not eligible" responses).

## 6. Data Requirements

### 6.1 Reads
- `sessions.session_markers` (`jsonb`), `sessions.rtv_eligible` (`boolean`) — read once, server-side, in
  `provision-config/route.ts`, at the same query that already selects `id, live_conductor_content` (add
  both columns to that existing `select()` call — no new query).
- `sessions.recall_bot_id`, already read by `session-quality-evaluator.ts` — reused unchanged by the new
  accuracy-report step.
- `session_billing_audit_log`, filtered to `event_type IN ('bot_joined', 'rtv03_state_advance',
  'rtv03_quick_summary_cue', 'rtv03_next_topic_cue')` for a given `session_id`, ordered by
  `occurred_at` — read once by the new accuracy-report step, via a new, narrowly-filtered query (not
  the existing `getAuditLog()`, which returns every row and is billing-specific; a new
  `getRtv03AuditEvents(sessionId)` helper in `lib/session-billing.ts` or a small sibling file is cleaner
  and avoids coupling QA code to the billing module's contract).
- Recall.ai transcript: `GET https://api.recall.ai/api/v1/bot/{recall_bot_id}/transcript` — the exact
  existing call `session-quality-evaluator.ts` already makes (lines 601–629); reused, not duplicated.

### 6.2 Writes

**New migration `supabase/migrations/064_rtv03_position_tracking.sql`** (additive only, no existing
column/table touched):
1. `sessions.rtv03_tracking_enabled boolean` (nullable, default `null`) — persisted once, at connect
   time, in `provision-config/route.ts`, in the same `update()` call that already writes
   `hume_native_config_id`/`hume_native_enabled` (lines 462–468). Mirrors exactly why
   `hume_native_enabled` is persisted per-session rather than re-derived from the live env var later:
   the global toggle can change over time, and the accuracy report must know whether *this specific*
   historical session actually had tracking on, independent of today's env var value.
2. New table `rtv03_accuracy_reports`:
   ```sql
   create table rtv03_accuracy_reports (
     session_id uuid primary key references sessions(id) on delete cascade,
     generated_at timestamptz not null default now(),
     topics_total int not null,
     topics_matched int not null,
     max_topics_out_of_sync int not null,
     self_correction_events int not null,
     mean_abs_delta_seconds numeric,
     median_abs_delta_seconds numeric,
     max_delta_seconds numeric,
     per_topic jsonb not null,
     transcript_fetch_error text
   );
   ```
   One row per evaluated session (upserted by `session_id`, same idempotency convention
   `session-quality-evaluator.ts` already relies on for its own per-session writes). RLS: service-role
   write only, matching every other admin/QA table in this project (no end-user access path needed —
   this is never read by any user-facing route).

- `session_billing_audit_log` — three new `event_type` literal values, added to
  `BillingAuditEventType` in `lib/session-billing.ts` (line 81) and to the client-side
  `BillingAuditEventType` alias in `WalkthroughClient.tsx` (line 129):
  - `rtv03_state_advance` — `metadata: { from_state, to_state, matched_word, lookahead_depth: 1 | 2,
    correction_type: 'normal' | 'gap_jump', subtopic_slug }`
  - `rtv03_quick_summary_cue` — `metadata: { state, matched_word, same_signal_as_next_topic_cue: true }`
  - `rtv03_next_topic_cue` — `metadata: { from_state, to_state, matched_word }`

  All three are written together, fire-and-forget, in the same tick a qualifying hit occurs (Section
  4a). See Question 2 below for why `rtv03_quick_summary_cue` and `rtv03_next_topic_cue` share one
  detection signal in this phase.

### 6.3 API changes

- **`POST /api/hume-native/provision-config`** — additive response field:
  ```ts
  {
    configId: string,
    rtv03?: { sessionId: string, topics: SessionMarkerEntry[] }
  }
  ```
  Included only when all four Section 3 conditions hold. Server-side check:
  `process.env.NEXT_PUBLIC_RTV_TRACKING_ENABLED === 'true' && summaryModeEnabled &&
  sessionRow.rtv_eligible === true` (the fourth condition, `HUME_NATIVE_ENABLED`, is implicit — this
  route only ever runs when it's already true). Reading a `NEXT_PUBLIC_`-prefixed var server-side is
  safe and already done elsewhere in this codebase's convention (these vars are plain `process.env`
  reads, not client-bundle-restricted) — this keeps one single toggle source of truth for both the
  client's decision to instantiate the tracker and the server's decision to hand it data.

- **`POST /api/sessions/audit-event`** — additive, backward-compatible change to
  `app/api/sessions/audit-event/route.ts`:
  - `ClientWritableEventType` enum gains 3 values: `rtv03_state_advance`, `rtv03_quick_summary_cue`,
    `rtv03_next_topic_cue`.
  - `BodySchema` gains an optional field: `metadata: z.record(z.unknown()).optional()`.
  - The route passes `metadata: parsed.data.metadata ?? {}` through to `writeAuditEvent()` — one line
    added to the existing call, no other route logic changes. Existing event types (`voice_connect_
    attempt`, `speak_verified`, `gap_start`, `gap_end`) are unaffected; they simply never send
    `metadata` and default to `{}` exactly as they do today.

- **New `GET /api/admin/rtv03-accuracy-report`** — `?sessionId=<uuid>` (required). Auth: identical
  pattern to `app/api/admin/qa-session-context/route.ts` (`const { userId } = auth(); if (!userId)
  return 401`) — Clerk-authenticated, no additional role check, matching this project's existing
  single-owner-operated admin-route convention. Returns the stored `rtv03_accuracy_reports` row, or a
  structured "not available" response (Section 8).

- **Extended `inngest/session-quality-evaluator.ts`** (or a new, small sibling Inngest function on the
  identical cron/window, if keeping FB-008 untouched is preferred for blast-radius reasons — either is
  acceptable; a sibling function is slightly safer since it cannot regress FB-008's own quality-scoring
  logic even if RTV-03's step throws): for every session with `rtv03_tracking_enabled = true` that has
  completed and has a fetchable transcript, compute and upsert one `rtv03_accuracy_reports` row per
  Section 7's algorithm.

### 6.4 In-memory / client state
- `rtvStateRef: React.MutableRefObject<number>` — new, in `WalkthroughClient.tsx`.
- `rtvTopicsRef: React.MutableRefObject<SessionMarkerEntry[]>` — new, in `WalkthroughClient.tsx`.
- Neither is persisted to `localStorage`/`sessionStorage`/`walkthrough_state` — purely in-memory for the
  life of the component, exactly like `sectionsRef` etc. today. No new client-side persistence.

## 7. Success Criteria (Acceptance Tests)

✓ Given `NEXT_PUBLIC_RTV_TRACKING_ENABLED` unset (default), when any Hume-native session connects,
  then `provision-config`'s response contains no `rtv03` field, the tracker is never instantiated, and
  `session_billing_audit_log` never receives any `rtv03_*` row for that session.

✓ Given the toggle is `true` but the active session's `rtv_eligible` is `false` or `null` (true for all
  11 sessions in production today), when the session connects, then `provision-config`'s response still
  omits `rtv03`, and behavior is identical to the toggle-off case.

✓ Given the toggle is `true`, `HUME_NATIVE_SUMMARY_MODE` is `true`, and the active session has
  `rtv_eligible = true` with a full marker set, when Clio speaks a topic's golden word for the first
  time, then exactly one `rtv03_state_advance` row (with `correction_type: 'normal'`, `lookahead_depth:
  1`) and one each of `rtv03_quick_summary_cue`/`rtv03_next_topic_cue` are written to
  `session_billing_audit_log`, and `rtvStateRef.current` advances by exactly 1 — with **no** change to
  `currentSectionIndexRef.current` or any write to `/api/walkthrough-state/[userId]` as a result.

✓ Given the tracker is at state `k` and topic `k+1`'s golden word is never spoken but topic `k+2`'s
  golden word is, when that word is detected, then the state advances directly from `k` to `k+2` in one
  step, logged with `correction_type: 'gap_jump'`, `lookahead_depth: 2` — and the state never passes
  through `k+1`.

✓ Given a real completed session with `rtv03_tracking_enabled = true`, when the extended
  quality-evaluator step runs (2–2.25 hours after session end, same window as FB-008 today), then a row
  is upserted into `rtv03_accuracy_reports` with `topics_total`, `topics_matched`,
  `max_topics_out_of_sync`, and per-topic deltas computed against the real Recall.ai transcript — and
  `GET /api/admin/rtv03-accuracy-report?sessionId=<id>` returns that row as JSON to an authenticated
  caller.

✓ Given the Recall.ai transcript for a session is not yet available (still processing) when the
  evaluator step runs, then the step behaves exactly as `session-quality-evaluator.ts` already does for
  a 404 (re-throws so Inngest retries) — no new failure mode, no partial/incorrect report is ever
  written.

✓ Given a toggle-ON session is screen-recorded end-to-end and diffed against an otherwise-identical
  toggle-OFF recording of the same content, then every `show_visual`-driven transition occurs at the
  same real-world timestamp in both recordings — proving observe-only in practice, not just by code
  inspection.

## 8. Error States

- **`provision-config` cannot read `session_markers`/`rtv_eligible`** (e.g. a transient Supabase error
  on that one extra `select` column): treated as `rtv_eligible !== true` — omit `rtv03` from the
  response and proceed with the existing Hume-native connect flow completely unaffected. A tracker
  failure must never block or degrade session connect, exactly per this project's "technical decisions:
  full autonomy, never block the live experience" convention.
- **Client-side tracker throws** (e.g. malformed marker data): caught at the call site inside
  `onMessage`, logged via `console.error`, and the tracker simply stops advancing for the rest of the
  session (state freezes) — this must never throw uncaught inside `onMessage`, since that handler also
  runs the existing NAV/farewell logic and a tracker crash must not take those down with it. Wrapped in
  its own `try { } catch { }` block, isolated from the rest of the handler.
- **`writeAuditEvent` fails for an `rtv03_*` row** (network blip, DB error): non-fatal, exactly like
  every other audit-event write today — logged via `console.error`, fire-and-forget, never retried
  inline, never surfaced to the participant. A missing row degrades this session's accuracy-report
  completeness only, never the live call.
- **Recall.ai transcript fetch fails** in the accuracy-report step: reuse `session-quality-evaluator.
  ts`'s existing handling verbatim — 404 re-throws (Inngest retries), other errors set a
  `transcriptError` string and the report is written with `transcript_fetch_error` populated and
  `per_topic: []` rather than silently fabricating zero deltas.
- **`GET /api/admin/rtv03-accuracy-report` for a session with no report row yet** (not evaluated, not
  eligible, or still within the 2–2.25 hour post-session window): returns `404` with
  `{ error: 'No RTV-03 accuracy report available for this session', reason: 'not_evaluated' |
  'not_eligible' }` — never a silent empty `200`.
- **Missing/invalid `sessionId` query param:** `400` with a clear validation message, same convention as
  every other Zod-validated route in this codebase.

## 9. Edge Cases

- **First-ever RTV-03-eligible session vs. a returning topic:** no difference — the tracker has no
  per-user memory; it is reseeded fresh to state `0` on every connect, same as `currentSectionIndexRef`.
- **A session with only 1 topic (`N = 1`):** states are `0, 1, 2` (Overview, the one topic, Summary) —
  the depth-2 lookahead from state `0` checks state `1` and state `2` (Summary) simultaneously from the
  very start; this is intentional and correct, not a special case, since Summary's literal "summary"
  marker is a perfectly valid depth-2 target from Overview if the single topic's golden word is somehow
  missed.
- **Missed hit (topic's golden word never said):** covered explicitly by the `gap_jump` design (Section
  4a) — bounded to exactly one topic of lag, self-corrects at the next real hit.
- **Late hit (golden word said, but well after Clio has clearly moved on):** the state still advances
  correctly the moment the word is heard — "late" here only affects the *timing* delta measured in the
  accuracy report (Section 7's `delta_seconds`), not correctness of the eventual conclusion. This is
  exactly the kind of evidence the accuracy report exists to surface.
- **Hit for a non-adjacent topic (depth 3+) spoken as an aside/callback:** structurally never checked
  (Section 4a) — always ignored, no state change, no log row. RTV-02's uniqueness guarantee (a golden
  word appears in exactly one topic all session) makes this rare in the first place; the depth cap makes
  it inert even on the rare occasion it happens.
- **Backward reference to an earlier topic's golden word** (Clio calls back to something taught two
  topics ago): never checked, since only states strictly ahead of `current` are ever in the matching
  window — "never jumps backward" holds by construction, not by a defensive check.
- **A hit that satisfies both `current+1` and `current+2` in the exact same utterance** (e.g. an
  improvised transition that mentions both the current bridge and previews the topic after next in one
  breath): the depth-1 hit takes priority (advance by exactly 1, `normal`) — the tracker evaluates
  `current+1` before `current+2` in the same pass, so a same-utterance double-match never skips a state.
- **Self-healed sessions** (`rtv_eligible` explicitly set to `false` by the existing CONTENT-POP-01 path
  in `provision-config/route.ts` line 366): already excluded by the standard `rtv_eligible === true`
  gate — no additional handling required, exactly as RTV-02 designed.
- **A session where the toggle was flipped ON mid-way through the RTV-03 rollout but the session itself
  predates RTV-02 marker generation** (one of today's 11 sessions): `rtv_eligible` is `null`/`false` for
  all of them — excluded, no special migration/backfill needed.
- **Mobile vs. desktop:** not applicable — this feature has no UI surface.

## 10. Out of Scope

- **Any display control.** The tracker never calls `/api/walkthrough-state/[userId]`, never influences
  `show_visual`, never sets `screenQueueRef`. This is RTV-05.
- **Any content pre-fetch or generation call.** Detecting the "quick summary" checkpoint is
  logging-only in this phase — it does not trigger `/api/generate-visual` or any other generation
  endpoint. This is RTV-05's #7.
- **Template selection or the template library** (brainstorm items #9–#15, #20). Entirely unaffected
  and untouched by this spec.
- **ElevenLabs or Hume-Custom-LLM support.** Per Arun's A5 — Hume-native only. `buildSessionScript()`
  (used by the other providers) is not modified; only `buildSessionSummary()`'s sibling prompt template
  (`prompt-template.ts`) changes, and only its fixed rule set, not its per-session content assembly.
- **A dedicated admin dashboard/UI for the accuracy report.** A single authenticated JSON endpoint is
  the deliverable; building a visual report browser is not requested and would be scope creep on an
  observe-only validation phase.
- **A separate, distinctly-detectable signal for the "quick summary" checkpoint** beyond the
  golden-word hit it currently shares with the "next topic" checkpoint (see Question 2's answer below).
  Introducing a new forced literal marker for prompt rule 11 (mirroring rule 12's bookend approach)
  would be a real, reasonable future refinement — but it is not requested by this brief (rule 6/#6 is
  explicitly "a quick, *natural* summary," not a literal-word rule), and adding one now would be
  unrequested scope expansion of a prompt instruction the brief scoped narrowly. This is flagged
  explicitly (not silently done) so RTV-05 can decide, using this phase's own evidence, whether it's
  worth adding later.
- **Backfilling or re-running marker generation for the 11 existing sessions.** Out of scope for RTV-03;
  belongs to whatever future work actually turns `RTV_MARKER_GENERATION_ENABLED` on broadly.

## 11. Open Questions

None. All seven of the brief's "Questions for BA" are answered above with evidence from the live
codebase and live database:
1. State machine spec — Section 4a.
2. Cue detection & logging — Section 6.2/6.3 (schema), and immediately below (design rationale).
3. Prompt instructions #6/#17 — Section 4a is silent on this; see the dedicated answer immediately
   below.
4. Observe-only enforcement — Section 4b.
5. Accuracy-measurement surface — Section 5 (shape) + Section 6 (data) + Section 7 (algorithm/tests).
6. Self-correction behavior — Section 4a (design) + Section 9 (enumerated edge cases).
7. Toggle — Section 3 (`NEXT_PUBLIC_RTV_TRACKING_ENABLED`, default OFF) + Section 7's acceptance tests
   (byte-identical-display criterion).

**Question 2 — Cue detection & logging, full answer.** The brief distinguishes two designed
checkpoints: the "quick summary" point (future pre-fetch trigger, #7) and the "next topic title" point
(future display trigger, #8/#18). Mechanically, in this phase, **both are detected from the same single
signal**: the depth-1/depth-2 golden-word hit described in Section 4a. This is a deliberate, explicit
design decision, not an oversight: RTV-02's golden words are the only literal, single-hit-decisive
keyword primitive this design has to work with, and new prompt rule 11 (the quick-summary instruction)
deliberately has **no** forced literal marker of its own — Arun's A2 kept it "a quick, natural summary,"
explicitly distinct from rule 12's forced-literal-word bookend approach. Inventing a new forced marker
for rule 11 now would be unrequested scope expansion. So: on every qualifying hit, the tracker logs
**both** `rtv03_quick_summary_cue` and `rtv03_next_topic_cue` at the same timestamp, with the former's
metadata explicitly flagged `same_signal_as_next_topic_cue: true` — an honest, visible admission (for
RTV-05's benefit) that this phase cannot yet distinguish a genuinely earlier "she's now summarizing"
moment from the topic-transition moment itself. The accuracy report's per-topic `delta_seconds` (Section
5/7), computed against the real transcript, is exactly the evidence RTV-05 needs to decide whether that
gap matters enough to warrant adding a distinct marker for rule 11 later. Timing detail logged per hit:
`from_state`, `to_state`, `matched_word`, `lookahead_depth`, `correction_type`, and an implicit
`occurred_at` (server-assigned at write time, following the exact existing pattern every other
client-writable audit event already uses — no new client-supplied timestamp field is introduced).

**Question 3 — Prompt instructions #6 and #17, full answer, with proof.**
New rule 11 (implements brainstorm #6), inserted immediately after existing rule 10 in
`HUME_NATIVE_PROMPT_TEMPLATE`:

> `11. Before moving from one topic to the next, give a quick, natural spoken summary of what you just`
> `    covered in this topic — one or two sentences, in your own words — before beginning your bridge to`
> `    the next topic. This is a distinct transition checkpoint from the final two-sentence closing`
> `    summary described in rule 8, which only happens once, at the very end of the session — do not`
> `    confuse the two or skip this one because you already expect to summarize at the end.`

New rule 12 (implements brainstorm #17's runtime half), inserted immediately after rule 11:

> `12. Immediately before you begin delivering the Session Overview section's content (rule 1), and again`
> `    immediately before you begin delivering the Session Summary section's content (rule 8), explicitly`
> `    say the word "overview" or "summary" (respectively) out loud, naturally, as part of your sentence`
> `    — for example, "Let's start with a quick overview," or "Let's wrap up with a summary of what we`
> `    covered." Say one of these two words at that exact moment, every session, without exception.`

Rule 11 explicitly disambiguates itself from rule 8's existing "briefly summarize... in exactly two
sentences" closing instruction (a real, identified collision risk in the existing template — rule 8
already uses the word "summarize," and without this disambiguating sentence Clio could plausibly treat
rule 11 as redundant with rule 8 and skip it). `PROMPT_TEMPLATE_VERSION` bumps from `'v5'` to `'v6'`
(line 15).

**Proof the ~7,000-char voice-styling guardrail still holds:** `TONE_INSTRUCTION_ANCHOR` sits at
character ~150 of the template (Section 0), inside the fixed intro paragraph that precedes rule 1.
Rules 11/12 are inserted **after** rule 10 and **before** the `[CONTEXT]`/`[SESSION CONTENT]`
placeholders — i.e., entirely after the anchor's fixed position. Because
`assembleHumeNativePrompt()`'s guardrail check (lines 188–201) locates the anchor by
`indexOf(TONE_INSTRUCTION_ANCHOR)`, and nothing this spec adds appears *before* that string in the
template, the anchor's character offset in the final assembled prompt is **unchanged** — it is
mathematically invariant to any text added after it, regardless of how much `[CONTEXT]`/`[SESSION
CONTENT]` grows per session. The existing runtime `console.warn` check in `assembleHumeNativePrompt()`
(unmodified) remains the live, ongoing proof mechanism — this spec does not weaken or bypass it.

## 12. Dependencies

- **RTV-02 (`RTV-02-marker-generation-pipeline`)** — approved, merged (`f00fa40`), migration `063_
  session_markers_rtv02.sql` applied in production. Confirmed directly: `sessions.session_markers`/
  `rtv_eligible` exist with the exact documented shape. **Hard dependency, already satisfied.**
- **`RTV_MARKER_GENERATION_ENABLED`** must eventually be turned on for new sessions for RTV-03 to ever
  see real marker data in production — currently off (0 of 11 sessions have markers). Not a blocker for
  *building* RTV-03 (it will simply stay inert until that happens), but worth noting as the actual
  precondition for the accuracy report ever having real sessions to evaluate.
- **`HUME_NATIVE_ENABLED`, `HUME_NATIVE_SUMMARY_MODE`** — existing toggles, already live, unchanged.
- **`session_billing_audit_log` + `writeAuditEvent()`** (migration `051`) — existing, unchanged in
  shape; only the `BillingAuditEventType`/`ClientWritableEventType` literal unions and the client-facing
  Zod schema gain new values.
- **`RECALL_API_KEY`** — existing dependency, already required and configured for
  `session-quality-evaluator.ts`'s transcript fetch; the accuracy-report step reuses the same
  credential, no new secret needed.
- **New migration `064_rtv03_position_tracking.sql`** must be applied before any of this ships (adds
  `sessions.rtv03_tracking_enabled` + the new `rtv03_accuracy_reports` table).
- **No dependency on RTV-05** — this phase is explicitly designed to produce the evidence RTV-05 will
  depend on, not the other way around.
