# TMPL-07 — Per-Template Title/Subtitle Review Toggle — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-12

> **Grounding note (read before the spec).** Every claim below was verified by directly reading the
> current source, not inferred. Files read in full: all 7 renderers (`NarrativeCard.tsx`,
> `ActionPlan.tsx`, `GenericTemplate.tsx`, `ConceptMap.tsx`, `AnswerSpotlight.tsx`, `FrameworkCard.tsx`,
> `StatCallout.tsx`), `TwoByTwoMatrix.tsx` (the working title+context-above-canvas precedent copied
> from), `lib/templates/types.ts` (confirmed `TemplateMeta.subtopicTitle` exists on every
> `TemplateSection` variant), `components/templates/TemplateRenderer.tsx` (confirmed `GenericTemplate`
> is wired to exactly one live case today — `'QuoteCallout'` — and confirmed it already forwards an
> optional `styleOverrides` prop to exactly 2 of 27 cases, the precedent this doc's `headerEnabled`/
> `meta` prop-threading follows), `app/dashboard/admin/templates/TemplateApprovalClient.tsx` (full
> card structure, `patchTemplate`/`reopenForReview`/`resetToPending` wiring), `supabase/migrations/
> 065_rtv04_template_library.sql` and `067_tmpl01_automated_fix_loop.sql` (current schema),
> `app/api/templates/library/[templateName]/route.ts` (the only write path, its action-per-intent
> pattern), `app/api/templates/library/route.ts` (GET/`viewerIsApprover`), `lib/templates/
> styleOverrideSlots.ts` and `lib/templates/approval.ts` (confirmed `isFixLoopTemplate` scopes
> Heatmap/Overlay only — this feature does not extend that allowlist), `lib/templates/
> containerBudgets.ts` (confirmed none of the 7 templates have `FIXED_CONTAINER_DIMENSIONS`, so no
> pixel-canvas budget exists to touch), `scripts/seed-template-library.ts` (confirmed `template_name`
> for the `GenericTemplate.tsx` renderer is the row `QuoteCallout`, not `GenericTemplate` — there is no
> `TemplateName` value called `GenericTemplate`), and `lib/templates/generator.ts` (grepped to confirm
> every field proposed below as a subtitle source — `industry`, `central_concept`, `framework_name`,
> `coined_by`, `attribution`, `context` — is a real, already-LLM-generated field today, not a
> fabrication). Also read TMPL-02 (container-overflow fix), TMPL-05 (Overlay canvas sizing, the
> box-model-arithmetic-vs-empirical-render precedent this doc follows), and TMPL-06 (title font
> standard: `text-3xl font-bold` title / `text-sm` subtitle) for established conventions this document
> reuses rather than invents.
>
> **Naming clarification, confirmed against the seed script.** The Feature Brief refers to
> `GenericTemplate.tsx` as one of the "7 templates." There is no `template_library` row or
> `TemplateName` value called `GenericTemplate` — `GenericTemplate.tsx` is a shared fallback renderer
> currently wired to exactly one case in `TemplateRenderer.tsx` (line 87-88): `case 'QuoteCallout':
> return <GenericTemplate section={section} .../>`. Everywhere this document says "the `QuoteCallout`
> template," it means the template whose renderer file is `GenericTemplate.tsx`.
>
> **Canvas-adjustment methodology used, per the brief's explicit instruction to choose per template.**
> All 7 templates' canvas-adjustment questions are resolved by box-model arithmetic from the real
> source (TMPL-05's approach), not empirical rendering (TMPL-02's approach), because in every one of the
> 7 cases the container that needs to make room for a header is a CSS `flex-1` region inside an
> already-`flex flex-col` parent — the exact same structural pattern `TwoByTwoMatrix.tsx` already uses
> successfully in production for its own title+context-above-canvas layout (confirmed by direct read,
> lines 74-84). Because `flex-1` regions consume "whatever height is left over" by construction, adding
> a fixed-height sibling above them (a title/subtitle block) is a deterministic, already-proven-safe
> layout change, not something that requires a browser to observe. No empirical-rendering build task is
> proposed for any of the 7 templates.

## 1. Purpose
7 of Clio's 27 visualization templates currently render with a title and/or subtitle structurally
absent — not a font-size mismatch (that's TMPL-06's scope, limited to `DefinitionTriptych`), a genuine
missing header row. Arun's explicit decision (Feature Brief) is not to force a title/subtitle onto these
7 templates automatically, because for some of them (e.g. `FrameworkCard`, `StatCallout`) the natural
candidate title/subtitle content is already shown once, inside the ReactFlow canvas itself — adding a
second, page-level header row risks looking redundant rather than helpful, and only Arun, looking at the
real rendered result, can judge that per template. This feature gives him that per-template on/off
control inside the existing admin Template Library review tool
(`/dashboard/admin/templates`), reusing the same approval/audit machinery every other reviewer action in
that tool already uses (`isConfiguredApprover`, the `pending_review`/`approved`/`changes_requested`
status machine, `template_fix_log` audit trail).

Without this feature: these 7 templates stay permanently without a header (or, for the 4 that already
have a title, permanently without a subtitle), with no mechanism for Arun to ever try the alternative and
compare — the only way to change this today would be a code change with no review/approval step, which
this project's entire governance model (CEO → BA → Developer → Arun approval) exists to prevent for any
user-facing screen change.

## 2. User Story
As Arun, the configured template-library approver, reviewing one of the 7 flagged templates at
`/dashboard/admin/templates`,
I want to turn that specific template's title/subtitle header on or off and immediately see the rendered
result,
So that I can decide, per template, whether adding a header improves or clutters that template's design —
without needing a code change or a developer round-trip to try it.

