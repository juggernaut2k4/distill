# VIZ-01 — Visualization Template Intelligence: Feature Brief

**Author:** CEO Agent  
**Date:** 2026-06-26  
**Status:** Approved — ready for BA spec  

---

## Problem

The current visualization system generates 23 possible visual templates but selects the wrong one in a significant percentage of cases. The root cause: template selection uses keyword matching on the subtopic **title** only, and ignores the `template_hint` that Claude already produces when generating the content outline.

Concrete failure observed: a subtopic comparing Claude Sonnet vs Haiku vs Opus was assigned `DefinitionTriptych` (three definition boxes) instead of `ComparisonTable`. Haiku and Opus never appeared on screen. Clio voiced over the Sonnet definition box as if it were a general concept. The user had no way to compare the three models.

This is not a rare edge case. Any comparison-type content whose title does not contain "vs", "versus", or "compare" will silently receive the wrong template. The same applies to process content titled "Deploying AI at Scale" (no "step" keyword → wrong template) or statistical content titled "The State of AI Adoption" (no "statistic" keyword → wrong template).

---

## Solution

Make Claude's `template_hint` the primary template selection signal. Use keyword matching on the title only as a fallback when the hint is absent or unrecognised.

This requires a one-line change to how `selectTemplate()` is called — accept the hint as a parameter and apply it before the keyword rules. The callers (`session-plan.ts` and `generate-content/route.ts`) pass the hint through from the stored `visual_spec`.

Additionally, the comparison keyword set should be extended to catch model-name comparisons that don't use "vs" in the title ("Claude models", "model tiers", "Sonnet Haiku Opus").

---

## Success Criteria

- When Claude's `template_hint` is `ComparisonTable`, the rendered visual is always a comparison table regardless of the title wording
- When a subtopic compares named models, tools, or options — the comparison table shows all options side by side
- No regression on subtopics where the hint is absent or invalid — keyword fallback still applies
- TypeScript compiles clean (`npx tsc --noEmit`) after the change

---

## Scope

Small, targeted fix. Three files: `selector.ts`, `session-plan.ts`, `generate-content/route.ts`. No DB changes. No new LLM calls.

---

*Approved for BA spec.*
