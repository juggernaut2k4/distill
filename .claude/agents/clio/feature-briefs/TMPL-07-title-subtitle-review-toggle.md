# Feature Brief: TMPL-07 — Per-Template Title/Subtitle Review Toggle
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-12

## What Happened
Following the font-consistency audit (see TMPL-06 for the one outlier that gets a direct fix), 7 of the
28 templates render with a title and/or subtitle missing entirely — not a font-size mismatch, a genuine
structural absence:

**Title present, subtitle missing (4 templates):**
- `NarrativeCard.tsx` (line 22) — title is `{data.company}`, no subtitle line. `data.industry` exists but
  is shown as a small pill badge next to the title, not a subtitle line.
- `ActionPlan.tsx` (line 94) — title is a static `"Your Action Plan — {data.session_topic}"` string; no
  separate subtitle.
- `GenericTemplate.tsx` (line 58) — title is `{section.meta.subtopicTitle}` (this field is available on
  every section of every template type via the shared `TemplateMeta` interface, not just this one); no
  subtitle.
- `ConceptMap.tsx` (line 87) — title is `{data.title}`; no subtitle. `data.central_concept` exists on
  `ConceptMapData` but is not currently surfaced as header text anywhere.

**Neither title nor subtitle (3 templates):**
- `AnswerSpotlight.tsx` — no header row at all. Its data type (`AnswerSpotlightData`) has no `title`
  field; `data.question` is the main on-screen content, already rendered prominently elsewhere in the
  template.
- `FrameworkCard.tsx` — no header row at all above its ReactFlow canvas. Its data type
  (`FrameworkCardData`) has no `title` field either — closest candidate is `framework_name`.
- `StatCallout.tsx` — no header row at all above its ReactFlow canvas. Its data type
  (`StatCalloutData`) has no `title` field — the stat itself is the visual focus; closest candidate for
  a short label doesn't exist.

Arun's decision: do not force a title/subtitle onto these 7 templates automatically. Instead, give him a
review control so he can decide per template, after actually seeing it rendered, whether adding a
title/subtitle improves or clutters that specific template.

## The Feature
1. **A toggle in the admin Template Library review page** (`/dashboard/admin/templates`), placed below
   each of these 7 templates' cards specifically (the other 21 templates already have this covered by
   TMPL-06/the existing standard — no toggle needed there). The toggle lets the approver (gated by the
   same `isConfiguredApprover()` check every other mutating action in this workflow already uses) turn
   title/subtitle display on or off for that specific template.
2. **When turned ON, the template's container/canvas must adjust** to make room for the added header —
   following the same principle TMPL-02 already established for the rest of the library: actually
   render and measure, don't guess at a pixel number. Each of the 7 templates has a different layout
   (some are ReactFlow canvases with `fitView`, some are flex layouts), so the adjustment mechanism
   will likely differ per template — BA to determine the concrete approach per template, grounded in
   how TMPL-02 solved the equivalent problem for existing templates and how TMPL-05 solved it for
   Overlay specifically.
3. **Toggling this control counts as reviewer feedback**, not a silent, invisible change. It must move
   the template back into `pending_review` (reusing the existing status state machine and
   `template_fix_log` audit trail from TMPL-01/TMPL-03, the same way `reopen_for_review` already does)
   so the changed template is shown for Arun's review and requires his approval again before it's
   considered production-ready — exactly the same "don't let a change silently ship" principle
   requirement #15 (RTV-04) already established for template approval as a whole.

## Confirmed Directly Against the Current Code
- `template_library` (migration 065) has `sample_data jsonb`, `container_spec jsonb`, `status text`,
  `review_notes text` — BA to confirm whether a new boolean column (e.g. `header_enabled`) is the right
  storage choice, or whether this state belongs inside the existing `container_spec`/`style_overrides`
  jsonb columns instead.
- `TemplateMeta.subtopicTitle` (lib/templates/types.ts line 10) is available on every section regardless
  of template type — a candidate universal fallback title source for the 3 templates whose data type has
  no `title` field at all (AnswerSpotlight, FrameworkCard, StatCallout), since forcing a new required
  field onto their TypeScript data shapes would be a larger, riskier change than reusing metadata that
  already exists on every section today.
- TMPL-01's `style_overrides` mechanism and `styleOverrideSlots.ts` allowlist are scoped to
  Heatmap/Overlay only and are an LLM-fix mechanism — this toggle is unrelated: a direct boolean
  render-branch in each of the 7 renderer files, not an LLM-generated style change, and must not be
  wired into TMPL-01's fix loop, its Inngest job, or its slot validator.

## What Success Looks Like
- Each of the 7 templates gets a working on/off toggle, visible below its card in the admin review page.
- Toggling ON renders that template's title (and subtitle, where a reasonable field exists) using the
  same standard font treatment as every other template (`text-3xl font-bold` title, `text-sm` subtitle
  — matching TMPL-06's target state), with the canvas/container genuinely adjusted to fit, not just
  overlaid on top of existing content.
- Toggling the control (either direction) writes an audit entry and moves the template to
  `pending_review`, exactly like any other reviewer action in this workflow — it never silently applies
  to an approved template without going back through review.
- Toggling OFF returns the template to exactly its current (pre-TMPL-07) appearance.

## Known Constraints (do not expand scope)
- Scoped to exactly these 7 templates: NarrativeCard, ActionPlan, GenericTemplate, ConceptMap,
  AnswerSpotlight, FrameworkCard, StatCallout. Do not touch DefinitionTriptych (covered by TMPL-06) or
  any of the 17 templates that already have both title and subtitle.
- Do not touch TopicHero, SessionOverview, or SessionSummary — Arun has confirmed those bookend screens
  are fine to differ.
- Do not touch TMPL-01's automated LLM fix loop, its slot allowlist, or its Inngest job.
- Do not touch `containerBudgets.ts`'s character-budget numbers — if a header takes vertical space,
  prefer adjusting layout/dimensions over changing what content is allowed to say, consistent with
  TMPL-02's and TMPL-05's established principle.
- Default state for all 7 templates is OFF (today's current rendering, zero behavior change) until
  Arun explicitly flips a toggle.

## Process
Actually read each of the 7 templates' full renderer code and TypeScript data interface (not guess) to
decide, per template, exactly which field becomes the title and which (if any) becomes the subtitle
when the toggle is on — for templates with no natural subtitle field, it is fine for the spec to say
"title only, no subtitle toggle" rather than forcing one. Where a canvas-adjustment plan can be decided
by real box-model arithmetic (following TMPL-05's precedent), do that; where the template needs true
empirical rendering to be sure (following TMPL-02's precedent), do that instead. Write the full
12-section Requirement Document to
`.claude/agents/clio/requirement-docs/TMPL-07-title-subtitle-review-toggle.md`. Section 11 must be
empty — where a genuine product-taste question exists (e.g. exactly which field to use as a subtitle),
resolve it with the most reasonable, best-grounded choice and document the reasoning; Arun's own
per-template review/approval step (already part of this feature) is the real checkpoint for whether
that choice was right, not the spec approval gate.
