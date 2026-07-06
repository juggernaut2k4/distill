# SCREEN-01 — Fix Session Screen Sequence (Overview → Topics → Summary)
# Requirement Document

Version: 1.0
Status: READY FOR CEO APPROVAL — all open questions resolved 2026-07-06
Author: Business Analyst Agent
Date: 2026-07-06

---

## 1. Purpose

Every live Clio session shares a screen with the participant (a "shared screen" rendered by the Recall.ai bot). Today, three files each encode a different, mutually inconsistent assumption about what `section_index` means:

- **Script generation** (`lib/clio-context-builder.ts`) tells the voice model that `section_index: 0` means "the Session Overview" and that real content starts at `section_index: 1`.
- **The tool handler** (`lib/voice/relay-handler.ts`, `handleShowVisual`) and **the frontend** (`WalkthroughClient.tsx`, `SessionStack.tsx`) both index directly into the `sections` array — which contains ONLY real subtopics, 0-indexed, with no Overview entry at all.

The result confirmed by reading the code: when the model calls `show_visual({section_index: 0})` believing it will show a dedicated "what you'll learn today" overview, the code instead renders `sections[0]` — the real, first subtopic, using the `TopicHero` template (confirmed in `lib/templates/selector.ts` line 33: `if (position === 'first') return 'TopicHero'`). Because `TopicHero` is a title-card-style template and there is no true Overview screen behind it, this looks exactly like what Arun observed: the screen stuck on a title card for the entire call. Every subsequent `show_visual({section_index: N})` call is then off by one against the real content the model is teaching, permanently skipping the true first subtopic.

There is also no Summary/closing screen at all today — a session ends with whatever the last content section happened to be still on screen, or nothing.

Without this fix, every session continues to silently skip its first subtopic's visual, shows no true agenda overview, and ends with no closing screen — undermining the core promise that the shared screen stays in sync with what Clio is teaching.

## 2. User Story

As a participant in a live Clio session,
I want the shared screen to open with a real "what you'll learn today" overview, then show each actual topic in the order Clio is teaching it, and close with a real summary of what was covered,
So that what I see on screen always matches what I'm hearing, and I never watch a title card sit frozen for the whole call.

As the voice model delivering the session,
I want `section_index` to have one single, unambiguous meaning across the script I'm given, the tool I call, and the screen the participant sees,
So that calling `show_visual({section_index: N})` reliably shows the Nth thing I'm about to talk about — never the wrong subtopic, and never a blank/undefined screen.

## 3. Trigger / Entry Point

- No new route. This is a fix within the existing live-session flow at `/dashboard/walkthrough` (rendered inside the Recall.ai bot's headless browser, and also visible to the human user's own browser tab when applicable).
- Triggers exactly as today: a session start event injects `session_brief`, `topic_context`, and `session_script` (or per-tab scripts in split mode) into the voice agent's context; the voice agent calls the `show_visual` tool at agreed points during the call; the tool handler updates `walkthrough_state.current_section_index`; the frontend polls/reads that value and renders the corresponding screen.
- User state required: unchanged — authenticated session already in progress, `walkthrough_state` row already populated by the session-meeting-setup pipeline.

## 4. Screen / Flow Description

### The chosen contract (this is the crux of the fix — stated once, precisely, here)

**`sections` (the data array in `walkthrough_state.sections`) gains two new reserved entries: a dedicated Overview object at index 0, and a dedicated Summary object at the final index (index `N+1`, where `N` is the number of real content subtopics).** Real content subtopics move from their current `0..N-1` indices to `1..N`. This is Option 1 from the Feature Brief's Question 1 (a real Overview object added to the data model, content shifted to start at 1, with a new dedicated Summary object at the end) — chosen over the sentinel-value alternative (`-1` for Overview, `sections.length` for Summary) for the reasons in Section 11.

Concretely, for a session with 5 real subtopics, `sections` becomes a 7-element array:
- `sections[0]` — Overview (new `SessionOverview` object type, Section 6 below)
- `sections[1..5]` — the 5 real subtopics (unchanged content, shifted index only)
- `sections[6]` — Summary (new `SessionSummary` object type, Section 6 below)

`section_index` as used everywhere (script generation, `show_visual` tool calls, `current_section_index` in `walkthrough_state`, and every frontend consumer) means exactly: **the index into this 7-element array.** There is no special-cased `-1` or `sections.length` value anywhere in the fixed codebase — every index used by any caller is a valid, in-bounds index into `sections`.

