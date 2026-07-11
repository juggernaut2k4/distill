# Feature Brief: TMPL-02 — Container Overflow + Minimum Font Size Fix Across Template Library
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 (visual defect affecting real users, not a new feature)
Date: 2026-07-11

## What Arun Said (verbatim intent)
General feedback after reviewing the template library, applying to many templates in common:
1. **Containers are overflowing the screen** — content spills past its intended visual boundary.
   Margins and spacing need to be set so containers stay fully within the canvas.
2. **Font is too small on most templates** — needs a minimum font size that's comfortably readable
   on both mobile and desktop.

Arun's exact instruction: route this through the CEO/BA process and fix it in the templates — not a
quick patch, a properly spec'd fix.

## Context / Known Prior State (do not re-derive, verify against current code instead)
- RTV-04 (`.claude/agents/clio/requirement-docs/RTV-04-template-library-and-approval.md`) built
  Layer 1 (character-count budgets) and Layer 2 (fixed-pixel containers, `overflow-hidden` +
  `line-clamp-N`) structural enforcement — but **explicitly and only for the 2 new templates
  (Heatmap, Overlay)**. RTV-04's own Section 10 flagged: "Retrofitting fixed-size containers onto
  the 23 pre-existing templates. Already flagged as a follow-up in RTV-04; unaffected and untouched
  here." TMPL-01 repeated the same flag. **This brief is very likely that exact follow-up work,
  now surfaced as a real, observed defect rather than a hypothetical gap** — but confirm this by
  actually looking at the current templates, don't assume every template is affected equally.
- Do not assume "many templates" means "all 27." BA must determine, by actually rendering/inspecting
  the templates (not just reading the character-budget numbers), which specific templates and which
  specific fields overflow or run too small, and report that concretely in the spec rather than
  applying a blanket fix on an assumption.
- The 2 templates covered by RTV-04's Layer 2 (Heatmap, Overlay) may or may not also have issues —
  check them too rather than excluding them by assumption just because they have some existing
  structural enforcement.
- TMPL-01 (`.claude/agents/clio/requirement-docs/TMPL-01-automated-feedback-fix-loop.md`, deployed)
  built an automated per-template style-override mechanism, but it is explicitly scoped to
  Heatmap/Overlay only and only touches a small, fixed allowlist of color/dimension slots on those
  2 templates — it is not the mechanism for this fix, and this brief does not extend it. This is a
  direct, human-spec'd, developer-built fix to the renderer components themselves (margins, spacing,
  font sizes), not an LLM-generated one.

## The Problem Being Solved
Executives using Clio in a live session (and Arun reviewing templates in the admin tool) are seeing
visual content that doesn't fit its container and text that's uncomfortably small to read — on a
premium product where the entire pitch is "15-20 seconds a day, easy to absorb," a visually broken
or hard-to-read screen undermines the product immediately. This is a defect in an already-shipped,
real-user-facing surface, not a nice-to-have.

## What Success Looks Like
- Every template's content stays fully within its rendered canvas — no clipped/overflowing text,
  no content spilling past a card's visual boundary — across the range of content lengths RTV-04's
  own character budgets already allow (i.e., the fix must hold at the actual maximum lengths the
  system permits, not just for short sample content).
- A defined minimum font size applies across the template library, verified comfortable on both a
  mobile viewport and a desktop viewport — BA must pick concrete numbers (with rationale, e.g. a
  common accessibility/readability baseline) and specify exactly which existing text classes/sizes
  in the affected renderers need to change.
- Consistent margin/spacing standard applied wherever containers were overflowing — not a one-off
  patch per template, a rule BA defines once and developers apply consistently.
- No regression to RTV-04's Layer 1/2 enforcement, TMPL-01's style-override mechanism, or any
  live-session behavior beyond the templates' own visual rendering.

## Known Constraints (do not expand scope)
- This is a visual/CSS-level fix to existing renderer components (`components/templates/renderers/
  *.tsx`) — not a data-shape change, not a new template type, not a new API route.
- Must not break RTV-04's existing character-budget assumptions (Layer 1) — if a font-size increase
  means less text fits comfortably per line, BA should determine whether the existing character
  budgets need adjusting too, or whether spacing/layout absorbs it — state which, explicitly.
- Must not touch TMPL-01's `style_overrides` mechanism, slot allowlists, or the automated fix loop —
  this is a baseline rendering fix underneath that, not an interaction with it.
- Approved libraries/patterns only, per CLAUDE.md — Tailwind classes and inline styles as already
  used throughout this codebase, no new styling library.
- Mobile AND desktop — Clio sessions render in a Recall.ai bot browser tab and the dashboard walkthrough
  page; check both actual rendering contexts this codebase already supports rather than inventing a
  new breakpoint model.

## Process
**Before writing the spec, actually look at the rendered templates.** Start the dev server and use
the `/dashboard/admin/templates` admin review page (RTV-04) to visually inspect each of the 27
templates' live-rendered previews (this page already renders the real `TemplateRenderer` component
with real/sample data, per RTV-04's own design) — do not spec this from reading source code alone.
Identify concretely: which templates overflow, which specific fields/containers overflow, what the
current font sizes are on the fields Arun is calling "too small," and what a consistent fix looks
like. Take note of container dimensions, current Tailwind text-size classes, and specific overflow
points (e.g. "ComparisonTable's `verdict` field can exceed its card height at RTV-04's own 25-word
budget max"). Ground every fix in what you actually observed rendering, not assumption.

Write the full 12-section Requirement Document to
`.claude/agents/clio/requirement-docs/TMPL-02-container-overflow-and-font-size-fix.md`. Section 11
must be empty — if a genuine ambiguity remains after your own visual audit and research (e.g. an
exact minimum font size number that's genuinely Arun's call rather than a technical judgment), list
it plainly rather than guessing. Suggested id: `TMPL-02-container-overflow-and-font-size-fix`.
