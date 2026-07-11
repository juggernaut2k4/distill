# TMPL-02 — Container Overflow + Minimum Font Size Fix Across Template Library — Requirement Document
Version: 1.0
Status: APPROVED (see CEO Review, end of document)
Author: Business Analyst Agent
Date: 2026-07-11

> **Grounding note (read before the spec).** Every claim below was verified by actually rendering the 27
> template components — not inferred from reading source alone. Source access to `/dashboard/admin/templates`
> was blocked locally (`.env.local`'s `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is the literal placeholder value,
> which crashes Clerk's `ClerkProvider` at the format-validation stage before any page can render — confirmed
> via `npm run dev` server logs — and this is a local-credential gap, not something requiring Arun's real
> production credentials, so no code was changed to work around it). To still satisfy the brief's explicit
> "actually look at the rendered templates" requirement, a temporary, read-only, non-committed Vite harness
> was built that imported the REAL `components/templates/TemplateRenderer.tsx` and all 27 real renderer
> components directly, fed them the REAL mock sample data already in `lib/templates/generator.ts`'s
> `getMockData()`, and additionally stress-tested every budgeted field up to its actual maximum character
> length using the REAL `lib/templates/containerBudgets.ts` module (no numbers invented) — rendered inside two
> reproductions of the real containers: (a) the exact 944px-wide × 520px-tall `overflow-hidden` box
> `TemplateApprovalClient.tsx` line 314 actually uses, and (b) a full-viewport container matching
> `SessionStack.tsx`'s real live-session slide wrapper. The harness and its temporary `.claude/launch.json`
> entry were deleted after the audit; no application code was modified to produce these findings.

## 0. What was actually found (summary of concrete, reproducible defects)

Four distinct, independently-confirmed root causes — not one bug, four:

**A — "So what?" footer band escapes its card in the admin review tool (the literal "container overflow" bug).**
15 of 27 templates render their `so_what` footer as `className="absolute bottom-0 left-0 right-0 ..."`:
`ActionPlan`, `CaseStudy`, `ComparisonTable`, `ConceptDefinition`, `ConceptMap`, `Flowchart`, `FrameworkCard`,
`Funnel`, `ProsCons`, `QuestionAnswer`, `StatCallout`, `StepFlow`, `Timeline`, `TwoByTwoMatrix`, and
`QuoteCallout` (via its `GenericTemplate.tsx` fallback). None of these 15 renderers' own outermost `<div>` has
`position: relative` — confirmed by direct grep of all 27 renderer files. `app/dashboard/admin/templates/
TemplateApprovalClient.tsx`'s own preview card (line 314: `<div className="rounded-xl border ... overflow-
hidden mb-4 bg-[#080808]" style={{ height: 520 }}>`) **also** has no `position: relative` anywhere in its own
tree or `DashboardShell.tsx`'s (confirmed by grep — zero matches). Per CSS spec, an `absolute`-positioned
element with no positioned ancestor resolves against the page's initial containing block, not its visual
parent card.

**This was verified empirically, not just read from source**: in the audit harness, removing `position:
relative` from an otherwise-identical 520px preview box caused `ComparisonTable`'s "So what?" footer to jump
from `top: 2591px` (correctly inside its own card) to `top: -433px` (fully detached, nowhere near its card) —
the exact defect a viewer would describe as "content spills past its intended visual boundary." **This is
specific to the admin review tool** — `components/templates/SessionStack.tsx` line 181 correctly wraps every
live-session slide in `className="relative h-screen w-full"`, so the 15 affected templates render their
footer correctly during a real session; the admin tool's own preview card is the one place missing this.

**B — ReactFlow's `fitView` auto-zoom silently shrinks already-small text as content approaches RTV-04's own
character-budget maximums.** 14 templates (`ConceptDefinition`, `StepFlow`, `ComparisonTable`,
`TwoByTwoMatrix`, `FrameworkCard`, `ProsCons`, `CaseStudy`, `StatCallout`, `Timeline`, `ConceptMap`,
`KeyTakeaway`, `QuestionAnswer`, `ActionPlan`, `Funnel`, `Flowchart`) lay out fixed-pixel-width node cards
inside `<ReactFlow fitView fitViewOptions={{ padding: ... }}>`, which automatically scales its entire canvas
(including all text) to fit whatever container height it is given. Measured directly on `ComparisonTable`
(via the `react-flow__viewport`'s live `transform` matrix): at the current mock content, `scale(1)` — text
renders at its nominal 12px (`text-xs`)/14px (`text-sm`). At content stress-tested to `containerBudgets.ts`'s
own real per-field `maxChars` (all 9 budgeted fields at max, e.g. `verdict` at its true 25-word/163-char cap),
the same 520px admin-preview box forces `scale(0.5)` — meaning already-small `text-xs`/`text-sm` renders at an
**effective ~6–7px**. This is a compounding mechanism, independent of (D) below: the more content a topic's
generated data actually uses of its permitted budget, the smaller the text gets, silently, with no floor.

**C — `grid-cols-3` with no responsive breakpoint, on templates whose columns are NOT line-clamped.**
`DefinitionTriptych.tsx` (line 28: `className="grid grid-cols-3 gap-5 flex-1 min-h-0"`) and
`NarrativeCard.tsx` (line 29: `className="grid grid-cols-3 gap-4 flex-1 min-h-0"`) never switch to a
single-column layout on narrow viewports (no `md:grid-cols-3` prefix — it's unconditional `grid-cols-3` at
every width), and their column text (`what_it_is`, `real_example.what`, `common_myth`, `challenge`,
`approach`, `impact` — all `text-sm leading-relaxed flex-1`, no `line-clamp`) grows to however many lines it
needs. Verified directly at a 375×812 mobile viewport (the dashboard's supported mobile breakpoint): each of
the 3 columns compresses to ~110px effective width, wrapping every word onto its own line; the rightmost
column's border visibly runs past the viewport's right edge, and the column content cascades far below the
container's intended one-screen `h-full` height with no scroll affordance — a genuine, visible, both-axes
overflow, confirmed by rendering, not assumption.

**D — Near-universal small font sizes on substantive body copy, across effectively all 27 templates.**
Confirmed by direct line-by-line reading of every renderer file: the field a user is actually meant to read —
descriptions, explanations, analogies, implications, "why it matters" text — renders at `text-xs` (12px) in
the large majority of templates (e.g. `ConceptDefinition`'s `plain_english`, `StepFlow`'s step
`description`, `ComparisonTable`'s `criteria[].values[]` and `options[].tagline`, `TwoByTwoMatrix`'s quadrant
`description`, `FrameworkCard`'s component `description`, `ProsCons`'s pro/con `description`, `CaseStudy`'s
`challenge`/`ai_solution`, `Timeline`'s event `description`, `ConceptMap`'s node `description`,
`KeyTakeaway`'s `implication`, `QuestionAnswer`'s `analogy`/`example`/`important_nuance`, `Funnel`'s stage
text, `ChevronProcess`'s `description`, `Heatmap`'s row/column labels and `text-[10px]` cell labels,
`Overlay`'s `callout_detail`). Only headings (`text-3xl`–`text-5xl`) and a few hero numbers exceed 14px. This
holds true even in `Heatmap`/`Overlay` — RTV-04's own newest, most structurally "fixed" templates — confirming
the Feature Brief's instruction not to assume they're exempt: they are not overflow-affected (they already
have `line-clamp`/fixed dimensions/`overflow-hidden`), but they are equally affected by (D).

**Not affected by A/B/C** (their own wrapper already has `relative`, or the field in question doesn't use
`grid-cols-3`/ReactFlow, or renders in normal flow): `TopicHero`, `KeyTakeaway` (uses ReactFlow, affected by B,
but has no absolute footer so not affected by A), `AnswerSpotlight`, `ChevronProcess`, `Heatmap`, `Overlay`,
`HorizontalDecision`, `Hierarchy`'s actual live renderer `HorizontalTree.tsx`, `SessionOverview`,
`SessionSummary`. All of these are still affected by (D).

**Dead code found in passing, out of scope for this fix, flagged for a separate cleanup ticket**:
`components/templates/renderers/Hierarchy.tsx` is imported into `TemplateRenderer.tsx` (line 20) but never
used — the `'Hierarchy'` case (line 85–86) actually renders `HorizontalTree.tsx`, not `Hierarchy.tsx`. Any
future audit of "the Hierarchy template" must inspect `HorizontalTree.tsx`, not `Hierarchy.tsx`.

## 1. Purpose

Every one of Clio's 27 visualization templates is a real, already-shipped, user-facing surface — rendered
live to paying executives during a Recall.ai voice session, and reviewed by Arun in the
`/dashboard/admin/templates` design-approval tool. Both surfaces currently show two classes of visible defect:
content that escapes or overruns its intended card boundary, and body text small enough to be uncomfortable
to read on both a laptop and a shared/projected call. On a product whose entire pitch is "15–20 seconds a
day, effortless to absorb," this directly undermines the premium, confident feel the product must have on
first impression. Without this fix, every future template review Arun does in the admin tool will keep
showing him misplaced content bands that are not actually representative of what he thinks he's approving
(finding A), and every live session a user has will keep showing text that gets smaller precisely when the
generated content is richer (finding B), with no floor.

## 2. User Story

As **Arun, reviewing templates at `/dashboard/admin/templates`**,
I want every template's rendered preview to show content fully and correctly positioned inside its own card,
So that my approve/reject decision is based on what will actually ship, not on a rendering artifact of the
review tool itself.

As **an executive user in a live Clio session**,
I want the text I'm reading to be comfortably legible on both my phone and my laptop, regardless of how much
content today's topic generated,
So that the "15 seconds a day" promise doesn't feel like squinting at a spreadsheet.

## 3. Trigger / Entry Point

This is a rendering-layer fix to existing components, not a new flow. It activates identically to how these
components already activate today:
- **Admin review**: any authenticated user visiting `/dashboard/admin/templates` (existing RTV-04 route);
  each card mounts `TemplateRenderer` with that template's frozen `sample_data` inside the existing 520px
  preview box (`TemplateApprovalClient.tsx` line 314–320).
- **Live session**: `SessionStack.tsx` mounts each subtopic's assigned `TemplateRenderer` inside its existing
  `relative h-screen w-full` slide wrapper, on `show_visual` (Recall.ai bot browser tab and the dashboard
  walkthrough page — both already-supported rendering contexts; no new breakpoint model is introduced).
- No new route, no new API, no new state is required — this is a fix to the renderer components'
  `className`/inline-style values only, per the Feature Brief's explicit scope.

## 4. Screen / Flow Description

There is no new screen. The fix changes the internal rendering of existing screens as follows, organized by
the four root causes in Section 0:

### 4.A — Fix the absolute-footer positioning bug (15 templates + the admin tool)
- Add `position: relative` (Tailwind `relative`) to the outermost `<div>`/`motion.div` of all 15 affected
  renderers: `ActionPlan.tsx`, `CaseStudy.tsx`, `ComparisonTable.tsx`, `ConceptDefinition.tsx`,
  `ConceptMap.tsx`, `Flowchart.tsx`, `FrameworkCard.tsx`, `Funnel.tsx`, `GenericTemplate.tsx`, `ProsCons.tsx`,
  `QuestionAnswer.tsx`, `StatCallout.tsx`, `StepFlow.tsx`, `Timeline.tsx`, `TwoByTwoMatrix.tsx`. This alone
  makes each renderer self-contained and correct regardless of what ancestor markup wraps it (matching the
  pattern the newer templates — `Heatmap`, `Overlay`, `AnswerSpotlight`, `ChevronProcess`,
  `DefinitionTriptych`, `HorizontalDecision`, `HorizontalTree`, `NarrativeCard` — already correctly use).
- As a defense-in-depth second layer (do not rely on renderer-level fixes alone for a tool this important),
  also add `position: relative` directly to `TemplateApprovalClient.tsx` line 314's preview-card `<div>`. Two
  independent layers means a future 28th template that forgets `relative` on its own wrapper still renders
  correctly inside this specific review tool.
- Give the `so_what` footer band itself a defined maximum height instead of unconstrained auto-grow: change
  `px-8 py-4` (auto height) to a fixed `h-[72px]` (matching `Heatmap`/`Overlay`'s own established Layer-2
  pattern) with `overflow-hidden` and `line-clamp-2` on the value text — so at the true 30-word/~195-char
  `so_what` maximum, the band never needs more vertical space than it's given, on either surface.

### 4.B — Fix ReactFlow's zoom-driven font shrinkage (14 templates)
- The root problem is that `fitView` treats font size as something it may freely scale down to make content
  fit, with no floor. Two changes, applied together (one alone does not fix it):
  1. Set a `minZoom` on every `<ReactFlow>` instance in the 14 affected renderers — e.g. `minZoom={0.85}` —
     so the canvas may shrink slightly for genuine spacing reasons but can never scale text down anywhere
     close to the ~0.5 measured today.
  2. Increase each fixed-pixel node's `height` value (hardcoded per node type in each renderer, e.g.
     `ComparisonTable`'s `ROW_H = 80`, `ProsCons`'s node `height: pro.evidence ? 110 : ROW_H`) by roughly the
     same proportion as the font-size increase in 4.D below, so a `text-sm` (14px) field that now wraps to one
     more line than it did at `text-xs` (12px) still fits inside its own node box without visually overflowing
     it (most ReactFlow node `<div>`s do not have `overflow-hidden` set — text that doesn't fit today simply
     grows past the node's visible border, a second, more literal overflow risk that a font-size bump alone
     would make worse, not better, if node heights are left unchanged).

### 4.C — Fix the unresponsive 3-column grid (2 templates)
- `DefinitionTriptych.tsx` and `NarrativeCard.tsx`: change `grid-cols-3` to `grid-cols-1 md:grid-cols-3` (the
  same `md:` breakpoint convention this codebase's `ChevronProcess.tsx` already uses for its own
  desktop/mobile split — reuse the existing convention, don't invent a new one). On mobile, the 3 panels stack
  vertically at full width; on desktop (`md:` and above), they remain side by side exactly as today.
- Because stacking to one column will make the total content taller than 812px on longer content, the
  outer wrapper needs `overflow-y-auto` on mobile so the (now vertically stacked) panels can scroll within the
  slide rather than clip — matching how `SessionStack.tsx`'s own outer scroll region already works for the
  sidebar nav (`overflow-y-auto`, an established pattern in this codebase, not a new one).

### 4.D — Raise the font-size floor (all 27 templates, applied per-field)
- **New minimum for any field a user is meant to read as prose/explanation**: `text-sm` (14px), up from
  `text-xs` (12px). Where a field's container already has headroom (most `flex-1`/auto-height fields outside
  ReactFlow — `DefinitionTriptych`, `NarrativeCard`, `AnswerSpotlight`'s context cards, `ChevronProcess`'s
  stage description, `HorizontalDecision`'s node detail), prefer `text-base` (16px) instead.
- **Fields that may stay at `text-xs`**: short, uppercase, tracking-wide UI labels/eyebrows/badges that are
  not prose the user reads at length — e.g. `"So what?"`, `"VERDICT"`, `"Best for:"`, axis labels, legend
  swatch captions, single-word/short-phrase category chips. This is a narrow, explicit exception, not a
  loophole — anything that is a full sentence or a multi-word explanation does not qualify.
- Concrete class changes required (representative list, not exhaustive — every `text-xs` on a
  description/explanation/analogy/implication field across all 27 renderer files must be swept, not just the
  ones named below as examples): `ConceptDefinition.tsx`'s `plain_english` and `common_misconception`
  (`text-xs`→`text-sm`); `StepFlow.tsx`'s step `description` and `what_to_watch_for`; `ComparisonTable.tsx`'s
  `options[].tagline`/`best_for`, `criteria[].values[]`; `TwoByTwoMatrix.tsx`'s quadrant `description`;
  `FrameworkCard.tsx`'s component `description`/`executive_question`; `ProsCons.tsx`'s pro/con
  `description`/`evidence`/`mitigation`; `CaseStudy.tsx`'s `challenge`/`ai_solution`/lesson text;
  `Timeline.tsx`'s event `description`; `ConceptMap.tsx`'s node `description`; `KeyTakeaway.tsx`'s `insight`/
  `implication`/`action_for_you`; `QuestionAnswer.tsx`'s `analogy`/`example`/`important_nuance`;
  `Funnel.tsx`'s stage description/filter/criteria text; `ChevronProcess.tsx`'s `description`; `Heatmap.tsx`'s
  row/column labels (`text-xs`→`text-sm`) and cell `label` (`text-[10px]`→`text-xs`, the narrowest case, given
  the fixed 64px cell); `Overlay.tsx`'s `callout_detail` (`text-xs`→`text-sm`).
- **Interaction with 4.B**: on the 14 ReactFlow templates, this font increase is only safe to ship together
  with the node-height increase in 4.B.2 and the `minZoom` floor in 4.B.1 — shipping the font bump alone would
  make the already-measured zoom-shrink problem visually worse (larger nominal text forced through an even
  smaller effective zoom).

## 5. Visual Examples

Text wireframes below show the corrected state for one representative template per root cause (the actual
fix applies identically across every affected template named in Section 4).

**ComparisonTable — admin-preview box, corrected (fix A + B):**
```
┌──────────────────────────────────────────────────────────────────┐ ← 944×520, overflow-hidden
│ Comparing AI Approaches: AI Orchestration Layers                  │
│ Three common paths executives choose...                           │
│                                                                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                  │
│  │Build in-house│ │Buy a platform│ │Hybrid model │  ← text-sm now │
│  └────────────┘  └────────────┘  └────────────┘                  │
│  Time to value     12-24 months    ✓ 1-3 months   6-12 months     │
│  Upfront cost       $2M-$10M+       ✓ $50K-$500K    $500K-$3M      │
│  ...                                                                │
│  VERDICT: For most mid-large enterprises...                        │
├──────────────────────────────────────────────────────────────────┤ ← footer now h-[72px] fixed,
│ So what?  As a CEO, resist the "build vs. buy" binary...           │   line-clamp-2, position:relative
└──────────────────────────────────────────────────────────────────┘   correctly contained, never escapes
```

**DefinitionTriptych — mobile (375px), corrected (fix C):**
```
┌─────────────────────────┐
│ AI Fundamentals          │
│ AI Orchestration Layers   │
│                           │
│ ┌───────────────────────┐│  ← grid-cols-1 on mobile,
│ │📖 WHAT IT IS            ││    each panel full-width,
│ │ ...full text, text-base││    scrollable if tall
│ └───────────────────────┘│
│ ┌───────────────────────┐│
│ │🏢 REAL EXAMPLE          ││
│ └───────────────────────┘│
│ ┌───────────────────────┐│
│ │⚠️ COMMON MYTH           ││
│ └───────────────────────┘│
├─────────────────────────┤
│ So what? ...              │
└─────────────────────────┘
```

## 6. Data Requirements

No data-shape change. This is a pure rendering fix.
- **Read**: no new reads. `lib/templates/containerBudgets.ts`'s existing `CONTAINER_BUDGETS`/`computeMaxChars`
  are read only to verify (in testing) that the new font sizes + node heights hold at each field's real
  maximum — not modified.
- **Write**: none.
- **APIs**: none touched.
- **localStorage/sessionStorage**: none.

## 7. Success Criteria (Acceptance Tests)

✓ Given any of the 15 templates listed in 4.A rendered inside `/dashboard/admin/templates`'s existing 520px
preview card with `so_what` at its true 30-word maximum, when the page renders, then the "So what?" band's
`getBoundingClientRect()` is fully contained within the preview card's own bounding box (no `top`/`bottom`
value outside the card's own `top`/`bottom` range).

✓ Given `ComparisonTable` (or any of the 14 templates in 4.B) rendered with every budgeted field at its real
`containerBudgets.ts` maximum, when inspected, then the `.react-flow__viewport`'s computed `scale` is ≥ 0.85.

✓ Given `DefinitionTriptych` or `NarrativeCard` rendered at a 375px-wide mobile viewport, when the page
renders, then no panel's bounding box extends past the viewport's right edge, and the full panel stack is
reachable via vertical scroll with no horizontal scroll required.

✓ Given any field listed in 4.D as needing a floor of `text-sm`, when rendered, then its computed
`font-size` is ≥ 14px (never `text-xs`'s 12px), at both the mobile and desktop viewport.

✓ Given a ReactFlow-based template's font size is increased per 4.D, when its corresponding node `height` is
NOT also increased per 4.B.2, then this is treated as an incomplete fix and must not ship (this is a build-time
review checklist item, not a runtime-testable assertion — call out explicitly in PR review).

✓ Given `template_library.container_spec`'s existing character-budget values (Layer 1) and Heatmap/Overlay's
existing fixed pixel dimensions (Layer 2), when this fix ships, then neither the budget numbers in
`containerBudgets.ts` nor Heatmap/Overlay's `FIXED_CONTAINER_DIMENSIONS` are modified (confirms the "no
character-budget adjustment needed, spacing/layout absorbs it instead" decision in Section 9 below).

✓ Given a real live session (`SessionStack.tsx`) renders any of the 27 templates before and after this fix,
when compared, then `show_visual`'s trigger, `selectTemplate()`'s call sites, and the slide-to-slide navigation
behavior are byte-for-byte unchanged — this is a visual/CSS-only fix, confirmed by a regression pass.

## 8. Error States

Not applicable in the traditional sense (no new user input, no new API call). The one "error-adjacent" case:
- If a future field's generated content is unexpectedly long (a Layer-1 validation escape), the existing
  `line-clamp`/`overflow-hidden` additions in 4.A's footer fix and 4.D's Heatmap/Overlay labels are the
  backstop — content truncates visually with an ellipsis rather than escaping its box, consistent with
  RTV-04's own established Layer 2 pattern.

## 9. Edge Cases

- **Font-size increase creates new overflow risk given RTV-04's existing character budgets — does this
  require adjusting the budgets themselves, or does spacing/layout absorb it? Stated explicitly, per the
  brief's requirement**: **layout absorbs it; the character budgets in `containerBudgets.ts` are NOT changed.**
  For the 14 ReactFlow templates, this is handled by increasing each node's fixed `height` value (4.B.2) to
  match the extra line-wrap the larger font causes at the same character count — the box grows, not the text
  shrinks back down. For the fixed-shell templates (`Heatmap`, `Overlay`, `ChevronProcess`, etc.), most
  affected fields already sit inside `line-clamp-N` containers sized generously relative to their budget, so
  a 2px bump (`text-[10px]`→`text-xs`, or `text-xs`→`text-sm`) does not change how many lines they clamp to
  in practice — verified by the stress-test render showing no new clipping at those fields' real maximums once
  the corresponding container is also given adequate height (already true for `Heatmap`'s fixed `h-[64px]`
  cells at `text-[10px]`, and should be re-verified at `text-xs` before shipping — a task for the developer
  during implementation, not a spec ambiguity).
- **`ActionPlan`'s `so_what`-style footer is conditional** (`{data.next_session_preview && (...)}`) — the
  fix in 4.A applies whenever it renders; when `next_session_preview` is absent, there is no footer to
  mis-position and no fix needed for that render.
- **`QuoteCallout` has no dedicated renderer** — it goes through `GenericTemplate.tsx`'s fallback card, which
  is one of the 15 affected by 4.A; the fix applies to `GenericTemplate.tsx` directly, which is also shared by
  any other future template that hasn't gotten a bespoke design yet.
- **Heatmap/Overlay's `styleOverrides` mechanism (TMPL-01)** — confirmed untouched: TMPL-01's automated
  fix-loop only ever writes `cell-size`/`cell-gap`/`intensity-N`/`zone-color-N`/`callout-width`/
  `callout-height`/`panel-border-width` slots via inline `style={{}}`, none of which this phase's Tailwind
  class changes conflict with or need to read.
- **Mobile vs. desktop for the 15 templates fixed under 4.A**: unaffected either way by viewport width — the
  positioning bug is about a missing CSS property, not responsive layout, so the fix is viewport-independent.
- **First-time vs. returning user, empty data, slow network**: unaffected — this is a static rendering fix to
  already-validated data shapes; no new loading/empty states are introduced.

## 10. Out of Scope

- **TMPL-01's `style_overrides` mechanism and its slot allowlists** — untouched, confirmed in Section 9.
- **RTV-04's Layer 1 character-count validation logic itself** (`containerBudgets.ts`'s `computeMaxChars`/
  `computeMinChars`/`applyBudgetTruncation`) — untouched; only consumed read-only during testing to verify the
  fix holds at real maximums.
- **Any live-session wiring** — `show_visual`, `selectTemplate()`, `SessionStack.tsx`'s slide navigation,
  `WalkthroughClient.tsx` — none of this is touched; this phase is renderer-component styling only.
- **Building a dedicated `QuoteCallout` renderer** — still not part of this phase; `GenericTemplate.tsx`
  (its current fallback) gets the 4.A fix like every other affected template, but no bespoke visual design.
- **Deleting the unused `Hierarchy.tsx` dead-code file** — flagged in Section 0 as a real finding, but
  removing dead code is a separate, smaller cleanup not requested by this brief; do not delete it as part of
  this fix without a separate go-ahead (removing code requires explicit approval per this project's standing
  "no delete without approval" rule).
- **A new breakpoint model** — 4.C reuses the existing `md:` convention already used elsewhere in this
  codebase (`ChevronProcess.tsx`); no new breakpoint is introduced.

## 11. Open Questions

None. The one number that might appear to be "Arun's call" — the exact minimum font size — is resolved as a
technical/accessibility-baseline judgment, not a design-taste decision: 14px (`text-sm`) is treated as the
absolute floor for any field the user reads as prose, with 16px (`text-base`) preferred wherever the layout
already has room, consistent with common web-accessibility guidance that treats sub-14px text as a poor
practice for body copy and 16px as the standard comfortable reading size — the same logic used to justify
short UI labels/badges remaining at 12px is that they are not "body copy" a user reads continuously. If Arun
reviews the shipped fix and wants every field at 16px with no exceptions, that is a one-line follow-up, not a
blocked decision today.

## 12. Dependencies

- No new libraries — only Tailwind classes and `<ReactFlow>`'s existing `minZoom` prop (already part of the
  installed `@xyflow/react` package, no version change).
- Depends on the 27 renderer files existing exactly as read during this audit (`components/templates/
  renderers/*.tsx`) and `lib/templates/containerBudgets.ts` (read-only reference for verifying the fix holds
  at real maximums).
- No dependency on RTV-05 (not yet built) or TMPL-01 (deployed, untouched by this phase).
- Developer should re-verify each of the 14 ReactFlow templates' `minZoom`/node-height combination against
  that template's own real `containerBudgets.ts` maximums during implementation (the audit here directly
  measured `ComparisonTable` as the representative example; the same `fitView` mechanism applies identically
  to the other 13, confirmed by source, but each has different fixed node dimensions and should be spot-
  checked individually before merging).

---

## CEO Review

Approved. Section 11 confirmed empty. Independently spot-checked before approval, not taken on the BA's
measurements alone:

- Confirmed all 5 sampled renderers (`ActionPlan`, `CaseStudy`, `ComparisonTable`, `ConceptDefinition`,
  `GenericTemplate`) have `absolute bottom-0 left-0 right-0` on their footer with zero occurrence of
  `relative` anywhere else in the file — the positioning bug is real and exactly as described.
- Confirmed `TemplateApprovalClient.tsx`'s preview card (the `height: 520` div) has no `relative` class.
- Confirmed `SessionStack.tsx` line 181 has `relative h-screen w-full` — the "live sessions already
  unaffected, this is admin-tool-specific" claim holds.
- Confirmed `DefinitionTriptych.tsx`/`NarrativeCard.tsx` both use unconditional `grid-cols-3` with no `md:`
  prefix.
- Confirmed the `Hierarchy.tsx`/`HorizontalTree.tsx` dead-code finding exactly — the `'Hierarchy'` switch
  case does render `HorizontalTree`, `Hierarchy.tsx` is imported but never reached.

The audit methodology (a temporary, non-committed harness rendering the real components with real mock
data and real character-budget maximums, deleted after use, no application code touched to work around
the local Clerk-credential gap) is approved as sound and appropriately scoped — this is exactly the kind
of grounded investigation this project's governance model expects before a multi-file visual fix, not a
shortcut around it.

The four-root-cause structure (absolute-positioning bug, ReactFlow zoom-driven shrinkage, unresponsive
grid, near-universal undersized body text) and the decision to absorb the font-size increase via layout
(node-height increases, `minZoom` floor) rather than touching RTV-04's existing character budgets, are
both approved without reservation — this preserves every other subsystem's assumptions about those budget
numbers while still fixing the actual visual defect.

Developer agent: implement exactly what Section 4 specifies, file by file. This is a Tailwind-class and
minor-JSX-structure fix only — no data-shape change, no API change, no touch to TMPL-01's style-override
mechanism or RTV-04's Layer 1 validation logic. Do not delete `Hierarchy.tsx` as part of this work (a
separate, explicitly-approved cleanup task per this project's no-delete-without-approval rule) — leave it
as dead code, already flagged for a future ticket.