### State 1 — Overview screen (session start)

- Shown immediately when the session begins, before any TEACH content.
- Content (Section 6 below defines exactly what this contains): session title, today's agenda (the list of real subtopic titles in order), and a one-line framing sentence.
- Rendered via a new `SessionOverview` template component (Section 5), NOT via `TopicHero` (which remains reserved for a real per-subtopic "hero" moment if the template selector still wants to use it for the first real subtopic — see Section 11 for why this is preserved, not removed).
- User does nothing to advance this screen — Clio (the voice agent) reads the agenda aloud per the existing `buildSessionBrief()` opening-sequence instructions, then calls `show_visual({section_index: 1})` to move to the first real subtopic.

### State 2 — Topics (each real subtopic, in order)

- Unchanged in content/template selection from today, EXCEPT the index each one lives at shifts by +1 (subtopic 1 is now `sections[1]`, not `sections[0]`; subtopic N is now `sections[N]`, not `sections[N-1]`).
- The template selector's `position === 'first'` / `position === 'last'` special-casing (`lib/templates/selector.ts` lines 33–34) continues to apply to the first and last REAL subtopic (i.e. `sections[1]` and `sections[N]`), not to the new Overview/Summary objects, which use their own dedicated renderers entirely outside the `selectTemplate()` function.

### State 3 — Summary screen (session end)

- Shown when Clio delivers the final bridge/summary and calls `end_session` (or immediately before — see Section 11 for the exact trigger point decision).
- Content (Section 6 below): "Session complete" heading, the list of subtopics actually covered (excludes any that were skipped via the existing `skippedTopics` mechanism), and a closing line.
- Rendered via a new `SessionSummary` template component (Section 5).
- Remains on screen until the bot/session teardown completes (`forceEndSession()` already resets `walkthrough_state` afterward — unchanged by this fix).

## 5. Visual Examples

### State 1 — Overview

```
┌─────────────────────────────────────────────────┐
│                                                   │
│              Today's session                     │
│                                                   │
│         [Session Title, e.g. "Understanding      │
│          Large Language Models"]                  │
│                                                   │
│   Here's what we'll cover:                        │
│                                                   │
│     1. [Real subtopic 1 title]                    │
│     2. [Real subtopic 2 title]                    │
│     3. [Real subtopic 3 title]                    │
│     4. [Real subtopic 4 title]                    │
│     5. [Real subtopic 5 title]                    │
│                                                   │
│   Let's dive in.                                  │
│                                                   │
└─────────────────────────────────────────────────┘
```
Subtopics marked as skipped (per `skippedTopics`) are shown with a muted/struck-through style and no number re-flow — they still occupy their position in the list but visually indicate "skipped today."

### State 2 — Topics

Unchanged from today's existing per-template renderers (`TopicHero`, `ConceptDefinition`, `StepFlow`, etc., selected by `lib/templates/selector.ts`) — no new wireframe needed since no visual content changes, only the index it's stored at.

### State 3 — Summary

```
┌─────────────────────────────────────────────────┐
│                                                   │
│              Session complete                    │
│                                                   │
│   Today you covered:                              │
│                                                   │
│     ✓ [Real subtopic 1 title]                     │
│     ✓ [Real subtopic 2 title]                     │
│     ✓ [Real subtopic 3 title]                     │
│     ✓ [Real subtopic 4 title]                     │
│     ✓ [Real subtopic 5 title]                     │
│                                                   │
│   Nice work today.                                │
│                                                   │
└─────────────────────────────────────────────────┘
```
Skipped subtopics are omitted from the "Today you covered" list entirely (not shown with a different mark) — the Summary screen only recaps what was actually taught, per the minimal-literal-content decision in Section 11.

## 6. Data Requirements

**New template types added to `lib/templates/types.ts`:**

```typescript
export interface SessionOverviewData {
  session_title: string
  agenda: Array<{ subtopic_title: string; skipped: boolean }>
  framing_line: string   // fixed literal string, see Section 11 — not LLM-generated
}

export interface SessionSummaryData {
  session_title: string
  covered_subtopics: string[]   // excludes skipped subtopics entirely
  closing_line: string          // fixed literal string, see Section 11 — not LLM-generated
}
```