As Arun, having just flipped a header toggle on an already-`approved` template,
I want that action to move the template back into `pending_review` automatically,
So that a title/subtitle change never silently reaches "production-ready" status without my explicit
re-approval, matching the standing rule that no template change ships un-reviewed.

(Single user/persona — `isConfiguredApprover()` gates every mutating action in this tool already; no
other user type interacts with this control. Any other authenticated user can view the toggle's current
state but the control is disabled for them, matching how Approve/Request Changes already behave for
non-approvers.)

## 3. Trigger / Entry Point
- **Route**: `/dashboard/admin/templates` (existing RTV-04 route, `TemplateApprovalClient.tsx`). No new
  route.
- **Action**: clicking a new button, rendered below each of the 7 flagged templates' cards (in every
  status tab — Pending Review, Approved, Changes Requested — since the live-rendered preview already
  shows on every card in all 3 tabs today, confirmed at `TemplateApprovalClient.tsx` lines 321-328,
  unconditional on `row.status`).
- **State required**: user must be authenticated (`requireSessionAuth`, existing). The control is
  visible to any authenticated user but disabled unless `viewerIsApprover` is true (identical gating to
  the existing Approve/Request Changes/Reopen buttons, same `title="Only the configured approver can..."`
  tooltip convention).
- **Scope of the control**: only rendered for the 7 template_library rows whose `template_name` is one
  of `NarrativeCard`, `ActionPlan`, `QuoteCallout`, `ConceptMap`, `AnswerSpotlight`, `FrameworkCard`,
  `StatCallout`. The other 20 rows (17 already-complete + `DefinitionTriptych` (TMPL-06) + `Heatmap` +
  `Overlay`) never render this control.

## 4. Screen / Flow Description

### 4.1 The admin review card — new control
Below the existing per-card content in `TemplateApprovalClient.tsx` (live preview → action
buttons/confirmation UI → "View fix progress" link, in that order today), for exactly the 7 flagged
`template_name` values, a new block is appended at the bottom of the card:

- A small label showing current state: **"Title/subtitle header: Off"** or **"Title/subtitle header:
  On"**, with a colored dot (green when On, muted gray when Off) — matching the existing status-dot
  convention already used for the fix-state indicator (`fixDisplay.color`, line 263-268).
- A single button whose label reflects the action it performs, matching this codebase's existing
  convention (e.g. the Approve button says "Approve for production," not just "Approve"):
  - When `header_enabled` is currently `false`: button reads **"Show title/subtitle"**.
  - When `header_enabled` is currently `true`: button reads **"Hide title/subtitle"**.
- Single click, no confirmation dialog, no notes field — matching TMPL-03's `reopen_for_review`/
  `resetToPending` precedent exactly ("single-click action, no confirmation dialog, no notes field").
- Disabled (with the same `title="Only the configured approver can change template approval status."`
  tooltip) when `!viewerIsApprover`, and disabled with a loading spinner mid-request using the existing
  `actioning[row.template_name]` state — identical mechanics to every other action button in this file.
- Clicking it calls `patchTemplate(templateName, { action: 'toggle_header', headerEnabled: !row.header_enabled })`
  (reusing the existing `patchTemplate` helper, function signature unchanged).

### 4.2 What happens server-side (extends the existing single write path)
`app/api/templates/library/[templateName]/route.ts` is, per its own doc comment, "the ONLY write path
for template_library's status/reviewed_by/reviewed_at/review_notes columns" — this feature extends it
with one new `action` value, `'toggle_header'`, rather than adding a new route (matching how TMPL-01
extended this same endpoint rather than adding a new one).

1. **Auth** (unchanged): `requireSessionAuth`, then `isConfiguredApprover(user.email)` — 403 if not the
   configured approver, identical to every existing action.
2. **New Zod fields**: `action` enum extended to include `'toggle_header'`; new optional field
   `headerEnabled: z.boolean().optional()`.
