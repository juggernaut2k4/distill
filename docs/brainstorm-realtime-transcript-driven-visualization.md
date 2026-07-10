# Brainstorm: Transcript-Driven Real-Time Visualization

Status: REQUIREMENTS GATHERING — no code changes yet, not a spec.
Started: 2026-07-09
Participants: Arun (product owner), Orchestrator

This document exists to capture Arun's raw requirements before any CEO/BA/build work starts, per
his explicit process: (1) document requirements, (2) orchestrator asks clarifying questions, (3)
document Arun's answers, (4) orchestrator restates understanding, (5) only then proceed to
CEO → BA → build → review → test → deploy.

---

## 1. Arun's Requirements (as stated, restructured for clarity — not yet reworded/interpreted)

1. **Live transcript access.** Get a relay/stream, or otherwise constantly listen to / access
   Hume's transcript in real time as Clio speaks — not after the fact.

2. **Approximate position tracking via keywords.** Run an algorithm that watches the live
   transcript for unique keywords/markers that identify what Clio is currently talking about and
   where that falls in the overall session content. This tracking need not be perfectly accurate.

3. **Keyword uniqueness is critical.** The keywords must be genuinely unique per session — common/
   generic words risk false signals (e.g. wrongly concluding the session is ending, or misjudging
   which tab/topic is being discussed). Need an algorithm that quickly and intelligently prepares
   this keyword list per session (not manually curated per session).

4. **Tracking logic.** Using the live transcript stream, continuously check the most recently
   spoken words against the keyword list to determine current position/progress — which topics
   have already been covered.

5. **Prerequisite state.** Once you have: (a) the session's content, (b) markers/keywords derived
   from it, and (c) content already categorized into tabs/topics — the tracking system is ready to
   operate.

6. **Prompt instruction: signal the transition.** Add an instruction so Clio gives a quick summary
   before moving from one session topic/tab to the next — a designed, reliable verbal transition
   cue.

7. **Trigger for generation (pre-fetch).** When the tracked position crosses that "quick summary"
   point for a topic, start generating the visualization for the *next* topic in the background, so
   it's ready in time.

8. **Trigger for display (precise sync).** If tracking is accurate enough, actually render/switch
   the screen to the new visualization exactly when Clio starts saying the title of the next topic
   — not before, not noticeably after.

9. **Template-selection algorithm.** Need logic that, given a topic and its content, decides which
   visualization template fits best (comparison → table, process → flow chart, landscape → heatmap,
   etc.).

10. **Minimal on-screen text.** Visualizations should show short, crisp text only — detailed
    explanation stays verbal (talking points), not written on screen.

11. **Template library.** Define a set of infographic template types: tables, overlays, flow
    charts, heatmaps, etc.

12. **Fixed-size containers with a max character budget.** Define a max character count per
    box/container per template. Containers are fixed size regardless of actual content length, so
    shorter text never distorts shape/spacing.

13. **Minimum character floor + uniform typography.** Containers must also have a minimum content
    length so they never look empty. Same font family throughout the app; uniform font sizes.

