# TMPL-06 — Title Font Standardization (DefinitionTriptych) — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-12

## 1. Purpose
`DefinitionTriptych.tsx` renders its title one font-size step larger and one weight heavier
(`text-4xl font-extrabold`, 36px) than every other topic-content template's title
(`text-3xl font-bold`, 30px). Confirmed directly: `DefinitionTriptych.tsx` line 24 is
`<h2 className="text-4xl font-extrabold text-white tracking-tight">{data.term}</h2>`, while
`ChevronProcess.tsx` (line 24), `ComparisonTable.tsx` (line 157), `CaseStudy.tsx` (line 120),
`ConceptDefinition.tsx` (line 77), and `KeyTakeaway.tsx` (line 148) all render
`<h2 className="text-3xl font-bold text-white mb-1">`. This feature exists to remove that one
visual inconsistency so DefinitionTriptych matches the rest of the template library. Without it,
DefinitionTriptych's title looks oversized and out of place whenever it appears alongside other
templates in a session.

## 2. User Story
As an executive learner viewing a Clio session,
I want every template's title to be styled consistently,
So that the DefinitionTriptych screen doesn't visually stand out as inconsistent with the rest of the session.

## 3. Trigger / Entry Point
- No new trigger. This is a static style change to an existing renderer.
- Activates whenever `DefinitionTriptych` is rendered as part of a live or generated session (existing code path, unchanged).

## 4. Screen / Flow Description
No flow change. The only change is the CSS classes applied to the existing title element in
`DefinitionTriptych.tsx` line 24:

- Before: `className="text-4xl font-extrabold text-white tracking-tight"`
- After: `className="text-3xl font-bold text-white tracking-tight"`

`tracking-tight` is retained — it is neither a font-size nor font-weight property, and the brief
restricts this change to size/weight only. Everything else on the screen (badge pill, 3 panels,
"So what?" footer, spacing, layout) is unchanged.

## 5. Visual Examples

Before:
```
┌─────────────────────────────────────────┐
│  [Category Badge]                       │
│  Term Title (36px, extrabold)           │
│                                         │
│  [Panel 1]   [Panel 2]   [Panel 3]      │
│                                         │
│  So what? ...                           │
└─────────────────────────────────────────┘
```

After:
```
┌─────────────────────────────────────────┐
│  [Category Badge]                       │
│  Term Title (30px, bold)                │
│                                         │
│  [Panel 1]   [Panel 2]   [Panel 3]      │
│                                         │
│  So what? ...                           │
└─────────────────────────────────────────┘
```

## 6. Data Requirements
None. No data read, written, or fetched. No API, database, or storage change.

## 7. Success Criteria (Acceptance Tests)
✓ Given `DefinitionTriptych.tsx`, when line 24 is inspected, then the `<h2>` className is
  `text-3xl font-bold text-white tracking-tight` (no `text-4xl` or `font-extrabold`).
✓ Given a session containing a DefinitionTriptych screen, when it renders, then the title
  font-size renders at 30px (text-3xl) and weight 700 (bold), matching ChevronProcess,
  ComparisonTable, CaseStudy, ConceptDefinition, and KeyTakeaway.
✓ Given the same screen, when compared to its pre-fix appearance, then the badge pill, 3-panel
  grid, panel content, and "So what?" footer are pixel-identical (unchanged).
✓ Given the codebase, when any other renderer file is checked, then none of them have been
  modified by this change.
✓ Given `TopicHero.tsx`, `SessionOverview.tsx`, and `SessionSummary.tsx`, when checked after this
  change, then their hero title treatment (`text-4xl md:text-5xl font-extrabold`) is untouched.

## 8. Error States
Not applicable — static className change, no runtime logic, no inputs, no failure modes.

## 9. Edge Cases
Not applicable — the title is a fixed-position static element; no data-length, empty-state, or
device-specific behavior changes as a result of this fix.

## 10. Out of Scope
- Adding a subtitle to DefinitionTriptych (covered separately by TMPL-07).
- Any change to margins, spacing, the category badge pill, panel styling, or the "So what?" footer.
- Any change to `TopicHero.tsx`, `SessionOverview.tsx`, or `SessionSummary.tsx` (confirmed correct to differ).
- Any change to any other renderer file.
- Any change to `containerBudgets.ts` or character-budget logic.

## 11. Open Questions
None.

## 12. Dependencies
None. Single-file change to `components/templates/renderers/DefinitionTriptych.tsx`, no other
files or systems must change first.

---

## CEO Review

Approved. Section 11 confirmed empty. Independently re-verified before approving: read
`DefinitionTriptych.tsx` line 24 directly (confirms `text-4xl font-extrabold`) and
`ChevronProcess.tsx` line 24 directly (confirms `text-3xl font-bold text-white mb-1`) — the
mismatch is real and the fix target is correct. Proceeding straight to build; this is small enough
that I'll apply it myself rather than dispatching a separate developer agent.