Added to the `TemplateName` union (line 364 area) as `'SessionOverview'` and `'SessionSummary'`, and to the discriminated `TemplateSection` union (line 391 area) as:
```typescript
| { id: string; type: 'SessionOverview'; data: SessionOverviewData; meta: TemplateMeta; status: SectionStatus }
| { id: string; type: 'SessionSummary'; data: SessionSummaryData; meta: TemplateMeta; status: SectionStatus }
```

**Read:** No new reads beyond what already exists — `session_title`, subtopic titles, and `skippedTopics` are all already available wherever `sections` is currently assembled (the session-meeting-setup pipeline, `inngest/session-meeting-setup.ts`, and `app/api/recall/bot/route.ts` — both already call `buildAllClioDocs()`/`buildSessionBrief()` and already have the full subtopic list and skip list in scope).

**Written:** `walkthrough_state.sections` now contains 2 additional entries (Overview + Summary) beyond the real subtopic count — written at the same point in the same pipeline that already builds `sections` today (session-meeting-setup), not as a separate write.

**No LLM call, no new API call, no new npm package.** Per the standing rule ("never use an AI-generated API call to populate a screen whose content requirements are undefined"), both `SessionOverviewData.framing_line` and `SessionSummaryData.closing_line` are fixed literal strings assembled in code from data already known (session title, subtopic titles, skip list) — never generated by Claude or any other model at render time.

## 7. Success Criteria (Acceptance Tests)

✓ Given a session with 5 real subtopics starts, when the voice model calls `show_visual({section_index: 0})` per its opening-sequence instructions, then the screen shows the new Overview template listing all 5 subtopic titles in order — not `TopicHero` and not any real subtopic's content.

✓ Given the voice model then calls `show_visual({section_index: 1})` to begin the first real subtopic, when the tool handler processes this call, then the screen shows the FIRST real subtopic's content (not the second) — confirming the off-by-one skip is fixed.

✓ Given a session with 5 real subtopics, when the voice model calls `show_visual({section_index: 5})` (the last real subtopic per the shifted numbering), then the screen shows the 5th (last) real subtopic — not an out-of-bounds error, not the Summary screen prematurely.

