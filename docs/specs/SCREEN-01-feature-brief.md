# Feature Brief: SCREEN-01 — Fix session screen sequence (Overview → Topics → Summary)
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-06

## What Arun Said
The shared screen in a live session got stuck on the title card for the
entire call and never advanced. Investigate whether this is a genuine
off-by-one in how `section_index` maps to the sections array, or a different
root cause. Also — as a product requirement, not just a bug fix — every
session's screen sequence must be Overview (real "what you'll learn today"
content) → Topics → Summary, never a bare title-only screen left on-screen.

## The Problem Being Solved
Confirmed by reading the code directly (not guessing):

**Genuine off-by-one / design gap**, spanning three files that each encode a
different, mutually inconsistent assumption about what `section_index`
means:

1. **Script generation** (`lib/clio-context-builder.ts`): tells the voice
   model "Overview = 0; section 1 = 1, section 2 = 2" (line 97), and
   instructs it to call `show_visual({ section_index: 0 })` immediately at
   session start to show "the Session Overview" (line 89). Real content
   sections are numbered starting at `section_index: 1`
   (`buildSessionScript`, line 172: `sectionNum = i + 1`).
2. **Tool handler** (`lib/voice/relay-handler.ts`, line 70,
   `handleShowVisual`): does `const section = sections[sectionIndex]` —
   indexes directly and only into the real `sections` array (which contains
   only actual content sections, 0-indexed, no Overview entry) with **no
   offset and no special case for `sectionIndex === 0`**.
3. **Frontend** (`app/dashboard/walkthrough/WalkthroughClient.tsx` line 1404,
   `components/templates/SessionStack.tsx`): same thing —
   `state.sections?.[currentSectionIdx]` directly, no Overview slot exists in
   the data model at all.

Net effect: the model calls `show_visual({section_index: 0})` believing it
will show a proper "what you'll learn today" overview screen, but the code
renders `sections[0]` — which is actually the **first real subtopic's**
template (with no dedicated overview content behind it). Then when the model
moves to what it thinks is "section 1" via
`show_visual({section_index: 1})`, the code shows `sections[1]` — the
**second** real subtopic — permanently skipping the actual first subtopic's
content. Comments already in the codebase (`WalkthroughClient.tsx` lines 689,
904, 1071–1073, 1143) show the team's mental model always assumed a distinct
overview screen at index 0 existed — it does not; no such screen object,
template, or renderer exists anywhere in the current data model.

Since there is no overview-specific template/renderer, and `sections[0]`
apparently has thin/no populated content in some session configurations, what
the user experienced as "stuck on the title card all call" is consistent
with `sections[0]`'s generic template rendering as a bare title-only card for
the whole session, while the real first subtopic's content is silently
skipped and every subsequent section is shifted by one.

## What Success Looks Like
Every session's shared screen follows exactly this sequence, with real
content at each stage, never a bare title-only screen left on-screen for an
extended period:
1. **Overview** — an actual "what you'll learn today" screen (agenda /
   session outline), shown at session start.
2. **Topics** — each real content section shown in order, correctly
   corresponding to what the voice coach is actually teaching at that moment
   (no more off-by-one skip of the first topic).
3. **Summary** — a real closing screen at session end (not just silence /
   frozen last topic screen).

`section_index` must have one single, unambiguous, consistently-applied
definition across script generation, the tool handler, and the frontend
renderer — whichever convention the BA spec picks (e.g., index 0 reserved for
a real Overview screen object, content sections shifted to start at 1, with a
matching new Summary screen at the end).

## Known Constraints
- This is a product requirement (Item C), not optional: Overview and Summary
  screens must show real, defined content — never AI-generated filler on an
  undefined screen (per this project's standing rule: never use speculative
  AI output to fill an undefined screen).
- Whatever fix is chosen must update all three call sites consistently in the
  same change: `lib/clio-context-builder.ts` (script text /
  `formatSingleSectionScript` too), `lib/voice/relay-handler.ts`
  (`handleShowVisual`), and the frontend (`WalkthroughClient.tsx`,
  `SessionStack.tsx`, and any other consumer of `current_section_index` /
  `sections[idx]` — BA must audit for all of them, including the tab-manifest
  and live-conductor branches referenced in `WalkthroughClient.tsx`).
- Must not break the split-mode / tab-manifest / live-conductor rendering
  paths that also reference `current_section_index` and `sections[idx]`.
- No regression to existing working sessions — this is a correctness fix,
  not a redesign of session content itself.

## Questions for BA
1. Exact screen-index contract: is index 0 a dedicated Overview object (not
   present in today's `sections` array — needs to be added to the data
   model), with real content sections at indices 1..N, and a new dedicated
   Summary object at index N+1? Or is it simpler/safer to keep `sections`
   as real-content-only (0-indexed, unchanged) and handle Overview/Summary as
   two special sentinel values outside the array entirely (e.g.
   `current_section_index === -1` for Overview, `=== sections.length` for
   Summary)? Document the full contract precisely — this is exactly the kind
   of ambiguity that caused this bug the first time.
2. What does "real Overview content" actually consist of — is there existing
   agenda/session-brief data already assembled (see `buildSessionBrief` in
   `clio-context-builder.ts`) that can be surfaced as the Overview screen's
   content, or does new content need to be generated/stored?
3. What does the Summary screen show — a static "session complete" card, or
   real recap content (e.g. topics covered, KB links)? If content is
   undefined here, per standing rule, BA must specify the minimal literal
   version rather than leaving it to a developer to improvise.
4. Full audit required: every file/component that reads
   `current_section_index` or indexes into `sections` (list all found, e.g.
   `WalkthroughClient.tsx` lines 735, 755, 767, 910, 939, 952, 1146, 1217,
   1397, 1494; `SessionStack.tsx`; `relay-handler.ts`) must be enumerated in
   the spec's "Files Changed" section with the exact indexing change each one
   needs.
5. Regression/backfill: are there other currently-live or recently-completed
   sessions affected by this same off-by-one that need any kind of retroactive
   handling (e.g. KB entries generated under the wrong section mapping), or is
   this purely forward-looking from the fix's deploy time?

Please write the full requirement document (12 sections, with exact wireframe-level
description of Overview and Summary screens per the "Ambiguous UX = STOP" rule)
once these are resolved — escalate to me if any answer is a product/content
decision rather than a technical one.