14. **Generous margins, no warm-up state.** More margin around visualizations so content reads as
    centered/aligned. Since content is prepared ahead of time (per #7), there's no need for a
    loading/warm-up visual state — it should appear immediately, fully formed.

15. **No live generative drawing — pre-approved templates only.** This is not a "design something
    new each time" system. Build a defined library of templates per topic/content type ahead of
    time, each with sample content, and get Arun's explicit approval on each template *before* it's
    used in production. Once approved, the live system only ever plugs data into an
    already-approved template — no on-the-fly design/layout changes during a real session.

---

## 2. Orchestrator's Understanding + Relevant Existing Context

*(Grounded in this exact codebase, not speculation — verified via direct file reads.)*

- **#1 is already technically possible today, and partially already built.** The app already
  receives Clio's spoken text live, per-utterance, inside `WalkthroughClient.tsx`'s Hume message
  handler — this is the exact mechanism `FAREWELL_PHRASES`/`isFarewellMessage()` already uses (just
  shipped/hardened yesterday under `SESSION-END-01`). Extending this to keyword/marker tracking for
  visualization timing is a natural extension of existing, already-working infrastructure — not a
  new integration with Hume.
- **A related-but-distinct toggle already exists**: `REALTIME_VISUAL_TEST_MODE`
  (`NEXT_PUBLIC_REALTIME_VISUAL_TEST`), deployed but off by default (tracked in
  `docs/action-items.json` as `realtime-visual-test-toggle`). Checked directly: it only affects
  whether `show_visual` falls back to on-demand visual generation vs. the normal pre-built path — it
  is **not** a transcript-keyword-tracking system. Worth knowing it exists and is adjacent, but it
  does not already solve what's being proposed here.
- **#2's "need not be accurate" framing matters a lot, given yesterday's work.** The exact mechanism
  proposed (matching live speech against a keyword list) is architecturally the same shape as
  `FAREWELL_PHRASES` — which is precisely what `SESSION-END-01` just demoted from *authoritative*
  to a *gated fallback*, because phrase-matching against live, non-deterministic speech is fragile.
  The difference here: this is explicitly framed as an approximate visual-sync heuristic, not an
  authoritative signal controlling billing/session-completion — so the stakes of an occasional
  miss are much lower (worst case, a visualization appears a few seconds early/late), not a broken
  session. Worth confirming this reading is correct (see Question 3 below).
- **#6 connects directly to a still-open thread from an earlier brainstorm** (pacing/signposting —
  giving Clio explicit "you're moving to the next topic now" language). That earlier discussion was
  explicitly deferred/out of scope for `SESSCTX-01`. This new requirement may end up being the same
  underlying mechanism, just motivated by visualization timing instead of pacing — worth deciding
  whether to design them together or keep them separate (see Question 2).
- **#9 and #15 together imply template selection is decided once, offline, at content-authoring
  time** — not live, per-call. This matches #15's "no live generative drawing" constraint. Worth
  explicitly confirming (see Question 4).
- **#12/#13's fixed-size, uniform-typography container discipline already matches this project's
  existing design system** (dark theme, Inter font, fixed heading sizes — defined in this project's
  `CLAUDE.md`). This isn't a new design language, just a new template library that should conform to
  the existing one.
- **#15's "pre-approve every template before it's used" gate mirrors this project's existing
  governance model** (no code without an approved spec) — just extended to visual/content templates.
  Consistent with how this project already operates.
- **Directly relevant to timing**: yesterday's `SESSCTX-01` (summary-driven session content, now
  live in production behind `HUME_NATIVE_SUMMARY_MODE=true`) means Clio may now be **improvising**
  her own wording for teaching and transitions, rather than reading a fixed script. This materially
  affects how reliable keyword-based tracking can be — see Question 1, the most important open
  question below.

---

## 3. Open Questions

**Q1 — Does this need to work against improvised speech (SESSCTX-01, now live) or scripted speech,
or both?**
In the original fully-scripted mode, Clio's exact TEACH/bridge wording is known in advance, so
keyword tracking can be tuned against known text. In the new summary-driven mode (live now),
she improvises her own phrasing — the exact words said are not knowable ahead of time, which makes
keyword-based tracking meaningfully harder to get reliable. Which mode is this meant to track, and
does that change the design?

