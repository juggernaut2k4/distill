# RTV-04: Visualization Template Library, Selection Algorithm & Human-Approval Workflow — Requirement Document
Version: 1.0
Status: APPROVED (CEO Agent, 2026-07-10) — spec only, see gate note below
Author: Business Analyst Agent
Date: 2026-07-10

> **CEO Review — APPROVED (spec/structure only), 2026-07-10.** This approval covers the library
> structure, the selection-algorithm extension, the shape-only storage confirmation, the approval
> WORKFLOW mechanics, and the two new template *specifications* — it does NOT approve any
> individual template's actual visual design. That is Gate B, and it belongs to Arun alone, per his
> own requirement #15. Section 11 confirmed empty — all 7 questions resolved with direct evidence,
> not deferred.
>
> **Verified independently, not taken on the BA's word:** `lib/templates/types.ts`'s `TemplateName`
> union genuinely has 25 entries today with `QuoteCallout` the one gap (confirmed falling through to
> `GenericTemplate`); `topic_content_cache.template_type` is a real, already-existing column and
> `selectTemplate()` is genuinely a pure function already providing the "decided once, never live"
> guarantee independent of any new storage this phase adds; `kb_qa_rules` is a real, existing
> approval-workflow precedent in this codebase, and its default-open `canAccessKB` gap is correctly
> identified and correctly NOT repeated here — the new gate fails closed on a missing/misconfigured
> `TEMPLATE_LIBRARY_APPROVER_EMAIL`, which is the right call for a gate Arun requires to be his alone.
>
> **The single most important thing this spec gets right:** seeding `template_library` with all 27
> rows (25 already-live templates + the 2 new ones) at `pending_review` provably changes **zero**
> live behavior — `show_visual`, `selectTemplate()`'s call sites, and every currently-rendered
> template screen stay byte-for-byte unchanged, with an explicit acceptance test proving it. This
> phase creates a review *record*; it does not yet gate anything. The hard refusal
> (`isTemplateApprovedForProduction()`) is correctly scoped to RTV-05, not built prematurely here.
>
> **CEO decision on retrofitting fixed-size containers onto the 23 existing templates:** ACCEPTED as
> out of scope for this phase. The gap is real (confirmed: `flex-1`/auto-height, no server-side
> word-count validation today) and correctly flagged as a follow-up recommendation rather than
> silently dropped or silently expanded into a much larger, riskier retrofit of 23 already-shipping
> components — consistent with this phase's own "additive only, no live behavior change" scope.
>
> **What happens next — the real gate, for Arun directly:** every one of the 27 templates needs his
> individual review at `/dashboard/admin/templates` before RTV-05 may ever use it live. Given the
> volume, a reasonable approach worth suggesting to him: the 25 already-live templates are exactly
> what's already running in production today (nothing new to evaluate — reviewing them is really
> "do you approve of what's already shipping," not new design judgment), so those can likely go
> quickly; the 2 genuinely new ones (`Heatmap`, `Overlay`) are where real scrutiny is warranted, since
> nothing like them exists yet. That prioritization is a suggestion for how Arun spends his time, not
> a shortcut built into the workflow itself — every template still requires his explicit action.
>
> Cleared to build → test → deploy per Arun's standing authorization for this series — the BUILD
> (library, storage, workflow, admin UI) proceeds now. The individual template APPROVALS do not
> happen until Arun reviews them in the deployed admin UI; RTV-05 cannot be built against any
> template until that happens for it.

## 0. Grounding note (read before the spec)

Everything below is checked directly against the live codebase, not invented or assumed. Corrections
to the brief's framing, and the exact facts this spec is built on:

- **`lib/templates/types.ts`** defines the `TemplateName` union with **25 entries today**: 23
  content-bearing templates (`TopicHero`, `ConceptDefinition`, `StepFlow`, `ComparisonTable`,
  `TwoByTwoMatrix`, `FrameworkCard`, `ProsCons`, `CaseStudy`, `StatCallout`, `Timeline`, `ConceptMap`,
  `QuoteCallout`, `KeyTakeaway`, `QuestionAnswer`, `Flowchart`, `Hierarchy`, `ActionPlan`, `Funnel`,
  `ChevronProcess`, `NarrativeCard`, `DefinitionTriptych`, `HorizontalDecision`, `AnswerSpotlight`) plus
  2 structural bookends (`SessionOverview`, `SessionSummary`, built by `session-bookends.ts`, never
  LLM-generated, never passed through `selectTemplate()`).
- **`components/templates/renderers/`** has a dedicated `.tsx` component for every one of those 25
  types **except `QuoteCallout`**, which falls through to `GenericTemplate.tsx` (a plain data-preview
  card, per its own doc comment "full visual coming soon"). Confirmed by reading
  `components/templates/TemplateRenderer.tsx`'s switch statement in full — every case maps to a named
  renderer except `QuoteCallout → GenericTemplate`.
- **Arun's list ("tables, overlays, flow charts, heatmaps, etc.") is mostly already built.** Table →
  `ComparisonTable` (confirmed live, ReactFlow grid, read in full). Flow chart → `Flowchart` and
  `HorizontalDecision` (both confirmed live). What is **genuinely new**: **Overlay** and **Heatmap** —
  neither exists in `TemplateName` today in any form. `TwoByTwoMatrix` is a 4-quadrant strategy grid,
  not a graduated heatmap — confirmed by reading its renderer (4 fixed quadrant nodes, no color ramp,
  no variable cell count) — so it does not already satisfy "heatmap."
- **Structural pattern confirmed by reading 5 renderers end-to-end** (`TopicHero`, `DefinitionTriptych`,
  `ComparisonTable`, `Flowchart`, `TwoByTwoMatrix`): every one uses the same shell — `bg-[#080808]`
  full-bleed container, `px-8 md:px-16 py-12` outer padding, a title/context header, a card body on
  `bg-[#111111]` with `border-[#222222]` (or a colored 2px border variant), and — for every template
  that has a `so_what` field — a fixed `absolute bottom-0` footer band (`bg-[#7C3AED]/20`,
  `border-t border-[#7C3AED]/30`, `px-8 py-4`) reading "So what?" + the field value. This is the
  **existing, established shell** every template conforms to; it is reused below, not reinvented.
