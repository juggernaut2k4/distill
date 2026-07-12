# Feature Brief: TMPL-06 — Standardize DefinitionTriptych's Oversized Title Font
From: CEO (Arun)
To: Business Analyst Agent
Priority: P2
Date: 2026-07-12

## What Happened
Arun asked whether every template's title and subtitle are rendered at the same font size. A direct
audit of all 28 renderer files in `components/templates/renderers/` (grep + read, not a guess) found:

- 17 templates share an identical title/subtitle pair: title `text-3xl font-bold text-white` (30px,
  bold), subtitle `text-sm text-[#94A3B8]` (14px) — ChevronProcess, ComparisonTable, Flowchart, Funnel,
  Heatmap, Overlay, HorizontalDecision, HorizontalTree, Hierarchy (dead code), ProsCons, StepFlow,
  Timeline, TwoByTwoMatrix, CaseStudy, ConceptDefinition, KeyTakeaway, QuestionAnswer (title is the
  static text "Q&A"; the question itself is the subtitle, already at `text-sm`).
- `DefinitionTriptych.tsx` (line 24) is the ONE outlier: its title uses
  `text-4xl font-extrabold text-white tracking-tight` — one full step larger (36px vs 30px) and one
  weight heavier (extrabold vs bold) than every other template's title.
- 3 bookend/session-role screens (TopicHero, SessionOverview, SessionSummary) intentionally use a much
  larger `text-4xl md:text-5xl font-extrabold` hero treatment — Arun has explicitly confirmed these are
  correct to differ (they are the session's opening/closing screens, not topic-content templates) and
  are OUT OF SCOPE for this brief.

## The Problem Being Solved
DefinitionTriptych's title doesn't match the font size/weight every other topic-content template uses,
making it look inconsistent when reviewed alongside the rest of the library.

## What Success Looks Like
`DefinitionTriptych.tsx`'s title font is changed to match the standard used everywhere else:
`text-3xl font-bold` (in place of `text-4xl font-extrabold`). Nothing else about the template's layout,
spacing, badge pill, or content changes.

## Known Constraints (do not expand scope)
- Font-size and font-weight ONLY. Do not touch margins, spacing, the category badge pill, or any other
  visual property.
- Do not add a subtitle to DefinitionTriptych — it currently has none, and adding one is explicitly
  covered by the separate TMPL-07 toggle feature, not this brief.
- Do not touch any other renderer file. Do not touch TopicHero, SessionOverview, or SessionSummary —
  Arun has confirmed those are fine to differ.
- Do not touch containerBudgets.ts or any character-budget logic.

## Process
Confirm the DefinitionTriptych.tsx line 24 finding directly against the current file before writing the
spec. Write the full 12-section Requirement Document to
`.claude/agents/clio/requirement-docs/TMPL-06-title-font-standardization.md`. Given how small and
mechanical this fix is, keep every section proportionate — do not pad. Section 11 must be empty.