**Q2 — Is the "quick summary before moving on" instruction (#6) the same mechanism as the earlier
pacing/signposting idea from the prior brainstorm (explicitly deferred out of `SESSCTX-01`), or a
separate, narrower instruction just for visualization timing?**

**Q3 — What's an acceptable failure mode for the tracker being wrong?** Given #2 says accuracy
isn't required, what's the actual tolerance — e.g. is it fine if a visualization shows up a few
seconds early/late, but never acceptable for it to show the wrong topic's visual for an extended
stretch, or get stuck? This shapes whether a safety-net fallback (similar in spirit to
`SESSION-END-01`'s demoted farewell timer) is needed here too.

**Q4 — Confirming: is template selection (#9) a one-time, offline decision made per topic during
content authoring/curation (not a live, per-call decision)?** This seems implied by #15 but worth
confirming explicitly, since it determines whether this logic lives in the content pipeline or in
the live runtime.

**Q5 — Scope: Hume-native only, or also ElevenLabs/Hume-Custom-LLM?** Live transcript access exists
in both paths today (the farewell-detection precedent runs in both blocks in
`WalkthroughClient.tsx`), so this is technically possible either way — but recent work has
consistently scoped new features to Hume-native only. Does that same scoping apply here?

---

## 4. Arun's Answers

**A1.** Improvised speech — "we are not going to use any scripted speech." Arun asked the
orchestrator to highlight anywhere scripted speech is still actually in use today, since this
assumption needs to hold for the design to make sense.

**A2.** #6 (quick-summary-before-transition) is probably related to the earlier pacing/signposting
thread, but Arun wants it kept separate for now — focus only on this request, don't merge them.

**A3.** No accepted failure. The tracker has to be correct, and there must be a defined process to
ensure that. **If the tracker gets no data at all from Hume, the session must not start at all** —
show a polite message that the relay is unsuccessful, it will be fixed, and the session will be
rescheduled. Fail closed, not fail open.

**A4.** Arun asked for the question to be explained better — see Section 5's restated Q4 below with
a concrete example, awaiting his answer.

**A5.** Hume only (Hume-native), confirming Q5's assumed scope.

## 5. Orchestrator's Restated Understanding (post-answers, pending Q4)

**On A1 — where scripted speech still actually exists today (this matters a lot for the design):**
Checked directly against the current, live configuration:
- **Bookend sections (Session Overview / Session Summary) are ALWAYS fully scripted, even with
  `HUME_NATIVE_SUMMARY_MODE=true` (the mode currently live in production).** This was an explicit,
  deliberate design decision in the approved `SESSCTX-01` spec: existing prompt rules require the
  Overview/Summary content be delivered "in full," so `buildSessionSummary()` special-cases these
  two sections to reuse the exact same full scripted content `buildSessionScript()` produces for
  them — this did not change when summary mode went live.
- **If `HUME_NATIVE_SUMMARY_MODE` is ever flipped back to OFF** (the whole point of it being a
  toggle), the entire Hume-native session reverts to fully scripted content again, for every
  section.
- **The ElevenLabs and Hume-Custom-LLM voice paths always use fully scripted content** —
  `buildSessionScript()` via `buildAllClioDocs()`, completely untouched by `SESSCTX-01`, still live
  in production for any session on those providers.

So "no scripted speech" is accurate **only** for: Hume-native sessions, with the summary-mode flag
on, on non-bookend sections. It is not true for the Overview/Summary moments of *any* session
regardless of mode, nor for any ElevenLabs/Hume-Custom-LLM session. This needs an explicit scope
decision: does the tracker only need to operate during non-bookend sections of summary-mode
Hume-native sessions (and simply not run / not matter during bookends), or does it need a fallback
behavior for the scripted moments too?

**On A2 — noted, keeping #6 scoped narrowly to this feature, not merging with the pacing thread.**

**On A3 — this needs to be split into two genuinely different problems, because they have
different achievable guarantees:**

1. **Relay/connectivity failure (no transcript data arriving at all).** This is binary and
   testable — either Hume's live transcript stream is reaching the app or it isn't. A fail-closed
   pre-flight check here is realistic and buildable: verify the relay is actually delivering data
   before letting a session be marked "started," and if it isn't, show the polite
   "relay unsuccessful, we'll fix this and reschedule" message instead of starting. This is a
   legitimate, achievable, zero-accepted-failure requirement.

2. **Tracker semantic accuracy (correctly identifying *which* topic is being covered from keyword
   matches in genuinely improvised, non-deterministic speech).** This is a fundamentally different
   kind of problem — it's a probabilistic heuristic operating on live human-adjacent speech, not a
   binary connectivity check. I want to be direct rather than overpromise: I can design this to be
   *very* reliable — highly distinctive multi-word keyword phrases per topic (not single common
   words), requiring corroborating signals rather than a single keyword hit, conservative
   forward-only progression logic (never jump backward, never skip ahead speculatively), and a
   hard-bounded worst case (e.g. "even if a match is missed or early, the displayed visualization is
   never more than one topic out of sync, and self-corrects at the next reliable signal") — but I
   cannot honestly promise **mathematically zero** failure for matching against improvised speech
   the way I can for a connectivity check. If "the tracker has to be correct" means "connectivity
   must be verified before starting, and semantic accuracy must be engineered to a tight, bounded
   worst case with self-correction" — that's achievable and I'd propose we build to that. If it
   means something stricter than that for the semantic-matching piece specifically, I'd want to
   understand what evidence/guarantee would satisfy that before we spec it, since I don't want to
   promise something I can't actually deliver.

**On A5 — confirmed, Hume-native only.** No ElevenLabs/Hume-Custom-LLM work in this feature.

**A4 (final).** Option A — template is chosen once per topic/session, reused every time that same
topic/session is taught again. Important clarification: **only the template (empty structure/shape)
is saved in the knowledge base — never the filled content.** The actual text that populates a
template's boxes is generated in real time during the live session itself, not pre-generated or
cached ahead of time.

**Q4, restated more concretely (for the record — now answered):** Every topic in a session has content that gets taught. At some
point, the system has to decide "topic X gets shown as a Table" vs. "topic Y gets shown as a Flow
Chart" vs. "topic Z gets shown as a Heatmap." The question is *when* and *how often* that decision
gets made:

- **Option A — decided once, ever, per topic, ahead of any live call.** When a topic's content is
  first authored/curated (the same pipeline that already produces `content_outline`/
  `training_script` today), the system also decides its template type at that same time, and that
  decision is saved permanently. Every future session that ever teaches this topic — for any user,
  any time — reuses that same saved template choice. If you want to change it later, you'd update
  the saved decision, not re-decide it live.
- **Option B — decided fresh, live, each time a real session reaches that topic.** Even for the
  exact same topic, the choice of template could be made in the moment during the call (e.g. an
  LLM call right then deciding "table this time"), meaning two different users covering the same
  topic could get different template types, or the same user could get a different one on a
  re-take.

Given #15 ("build the templates ahead of time with sample content, get approval, then only ever
plug data into an approved template — no live design decisions"), Option A seems like what you
meant — but I want to confirm plainly: **is template selection a one-time decision per topic, made
during content authoring, reused by every future session — not something decided in the moment
during a live call?**

---

## 6. Final Consolidated Understanding — Ready for Confirmation

All open questions resolved. This is the complete system as understood, end to end, before it
becomes a CEO Feature Brief.

**Scope:** Hume-native only. Applies only to Hume-native sessions with `HUME_NATIVE_SUMMARY_MODE`
on, and only to non-bookend sections (Overview/Summary always use full scripted content today, in
every mode — this system does not need to handle those moments; they keep whatever visual behavior
already exists for them, unaffected).

**Two separate things are built ahead of time, at content-authoring time, and never touched live:**
1. **The template library** — a fixed set of infographic types (table, overlay, flow chart,
   heatmap, etc.), each with defined fixed-size containers, a max character budget per container, a
   minimum character floor so nothing looks empty, and uniform typography/margins matching this
   project's existing design system. Every template is built with sample content and explicitly
   approved by Arun before it's usable in production — no live generative design ever happens.
2. **The template assignment per topic** — a one-time decision, made when a topic's content is
   authored/curated, of which template that topic will use. Saved permanently in the knowledge
   base. Every future session teaching that topic reuses this same saved template — never
   redecided live, never varies session to session for the same topic.

**What happens live, during an actual call, is only:**
1. **Position tracking** — the app listens to Clio's live, improvised speech (reusing the existing
   real-time transcript access already built for farewell-detection) and watches for
   session-specific, deliberately-distinctive keyword markers to determine which topic is currently
   being covered. This tracking must never silently produce wrong output: if the transcript relay
   itself isn't delivering data at all, the session must not be allowed to start — the participant
   sees a polite message that the relay wasn't successful and the session will be rescheduled,
   rather than starting a session with a broken tracker. Where the semantic matching itself
   (correctly identifying *which* topic, from keyword hits in genuinely improvised speech) can't be
   made mathematically perfect, it's engineered to a tight, self-correcting, bounded worst case
   instead of an honest-but-unachievable zero-failure promise.
2. **A new prompt instruction** telling Clio to give a quick, natural summary before moving from one
   topic to the next — this is the designed verbal checkpoint the tracker listens for.
3. **Content generation for the next topic's template, triggered early** — the moment tracking
   detects that "quick summary" checkpoint, the system starts generating the actual content to plug
   into the next topic's (already-decided) template, in real time. This content is never cached or
   saved to the knowledge base — only the template shape is saved; the content is fresh every
   session.
4. **Display, triggered precisely** — the moment tracking detects Clio starting to say the next
   topic's title, the screen switches to the new template, already populated with the freshly
   generated content (prepared a moment earlier in step 3) — so there's no loading/warm-up state,
   it just appears, fully formed, in sync with her voice.

**Visual design constraints carried through to every template:** short/crisp on-screen text only
(detail stays verbal); fixed-size containers regardless of actual content length; a defined max and
min character count per container; the same font family and font sizes throughout; generous margins
so content reads as centered and deliberate, not cramped.

Arun confirmed: "Yes it aligns."

---

## 7. Tracked Requirements — Same Numbering, One Row Per Item

Per Arun's instruction: keep the original 1–15 numbering so each item tracks to closure
individually (same pattern as `docs/action-items.json`), and add new numbered items for anything
that emerged during Q&A rather than folding it invisibly into prose.

| # | Requirement (short) | Status | Notes |
|---|---|---|---|
| 1 | Live transcript access | **RESOLVED** | Already exists — reuses the same live speech-listening mechanism `FAREWELL_PHRASES` already uses. No new Hume integration needed. |
| 2 | Approximate position tracking via keywords | **CONFIRMED, scope simplified** | The tracker's only job is: which of the N known session topics is currently being discussed. Not fine-grained position within a topic, not word-level tracking — a plain classification among a fixed, known set of topics. Must track *improvised* speech (A1); engineered to a tight, self-correcting bound rather than mathematical perfection (see #17-19). |
| 3 | Unique keyword-generation algorithm | **FINAL VERSION (corrected) — pending Arun's sign-off** | Source is Session Content only, scoped to the topics within one session. A candidate word qualifies as a marker only if it passes **all three** checks: (1) it's a noun — a specific named thing or technical term, not descriptive/paraphrasable language; (2) it passes the "cannot-miss" test — the topic cannot be taught without saying it; (3) **corrected uniqueness rule** — count how many *different topics* the word appears in across the session (not raw total occurrence count). It qualifies only if it appears in exactly one topic, no matter how many times within that topic. Repeating multiple times inside its one home topic while never appearing elsewhere is the strongest possible signal ("golden word") and gets top priority — more repetition within its home topic is a plus, not a disqualifier. No artificial target count per topic — however many words naturally qualify is the marker set for that topic. **Detection rule: a single hit of any one qualifying marker is sufficient and decisive** — no corroboration needed. Mechanically: checks 1/2 need semantic judgment (LLM), check 3 is deterministic counting grouped by topic (no LLM needed). Saved once per session/topic (per #9/#15), reused if that exact session is reused. **No fallback allowed** (Arun, explicit): every topic must always have at least one qualifying golden word — this is a hard guarantee, not a soft degrade. If the deterministic check finds zero qualifying words for a topic, the content-authoring process must actively rework that topic's Session Content wording (or re-run extraction with a deliberate instruction to surface/insert a genuinely unique named term) until at least one word passes all three checks, before that topic is considered ready. A topic is never allowed to ship with zero coverage. |
| 4 | Tracking logic (match recent words vs. markers) | **CONFIRMED, simplified** | Since #2 is just "which of N known topics" — this is a small state machine: N possible states (one per topic), one set of markers per state. Watch recent spoken words for marker hits; a hit for the *next* topic's markers advances the state by one (forward-only, never jumps backward or skips ahead). Not continuous/fine-grained tracking — just picking the current bucket out of a known, fixed list. |
| 5 | Prerequisite state (content + markers + tabs) | **CONFIRMED** | Matches design as stated. |
| 6 | Prompt instruction: quick summary before transition | **CONFIRMED, scoped narrowly** | Per A2 — kept separate from the earlier pacing/signposting brainstorm thread, not merged. |
| 7 | Trigger for generation (pre-fetch at summary point) | **CONFIRMED** | This is the low-stakes trigger — approximate timing is fine here. |
| 8 | Trigger for display (at next topic's title) | **UNDER REVISION — see #18** | Originally proposed as transcript-driven; recommend anchoring to the existing `show_visual` tool call instead (see #18). |
| 9 | Template-selection algorithm | **RESOLVED** | Per A4 — decided once per topic/session at content-authoring time, never live. |
| 10 | Minimal on-screen text | **CONFIRMED** | Unchanged. |
| 11 | Template library (table, overlay, flow chart, heatmap, etc.) | **CONFIRMED** | Unchanged. |
| 12 | Fixed-size containers, max character budget | **CONFIRMED** | Unchanged. |
| 13 | Minimum character floor, uniform typography | **CONFIRMED** | Unchanged; should conform to this project's existing design system (Inter font, fixed heading sizes already defined in `CLAUDE.md`). |
| 14 | Generous margins, no warm-up state | **CONFIRMED** | Achievable because content generation (per #7) happens ahead of display, not at display time. |
| 15 | Pre-approved templates only, no live drawing | **CONFIRMED, clarified** | Per A4 — only the template *shape* is saved to the knowledge base; filled content is generated fresh every session, never cached. |
| 16 | Scope: Hume-native only | **CONFIRMED (A5)** | No ElevenLabs/Hume-Custom-LLM work in this feature. |
| 17 | Scripted-speech exceptions still exist today | **RESOLVED** | ElevenLabs/Hume-Custom-LLM sessions and a flipped-off summary mode are out of scope, unaffected (as before). For Overview/Summary bookends specifically: no content-based marker extraction — skip the noun/cannot-miss/frequency pipeline entirely for these two. Instead, add a new prompt instruction forcing Clio to explicitly say the word "Overview"/"Summary" right before delivering that section's content. The marker for these two is simply that literal word — inherently safe since there's always exactly one Overview and one Summary per session, can't collide with real-topic content. |
| 18 | Display trigger: build both mechanisms, gate with a toggle so only one is ever authoritative | **RESOLVED — final** | Arun: build both the existing `show_visual`-driven display switch AND the new title-detection-driven display switch — neither gets deleted or replaced. A new toggle decides which one is authoritative at runtime: toggle OFF (default) → `show_visual` continues to drive the display switch exactly as today, new system inert; toggle ON → the new title-detection system becomes the *sole* authority for the on-screen switch, and `show_visual`'s tool call (still fired, still exists) means only "content is ready/being prepared," not "switch the display now." Whichever state the toggle is in, only one mechanism is ever authoritative for the actual switch — this is what avoids the `LIVE-06`-style dual-signal race. Matches this project's established pattern (`SESSION-END-01`, `SESSCTX-01`) — additive, toggle-gated, nothing deleted. |
| 19 | Relay connectivity is a hard pre-flight gate; semantic tracking accuracy is a bounded-best-effort, not a zero-failure promise | **NEW — from A3** | If the transcript relay isn't delivering data at all, the session must not start — polite message, reschedule instead of starting broken. This is achievable and will be built as a hard gate. Semantic topic-identification accuracy (from keyword matches in improvised speech) is engineered to a tight, self-correcting bound instead — see #2, #17's mitigation via #18. |
| 20 | Content is never cached; only templates are | **NEW — from A4** | Explicit clarification: the knowledge base stores template shapes only. Content populating a template is generated in real time, every session, never persisted/reused across sessions. |

Awaiting Arun's decision on #3 (marker-generation approach), #17 (confirm no bookend handling
needed), and #18 (anchor display to `show_visual`, not fuzzy matching) before this moves to a CEO
Feature Brief.