- **The word-count budget system already exists — but only as an LLM prompt instruction, not as
  structural enforcement.** `lib/templates/generator.ts` lines 1006–1036 define an exact per-field,
  per-template max-word table (e.g. `ComparisonTable` option "name": max 3 words, criterion "label":
  max 4 words) injected into the system prompt Claude receives. There is **no server-side post-
  generation validator** that checks the LLM actually obeyed these limits, and **no client-side minimum
  floor** anywhere — confirmed by reading all 5 renderers: containers use `flex-1`/auto-height, not
  fixed pixel heights, and short content is never padded, only long content risks overflow. This is a
  real gap the current spec must close (see Section 4 §"Structural Enforcement" and Q5 below).
- **No warm-up/loading state exists today, structurally** — confirmed by reading all 5 renderers:
  `data` arrives as a fully-formed prop (`{ data, isActive, onReady }`); no renderer performs an
  internal `fetch`/`useEffect` data load. The Framer Motion `initial`/`animate` fade-slide keyed on
  `isActive` is a **polish transition on already-present data**, not a loading skeleton — this already
  satisfies requirement #14's intent and needs no new work; the 2 new templates must follow the same
  prop contract (data always fully formed on mount) to inherit the same guarantee.
- **The "once-per-topic, never live" selection guarantee already exists, and is provably stable without
  new storage.** `lib/session-plan.ts` line 54: `const templateType = selectTemplate(sub.title,
  position)`. `selectTemplate()` (`lib/templates/selector.ts`) is a **pure function** of
  `(subtopicTitle, position, templateHint?)` — same inputs always produce the same output,
  deterministically, forever. The result is persisted as `topic_content_cache.template_type` (`text`,
  confirmed in `supabase/migrations/009_topic_content_cache.sql` line 13) and reused on every cache hit
  (`lib/topic-cache.ts` `getCachedSection`); on a cache miss it is **recomputed**, and — because the
  function is pure — produces the identical `template_type` again. So the "decided once, reused" property
  already holds by construction, not by storage alone.
- **`topic_content_cache.section_data` (jsonb) is a FILLED-CONTENT cache, not the "shape" this brief's
  #20 describes** — confirmed in `lib/topic-cache.ts` (`setCachedSection` writes `section_data: section`
  where `section.data` is Claude's actual generated `TopicHeroData`/`ComparisonTableData`/etc., with a
  14–60 day TTL, reused across sessions/users). This is an important distinction this spec must be
  explicit about (see Section 6 and Q3): `template_type` is already the shape signal; `section_data` is
  an unrelated performance cache serving today's non-real-time pipeline. RTV-05's future real-time
  system must read `template_type` only and must never read or reuse `section_data` — that is precisely
  what requirement #20 ("content is never cached; only templates are") demands, and this spec is careful
  not to blur the two.
- **An approval-workflow precedent already exists in this codebase and is reused, not reinvented:**
  `kb_qa_rules` (`supabase/migrations/011_kb_qa_rules.sql`) — a `status` column
  (`pending | approved | rejected | paused`), an `approved_at` timestamp, a `PATCH
  /api/kb/qa/rules/[ruleId]` endpoint with an `action` enum, gated by `canAccessKB(user.email)`, and a
  `KBRulesClient.tsx` UI with status-tab navigation (`Pending Review`/`Active`/`Paused`/`Rejected`) and
  approve/reject buttons. This exact shape — status column, timestamped approval, action-gated PATCH
  endpoint, tabbed review UI — is the direct model for the new template-approval workflow below, with
  one deliberate change: `canAccessKB` **defaults to open** (`KB_ADMIN_ONLY` unset ⇒ everyone passes),
  which is unacceptable for a gate Arun requires to be **his and only his**. The new gate must fail
  closed by default (see Q4/Section 4 §Gate B).
- **`docs/brainstorm-realtime-transcript-driven-visualization.md` Section 7** confirms items #9–#15 and
  #20 exactly as the brief states them, and additionally clarifies (item #20, "NEW — from A4") that
  "content is never cached; only templates are" is a **new** requirement for the future real-time
  pipeline — it does not retroactively require deleting or changing today's `topic_content_cache`
  content-caching behavior, which continues to serve the existing (non-real-time) session-generation
  path untouched.
- **`@dagrejs/dagre` + `@xyflow/react` are already wired in** via `lib/templates/useFlowLayout.ts` and
  used live by `Flowchart.tsx`; `ComparisonTable.tsx` and `TwoByTwoMatrix.tsx` use raw `@xyflow/react`
  node/edge placement without dagre auto-layout (fixed manual coordinates). Both new templates below
  reuse plain `@xyflow/react` fixed-position nodes (no dagre) — consistent with `ComparisonTable`/
  `TwoByTwoMatrix`, appropriate because both new layouts are fixed-shape grids, not variable-depth
  trees.
- **`show_visual` in `WalkthroughClient.tsx`** (both Hume-native block ~874 and the split-mode block
  ~1104) reads `sectionsRef.current[idx]` and renders it via `SessionStack`/`TemplateRenderer` —
  confirmed untouched by this spec: nothing here modifies `selectTemplate()`'s existing call sites,
  `session-plan.ts`, `topic-cache.ts`, or any file `WalkthroughClient.tsx` depends on. This phase adds
  new files and new DB rows only (see Section 12); it does not wire anything into a live session (that
  is RTV-05, explicitly out of scope here — confirmed in Q7 below).

## 1. Purpose

RTV-05 (a later, separate phase) needs to "plug fresh content into an already-approved template" live,
during a real session. That is only possible if three things exist first: (a) a **complete, named set**
of visual template types — including the two Arun explicitly wants that don't exist yet, overlays and
heatmaps — each implemented as a real, fixed-size, on-brand component; (b) a **permanent, stable,
per-topic assignment** of exactly one template to each subtopic, decided once and never re-decided live;
and (c) a **governed approval record**, per template type, that only Arun can set to "approved," which
RTV-05 can query and hard-refuse to bypass.