✓ Given a session reaches its final bridge and the model delivers its closing summary, when `end_session` is called (or immediately before, per Section 11's trigger decision), then the screen shows the new Summary template listing only the subtopics that were actually covered (excluding any skipped ones) — not a frozen last-topic screen, not blank.

✓ Given a subtopic was marked skipped via the existing `skippedTopics` mechanism, when the Overview screen renders, then that subtopic appears in the agenda list with a "skipped" visual treatment, and when the Summary screen renders at session end, that subtopic is absent from the "covered" list entirely.

✓ Given split-mode context injection is active (`NEXT_PUBLIC_CLIO_CONTEXT_MODE=split`), when the first content tab's script is injected at session start (`WalkthroughClient.tsx` line 1146, `tab1Section = sections[1]`), then it correctly reads the FIRST real subtopic (now genuinely at index 1) — not the second subtopic as today's pre-fix code would have via the same line number coincidentally already using index 1 for a different, currently-wrong reason (see Files Changed for why this line's behavior changes even though the literal index `1` does not).

✓ Given the live-conductor / tab-manifest rendering path is active for a session, when `current_section_index` is read by `WalkthroughClient.tsx` (line 1397) and `SessionStack.tsx` (line 90), then both correctly resolve to the shifted Overview/Topics/Summary indices with no separate/parallel indexing scheme — there is exactly one `section_index` contract in the entire codebase after this fix.

## 8. Error States

- **`show_visual({section_index: N})` called with `N` out of bounds (e.g. model hallucinates an index beyond `sections.length - 1`):** unchanged existing clamping behavior in `WalkthroughClient.tsx` (lines 894–901, "Bounds check: clamp idx to a valid range") continues to apply — clamps to the last valid index (which, after this fix, is now the Summary screen, not a real subtopic). `relay-handler.ts`'s `handleShowVisual` (line 70–73) currently has NO bounds check (`const section = sections[sectionIndex]`, returns a generic fallback string if `!section` but never clamps `current_section_index` itself) — this fix adds the same clamping behavior there for consistency (see Files Changed).
- **Overview or Summary section object is somehow missing from `sections` (a defensive/malformed-data case):** the frontend must render a graceful, non-crashing fallback (existing `GenericTemplate.tsx` pattern already used elsewhere in `TemplateRenderer.tsx` for unrecognized types) rather than throwing — this is a pre-existing defensive convention, not a new one introduced here.
- **Session has zero real subtopics (edge case, should not happen but must not crash):** Overview screen still renders with an empty agenda list ("Here's what we'll cover:" with no items) rather than crashing; Summary screen renders with an empty "covered" list. This is a defensive minimum, not an expected real-world case.
- **Voice model calls `show_visual` before `sections` has been populated in `walkthrough_state` (race with the setup pipeline):** unchanged existing behavior — `handleShowVisual` in `relay-handler.ts` already returns a generic `Now showing section ${sectionIndex}` string when `!data` (line 62), and the frontend already shows nothing/idle state until `sections` arrives via polling.

## 9. Edge Cases

- **First-time session vs. a resumed/reconnected session:** on reconnect (`isReconnect || isMidSession` branches in `WalkthroughClient.tsx` around lines 1135–1141), the model is told to resume "from where you left off" using the CURRENT `current_section_index` — this already works correctly with the new indexing scheme with no changes needed, since it's just resuming at whatever index it was last at (which may now legitimately be the Overview, a Topic, or the Summary).
- **User with a session that has only 1 real subtopic:** `sections` has 3 entries total (Overview at 0, the 1 subtopic at 1, Summary at 2) — the "first" and "last" real-subtopic template-selector special-casing (`selector.ts` lines 33–34) both apply to the same single subtopic; this is pre-existing selector behavior, unaffected by this fix.
- **Split-mode vs. all-upfront context mode:** both modes are audited in Files Changed below — split mode's per-tab injection logic (which subtracts 1 from `section_index` to find the right `training_scripts` entry, since `training_scripts` remains a real-subtopics-only, 0-indexed array — see Section 11 for why `training_scripts` itself is NOT shifted) must continue to work; this fix's Files Changed section lists every line where this subtraction happens and confirms it remains correct.
- **Live-conductor / tab-manifest branches:** `state.live_conductor_tab_index` and `state.tab_manifests` are keyed by the same shifted `section_index` values going forward — no separate numbering scheme is introduced for these paths (this was an explicit Known Constraint in the brief: "must not break the split-mode / tab-manifest / live-conductor rendering paths").
- **Skip behavior via the on-screen "Skip" button** (`SessionStack.tsx` `handleSkip`, lines 118–129): continues to operate purely on array position (`i > currentIdx`) — completely agnostic to what the section IS (Overview/Topic/Summary), so no change needed there; a defensive note is added in Files Changed to confirm the Summary section is never skippable (the skip button is already only rendered for `i < sections.length - 1`, so the last section — now always the Summary — already never shows a Skip button, unchanged).
- **Regression/backfill for already-completed or currently-live sessions:** this fix is forward-looking only from deploy time (see Section 11 Decision E) — no backfill or KB re-keying is performed as part of this spec.

## 10. Out of Scope

- Any redesign of the real subtopic content templates themselves (`ConceptDefinition`, `StepFlow`, etc.) — only their array position changes.
- Retroactive backfill of any previously-generated KB entries or content that was generated under the old (buggy) indexing scheme — see Section 11 Decision E.
- Any change to how subtopics are chosen, ordered, or generated by the curriculum/session-designer pipeline — this fix only touches how the already-decided subtopic list is indexed for screen display.
- Removing or renaming the existing `TopicHero` or `KeyTakeaway` templates — both remain available to the template selector for the first/last REAL subtopic exactly as today; only the NEW dedicated Overview/Summary screens are new template types, layered on top.
- Building a "review your session" post-session recap page outside the live call (e.g. in the KB or dashboard) — the Summary screen described here is the in-call closing screen only.
- Any change to `finalizeHumeNativeBilling`/session billing (that is HUME-DURATION-02, a separate spec).

## 11. Open Questions

None. All five questions raised in the Feature Brief are resolved below — three are technical/architectural decisions, and two (Overview/Summary content) are product/content decisions where, per this project's standing rule, a specific minimal literal version is proposed here rather than left undefined. **CEO should confirm the exact wording proposed in Decisions C and D below** — flagged separately in my accompanying message, but the spec is fully buildable as written regardless.

**Decision A — Exact section_index contract (Brief Question 1):**
Real Overview and Summary objects are added to the `sections` array itself (index 0 and index `N+1`), with real content subtopics shifted to occupy indices `1..N`. Rejected alternative: sentinel values (`-1` for Overview, `sections.length` for Summary) kept outside the array. Rationale: sentinel values require every single consumer (script generator, tool handler, `WalkthroughClient.tsx`, `SessionStack.tsx`, any future consumer) to independently remember and correctly implement two special-case branches around the ordinary array-indexing logic — this is exactly the class of "each file assumed something different" bug that caused this incident in the first place. Making Overview and Summary real, ordinary elements of `sections` means every existing consumer's normal `sections[idx]` / bounds-check / clamp logic works correctly for all three screen types with zero special-casing, and the existing `position === 'first'`/`'last'` convention already in `lib/templates/selector.ts` demonstrates the codebase already treats structural-anchor positions as ordinary array members, not sentinels — this fix extends that same proven pattern rather than introducing a new one.

**Decision B — Where "real Overview content" comes from (Brief Question 2):**
Not sourced from `buildSessionBrief()`'s existing text output (that function produces instructions FOR the voice model — the "TODAY'S AGENDA" text block is meant to be read/paraphrased aloud by Clio, not rendered as on-screen structured data). Instead, `SessionOverviewData` is assembled directly, in code, from the same underlying data `buildSessionBrief()` already has in scope (`sessionTitle`, the ordered subtopic titles from `sections`, and `skippedTopics`) — at the same point in the session-meeting-setup pipeline where `sections` is currently built (see Files Changed). No new content generation, no new Claude call.

**Decision C — Overview screen exact content (Brief Question 3 half):**
Proposed minimal literal content — **CEO should confirm this wording:**
- Heading: `"Today's session"`
- Session title: the session's existing `sessionTitle` value (already available, no new data).
- Section label: `"Here's what we'll cover:"`
- Agenda: numbered list of real subtopic titles in order, exactly as they already appear in `sections`. Skipped ones shown with a muted/struck-through treatment (visual detail for the Frontend Agent — exact CSS left to existing design-system conventions already used elsewhere for "skipped" status, e.g. `SessionStack.tsx`'s `STATUS_COLORS.skipped`).
- Closing framing line: `"Let's dive in."` (fixed literal string, not personalized, not LLM-generated).

**Decision D — Summary screen exact content (Brief Question 3 other half):**
Proposed minimal literal content — **CEO should confirm this wording:**
- Heading: `"Session complete"`
- Section label: `"Today you covered:"`
- List: real subtopic titles that were actually taught, in order, each with a checkmark — skipped subtopics are omitted entirely from this list (not shown crossed-out; simply absent, since they were not, in fact, covered).
- Closing line: `"Nice work today."` (fixed literal string).
- Explicitly NOT included in v1 (per the brief's framing "static session complete card" being an acceptable minimum, and to avoid inventing undefined KB-link behavior): no links to KB entries, no score/readiness data, no personalized recap text. If richer recap content is wanted later, that is a new, separate feature brief — this spec delivers the minimal literal version per the standing rule, not a speculative richer one.

**Decision E — Regression/backfill for already-affected sessions (Brief Question 5):**
Forward-looking only from this fix's deploy time. No backfill of KB entries or retroactive reprocessing of already-completed sessions is performed. Rationale: KB entries are generated from subtopic content and titles, which are NOT renumbered or changed by this fix (only the screen-display array position of Overview/Topics/Summary changes) — the underlying subtopic content a completed session's KB entry was generated from is unaffected, so there is nothing incorrect to retroactively fix in the KB itself. The bug this fix addresses is a live-session screen-display and skip issue, not a content-generation or KB-storage issue, so no backfill is needed for those systems. If a live/in-progress session is actively mid-call when this fix deploys, that single in-flight session may see a one-time index jump (acceptable, rare, and self-resolving within that one call) — not worth building migration logic for.

## 12. Dependencies

- No new npm packages, no new database migration (all changes are to the JSONB/array shape already stored in `walkthrough_state.sections`, plus new `TemplateName` union members in `lib/templates/types.ts` — a type-level change only).
- Depends on `lib/templates/selector.ts`'s existing `position === 'first'`/`'last'` convention remaining in place for real subtopics (unchanged, not removed).
- Depends on the session-meeting-setup pipeline (`inngest/session-meeting-setup.ts`) being the single place `sections` is assembled before a session starts — confirmed as the correct injection point for the new Overview/Summary objects (see Files Changed).

---

## Files Changed

### `lib/templates/types.ts`

- Add `SessionOverviewData` and `SessionSummaryData` interfaces (Section 6).
- Add `'SessionOverview'` and `'SessionSummary'` to the `TemplateName` union (near line 364).
- Add both new discriminated-union members to `TemplateSection` (near line 391).

### `components/templates/renderers/SessionOverview.tsx` (NEW FILE)

- New renderer component, modeled on the existing `TopicHero.tsx` renderer's prop shape (`data`, `isActive`, `onReady`). Renders the wireframe in Section 5, State 1.

### `components/templates/renderers/SessionSummary.tsx` (NEW FILE)

- New renderer component, same prop shape convention. Renders the wireframe in Section 5, State 3.

### `components/templates/TemplateRenderer.tsx`

- Add two new `case` branches (alongside the existing `case 'TopicHero':` at line 37) routing `'SessionOverview'` → the new `SessionOverview` component and `'SessionSummary'` → the new `SessionSummary` component.

### `lib/templates/selector.ts`

- **No change to `selectTemplate()`'s signature or logic.** This function is only ever called for REAL subtopics (position `'first'`/`'middle'`/`'last'` among the N real subtopics) — the Overview and Summary objects are constructed directly with `type: 'SessionOverview'` / `type: 'SessionSummary'` at the point `sections` is assembled (in the setup pipeline, below), never passed through `selectTemplate()`. Add a one-line code comment at the top of the file noting this explicitly, so a future reader does not assume `selectTemplate()` needs an Overview/Summary branch.

### `inngest/session-meeting-setup.ts`

- This is the pipeline that currently builds the `sections` array (N real subtopics, indices `0..N-1`) and writes it to `walkthrough_state`. Change: after building the existing N real-subtopic section objects (unchanged construction logic, only their array position shifts), wrap them as follows:
  1. Construct one `SessionOverview` section object at position 0, populated per Decision C (session title, agenda list built from the N subtopic titles + `skippedTopics`, fixed `"Let's dive in."` framing line).
  2. Place the N real subtopic objects at positions `1..N` (previously `0..N-1`).
  3. Construct one `SessionSummary` section object at position `N+1`, populated per Decision D (subtopic titles filtered to exclude `skippedTopics`, fixed `"Nice work today."` closing line). Note: at pipeline-build time the actual "covered" list cannot yet be known (nothing has been taught yet) — the Summary object is built listing ALL non-skipped subtopics as "planned to cover"; Files Changed below in `relay-handler.ts`'s `handleEndSession` (or an equivalent point) is where this list could in principle be trimmed further to only subtopics actually reached before end_session fired, but per Decision D's "minimal literal version," this fix ships listing all non-skipped subtopics rather than tracking real-time "actually reached" state — a future enhancement, not required for this fix's acceptance criteria (Section 7 tests this against "covered" meaning "was on the agenda and not skipped," consistent with this simpler implementation).
  4. Write the resulting `N+2`-length array to `walkthrough_state.sections`.

### `lib/clio-context-builder.ts`

- **`buildSessionBrief()`** (lines 62–107): 
  - Line 89 (`Call show_visual({ section_index: 0 }) immediately when the session starts.`) — **no change needed**, this line's stated meaning ("section_index 0 = Overview") now matches reality for the first time.
  - Line 97 (`Always pass section_index (Overview = 0; section 1 = 1, section 2 = 2, etc.)`) — **no change needed** for the same reason; this instruction was always correct in intent, only the code behind it was wrong. Confirm this comment/instruction text stays as-is.
  - Add one new line to the "OPENING SEQUENCE" block (after line 92) instructing the model on the new Summary step: `"After the final bridge and 2-sentence summary, call show_visual({ section_index: <N+1> }) to show the closing Summary screen, THEN call end_session."` — this requires threading the value `sections.length` (i.e. `N+1`, the Summary's index) into this function. Since `buildSessionBrief()` already receives `sections` (the real-subtopics array passed to it, see below) as an input, and its own `sections.length` (line 63/80) already refers to N (real subtopics only, NOT including the new Overview/Summary wrapper — see next bullet for why), the correct value to inject is `sections.length + 1`.
  - **Important scoping clarification:** `buildSessionBrief()`, `buildSessionScript()`, and `formatSingleSectionScript()` all continue to receive ONLY the real-subtopics array (still called `sections` in their own parameter, still 0-indexed internally to these functions, still length N) — NOT the new N+2-length `walkthrough_state.sections` array. These script-generation functions already do their own `+1` math to compute the section_index values they embed in generated text (e.g. line 172: `SECTION ${i + 1}/${totalSections}`, line 105: final section number `${sections.length}/${sections.length}`) — this existing `+1` convention is EXACTLY the new real-content indexing scheme (`1..N`), so **no change is needed to the internal indexing math in `buildSessionScript()` or `formatSingleSectionScript()`** (lines 136–276) beyond the one new instruction line above and the Summary section_index literal now being `sections.length + 1` instead of undefined/nonexistent.
  - Line 104 (`After delivering the final bridge for the FINAL section (section ${sections.length}/${sections.length})`) — no change; this already correctly refers to the last REAL subtopic using the function's own local `sections.length` (=N), which is unaffected by the wrapper array used elsewhere.

### `lib/voice/relay-handler.ts`

- **`handleShowVisual(userId, sectionIndex)`** (lines 48–103): 
  - Line 51–54 (`.update({ current_section_index: sectionIndex })`) — no change; still writes whatever index the model passed.
  - Line 56–60 (`.select('sections, training_scripts')`) — **change**: `sections` now refers to the full N+2-length wrapper array (Overview + Topics + Summary), consistent with the new contract. `training_scripts` remains the real-subtopics-only, N-length array (training scripts only ever apply to real TEACH content — Overview/Summary have no TEACH script) — this is intentional and different-length from `sections` by design (documented via a code comment added here).
  - Line 70 (`const section = sections[sectionIndex]`) — **add bounds clamping**: currently no clamp exists here (unlike `WalkthroughClient.tsx`'s existing clamp at lines 894–901) — add `const clampedIndex = Math.max(0, Math.min(sectionIndex, sections.length - 1))` and use `sections[clampedIndex]` consistently, for parity with the frontend's existing defensive behavior (Section 8).
  - Line 71 (`const script = scripts[sectionIndex] ?? null`) — **change to `scripts[clampedIndex - 1] ?? null`**, guarded so it becomes `null` (not a negative-index lookup) when `clampedIndex` is 0 (Overview) or `sections.length - 1` (Summary) — since `training_scripts` is offset by exactly 1 relative to the new `sections` indexing (real subtopic at `sections[1]` maps to `training_scripts[0]`, etc.). Add: `const scriptIdx = clampedIndex - 1; const script = (scriptIdx >= 0 && scriptIdx < scripts.length) ? scripts[scriptIdx] ?? null : null`.
  - Lines 73–101 (building the returned instruction string): unaffected in structure; `section.meta.subtopicTitle` continues to work unchanged since Overview/Summary objects also carry a `meta.subtopicTitle` field (set to `"Session Overview"` / `"Session Summary"` respectively) so this code path never needs a null-check added — the existing "if no script, return `Now showing: ${sectionTitle}`" fallback (line 84) naturally handles Overview/Summary correctly (they have `!script` since `scriptIdx` will be out of range, so this generic fallback text fires exactly as intended, with no special-casing needed).

### `app/dashboard/walkthrough/WalkthroughClient.tsx`

Every one of the following call sites operates on the same shifted `sections`/`training_scripts` offset relationship described above (`sections[idx]` = wrapper array, `training_scripts[idx - 1]` = real-subtopic-only array):

- **Line 688 (`currentSectionIndexRef.current === 0` → "overview section" NAV-ignore check, Hume path):** **no change** — this check already correctly means "we're on the Overview" under the new contract (previously this comment was aspirational/wrong since index 0 was actually the first real subtopic; now it is literally true).
- **Line 727–728 (Hume `show_visual`, clamp `idx`):** no change to the clamp logic itself; confirm it clamps against the new (N+2-length) `sections.length`.
- **Line 732–738 (split-mode script injection, Hume path — `if (splitCtxMode === 'split' && idx > 0)`, `scriptIndex = idx - 1`):** **no change needed** — `idx > 0` already correctly means "not the Overview" under the new contract, and `scriptIndex = idx - 1` already correctly maps to `training_scripts`' 0-indexed real-subtopic array. This line's behavior is now correct for the first time (previously `idx > 0` meant "not the first real subtopic," which was the wrong exclusion).
- **Line 755, 767 (Hume `show_visual`, `sections[idx].meta.subtopicTitle`):** no change — works unchanged since Overview/Summary carry `meta.subtopicTitle` too (see relay-handler.ts note above).
- **Line 904 (`advance_tab` handler context, referenced in brief):** confirm this reads `currentSectionIndexRef.current`/`sections` consistently with the same shifted contract — no separate indexing scheme introduced here.
- **Line 906–920 (ElevenLabs path split-mode injection, `scriptIndex = idx - 1`):** same as the Hume-path equivalent above — **no change needed**, now correct for the same reason.
- **Lines 1071–1073 (ElevenLabs NAV-ignore check for `currentSectionIndexRef.current === 0`):** same as line 688 — no change, now literally correct.
- **Line 1140 (reconnect/mid-session resume instruction text, `show_visual({ section_index: ${section} })`):** no change — `section` is whatever `current_section_index` already holds, correctly interpreted under the new contract with no special-casing.
- **Line 1146 (`tab1Section = sections[1]`):** **no code change**, but behavior CHANGES — today this line coincidentally reads `sections[1]`, which under the OLD (buggy) contract was actually the SECOND real subtopic (since `sections[0]` was the first real subtopic, mislabeled as "overview" in intent only). Under the NEW contract, `sections[1]` is genuinely the FIRST real subtopic. This is precisely the off-by-one this fix corrects — call this out explicitly in the PR/commit description so reviewers understand why a zero-line-diff location still changes behavior.
- **Line 1217 (`currentSectionIndexRef.current = data.current_section_index ?? 0`):** no change — still a direct passthrough.
- **Lines 1397–1405 (`currentSectionIdx = state.current_section_index ?? 0`, `currentTabManifest = state.tab_manifests?.[String(currentSectionIdx)]`, `currentSection = state.sections?.[currentSectionIdx]`):** no change to the code itself; `tab_manifests` keys must be generated using the same shifted indexing (confirm in the tab-manifest generation pipeline, likely also in `inngest/session-meeting-setup.ts` or a sibling file — BA flags this as a location the Developer Agent must grep for and verify during implementation, since a tab-manifest generator keyed on the OLD 0-indexed real-subtopic scheme would silently break if not updated in lockstep).
- **Line 1494 (`currentSectionIndex={state.current_section_index ?? 0}` passed to `SessionStack`):** no change — passthrough.

### `components/templates/SessionStack.tsx`

- **Lines 89–92, 100–105 (polling `current_section_index`/`sections` from `/api/walkthrough-state/[userId]`):** no change — generic array-index logic, works correctly for any valid index into the now-longer `sections` array, including the new Overview/Summary positions.
- **Lines 118–129 (`handleSkip`)**: no change — already position-agnostic (`i > currentIdx && s.status !== 'completed' && s.status !== 'skipped'`); confirm (no code change, verification only) that the Summary section, always being the final element, is never presented with a Skip button per the existing `i < sections.length - 1` guard at line 198 in the render — this guard already, correctly, never shows Skip on the last element regardless of what that element is.
- **Line 163 (`section.meta.subtopicTitle` used in the sidebar nav list):** no change — Overview/Summary's `meta.subtopicTitle` values (`"Session Overview"`, `"Session Summary"`) render correctly in the existing sidebar with no special-casing.

### `app/api/recall/bot/route.ts` and `app/api/admin/qa-session-context/route.ts`

- Both files call `buildAllClioDocs()`/`buildSessionBrief()` per the earlier grep. **Developer Agent must verify** (BA could not fully trace without live execution) that these two callers pass the real-subtopics-only array (length N) consistent with the scoping clarification above, and do not also need to separately be updated to read the new N+2-length wrapper array for any purpose beyond script generation. If either of these routes ALSO reads `walkthrough_state.sections` directly (as opposed to only calling the script-builder functions), it must be updated with the same shifted-index awareness as `WalkthroughClient.tsx` above.

---

## Report Note for CEO

Section 11 Decisions C and D (exact Overview/Summary screen wording) are proposed literal content, not left blank — but per the standing rule on content decisions, these two specific wording choices should be confirmed by the CEO before the Frontend Agent builds against them. Every other open question is a technical decision resolved directly in this document.
