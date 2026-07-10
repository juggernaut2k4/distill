# Feature Brief: RTV-04 — Visualization Template Library, Selection Algorithm & Human-Approval Workflow
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-09

## Series context
Phase 4 of five. Authoritative requirements:
`docs/brainstorm-realtime-transcript-driven-visualization.md` Section 7. This
brief covers **#9 (template-selection algorithm), #10 (minimal on-screen text),
#11 (template library), #12 (fixed-size containers, max char budget), #13 (min
char floor, uniform typography), #14 (generous margins, no warm-up state), #15
(pre-approved templates only, no live drawing), and the template-shape-only KB
storage of #20.** It does NOT cover live pre-fetch or the display-switch trigger
(RTV-05) — this phase builds the template shapes, the once-per-topic selection,
and the approval workflow; it does not wire them into a live session.

Scope guardrail: Hume-native summary-mode only (#16), consistent with the
series.

## ⚠️ HARD GATE — ARUN'S PERSONAL APPROVAL REQUIRED (do not bypass)
Requirement #15 is a hard gate Arun stated he wants personally: **no
visualization template's actual visual design (colors, layout, sample content)
ships to a real production session without Arun's explicit sign-off.** This is
his own requirement, not caution added by the CEO. Consequences for this spec:
- The BA designs the template library, the selection algorithm, the storage,
  and the approval WORKFLOW — all of that proceeds normally under CEO approval.
- But the **actual visual designs of the templates themselves** (each
  template's real colors/layout with sample content) are gated on Arun. The
  spec must build a workflow in which no template can be marked
  "approved / usable in production" without an explicit human approval action,
  and RTV-05 must refuse to use any template not in the approved state.
- **The CEO will NOT approve the individual template visual designs** — that
  step routes to Arun. The CEO approves the spec (library structure, selection,
  storage, workflow, constraints); Arun approves each rendered template design.
  The BA must design the workflow so these two approvals are cleanly separable.

## What Arun Said
- **#11 template library:** a defined, fixed set of infographic template types
  — tables, overlays, flow charts, heatmaps, etc. Not a "design something new
  each time" system.
- **#15 no live generative drawing:** build the library ahead of time, each
  template WITH sample content, get Arun's explicit approval on each BEFORE it
  is used in production. Once approved, the live system only ever plugs data
  into an already-approved template — no on-the-fly design/layout changes during
  a real session.
- **#9 template selection:** logic that, given a topic and its content, decides
  which template fits best (comparison → table, process → flow chart, landscape
  → heatmap, etc.). Resolved (A4): this decision is made **once, per
  topic/session, at content-authoring time** — never live, never re-decided.
  Two different users on the same saved topic get the same template.
- **#20 / #15 storage:** **only the template SHAPE (empty structure) is saved to
  the knowledge base — never the filled content.** (The filled content is
  generated live every session — that's RTV-05, out of scope here.)
- **#10 minimal on-screen text:** short, crisp text only; detailed explanation
  stays verbal.
- **#12 fixed-size containers + max char budget:** each box/container has a
  defined max character count; containers are fixed size regardless of actual
  content length, so shorter text never distorts shape/spacing.
- **#13 min char floor + uniform typography:** containers also have a minimum
  content length so they never look empty; same font family throughout; uniform
  font sizes.
- **#14 generous margins, no warm-up state:** more margin so content reads
  centered/aligned; because content is prepared ahead of display (RTV-05),
  there is no loading/warm-up visual state — the template appears immediately,
  fully formed.

## The Problem Being Solved
RTV-05 can only "plug fresh content into an approved template" if the templates
exist, are visually approved, and each topic already has a template assigned.
This phase produces exactly that: a governed library of executive-grade
infographic templates and a permanent per-topic template assignment. Without the
approval gate, speculative/AI-designed visuals could reach real senior-executive
users — which Arun has explicitly forbidden (product principle #4: never use
AI-generated content to fill undefined screens; #15: pre-approved templates
only).

## What Success Looks Like
- A defined set of template types (BA proposes the exact initial set grounded in
  the existing template system — see grounding), each implemented as a
  fixed-size, uniform-typography, generous-margin component conforming to this
  project's design system (dark theme, Inter, fixed sizes per `CLAUDE.md`).
- Each template has: defined containers, a max char budget per container, a min
  char floor per container, and sample content demonstrating it fully formed.
- A **selection algorithm** that, at content-authoring time, assigns exactly one
  template per topic and persists that choice (the existing
  `topic_content_cache.template_type` column is the likely home — see grounding).
  Deterministic-enough to be stable and reusable; the BA specifies the exact
  decision logic (content-shape → template mapping) and where it runs.
- **KB stores the template SHAPE only** (which template + its container
  structure/constraints) — never filled content (#20). The BA confirms exactly
  what is persisted vs. generated-live-later.
- An **approval workflow** where each template's rendered visual design (with
  sample content) is presented for Arun's explicit approval, an approved/
  not-approved state is recorded, and only approved templates are eligible for
  production use. RTV-05 will hard-refuse any non-approved template.
- Nothing in this phase is wired into a live session yet — templates and
  assignments exist and are approvable; the live plumbing is RTV-05.
- Toggle/flag posture consistent with the series; building the library and
  assignments must not change any existing screen behavior until RTV-05 wires
  it in.

## Known Constraints (do not expand scope)
- No live pre-fetch, no display-switch trigger, no live-session wiring — that is
  RTV-05. This phase = shapes + selection + storage + approval workflow only.
- No live generative drawing, ever (#15). The live system plugs data into an
  approved shape; it never designs layout at runtime. The spec must make this
  structurally impossible, not merely discouraged.
- Every user-facing template is a real screen → the executive-UX and
  "implement literally, no AI-slop, >= 3-line + example documentation" product
  principles apply in full. Each template must be documented to that standard.
- Conform to the existing design system — this is a new template library, not a
  new design language. Reuse `lib/templates/` conventions where they exist.
- Do not delete or regress the existing template/section rendering used by
  today's `show_visual` path (`DefinitionTriptych` etc.). Additive only.

## Grounding already gathered (do not re-derive — use this)
- `lib/templates/types.ts` and the existing `lib/templates/` directory — there
  is ALREADY a template system (`TemplateSection` discriminated union;
  `DefinitionTriptych` and `SessionOverview`/`SessionSummary` bookends are
  live section types; `session-bookends.ts` builds bookend content). The BA
  MUST read the existing template system in full and extend it, not invent a
  parallel one. Determine which existing section types already satisfy some of
  Arun's template list (e.g. is there already a table/comparison type?) and what
  genuinely new types (flow chart, heatmap, overlay) must be added.
- `topic_content_cache.template_type` (text) ALREADY EXISTS (project
  `nqxlpcshouboplhnuvrh`) and is the per-subtopic template assignment column —
  this is very likely where #9's once-per-topic selection is already partly
  modeled. Confirm how it is populated today and whether the RTV selection
  algorithm extends or replaces that. `section_data` (jsonb) holds the current
  filled content shape.
- `CLAUDE.md` design system: dark theme (`#080808`/`#111111`/`#1A1A1A`,
  borders `#222222`/`#333333`), accents (purple `#7C3AED`, cyan `#06B6D4`,
  amber `#F59E0B`), Inter font, fixed heading sizes. Templates conform to this.
- `@dagrejs/dagre` + `@xyflow/react` are already on the approved library list
  (per `distill/CLAUDE.md`) "used in template system" — likely the intended
  tooling for the flow-chart template. Confirm before relying on it.
- The existing `show_visual` render path in `WalkthroughClient.tsx`
  (`scroll_to` / section rendering via `sections`) shows how a section is
  currently displayed — RTV-05 will reuse this plumbing, so the new templates
  must be renderable through the same `TemplateSection` mechanism.

## Questions for BA
1. **The template set.** Propose the exact initial list of template types,
   grounded in what `lib/templates/` already has vs. what must be added. For
   each: purpose, the content shape it fits (feeding #9), container layout,
   per-container max/min char budgets, typography, margins — to the executive-UX
   documentation standard, with a sample-content example each.
2. **Selection algorithm (#9).** Exact content-shape → template mapping logic,
   where it runs in the authoring pipeline, how the choice is persisted
   (confirm `template_type`), and the guarantee it is decided once and reused,
   never live.
3. **Shape-only storage (#20).** Precisely what is stored in the KB (template id
   + container structure/constraints) vs. what is deliberately NOT stored (any
   filled content). Confirm no filled content is ever persisted.
4. **Approval workflow — the gate.** Design a workflow where each template's
   rendered design + sample content is presented for Arun's explicit approval;
   an approval state is recorded; and only approved templates are production-
   eligible. Make CEO-spec-approval and Arun-design-approval cleanly separable.
   Specify how RTV-05 will query approval state and hard-refuse unapproved
   templates. Specify where the approval state lives.
5. **Fixed-size / min-floor / no-warm-up enforcement (#12/#13/#14).** How
   fixed container sizing, the min char floor, uniform typography, and the
   no-loading-state behavior are enforced in the components — structurally, so a
   short or long payload can never distort the layout.
6. **Design-system conformance (#13).** Confirm exact colors/fonts/sizes against
   `CLAUDE.md` and the existing components.
7. **Additive safety.** Confirm the existing `show_visual` / `DefinitionTriptych`
   rendering is untouched and that building this library changes no live screen
   until RTV-05.

## Process
Write the full 12-section Requirement Document with real wireframes/examples for
EVERY template (this is a heavily UI phase — the ">= 3 lines + example per
screen" standard is mandatory, no stubs). Section 11 must be empty before
returning to CEO. When the spec is CEO-approved, the **individual template
visual designs then route to Arun for his #15 sign-off before RTV-05 may use any
of them** — the CEO will flag this gate explicitly at that point. Suggested id:
`RTV-04-template-library-and-approval`.