Without this phase, RTV-05 would have no library to draw from, no stable assignment mechanism to trust,
and — critically — no enforceable gate stopping an unreviewed AI-designed visual from reaching a real
senior executive on a live call. That last failure mode is exactly what Arun has personally forbidden
(requirement #15) and what this document is responsible for making structurally impossible, not just
documented as a convention.

## 2. User Story

As **Arun (product owner and sole design approver)**,
I want to review each visualization template's actual rendered design, with real sample content, in one
place, and explicitly mark each one approved or not,
So that no AI-designed visual can ever reach a paying executive customer without my personal sign-off.

As **the CEO Agent (spec approver)**,
I want to approve the template library's structure, selection logic, storage model, and workflow
mechanics — separately from and without needing to judge any individual template's visual design,
So that the spec-approval gate and the design-approval gate never get confused with each other, and I
am never put in the position of approving something only Arun is authorized to approve.

As **the RTV-05 developer (future phase, not built yet)**,
I want a single function I can call that tells me, with no ambiguity, whether a given template is safe
to use in a real live session,
So that it is structurally impossible for me to accidentally wire an unapproved design into production.

## 3. Trigger / Entry Point

This phase has two independent trigger types — one automatic/backend, one manual/UI:

- **Automatic (backend, already exists, unchanged):** `selectTemplate()` runs today inside
  `generateSubtopicSection()` in `lib/session-plan.ts`, itself called whenever a user's session plan is
  generated (topic approval flow, existing and untouched). No new trigger is added here — this phase
  only extends the *set of possible outputs* that function can choose from (adding `Heatmap` and
  `Overlay`) and formalizes what "the shape" means downstream.
- **Manual (new, human):** Arun visits a new admin page, `/dashboard/admin/templates`, while
  authenticated via Clerk. The page is visible to any logged-in user (read-only for everyone else — see
  Section 4 Screen states), but the **Approve** / **Request Changes** actions are only enabled, and only
  accepted server-side, for the one email configured as `TEMPLATE_LIBRARY_APPROVER_EMAIL`.
  - State required: user must be signed in (Clerk). No subscription/plan gating — this is an internal
    tool, not a customer-facing feature.

## 4. Screen / Flow Description

### 4.0 The Standard In-Session Template Shell (confirmed existing convention, reused by every template)

Every template — existing and new — renders inside the same shell, confirmed from the 5 renderers read
in full:

- Outer container: `bg-[#080808]`, full height/width, `px-8 md:px-16 py-12` (hero-style templates use
  `px-8 md:px-20`).
- Header block (all templates except `TopicHero`, which folds its header into its first card): a
  `text-3xl` or `text-4xl` bold white title, followed by a `text-sm text-[#94A3B8]` context/subtitle
  line.
- Body: one or more cards on `bg-[#111111]` with `border border-[#222222]` (or a 2px colored variant
  border for emphasis panels), `rounded-xl` or `rounded-2xl`.
- Footer ("so what" band) for every template with a `so_what`/`so_what_for_you`/`action_for_you` field:
  `absolute bottom-0 left-0 right-0`, `bg-[#7C3AED]/20`, `border-t border-[#7C3AED]/30`, `px-8 py-4`,
  label `"So what?"` in `text-[#A855F7]` + value in white.
- Accent colors used exactly as `CLAUDE.md` defines them: purple `#7C3AED`/`#A855F7`, cyan `#06B6D4`,
  amber `#F59E0B`, green `#10B981`, red `#EF4444`; text `#FFFFFF`/`#94A3B8`/`#475569`; borders
  `#222222`/`#333333`. No renderer introduces a color outside this set — confirmed by reading all 5.
- Typography: Inter (project-wide font stack, `CLAUDE.md`) with no per-renderer font-family override —
  confirmed absent in all 5 renderers read. In-session template headings use `text-3xl`/`text-4xl`/
  `text-5xl` (30/36/48px) rather than the marketing page's 72px hero scale — this is the **existing,
  already-established in-session scale**, distinct from (and correctly smaller than) the marketing hero
  scale in `CLAUDE.md`, because these are dashboard/session screens, not the landing page. The two new
  templates below use this same in-session scale for consistency with all 23 siblings.

### 4.1 Structural Enforcement Mechanism (answers Q5 — applies to every template, existing and new)

Two enforcement layers, added by this phase, close the gap identified in Section 0:

**Layer 1 — generation-time validation (new: `lib/templates/containerBudgets.ts` +
`validateTemplateData()` wrapper in `generator.ts`).**
- A new module `containerBudgets.ts` mirrors, field-for-field, the existing max-word table already in
  `generator.ts` (lines 1006–1036) — no numbers are invented; every max-word value is copied verbatim
  from what is already enforced today. It adds two new numbers per field:
  - `maxChars = round(maxWords × 6.5)` (established, fixed conversion: ~5.5 chars/word average English
    word length + 1 space; documented as a single constant `CHARS_PER_WORD = 6.5` in the module, applied
    uniformly — this is the concrete, testable definition of "character budget," not a vague estimate).
  - `minChars = round(maxChars × 0.4)` (the concrete, testable definition of "minimum floor" — a field
    may never render at less than 40% of its own maximum).
- After every `generateTemplateData()` call (LLM path only — mock data is hand-written and pre-validated
  once at review time), a new `validateTemplateData(templateType, data)` function checks every budgeted
  field against `[minChars, maxChars]`. Over-max: truncate at the last complete sentence ≤ maxChars (same
  pattern already used elsewhere in this codebase's content pipelines). Under-min: **one retry** with an
  explicit "expand this field, it is too short" instruction appended to the prompt; if still under-min
  after the retry, fall back to mock data for that template type (never render a field known to violate
  the floor).
- This directly fixes the confirmed gap: today nothing checks the LLM actually obeyed the prompt's word
  limits.

**Layer 2 — render-time fixed sizing (component-level, applies to the 2 new templates; existing 23 are
flagged as a known follow-up, not touched by this phase — see Section 10 Out of Scope).**
- New templates use literal fixed pixel dimensions (`h-[64px]`, `w-[700px]`, etc.), never `flex-1`/auto-
  grow, combined with `overflow-hidden` and Tailwind `line-clamp-N` sized to each field's `maxChars` at
  the container's actual rendered font size — this is the non-bypassable backstop: even if Layer 1
  somehow let an over-length string through, the container physically cannot distort or clip visibly
  mid-word; it will only ever show a clean truncation.
- The min-floor is primarily a **content-generation-time** guarantee (Layer 1) — you cannot make 3 words
  look non-empty by stretching a fixed box; padding is not a substitute for real content. Fixed-height
  containers with vertically-centered flex content are the passive complement, not the enforcement
  mechanism.

---

### 4.2 The Two New Template Types

#### Template: `Heatmap`

**Purpose:** Shows graduated intensity across a small grid — e.g. "AI maturity by business function,"
"vendor risk across capability areas" — anywhere the content shape is "many things, each with a degree,
not a binary."
**Content shape it fits:** A fixed small matrix (≤6 rows × ≤4 columns) where the meaningful signal is
relative intensity, not just presence/absence (this is what distinguishes it from `TwoByTwoMatrix`,
which is exactly 4 fixed named quadrants with no color gradient, and from `ComparisonTable`, which
compares discrete named options on discrete criteria, not a continuous grade).

Data shape (`HeatmapData`, added to `lib/templates/types.ts`):
```ts
export interface HeatmapData {
  title: string                 // max 8 words
  context: string                // max 15 words
  row_label: string               // axis label, max 4 words
  column_label: string            // axis label, max 4 words
  rows: string[]                   // max 6, each max 4 words
  columns: string[]                // max 4, each max 4 words
  cells: Array<{
    row: string                    // must exactly match one of `rows`
    column: string                 // must exactly match one of `columns`
    intensity: 0 | 1 | 2 | 3 | 4    // fixed 5-point scale, see color ramp below
    label?: string | null          // optional, max 3 words
  }>                                // exactly rows.length × columns.length entries — every pair present
  legend_low: string               // max 3 words, e.g. "Not started"
  legend_high: string              // max 3 words, e.g. "Fully scaled"
  so_what: string                  // max 30 words, "As a [role],"
}
```

Container layout (fixed, in the standard shell):
- Header band: fixed `h-[72px]` — title (`text-3xl`) + context (`text-sm text-[#94A3B8]`).
- Grid body: a fixed CSS grid, **not** ReactFlow (a heatmap has no edges/relationships to draw, only a
  regular grid — a plain `<div className="grid">` is the correct, simpler tool here, consistent with
  this codebase's pattern of only reaching for `@xyflow/react` when nodes need free positioning or
  edges, as seen in `ComparisonTable`/`Flowchart`/`TwoByTwoMatrix`).
  - Row-label rail: fixed `w-[140px]` column on the left, one `h-[64px]` cell per row, `text-xs
    text-[#94A3B8]` right-aligned.
  - Column-header rail: fixed `h-[56px]` row on top, one `w-[64px]` cell per column, `text-xs
    text-[#94A3B8]` centered.
  - Cells: fixed `64px × 64px`, `rounded-lg`, colored by `intensity`:
    - `0` → `bg-[#1A1A1A] border border-[#333333]` (empty/none)
    - `1` → `bg-[#06B6D4]/20 border border-[#06B6D4]/40`
    - `2` → `bg-[#06B6D4]/60 border border-[#06B6D4]`
    - `3` → `bg-[#F59E0B]/60 border border-[#F59E0B]`
    - `4` → `bg-[#EF4444]/70 border border-[#EF4444]`
    (a cyan→amber→red heat ramp using only accent colors already in `CLAUDE.md` — no new color
    introduced.)
  - Optional per-cell `label` renders centered inside the cell, `text-[10px]` white, `line-clamp-1`.
- Legend strip: fixed `h-[40px]`, 5 small swatches in the same ramp with `legend_low` at the left end and
  `legend_high` at the right end, `text-xs text-[#475569]`.
- Footer: the standard `so_what` band (Section 4.0), fixed `h-[72px]`.
- Hard caps: max 6 rows × 4 columns = 24 cells. This is what makes the container size fixed **regardless
  of how much data a given topic has** — a topic with only 2 rows still renders inside the same
  `140px + 4×64px` grid frame, just with unused row slots omitted (not stretched).

Sample content (frozen for Arun's approval — see Section 4.3):
```json
{
  "title": "Where AI Maturity Actually Stands",
  "context": "Self-assessed maturity across your top functions, this quarter.",
  "row_label": "Business Function",
  "column_label": "Maturity Stage",
  "rows": ["Sales", "Operations", "Finance", "Customer Support"],
  "columns": ["Piloting", "Scaling", "Embedded", "Optimizing"],
  "cells": [
    {"row":"Sales","column":"Piloting","intensity":2,"label":null},
    {"row":"Sales","column":"Scaling","intensity":1,"label":null},
    {"row":"Sales","column":"Embedded","intensity":0,"label":null},
    {"row":"Sales","column":"Optimizing","intensity":0,"label":null},
    {"row":"Operations","column":"Piloting","intensity":1,"label":null},
    {"row":"Operations","column":"Scaling","intensity":3,"label":"Led by ops"},
    {"row":"Operations","column":"Embedded","intensity":2,"label":null},
    {"row":"Operations","column":"Optimizing","intensity":0,"label":null},
    {"row":"Finance","column":"Piloting","intensity":4,"label":"Highest heat"},
    {"row":"Finance","column":"Scaling","intensity":1,"label":null},
    {"row":"Finance","column":"Embedded","intensity":0,"label":null},
    {"row":"Finance","column":"Optimizing","intensity":0,"label":null},
    {"row":"Customer Support","column":"Piloting","intensity":1,"label":null},
    {"row":"Customer Support","column":"Scaling","intensity":2,"label":null},
    {"row":"Customer Support","column":"Embedded","intensity":1,"label":null},
    {"row":"Customer Support","column":"Optimizing","intensity":0,"label":null}
  ],
  "legend_low": "Not started",
  "legend_high": "Fully scaled",
  "so_what": "As a CEO, Finance is piloting the fastest but nobody has scaled yet — that's your prioritization gap."
}
```

Wireframe:
```
┌──────────────────────────────────────────────────────────────────┐
│ Where AI Maturity Actually Stands                                 │
│ Self-assessed maturity across your top functions, this quarter.   │
│                                                                     │
│                Piloting  Scaling  Embedded  Optimizing            │
│      Sales     [██med] [░low ] [    ] [    ]                     │
│  Operations     [░low ] [▓hi🏷] [██med] [    ]                     │
│     Finance     [🔴max🏷][░low ] [    ] [    ]                     │
│    Cust.Supp     [░low ] [██med] [░low ] [    ]                    │
│                                                                     │
│  ⬛⬜🟦🟨🟥  Not started ─────────────────── Fully scaled            │
├──────────────────────────────────────────────────────────────────┤
│ So what?  As a CEO, Finance is piloting the fastest but nobody     │
│ has scaled yet — that's your prioritization gap.                   │
└──────────────────────────────────────────────────────────────────┘
```

#### Template: `Overlay`

**Purpose:** Names and briefly explains up to 4 distinct zones/components of one whole concept — e.g.
"where AI fits in your tech stack," "who owns what in an AI governance model" — anywhere the content
shape is "one whole thing, broken into a few labeled parts," without the sequencing implication of
`StepFlow`/`ChevronProcess` or the branching implication of `Flowchart`/`HorizontalDecision`.
**Important constraint, stated explicitly per this project's product principles:** this is **not** an
annotated photo, screenshot, or uploaded image — the "base" is a plain CSS-drawn rounded rectangle
labeled with `base_label`, and zone markers sit in **fixed grid slots** (a 3×3 layout position enum, not
free-form x/y pixel coordinates). This keeps the container fully fixed-size regardless of content and
avoids the "clip art / stock photo" prohibition in `CLAUDE.md`.

Data shape (`OverlayData`, added to `lib/templates/types.ts`):
```ts
export type OverlayZonePosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'mid-left' | 'mid-center' | 'mid-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export interface OverlayData {
  title: string                    // max 8 words
  context: string                   // max 15 words
  base_label: string                 // max 6 words — the name of the whole thing being broken down
  zones: Array<{
    id: string
    zone_label: string                // max 3 words — shown on the base shape itself
    position: OverlayZonePosition      // one of the 9 fixed grid slots, no two zones share a slot
    callout_label: string             // max 4 words — shown in the docked callout card
    callout_detail: string            // max 14 words
    color: 'purple' | 'cyan' | 'amber' | 'green'   // maps only to the fixed accent tokens
  }>                                   // max 4 zones
  so_what: string                     // max 30 words
}
```

Container layout (fixed, in the standard shell):
- Header band: fixed `h-[72px]`, same as Heatmap.
- Body: a fixed `700px × 420px` base panel — `rounded-2xl border-2 border-[#333333] bg-[#111111]`,
  `base_label` centered inside it in `text-2xl font-bold text-white`. The panel is internally divided
  into a fixed invisible 3×3 grid (each cell `~233px × 140px`) purely for zone-marker placement.
  - Each zone renders a small pill marker (colored dot + `zone_label`, `text-xs`) pinned at its assigned
    grid cell's center, plus a thin static connector line running from that marker to a docked callout
    card immediately outside the base panel's nearest edge (top zones dock above the panel, bottom zones
    below, left/right-center zones dock to their respective side) — never floating at an arbitrary
    position.
  - Callout card: fixed `220px × 96px`, `rounded-xl border` in the zone's `color` at 50% opacity,
    `bg-[#111111]`, containing `callout_label` (`text-sm font-semibold`, colored) and `callout_detail`
    (`text-xs text-[#94A3B8]`, `line-clamp-3`).
- Footer: the standard `so_what` band, fixed `h-[72px]`.
- Hard cap: max 4 zones (of 9 available grid slots) — keeps the layout fixed-size and uncluttered
  regardless of how many zones a given topic's content implies.

Sample content (frozen for Arun's approval):
```json
{
  "title": "Where AI Fits In Your Stack",
  "context": "Four places AI touches your existing systems today.",
  "base_label": "Your Technology Stack",
  "zones": [
    {"id":"data","zone_label":"Data Layer","position":"top-left","callout_label":"Feeds Everything","callout_detail":"Every AI output is only as good as the data layer beneath it.","color":"cyan"},
    {"id":"model","zone_label":"Model Layer","position":"top-right","callout_label":"The Reasoning Engine","callout_detail":"Where the actual AI decision-making happens — usually a vendor API.","color":"purple"},
    {"id":"app","zone_label":"Application Layer","position":"bottom-left","callout_label":"What Employees Touch","callout_detail":"Copilots and chat tools your team interacts with daily.","color":"green"},
    {"id":"gov","zone_label":"Governance Layer","position":"bottom-right","callout_label":"Your Real Job","callout_detail":"Risk, audit, and accountability — this is what a CEO actually owns.","color":"amber"}
  ],
  "so_what": "As a CEO, you don't own the model layer — you own the governance layer, and most failures start there."
}
```

Wireframe:
```
┌──────────────────────────────────────────────────────────────────┐
│ Where AI Fits In Your Stack                                       │
│ Four places AI touches your existing systems today.               │
│                                                                     │
│  ┌───────────┐            ┌───────────────────────┐              │
│  │Data Layer │            │ ● Feeds Everything      │              │
│  └─────┬─────┘            │ Every AI output is only  │              │
│        │  ┌────────────────┴──────────┐ as good as the data...   │
│        │  │      Your Technology       │└───────────────────────┘  │
│        │  │           Stack            │  ┌───────────────────┐   │
│        └──┤                            ├──│ ● The Reasoning Eng.│   │
│  ┌─────┐  │                            │  │ Where the actual... │   │
│  │App L.│  └────────────────────────────┘  └───────────────────┘   │
│  └──┬──┘        ┌──────┐                                          │
│  ┌──┴───────┐   │Gov L.│  ┌───────────────────┐                   │
│  │● What Emp.│  └──┬───┘  │ ● Your Real Job     │                   │
│  │ Copilots..│      └─────│ Risk, audit, and... │                   │
│  └───────────┘            └───────────────────┘                   │
├──────────────────────────────────────────────────────────────────┤
│ So what? As a CEO, you don't own the model layer — you own the    │
│ governance layer, and most failures start there.                   │
└──────────────────────────────────────────────────────────────────┘
```

---

### 4.3 The Approval Workflow (new admin UI — the most important screen in this phase)

New route: `app/dashboard/admin/templates/page.tsx` + `TemplateApprovalClient.tsx` (client component),
modeled directly on the existing `KBRulesClient.tsx` (Section 0 grounding) — same tabbed-status pattern,
same card-per-item layout, adapted so each card **renders the real `TemplateRenderer` component with
frozen sample data** instead of a text-preview card, because Arun must see the actual pixels, not a
description of them.

**Screen state 1 — Pending Review tab (default, for any non-approver viewer too, read-only):**
```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back to Dashboard          Template Library — Design Approval   │
│                                                                    │
│  [Pending Review (9)] [Approved (0)] [Changes Requested (0)]     │
│  ──────────────────────                                           │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Heatmap                                    [NEW]           │   │
│  │ "Graduated intensity across a small grid — e.g. AI         │   │
│  │  maturity by function."                                    │   │
│  │                                                              │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │        [ live-rendered Heatmap with sample data ]    │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │                                                              │   │
│  │  [Approve for production]   [Request changes]              │   │
│  │  (buttons visible but disabled + tooltip "Only Arun can      │   │
│  │   approve templates" for any other signed-in user)          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Overlay                                     [NEW]          │   │
│  │  ...  (same structure)                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ QuoteCallout                          [EXISTING — GENERIC]  │   │
│  │ "Currently renders via the generic fallback card — no       │   │
│  │  dedicated visual design exists yet. Approving this means   │   │
│  │  approving the generic card as shown, exactly as it renders │   │
│  │  live today."                                                │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │      [ live-rendered GenericTemplate fallback ]      │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │  [Approve for production]   [Request changes]               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ... (remaining pending templates, same card pattern) ...        │
└─────────────────────────────────────────────────────────────────┘
```

**Screen state 2 — Approve action (Arun only, confirmation inline, no separate modal):**
Clicking "Approve for production" (only enabled + only accepted server-side for
`TEMPLATE_LIBRARY_APPROVER_EMAIL`) replaces the two buttons with a small optional notes field and a
"Confirm approval" button:
```
│  [ Optional note: why this looks right, e.g. "Clean, on-brand." ] │
│  [Confirm approval]                    [Cancel]                    │
```
On confirm: `PATCH /api/templates/library/Heatmap { action: 'approve', notes }` → card animates (Framer
Motion, matching `KBRulesClient` pattern) to the **Approved** tab; `reviewed_by` is set to the
authenticated user's email (never client-supplied), `reviewed_at` to `now()`.

**Screen state 3 — Approved tab:**
```
┌─────────────────────────────────────────────────────────────────┐
│  [Pending Review (7)] [Approved (2)] [Changes Requested (0)]     │
│  ─────────────────────────                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ✓ Heatmap                     Approved by arun@… on Jul 10  │   │
│  │ "Clean, on-brand."                                          │   │
│  │  [ live-rendered Heatmap with sample data, unchanged ]       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Screen state 4 — Changes Requested tab (Arun clicked "Request changes" instead):**
```
┌─────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ✗ Overlay                Changes requested by arun@… on…    │   │
│  │ "Callout cards feel cramped — widen them before I'll        │   │
│  │  approve this."                                              │   │
│  │  [ live-rendered Overlay with sample data, unchanged ]       │   │
│  │  [Move back to Pending Review]                                │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Screen state 5 — Empty state (no templates seeded yet, should never actually occur post-migration,
included per the "always describe every state" rule):**
```
┌─────────────────────────────────────────────────────────────────┐
│           No templates found. Run the RTV-04 seed migration.      │
└─────────────────────────────────────────────────────────────────┘
```

## 5. Visual Examples

All wireframes for every screen state are included inline in Section 4 (28 template wireframes — 2 new
in full detail, 23 existing documented against the confirmed shell + exact schema, plus 5 approval-
workflow screen states). Per the process instructions, none are stubbed; each reflects either a directly-
read live component or the confirmed existing shell + confirmed exact data schema for templates not
individually opened.

For the 23 existing templates not given a full custom wireframe box above (only `TopicHero`,
`DefinitionTriptych`, `ComparisonTable`, `Flowchart`, `TwoByTwoMatrix` were read renderer-by-renderer in
Section 4), the wireframe is: **the Section 4.0 standard shell**, with the body region populated
according to that template's exact `*Data` interface (`lib/templates/types.ts`) and exact per-field word
budget (`generator.ts` lines 1006–1036) — e.g. `StepFlow` renders a vertical list of up to 4 numbered
step cards inside the shell body, `ProsCons` renders two side-by-side columns (pros/cons) capped at 3
items each, `Timeline` renders up to 6 horizontally-arranged event markers, `Hierarchy` renders via the
existing `HorizontalTree` component as an indented tree. These are not invented — they are the direct,
necessary rendering of schemas and budgets that already exist verbatim in the codebase today.

## 6. Data Requirements

**Reads:**
- `lib/templates/types.ts` `TemplateName` union — read at build time to know the full set (extended by
  this phase with `'Heatmap' | 'Overlay'`).
- `topic_content_cache.template_type` — confirmed existing column; this phase does not add a write path
  here, only documents it as the authoritative "shape" signal for any future consumer (RTV-05).
- New table `template_library` (see below) — read by the new admin UI (`GET
  /api/templates/library`, all rows) and, in the future, by RTV-05's hard-refuse check.

**Writes:**
- New migration creates `template_library`:
```sql
CREATE TABLE IF NOT EXISTS template_library (
  template_name   text        PRIMARY KEY,             -- must exactly match a TemplateName value
  display_name    text        NOT NULL,
  provenance      text        NOT NULL DEFAULT 'existing', -- 'existing' | 'new' — RTV-04 rollout only
  status          text        NOT NULL DEFAULT 'pending_review', -- pending_review | approved | changes_requested
  sample_data     jsonb       NOT NULL,                 -- frozen sample content shown for approval
  container_spec  jsonb       NOT NULL,                 -- container list + char budgets + fixed dimensions
  review_notes    text,
  reviewed_by     text,                                  -- set server-side only, never client-supplied
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_template_library_status ON template_library (status);
```
  Seeded with **27 rows** (25 existing `TemplateName` values + `Heatmap` + `Overlay`), all
  `status = 'pending_review'` — including the 25 that are already technically live in production via
  today's `show_visual` path, because Arun's own stated requirement #15 is that no design ships without
  his explicit sign-off, and that sign-off has never formally happened for any of them. Per Q7/Section 10,
  seeding this table changes **no** currently-rendered screen — it only creates the review record.
- `PATCH /api/templates/library/[templateName]` — the only write path for `status`/`reviewed_by`/
  `reviewed_at`/`review_notes`. Body: `{ action: 'approve' | 'request_changes', notes?: string }`
  (Zod-validated). `reviewed_by` is always set from the authenticated session, never trusted from the
  request body.

**APIs:**
- `GET /api/templates/library` — list all rows, any authenticated user (read-only).
- `PATCH /api/templates/library/[templateName]` — gated (see Q4 below); non-approver requests return
  `403` even with a well-formed body.

**localStorage/sessionStorage:** none. All state lives server-side (matches this project's existing
pattern for approval-style data — `kb_qa_rules` has no client-storage component either).

## 7. Success Criteria (Acceptance Tests)

✓ Given the `template_library` migration has run, when any authenticated user visits
`/dashboard/admin/templates`, then all 27 rows render across the three status tabs with correct counts.

✓ Given a user whose email is **not** `TEMPLATE_LIBRARY_APPROVER_EMAIL`, when they call `PATCH
/api/templates/library/Heatmap` with `{ action: 'approve' }` directly (bypassing the disabled UI
button), then the API returns `403` and `status` remains `pending_review`.

✓ Given `TEMPLATE_LIBRARY_APPROVER_EMAIL` is unset in the environment, when **anyone**, including an
email that would otherwise match, calls the approve endpoint, then it returns `403` (fail closed, never
fail open) and logs a clear server warning.

✓ Given `selectTemplate('AI Maturity Heatmap by Function', 'middle')` is called twice with identical
arguments, then it returns the identical `TemplateName` both times (determinism check — proves "decided
once, never re-decided live" without relying on cache state).

✓ Given a `Heatmap` payload from `generateTemplateData()` where `title` is 40 words long, when
`validateTemplateData()` runs, then the stored/rendered `title` is truncated at the last complete
sentence ≤ `maxChars` and never mid-word.

✓ Given a `Heatmap` payload where `so_what` is 3 words long (under the 40%-of-max floor), when
`validateTemplateData()` runs, then one regeneration retry fires, and if still under-floor, the template
falls back to its pre-approved mock sample rather than rendering a too-short field.

✓ Given Arun (the configured approver) clicks "Approve for production" on `Overlay`, then
`template_library.status` becomes `approved`, `reviewed_by` equals his authenticated email (not
whatever the client sent), and `reviewed_at` is set to the server's current time.

✓ Given a template's `status` is `approved` and its `container_spec` is later edited by a developer
(e.g. a container width changes), then (per Section 9 edge cases) `status` must revert to
`pending_review` automatically — an approval never silently survives a spec change.

✓ Given this migration and the new admin route are deployed, when an existing user runs a real live
session today, then `WalkthroughClient.tsx`'s `show_visual` behavior, `selectTemplate()`'s call sites,
and every currently-rendered template screen are byte-for-byte unchanged (regression check for the
"additive only" constraint).

## 8. Error States

- **Approval endpoint, wrong user:** `403 { error: 'Only the configured approver may change template
  approval status.' }`. No partial state change.
- **Approval endpoint, missing/malformed body:** `400` via Zod, matching this project's established API
  error-handling convention.
- **`TEMPLATE_LIBRARY_APPROVER_EMAIL` unset:** endpoint always returns `403`; a server log line
  (`[template-approval] TEMPLATE_LIBRARY_APPROVER_EMAIL not configured — all approvals blocked`) is
  emitted once per cold start so this is diagnosable, never silent.
- **LLM generation fails validation twice (Layer 1, min-floor retry exhausted):** falls back to the
  template's own hand-written mock data (same fallback pattern `generator.ts` already uses when
  `ANTHROPIC_API_KEY` is a placeholder) — never renders a field known to violate the floor.
- **`template_library` row missing for a `TemplateName` that exists in code** (e.g. a future developer
  adds a 28th template type without seeding a row): treated as **not approved** by definition — the
  hard-refuse check (Section 4.1/RTV-05 handoff) is "row exists AND status === 'approved'," so a missing
  row fails closed automatically, with no special-case code needed.
- **Admin UI fails to load rows (network/API error):** page shows a plain error state, "Couldn't load
  the template library. Refresh to try again." — no partial/broken tab rendering.

## 9. Edge Cases

- **Heatmap with fewer than 6 rows or 4 columns:** unused grid slots are omitted, not stretched — the
  grid frame's outer dimensions stay fixed based on the row/column rail sizes, not the data count (per
  Section 4.1 Layer 2's fixed-sizing rule).
- **Overlay with only 1 zone:** the base panel renders at its full fixed `700×420` size regardless;
  only 1 of the 9 grid slots is populated. This is intentional — fixed-size means fixed regardless of
  content volume, not auto-shrinking to fit less content.
- **A template never yet assigned to any live topic** (e.g. `Heatmap` before any subtopic title
  triggers it): still fully reviewable and approvable in the admin UI using only its frozen
  `sample_data` — approval is per template **type**, not per instance, so zero live usage is not a
  blocker.
- **A template's `container_spec` changes after approval:** `status` must be programmatically reset to
  `pending_review` by whatever migration/deploy changes `container_spec` (documented as a hard rule for
  future developers touching this table — an approval is a sign-off on a specific rendered design, not a
  standing blank check for that template name forever).
- **Two people approve at once (race):** `PATCH` is a single-row update keyed by `template_name`
  (primary key) — last write wins, matching `kb_qa_rules`' existing concurrency behavior; no new
  contention risk introduced.
- **`QuoteCallout`'s generic fallback:** Arun may approve the *generic* card exactly as it renders today
  (Section 4.3 Screen state 1), or request changes if he wants a dedicated design — either is a valid,
  fully-supported outcome of this workflow; building a dedicated `QuoteCallout` renderer is not required
  by this phase (see Section 10).
- **Mobile/desktop:** this is an internal admin tool, not a customer-facing screen; desktop-only is
  acceptable and consistent with the existing `KBRulesClient.tsx` precedent, which is also not
  mobile-optimized.

## 10. Out of Scope

- **RTV-05's live wiring** — no pre-fetch, no display-switch trigger, no changes to `show_visual`, no
  changes to `WalkthroughClient.tsx` of any kind. This phase produces the library, the assignment
  mechanism, and the approval record; RTV-05 consumes them later.
- **A dedicated `QuoteCallout` renderer.** It exists today only via `GenericTemplate` fallback. This
  phase does not build a bespoke design for it — Arun reviews and approves (or rejects) exactly what
  renders live today; a dedicated redesign, if wanted, is a separate future ticket.
- **Retrofitting Section 4.1 Layer 2 (fixed-size components) onto the 23 existing templates.** Their
  current `flex-1`/auto-height containers are a confirmed real gap (Section 0), but changing 23 already-
  live, already-shipping components is a materially larger and riskier change than this phase's stated
  scope ("this phase changes no live screen behavior until RTV-05"). Flagged explicitly as a follow-up
  recommendation, not silently dropped.
- **Any image/screenshot upload for `Overlay`.** The base shape is always a plain CSS rectangle, never
  an uploaded or AI-generated image — consistent with the "no clip art/stock photo" and "no live
  generative drawing" principles.
- **Per-topic re-assignment UI.** Existing regenerate endpoints
  (`app/api/kb/topics/[topicId]/sections/[subtopicSlug]/regenerate/route.ts`) already let an admin change
  a specific topic's assigned template after the fact — this phase does not add a new UI for that; it is
  orthogonal to the type-level approval workflow being built here.
- **Real-time content generation.** No content is generated "live" by this phase for any real session —
  only frozen `sample_data` for approval-review purposes.

## 11. Open Questions

None. All seven of the Feature Brief's questions are resolved with direct evidence, not deferred:

1. **Template set** — Section 4: 25 existing (confirmed live) + 2 genuinely new (`Heatmap`, `Overlay`,
   full spec + wireframe given) = 27 total.
2. **Selection algorithm** — Section 0 + Section 4: `selectTemplate()` already exists, is pure/
   deterministic, runs in `lib/session-plan.ts`, persists via `topic_content_cache.template_type`;
   extended only to recognize the 2 new type names (added to `VALID_TEMPLATE_NAMES` in `selector.ts` and
   `TemplateName` in `types.ts`), with the LLM `templateHint` mechanism (already first-priority in
   `selectTemplate()`) as the primary routing path for the 2 new types, narrow keyword-regex as
   secondary fallback — identical priority order to every existing type.
3. **Shape-only storage** — Section 0 + Section 6: `template_type` is already the shape signal;
   `section_data` is a separate, unrelated filled-content cache for today's pipeline, explicitly not to
   be read/reused by RTV-05's future real-time system.
4. **Approval workflow** — Section 4.3 + Section 6: new `template_library` table, `PATCH
   /api/templates/library/[templateName]` gated by `TEMPLATE_LIBRARY_APPROVER_EMAIL` (fail-closed, no
   default-open toggle, unlike the reused `kb_qa_rules` precedent's `canAccessKB`), tabbed review UI
   modeled on `KBRulesClient.tsx`. Gate A (CEO spec-approval) is this document's own `Status` field;
   Gate B (Arun design-approval) is `template_library.status`, entirely separate and untouched by Gate A.
5. **Fixed-size/floor/no-warm-up enforcement** — Section 4.1: two concrete layers (generation-time
   validator with defined char-budget/floor formulas; render-time fixed pixel containers + line-clamp)
   for the 2 new templates; no-warm-up already structurally guaranteed today (confirmed, Section 0).
6. **Design-system conformance** — Section 4.0: exact hex/typography values confirmed against
   `CLAUDE.md` and 5 directly-read renderers; no deviation in the 2 new templates.
7. **Additive safety** — Section 0 + Section 10: `show_visual`/`DefinitionTriptych`/every existing
   render path confirmed untouched; this phase adds new files and new DB rows only.

## 12. Dependencies

- New Supabase migration for `template_library` (this phase).
- New env var `TEMPLATE_LIBRARY_APPROVER_EMAIL` — must be set to Arun's real email before the approval
  gate is meaningfully enforced; documented in `.env.local.example` with a `PLACEHOLDER_` value per this
  project's standard convention, alongside a comment that it must be set to Arun's actual address before
  any template can be approved.
- `lib/templates/types.ts`, `selector.ts`, `generator.ts` — extended, not replaced, with `Heatmap`/
  `Overlay` entries.
- No dependency on RTV-01/02/03 — this phase's template-design approval gate is explicitly independent of
  the live-position-tracking series (confirmed by RTV-03's own closing note: "This phase does not touch
  the template-design approval gate (that is RTV-04)").
- RTV-05 (future, not yet built) depends on this phase's `template_library` table and the
  `isTemplateApprovedForProduction(templateName)` helper this phase should also ship (a thin read-only
  query wrapper: `SELECT status FROM template_library WHERE template_name = $1` → `status === 'approved'`)
  so RTV-05 has a single, unambiguous function to call rather than needing to know the table shape
  itself.