3. **New validation, specific to this action**:
   - If `action === 'toggle_header'` and `headerEnabled` is not a boolean → 400 `"headerEnabled must be
     a boolean for the toggle_header action."`
   - If `action === 'toggle_header'` and `templateName` is not one of the 7 allowed names (checked via a
     new `isHeaderToggleTemplate(templateName)` allowlist function, described in 4.3) → 400 `"Header
     toggle is not available for this template."` This prevents the control being invoked via a direct
     API call against any of the other 20 templates even though the UI never renders the button there.
   - **No status precondition** (unlike `reopen_for_review`, which requires `status === 'approved'`):
     `toggle_header` is accepted from any current status (`pending_review`, `approved`, or
     `changes_requested`), because flipping it while `approved` is precisely the mechanism that moves an
     approved template back for re-review (Feature Brief requirement #3) — gating it to one starting
     status would block exactly the case this feature exists to support.
4. **Update payload** (mirrors `reopen_for_review`'s "clear review metadata" pattern exactly):
   ```
   {
     header_enabled: headerEnabled,
     status: 'pending_review',
     reviewed_by: null,
     reviewed_at: null,
     review_notes: null,
     updated_at: new Date().toISOString(),
   }
   ```
   `fix_state`, `style_overrides`, `fix_changes_summary`, `fix_failure_reason`, `fix_attempt_count`,
   `fix_cycle_id`, `fix_last_activity_at` are **not** touched by this action — they are irrelevant to
   these 7 templates in the first place (`isFixLoopTemplate()` only ever returns `true` for `Heatmap`/
   `Overlay`, so these columns are always at their `'none'`/`'{}'`/`0`/`null` defaults for all 7 rows
   regardless), and this feature must not read or write TMPL-01's fix-loop state per the brief's explicit
   instruction.
5. **Audit log write** (reuses `template_fix_log`, per the brief's explicit instruction, rather than a
   new table): after the DB update succeeds,
   ```
   {
     template_name: templateName,
     fix_cycle_id: null,          // not part of any TMPL-01 fix cycle
     attempt_number: null,
     event_type: 'header_toggled',  // new value; event_type is a free-text column with no DB check
                                     // constraint, confirmed by reading 067's migration — additive, safe
     message: `Title/subtitle header toggled ${headerEnabled ? 'ON' : 'OFF'} by reviewer.`,
     actor: user.email,             // mirrors the nudge events' existing use of `actor`
   }
   ```
   No Inngest event is fired (unlike `request_changes` for fix-loop templates) — this is a synchronous
   DB-only action, matching the brief's instruction that this is "a direct boolean render-branch... not
   an LLM-generated style change."
6. Response: same shape as every other action (`{ template: updated }`), so the existing client-side
   `setRows` merge logic in `TemplateApprovalClient.tsx` needs no changes beyond what 4.1 already
   describes.

### 4.3 New allowlist module (kept separate from TMPL-01's mechanism, per the brief)
A new file, `lib/templates/headerToggleTemplates.ts`, mirrors the shape of `isFixLoopTemplate()` in
`lib/templates/approval.ts` — **but is its own independent module**, not an extension of
`styleOverrideSlots.ts` or `approval.ts`, per the brief's explicit instruction not to touch TMPL-01's fix
loop, its Inngest job, or its slot validator:
```ts
export const HEADER_TOGGLE_TEMPLATE_NAMES = [
  'NarrativeCard', 'ActionPlan', 'QuoteCallout', 'ConceptMap',
  'AnswerSpotlight', 'FrameworkCard', 'StatCallout',
] as const
export type HeaderToggleTemplateName = (typeof HEADER_TOGGLE_TEMPLATE_NAMES)[number]
export function isHeaderToggleTemplate(name: string): name is HeaderToggleTemplateName {
  return (HEADER_TOGGLE_TEMPLATE_NAMES as readonly string[]).includes(name)
}
```
Used by: the PATCH route (4.2), and `TemplateApprovalClient.tsx` (to decide which 7 cards render the new
control).

### 4.4 Per-template title/subtitle field decisions and canvas adjustments
Every decision below was made by reading the actual renderer file and its `TemplateSection` data type;
none is forced onto a template with no reasonable field, per the brief's explicit permission.

**1. `NarrativeCard.tsx` — title: `data.company` (unchanged) / subtitle: `data.industry` (new).**
- Today (line 22): `<h2 className="text-3xl font-bold text-white">{data.company}</h2>` sits inside a
  `flex items-center gap-4 mb-6` row alongside the existing `data.industry` pill badge (line 23-25). The
  title already matches TMPL-06's standard (`text-3xl font-bold`) — unchanged either way.
- When `headerEnabled`, add one new line **below** the existing title+pill row:
  `{headerEnabled && <p className="text-[#94A3B8] text-sm mt-1">{data.industry}</p>}`. The pill stays
  (it serves a different purpose — an at-a-glance colored tag — the subtitle line is the same value
  rendered as plain descriptive text, which is a reasonable, if slightly repetitive, use of the only
  short field this template has that isn't already body copy; no better candidate field exists —
  `challenge`/`approach`/`impact`/`lesson` are all multi-sentence body text, not subtitle-shaped).
- Canvas: the 3-column challenge/approach/impact row is `flex-1 min-h-0` (line 29) inside an
  `overflow-y-auto` outer container (line 14) — a ~20px subtitle addition is absorbed by the flex region
  automatically; no clipping risk given the outer scroll fallback.

**2. `ActionPlan.tsx` — title: unchanged, static string / subtitle: none (title-only, documented
no-op).**
- Today (line 94): `<h2 className="text-3xl font-bold text-white mb-6">Your Action Plan — {data.session_topic}</h2>`
  — already renders unconditionally regardless of this feature.
- `ActionPlanData` (types.ts lines 219-233) has no remaining short, subtitle-shaped field:
  `key_takeaways`/`immediate_actions`/`questions_to_ask_your_team`/`watch_out_for` are all arrays;
  `next_session_preview` is optional and already has its own dedicated footer band (line 109-114) serving
  a distinct purpose (a forward-looking teaser, not a header subtitle). Per the brief's explicit
  allowance, this is documented as **title-only, no subtitle field exists.**
- **Deliberate design decision**: the control still renders on this card (for UI consistency with the
  other 6, and so the audit-trail/status-transition behavior in 4.2 works identically for all 7), but
  flipping it produces **no visible change** to `ActionPlan`'s render — the title already always shows,
  and there is nothing to add. This is an accepted, intentional no-op, not an oversight: the toggle's
  value is still persisted and still transitions status to `pending_review` with an audit entry either
  way, which is the behavior the brief actually requires ("toggling this control... counts as reviewer
  feedback"); it simply has no corresponding visual delta for this one template, exactly as the brief
  anticipates ("it's fine for a template to end up 'title only, no subtitle option'").
- Canvas: not applicable — no layout change occurs for this template.

**3. `QuoteCallout` (renderer `GenericTemplate.tsx`) — title: `section.meta.subtopicTitle` (unchanged) /
subtitle: `data.attribution` (new, optional).**
- Today (line 58): `<h2 className="text-3xl font-bold text-white">{section.meta.subtopicTitle}</h2>`
  inside a `mb-8 flex items-center gap-4` row alongside a badge showing `section.type` (line 54-57) —
  renders unconditionally regardless of this feature.
- `QuoteCalloutData` has `attribution?: string` (confirmed real and LLM-generated —
  `generator.ts` line 213 declares it in the prompt schema, line 658 shows a real mock value
  `'Andrew Ng, AI pioneer and founder of DeepLearning.AI'`). When `headerEnabled` **and** `data.attribution`
  is present: `<p className="text-[#94A3B8] text-sm mt-1">— {data.attribution}</p>` rendered directly
  below the existing header row. When `headerEnabled` is true but `attribution` is absent on a given
  section's data (it's optional), no subtitle line renders — title-only for that render, matching the
  same optional-field convention `AnswerSpotlight.tsx` already uses for its context cards (only rendering
  cards for fields that are actually present).
- Canvas: the data-grid preview below is `grid-cols-1 sm:grid-cols-2 gap-4 mb-6` in normal flow (not
  `flex-1`/fixed-height); the trailing "Renderer for..." note uses `mt-auto` to stay pinned near the
  bottom. A ~20px subtitle addition simply shifts this content down slightly; no fixed-height container
  is affected.

**4. `ConceptMap.tsx` — title: `data.title` (unchanged) / subtitle: `data.central_concept` (new).**
- Today (line 87): `<h2 className="text-3xl font-bold text-white mb-6">{data.title}</h2>` sits directly
  above the ReactFlow canvas div (line 88, `flex-1 rounded-2xl overflow-hidden border ...`), itself
  inside a `flex-1 flex flex-col pb-20` wrapper (line 86). `data.central_concept` (types.ts line 175) is
  confirmed real/generated (`generator.ts` line 206, 637) and is currently only used *inside* the
  canvas's `CentralNode` (the big purple circle's label, line 59) — never surfaced as header text.
- Change, structured to be byte-identical when `headerEnabled` is `false` (copied verbatim from
  `TwoByTwoMatrix.tsx`'s own already-shipped title+context pattern, lines 76-79):
  ```jsx
  {headerEnabled ? (
    <div className="mb-6">
      <h2 className="text-3xl font-bold text-white mb-1">{data.title}</h2>
      <p className="text-[#94A3B8] text-sm">{data.central_concept}</p>
    </div>
  ) : (
    <h2 className="text-3xl font-bold text-white mb-6">{data.title}</h2>
  )}
  ```
- Canvas: the ReactFlow div is the sole `flex-1` sibling in a `flex flex-col` wrapper — exactly
  `TwoByTwoMatrix.tsx`'s existing, already-working structure (title + context line + `flex-1` canvas).
  Adding the subtitle line reduces the canvas's available height by one `text-sm` line (~20px), absorbed
  automatically by `flex-1` sizing; `fitView`'s `minZoom={0.85}` floor (already present, confirmed line
  82) prevents any resulting text-shrink beyond the TMPL-02-established floor.

**5. `AnswerSpotlight.tsx` — title: `section.meta.subtopicTitle` (new — no header exists today) /
subtitle: none (title-only).**
- Today: no header row at all. `AnswerSpotlightData` (types.ts lines 333-340) has no `title` field;
  `data.question` is the main on-screen content, already rendered prominently (line 52-54,
  `text-[#06B6D4] text-xl md:text-2xl font-semibold`) immediately below where a header would go — reusing
  it again as a small subtitle directly under a new title would visually duplicate the same string twice
  in two sizes on the same screen, which is a worse outcome than no subtitle. No other short field exists
  (`direct_answer`/`analogy`/`example`/`important_nuance`/`so_what` are all body-length). Per the brief's
  explicit allowance: **title-only, no subtitle field exists.**
- Change: insert as the new first child inside the outer `motion.div` (before the existing "Top:
  question + direct answer" block, line 46): `{headerEnabled && <h2 className="text-3xl font-bold
  text-white mb-4">{meta.subtopicTitle}</h2>}`. Requires `meta: TemplateMeta` to be added as a new prop
  to `AnswerSpotlight`'s props interface (see 4.5) since this renderer currently only receives `data`,
  not the full `section`.
- Canvas: the context-cards grid below (line 60-79) is already `flex-1 min-h-0` — adding a ~48px title
  block above (text-3xl line height + `mb-4`) reduces its available height correspondingly, absorbed the
  same way this exact file's own `flex-1 min-h-0` region already handles variable question/answer text
  length today.

**6. `FrameworkCard.tsx` — title: `data.framework_name` (new — no header exists today) / subtitle:
`data.coined_by` (new, optional).**
- Today: no header row above the canvas. `data.framework_name` and `data.coined_by` (optional, types.ts
  lines 97-98) are currently only rendered *inside* the ReactFlow `HeaderNode` (lines 11-20:
  `{d.name}` and, conditionally, `by {d.coined_by}`). Per the brief: `FrameworkCardData` has no `title`
  field, and `framework_name` is the closest, most reasonable candidate — used here as the actual page
  title (not the generic `meta.subtopicTitle` fallback), because it names the specific framework being
  taught, which is more informative than the session's generic subtopic title. `coined_by` is reused
  verbatim as the subtitle, mirroring the exact "by {coined_by}" pattern already used inside `HeaderNode`
  — the same source field, same optional-field handling, just also surfaced one level up.
- Change: insert as the new first child inside `motion.div className="flex-1 flex flex-col pb-20"`
  (line 73), before the existing canvas div (line 74):
  ```jsx
  {headerEnabled && (
    <div className="mb-4">
      <h2 className="text-3xl font-bold text-white">{data.framework_name}</h2>
      {data.coined_by && <p className="text-[#94A3B8] text-sm mt-1">by {data.coined_by}</p>}
    </div>
  )}
  ```
- **Intentional duplication, called out explicitly**: `framework_name`/`coined_by`/`purpose` are already
  shown once inside the canvas's `HeaderNode`. Adding a second, page-level header duplicates this
  content. This is not a defect — it is exactly the tradeoff Arun's own review toggle exists to let him
  judge live, per template, per the brief's own framing ("whether adding a title/subtitle improves or
  clutters that specific template"). Documented here rather than silently avoided.
- Canvas: the ReactFlow div is the sole `flex-1` child of the same `flex flex-col` wrapper the new
  header block is inserted into — adding a ~60px title+subtitle block above it reduces the canvas's
  available height by that amount, absorbed by `flex-1` sizing exactly as in `ConceptMap`'s case; the
  existing `minZoom={0.85}` floor (confirmed line 75) is unaffected.

**7. `StatCallout.tsx` — title: `section.meta.subtopicTitle` (new — no header, no title field exists at
all) / subtitle: `data.context` (new).**
- Today: no header row above the canvas. `StatCalloutData` (types.ts lines 146-157) has no field at all
  that functions as a short name/label — confirmed: `headline_stat`/`unit` are the giant hero number
  itself (already the visual focus, inside `HeroStatNode`), `why_it_matters`/`supporting_stats` are
  body/array content. Per the brief: "closest candidate for a short label doesn't exist" — this is the
  one template using the universal `TemplateMeta.subtopicTitle` fallback for its title, per the brief's
  own explicit note that this field "is available on every section of every template type." `data.context`
  (max 15 words, confirmed generated at `generator.ts` line 1106/1409) is currently shown only inside
  `HeroStatNode` (line 16) — reused here as the subtitle, following the same title+context convention
  already standard across most of the other templates in this library (e.g. `TwoByTwoMatrix`,
  `ComparisonTable`, `Funnel`, all of which pair a `title` field with a `context` field at the header).
- Change: insert as the new first child inside `motion.div className="flex-1 flex flex-col pb-20"`
  (line 77), before the existing canvas div (line 78):
  ```jsx
  {headerEnabled && (
    <div className="mb-4">
      <h2 className="text-3xl font-bold text-white">{meta.subtopicTitle}</h2>
      <p className="text-[#94A3B8] text-sm mt-1">{data.context}</p>
    </div>
  )}
  ```
  Requires `meta: TemplateMeta` added as a new prop (see 4.5), same as `AnswerSpotlight`.
- **Intentional duplication, called out explicitly**: `data.context` is already shown once inside
  `HeroStatNode`. Same rationale as `FrameworkCard` above — this is Arun's call to make per template,
  not avoided here.
- Canvas: same reasoning as `FrameworkCard` — sole `flex-1` canvas child absorbs the added ~60px header
  block; existing `minZoom={0.85}` floor (confirmed line 79) unaffected.

### 4.5 Prop-threading changes (additive only, matches the existing `styleOverrides` precedent)
`TemplateRenderer.tsx` currently forwards an optional `styleOverrides` prop to exactly 2 of its 27
`case` branches (`Heatmap`, `Overlay`) — every other renderer's prop interface is `{ data, isActive,
onReady }` only. This feature follows the identical pattern:
- `TemplateRendererProps` gains one new optional prop: `headerEnabled?: boolean`.
- Each of the 7 renderers' own prop interfaces gains `headerEnabled?: boolean` (default treated as
  `false`/falsy when `undefined`, so every existing call site that never passes it — `SessionStack.tsx`,
  any walkthrough/preview caller — renders exactly as it does today, zero behavior change).
- `AnswerSpotlight` and `StatCallout` additionally gain `meta?: TemplateMeta` (only these two actually
  need `subtopicTitle`; the other 5 templates' new title/subtitle logic reads entirely from their own
  `data`, so they do not need `meta` threaded in).
- In `TemplateRenderer.tsx`'s switch, the 7 relevant `case` branches change from e.g.
  `case 'NarrativeCard': return <NarrativeCard data={section.data} isActive={isActive} onReady={onReady} />`
  to additionally pass `headerEnabled={headerEnabled}` (and, for `AnswerSpotlight`/`StatCallout` only,
  `meta={section.meta}`). The other 20 `case` branches are untouched.
- `TemplateApprovalClient.tsx`'s existing `<TemplateRenderer section={...} isActive styleOverrides={row.style_overrides} />`
  (line 323-327) gains one new prop: `headerEnabled={row.header_enabled}`.

### 4.6 Live sessions are explicitly not wired up in this phase
`headerEnabled` is only ever passed by the admin preview (`TemplateApprovalClient.tsx`). Every live
call site (`SessionStack.tsx` and any other consumer of `TemplateRenderer`) continues to omit this prop
entirely, so it is `undefined` → treated as `false` by every one of the 7 renderers → **today's exact
current rendering, unchanged, in every real session, regardless of what `header_enabled` is set to in the
database.** This is a deliberate scope boundary, not an oversight — see Section 10.

## 5. Visual Examples

**`NarrativeCard` — Off (today) vs. On:**
```
┌──────────────────────────────────────────┐     ┌──────────────────────────────────────────┐
│  Acme Logistics  [Logistics & Shipping]   │     │  Acme Logistics  [Logistics & Shipping]   │
│                                            │     │  Logistics & Shipping                     │
│  [Challenge]  [Approach]  [Impact]        │     │  [Challenge]  [Approach]  [Impact]        │
│  [Metrics strip]                          │     │  [Metrics strip]                          │
│  [Lesson]                                 │     │  [Lesson]                                 │
│  So what? ...                             │     │  So what? ...                             │
└──────────────────────────────────────────┘     └──────────────────────────────────────────┘
```

**`ActionPlan` — Off vs. On (identical — documented no-op):**
```
┌──────────────────────────────────────────┐     ┌──────────────────────────────────────────┐
│  Your Action Plan — AI Strategy           │     │  Your Action Plan — AI Strategy           │
│  [ReactFlow: takeaways → actions → Qs]    │     │  [ReactFlow: takeaways → actions → Qs]    │
│  [Watch out for]                          │     │  [Watch out for]                          │
└──────────────────────────────────────────┘     └──────────────────────────────────────────┘
```

**`QuoteCallout` (via `GenericTemplate`) — Off vs. On:**
```
┌──────────────────────────────────────────┐     ┌──────────────────────────────────────────┐
│  [QuoteCallout] AI Strategy Fundamentals  │     │  [QuoteCallout] AI Strategy Fundamentals  │
│  [Data preview grid]                      │     │  — Andrew Ng, AI pioneer and founder...   │
│  Renderer for QuoteCallout — full visual  │     │  [Data preview grid]                      │
│  coming soon                              │     │  Renderer for QuoteCallout — full visual  │
│  So what? ...                             │     │  coming soon                              │
│                                            │     │  So what? ...                             │
└──────────────────────────────────────────┘     └──────────────────────────────────────────┘
```

**`ConceptMap` — Off vs. On:**
```
┌──────────────────────────────────────────┐     ┌──────────────────────────────────────────┐
│  How LLMs Connect to Your Business        │     │  How LLMs Connect to Your Business        │
│  [ReactFlow concept map, central node]    │     │  Large Language Models                    │
│                                            │     │  [ReactFlow concept map, central node]    │
│  So what? ...                             │     │  So what? ...                             │
└──────────────────────────────────────────┘     └──────────────────────────────────────────┘
```

**`AnswerSpotlight` — Off vs. On:**
```
┌──────────────────────────────────────────┐     ┌──────────────────────────────────────────┐
│  Should we build or buy our AI stack?     │     │  AI Strategy Fundamentals                 │
│  Direct answer...                         │     │  Should we build or buy our AI stack?     │
│  [Analogy] [Example] [Nuance]             │     │  Direct answer...                         │
│  So what? ...                             │     │  [Analogy] [Example] [Nuance]             │
│                                            │     │  So what? ...                             │
└──────────────────────────────────────────┘     └──────────────────────────────────────────┘
```

**`FrameworkCard` — Off vs. On (intentional duplication with in-canvas HeaderNode):**
```
┌──────────────────────────────────────────┐     ┌──────────────────────────────────────────┐
│  [ReactFlow: HeaderNode "The AI Readiness │     │  The AI Readiness Framework               │
│   Framework, by McKinsey Digital" +       │     │  by McKinsey Digital                      │
│   component cards]                        │     │  [ReactFlow: HeaderNode (same text again) │
│  [When to use] [When NOT to use]          │     │   + component cards]                      │
│  So what? ...                             │     │  [When to use] [When NOT to use]          │
│                                            │     │  So what? ...                             │
└──────────────────────────────────────────┘     └──────────────────────────────────────────┘
```

**`StatCallout` — Off vs. On (intentional duplication with in-canvas HeroStatNode):**
```
┌──────────────────────────────────────────┐     ┌──────────────────────────────────────────┐
│  [ReactFlow: HeroStatNode "73% / of       │     │  AI Strategy Fundamentals                 │
│   executives.../ context text..."]        │     │  73% of executives say their AI...        │
│  So what? ...                             │     │  [ReactFlow: HeroStatNode (same text)]    │
│                                            │     │  So what? ...                             │
└──────────────────────────────────────────┘     └──────────────────────────────────────────┘
```

## 6. Data Requirements

**Read:**
- `template_library` — all existing columns (`GET /api/templates/library`, unchanged) plus the new
  `header_enabled` column, already covered by the route's existing `select('*')`.
- No new LLM generation and no new fields requested from `lib/templates/generator.ts` — every field used
  as a title/subtitle source (`data.industry`, `data.central_concept`, `data.framework_name`,
  `data.coined_by`, `data.attribution`, `data.context`, `section.meta.subtopicTitle`) is already generated
  today for its existing use; this feature only displays already-existing values in one additional
  location.

**Write:**
- `template_library.header_enabled` (new `boolean NOT NULL DEFAULT false` column, migration
  `068_tmpl07_header_toggle.sql`) — written only by the new `toggle_header` PATCH action.
- `template_library.status` / `reviewed_by` / `reviewed_at` / `review_notes` / `updated_at` — same
  columns every existing action already writes; `toggle_header` sets `status` to `'pending_review'` and
  clears the review-metadata fields, matching `reopen_for_review`'s existing pattern.
- `template_fix_log` — one new row per toggle action, `event_type = 'header_toggled'`, `fix_cycle_id =
  NULL`. Requires migration `068` to also relax `template_fix_log.fix_cycle_id` from `NOT NULL` to
  nullable (currently `NOT NULL` per migration `067`) — a backward-compatible schema relaxation; every
  existing row still has a `fix_cycle_id`, only new `header_toggled` rows will ever have `NULL` there.

**APIs:**
- `PATCH /api/templates/library/[templateName]` — extended (not replaced) with the `toggle_header`
  action, per Section 4.2. No new route.
- `GET /api/templates/library` — unchanged; already returns whatever columns exist via `select('*')`.

**localStorage/sessionStorage:** None, matching the existing tool.

## 7. Success Criteria (Acceptance Tests)

✓ Given the `NarrativeCard` template row with `header_enabled = true`, when rendered in the admin
preview, then a `text-sm` line showing `data.industry` appears directly below the existing title+pill
row, and the title itself is unchanged (`text-3xl font-bold`, still `data.company`).

✓ Given any of the 7 templates with `header_enabled = false` (the default), when rendered, then the
DOM output is byte-identical to this template's pre-TMPL-07 rendering — confirmed structurally for
`ConceptMap` (Section 4.4 shows the `false` branch reproduces today's exact single-`<h2>` markup).

✓ Given the `QuoteCallout` template with `header_enabled = true` and `sample_data.attribution` present,
when rendered, then a subtitle line `— {attribution}` appears; given the same toggle state but
`attribution` absent from the data, when rendered, then no subtitle line appears (title-only).

✓ Given the `ActionPlan` template, when `header_enabled` is toggled from `false` to `true` or back, then
the rendered output is pixel-identical in both states (documented no-op), while the underlying
`header_enabled` column value still changes and the audit trail (below) still fires.

✓ Given any of the 7 templates currently `status = 'approved'`, when the configured approver clicks the
header toggle button, then the response's `template.status` is `'pending_review'`, `reviewed_by` /
`reviewed_at` / `review_notes` are `null`, and the card disappears from the "Approved" tab and appears in
"Pending Review" on the next render (via the existing `filtered = rows.filter(r => r.status ===
activeTab)` mechanism, unchanged).

✓ Given a successful `toggle_header` PATCH, when `template_fix_log` is queried for that `template_name`,
then exactly one new row exists with `event_type = 'header_toggled'`, `fix_cycle_id = null`, `actor` equal
to the approver's email, and `message` containing `'ON'` or `'OFF'` matching the direction toggled.

✓ Given a `toggle_header` PATCH on any of the 7 templates, when the row is re-fetched, then
`fix_state`, `style_overrides`, `fix_cycle_id`, `fix_attempt_count` are unchanged from their pre-toggle
values (still `'none'` / `{}` / `null` / `0` for these 7 rows, since none of them is `Heatmap`/`Overlay`).

✓ Given an authenticated user who is **not** the configured approver, when they attempt the
`toggle_header` action (via direct API call, bypassing the disabled UI button), then the response is 403
and no row is modified — identical to every other existing action's auth behavior.

✓ Given a `toggle_header` PATCH targeting any of the other 20 `template_name` values (e.g.
`DefinitionTriptych` or `Heatmap`), when the request is made, then the response is 400 `"Header toggle is
not available for this template"` and no row is modified.

✓ Given a `toggle_header` PATCH with a missing or non-boolean `headerEnabled` field, when the request is
made, then the response is 400 and no row is modified.

✓ Given any of the 7 templates rendered inside a real live session (`SessionStack.tsx`), when compared
before and after this feature ships (regardless of that row's `header_enabled` value in the database),
then the rendered output is byte-for-byte unchanged — confirms the Section 4.6 scope boundary holds.

## 8. Error States
- **PATCH request fails (network error or non-2xx response)**: the existing `patchTemplate` catch block
  (`TemplateApprovalClient.tsx` lines 129-131, "non-fatal — row stays in its previous tab, user can
  retry") already handles this identically for the new action — the toggle button's displayed state
  simply does not change, and the user can click again. No new error-handling code is required beyond
  what this shared helper already does.
- **Invalid action/body** (missing/non-boolean `headerEnabled`, or unsupported `templateName` for this
  action): 400, handled server-side per Section 4.2 — the client shows no special messaging beyond the
  request silently not updating the row (same UX as any other malformed-request case in this tool today;
  this cannot happen through the normal UI since the button only ever sends a valid boolean and the
  control is only rendered for the 7 allowed names).
- **Non-approver attempts the action**: 403, identical handling to every existing action — the button is
  already disabled client-side for non-approvers, so this can only occur via a direct API call, and the
  existing `disabledForNonApprover` pattern already covers the UI state.
- **Database update fails** (`dbError` from Supabase): 500, identical to the existing `if (dbError) return
  NextResponse.json({ error: 'Update failed' }, { status: 500 })` branch — no new handling needed, this
  action reuses the same update call shape.
- **`template_fix_log` insert fails after a successful `template_library` update**: not specially handled
  — matches the existing precedent for `request_changes`'s own `feedback_received` log insert (Section
  4.2's code path), where the row update is the authoritative state change and the log write is
  best-effort/non-blocking. The row's `header_enabled`/`status` change still succeeds and is returned to
  the client even if the audit-log insert has a transient failure.

## 9. Edge Cases
- **`ActionPlan`'s toggle is a documented no-op** (Section 4.4, item 2) — the control still exists, still
  persists state, still triggers the status transition and audit log, but produces no visible render
  change. This is intentional, not a bug to fix later.
- **`QuoteCallout`'s subtitle depends on `attribution` being present** — since it's an optional field on
  `QuoteCalloutData`, a given section's real generated content might omit it; the toggle then yields
  title-only for that specific render even though `header_enabled` is `true`. This mirrors the existing
  optional-field pattern already used by `AnswerSpotlight`'s context cards (only rendering cards for
  fields that exist).
- **`FrameworkCard` and `StatCallout` intentionally duplicate content already shown inside their ReactFlow
  canvas** when the toggle is on (Section 4.4, items 6-7) — flagged explicitly as the exact tradeoff this
  feature exists to let Arun evaluate per template, not an oversight to be quietly avoided.
- **Toggling rapidly / double-clicking**: the existing `actioning[row.template_name]` boolean already
  disables the button mid-request for every action in this file; the new button reuses this same
  mechanism, so a second click cannot fire while the first request is in flight.
- **Toggling while the template is in `changes_requested`** (not just `approved`): permitted, same as any
  other status, per Section 4.2's "no status precondition" — the row moves to `pending_review` from
  `changes_requested` exactly as it would from `approved`.
- **A `template_library` row missing entirely for one of the 7 template_names** — cannot occur under
  normal operation (RTV-04's seed script always creates all 27 rows in one pass, confirmed at
  `scripts/seed-template-library.ts` lines 149-152, which aborts if the row count isn't exactly 27); if it
  somehow did, the existing `.update(...).eq('template_name', templateName).select().single()` call
  would surface as the existing, unmodified `dbError` → 500 path — not a new gap this feature introduces.
- **Mobile vs. desktop rendering of the admin review page**: not applicable — `/dashboard/admin/templates`
  is an internal, desktop-oriented tool (`max-w-5xl mx-auto` shell, confirmed line 164); no mobile-specific
  behavior is defined or required for this control, consistent with the rest of that page.
- **First-time vs. returning reviewer**: not applicable — `header_enabled` is a stored, durable column;
  whatever state it was last left in persists across page reloads and reviewer sessions, same as every
  other `template_library` column.

## 10. Out of Scope
- **Wiring `header_enabled` into real live-session rendering** (`SessionStack.tsx` or any other consumer
  of `TemplateRenderer` outside the admin tool). Confirmed via `lib/templates/approval.ts`'s own code
  comment that even the more fundamental `isTemplateApprovedForProduction()` gate is *not yet* called
  anywhere in the live template-selection path — that wiring is explicitly deferred to RTV-05 (confirmed
  "spec'd but not built" per current project status). It would be inconsistent and premature for this
  narrower feature to wire its own toggle into the live path before that foundational gate exists. This
  is a natural RTV-05-shaped follow-up, not built here.
- **Any change to `lib/templates/styleOverrideSlots.ts`, TMPL-01's automated fix loop, its Inngest job, or
  its slot validator** — confirmed untouched; the new `headerToggleTemplates.ts` allowlist is a wholly
  separate module.
- **Any change to `lib/templates/containerBudgets.ts`** — no character-budget numbers are added or
  modified; every title/subtitle field reused here is already unbudgeted (short pill/name-shaped fields
  like `industry`, `coined_by`, `framework_name`) or already budgeted for its existing use (`context`,
  max 15 words) with no new constraint needed for its second, header-level appearance.
- **Any new LLM-generated content** — every subtitle source field already exists and is already
  generated for another purpose; no new generation prompt, mock data, or field is added.
- **The other 20 templates** (17 already-complete, `DefinitionTriptych` (TMPL-06), `Heatmap`, `Overlay`) —
  untouched; the control is not rendered for them and the PATCH route rejects the action for them.
- **A shared/reusable "TemplateHeader" component abstraction** — each of the 7 renderers gets its own
  minimal inline JSX per Section 4.4; introducing a shared component is a larger refactor not requested
  by the brief.
- **A new design-system toggle/switch UI primitive** — implemented as a plain labeled button, consistent
  with every other action button already in this file, not a new reusable control.
- **Fixing the pre-existing 520px admin-preview-box vertical-clipping issue documented in TMPL-05
  (Overlay-specific) or any general canvas-utilization audit of these 7 templates beyond making room for
  the new header** — out of scope; this document only adds the header block and reduces the
  already-`flex-1` canvas region's available height by the amount that block requires, nothing else.

## 11. Open Questions
None.

## 12. Dependencies
- **Migration `068_tmpl07_header_toggle.sql`** must land before the PATCH route change ships. It:
  (a) adds `template_library.header_enabled boolean NOT NULL DEFAULT false`, and
  (b) relaxes `template_fix_log.fix_cycle_id` from `NOT NULL` to nullable (`ALTER COLUMN fix_cycle_id
  DROP NOT NULL`) — backward-compatible; every existing row already has a non-null value.
- **New module** `lib/templates/headerToggleTemplates.ts` (Section 4.3) must exist before the PATCH route
  and `TemplateApprovalClient.tsx` reference it.
- Depends on `template_library` already being seeded for all 27 rows (RTV-04's existing seed script,
  unchanged) — the new column's `DEFAULT false` means no re-seed or backfill is required for existing
  rows.
- Depends on TMPL-02's already-landed fixes being present in the current code (confirmed by direct read
  during this investigation, not assumed): `position: relative` on `ActionPlan`/`ConceptMap`/
  `FrameworkCard`/`StatCallout`/`GenericTemplate`'s outer wrappers, and `minZoom={0.85}` on all 4
  ReactFlow-based templates among the 7 (`ActionPlan`, `ConceptMap`, `FrameworkCard`, `StatCallout`) — the
  canvas-adjustment reasoning in Section 4.4 relies on both already being in place, and both are confirmed
  present today.
- No new npm packages, environment variables, or other agents' output required beyond the migration and
  the one new module above.
- **Future/deferred dependency, not built now**: RTV-05's live-path wiring (Section 10) — once that
  lands, a follow-up, separately-scoped decision would be needed on whether `header_enabled` should then
  also gate live-session rendering, matching whatever mechanism RTV-05 establishes for `status`/approval
  gating generally. Flagged here, not solved by this document.

---

## CEO Review

Approved. Section 11 confirmed empty. Independently re-verified the highest-risk claims directly
against the code before approving, not taken on the BA's word: confirmed `GenericTemplate.tsx` is
wired to exactly the `'QuoteCallout'` case in `TemplateRenderer.tsx` (line 87-88); confirmed
`QuoteCalloutData.attribution` is a real optional field (types.ts line 193); confirmed
`TwoByTwoMatrix.tsx`'s title+context-above-canvas pattern (lines 76-79) matches exactly what's
proposed to reuse for `ConceptMap`; confirmed `isFixLoopTemplate` lives in
`styleOverrideSlots.ts`, fully separate from the new `headerToggleTemplates.ts` module, so TMPL-01's
mechanism genuinely isn't touched; confirmed `template_fix_log.fix_cycle_id` really is `NOT NULL`
today (migration 067 line 27), so the proposed migration 068 relaxation is a real, necessary step,
not an invented one; and confirmed `position: relative` + `minZoom={0.85}` are already present on
all 4 ReactFlow-based templates among the 7 (ActionPlan, ConceptMap, FrameworkCard, StatCallout),
so the canvas-adjustment reasoning in Section 4.4 rests on things that are actually true today.

Two documented no-op/duplication tradeoffs (ActionPlan's invisible toggle; FrameworkCard/
StatCallout's intentional content duplication) are exactly the right call — flagging honestly for
Arun's own per-template judgment rather than forcing an artificial subtitle where none belongs.
Developer agent: implement exactly Sections 4.2–4.5, nothing beyond scope in Section 10.
