# TMPL-05 — Overlay Canvas Utilization + Zone Label Legibility — Requirement Document
Version: 1.0
Status: APPROVED (see CEO Review, end of document)
Author: Business Analyst Agent
Date: 2026-07-12

> **Grounding note (read before the spec).** Overlay's layout is 100% deterministic pixel/CSS
> arithmetic — every dimension involved (`PANEL_W`/`PANEL_H`, callout card `w-[220px] h-[96px]`,
> connector `24px`, all gaps, all shell padding/header/footer bands) is a hardcoded constant or a
> fixed Tailwind spacing-scale class, with no font-driven reflow in the outer bounding box (callout
> text sits inside `overflow-hidden` + `line-clamp` regions of fixed size). That means the "does this
> fit the container" question here is answerable by exact box-model arithmetic from the real source
> constants — no rendering ambiguity the way TMPL-02's font-overflow investigation had (which
> genuinely required a browser to observe text-wrap behavior). I built and hand-verified that
> arithmetic against every relevant CSS/Tailwind constant in the real file (`Overlay.tsx`,
> `TemplateApprovalClient.tsx`, `SessionStack.tsx`), using the REAL frozen mock data from
> `lib/templates/generator.ts`'s `Overlay` entry (2 top-docked zones + 2 bottom-docked zones — the
> exact configuration TMPL-01's seed/approval flow shows Arun today), and I additionally confirmed via
> a second research pass that `TemplateRenderer.tsx` applies **zero** wrapper markup, scaling,
> `transform`, or container-query CSS around `Overlay` — whatever renders is exactly what `Overlay.tsx`
> produces, unmodified. No temporary harness/component was left in the repo; no application code was
> touched to produce these numbers.
>
> Two candidate implementation approaches were seriously worked through and rejected before landing on
> the final recommendation — documented in Section 4 because the reasoning is why the final numbers
> are safe, not just what they are:
> 1. **Percentage-based `PANEL_W`** (e.g. `width: 'min(90%, 1040px)'`) — rejected: the panel's
>    immediate flex ancestors (the "middle row" div, the outer assembly wrapper) currently shrink-wrap
>    to content with no definite width of their own, so a percentage width on the panel has no stable
>    containing block to resolve against without also restructuring those wrapper divs.
> 2. **Tailwind viewport breakpoints for a large desktop tier** (e.g. `lg:w-[960px] xl:w-[1040px]`) —
>    rejected: Tailwind's `lg:`/`xl:` are *browser-viewport*-width media queries, not *local-container*
>    width. The admin-preview tool renders `Overlay` inside a box whose content-width is a fixed
>    ~816px (see 2.1 below) regardless of the reviewer's actual monitor size — so a breakpoint tuned
>    for "the browser window is wide" would wrongly fire while reviewing in that narrow local box
>    (most reviewers' monitors are ≥1280px wide) and overflow it. A CSS container query would solve
>    this correctly but requires an unapproved package (`@tailwindcss/container-queries` is not on
>    CLAUDE.md's approved list) — not used.
>
> The final recommendation (Section 4) uses exactly one safe, low tier and one safe, higher tier, both
> chosen to fit even under the *narrower* of the two real interpretations of "which box is currently on
> screen" — see the worked arithmetic in Section 2.

## 1. Purpose
`Overlay` (`components/templates/renderers/Overlay.tsx`) draws a fixed `700×420`px base panel,
centered inside a screen that is otherwise full-viewport. Arun reported directly, in his own words via
TMPL-01's fix-loop feedback box: "increase the size of canvas as I see lot of white space below the
canvas in the screen... the containers overlaps on the canvas... we need margins and spacing for all
containers... font has to be minimum readable size." TMPL-01's automated fix loop correctly rejected
this as out-of-scope for its narrow style-override allowlist (only zone colors, callout width/height,
and panel border width are adjustable slots — no panel-size or general-spacing slot exists) and
terminated with a clear reason; this document authorizes an actual code change to close that gap.

Two concrete, measured problems exist (Section 2 proves both from the real numbers):
- **Underused width.** On a realistic desktop live-session viewport, the 700px panel occupies roughly
  63–67% of the space available to it, and drops to ~44% on a large monitor — real, but more moderate
  than "a small box in a sea of empty space"; it reads as noticeably narrow, not catastrophically so.
- **Insufficient vertical budget — this is very likely the literal mechanism behind "overlaps."** At a
  common 1440×900 laptop viewport, the current panel + its top-and-bottom-docked callout rows (the
  *exact* zone configuration in the real frozen mock/seed data) need 684px of vertical room but only
  652px is available — the assembly is **already clipped by ~32px today**, at an ordinary, non-exotic
  screen size. The callout cards are the outermost elements in each row (closest to the clip boundary),
  so they are what gets visually truncated first — reading exactly like a callout crowding/overlapping
  the panel edge with no breathing room, matching Arun's description.

Without this fix: Overlay continues to look small/cramped in exactly the situations Arun is already
hitting in real use, and the callout-card clipping will recur unpredictably as different zone
configurations and screen sizes combine, undermining trust in the template library's visual polish that
TMPL-02 just established for the other 26 templates.

## 2. User Story
As Arun (product owner, reviewing/using Overlay in a live coaching session or in the admin approval
tool),
I want the Overlay canvas to use the space it's given without leaving obvious dead space or clipping
its own callouts,
So that the template reads as a deliberate, polished diagram rather than a small box floating in an
oversized frame.

(Single user/persona — this is a rendering-fidelity fix, not a new user-facing flow; no other user type
interacts with this component differently.)

### 2.1 The exact numbers this document is built on

**Fixed inputs from the real code** (all confirmed by direct file read, not inferred):
- `Overlay.tsx`: `PANEL_W = 700`, `PANEL_H = 420` (lines 66–67); callout card `w-[220px] h-[96px]`
  (line 89); `Connector` is `2px×24px` or `24px×2px` depending on orientation (line 124); row gaps are
  Tailwind `gap-3` (12px) and `gap-6` (24px); shell padding is `px-8 md:px-16 py-12` (32/64/48px); header
  band and footer band are each a fixed `h-[72px]`; the body wrapper adds `pb-20` (80px) buffer above
  the absolutely-positioned footer (line 145–160, 191–196, 231–240).
- `lib/templates/generator.ts` lines 951–962 — the frozen mock/seed data — has 4 zones at
  `top-left`, `top-right`, `bottom-left`, `bottom-right`. Per `dockSide()` (Overlay.tsx lines 58–64),
  this resolves to **2 top-docked + 2 bottom-docked callouts, 0 left/right-docked** — i.e. Overlay's
  worst-case vertical layout (both a top row *and* a bottom row of callouts stacked around the panel)
  is not a hypothetical edge case, it is the exact configuration shown in every review/demo today.
- `TemplateRenderer.tsx` (confirmed by direct read): a bare `switch` with **zero** wrapper `<div>`,
  no `h-full`/`w-full` of its own, no `transform`/`scale`/`zoom`, no container-query CSS anywhere in the
  file. Whatever `Overlay.tsx` renders is exactly what appears — no external scaling to account for.
- `TemplateApprovalClient.tsx` line 322: `<div className="relative rounded-xl border ... overflow-hidden
  mb-4 bg-[#080808]" style={{ height: 520 }}>` — fixed height **520px**, `position: relative` (already
  present; TMPL-02's fix-A landed since that audit), no explicit width (inherited from `max-w-5xl
  mx-auto` page shell + `p-5` card padding). TMPL-02's own audit already resolved this box's real
  content-width to **944px** by direct render measurement — reused here rather than re-deriving.
- `SessionStack.tsx` line 181: the live-session slide wrapper is `className="relative h-screen w-full"`
  — full viewport height, full available width (viewport width minus the `w-[200px]` sidebar on
  desktop, full width with sidebar hidden below `md:` on mobile). No max-width, no fixed aspect ratio.

**Vertical budget arithmetic** (identical box-model chain for both containers — outer div is
`h-full w-full flex flex-col px-8 md:px-16 py-12`, wrapping a `flex-1 flex-col pb-20 min-h-0` region that
itself contains a `shrink-0 h-[72px]` header and a `flex-1` body; the `so_what` footer is
absolutely-positioned, so it doesn't consume flow height but its `pb-20` reservation does):

| Container | Total height | − `py-12` (96) | − `pb-20` (80) | − header (72) | = available body height | needed today (264 + `PANEL_H`=420) | today's result |
|---|---|---|---|---|---|---|---|
| Admin preview (944×520) | 520 | 424 | 344 | 272 | **272px** | 684 | **clips by 412px** (pre-existing; unrelated to `PANEL_H`) |
| 1440×900 (common laptop) | 900 | 804 | 724 | 652 | **652px** | 684 | **clips by 32px today** |
| 1366×768 (very common laptop) | 768 | 672 | 592 | 520 | **520px** | 684 | **clips by 164px today** |

("264" = the two callout rows' own height, 96+24 each, plus the two 12px gaps around the panel — this
number is fixed regardless of `PANEL_H`, since callout card/connector sizes aren't changing.)

The admin-preview box cannot fit this exact zone configuration at *any* `PANEL_H`, even 0 — its 272px
budget is already smaller than the 264px the callout rows alone need plus any panel at all. This is a
pre-existing condition of that one fixed-size review tool, not something this fix causes or is capable
of fully resolving (see Section 9/12).

**Width arithmetic** (content-width = container width − shell padding − sidebar where applicable):

| Container | Content width available | current 700px panel utilization |
|---|---|---|
| Admin preview | 816px | 85.8% |
| 1440×900 (sidebar-adjusted) | 1112px | 63.0% |
| 1366×768 | 1038px | 67.4% |
| 1920×1080 (large monitor) | 1592px | 44.0% |
| Mobile 375px width | 311px | **225% — already overflows today** |

## 3. Trigger / Entry Point
No new trigger — this changes the rendering of an existing template. `Overlay` mounts wherever
`TemplateRenderer` dispatches `section.type === 'Overlay'`:
- Live coaching sessions: `components/templates/SessionStack.tsx`, inside the per-section
  `h-screen w-full` slide, whenever the current session's content includes an Overlay-type section.
- Admin template review: `app/dashboard/admin/templates/TemplateApprovalClient.tsx`'s
  `height: 520` preview box, using the frozen `sample_data` for the `Overlay` row.
No auth/state change, no new route, no new API call.

## 4. Screen / Flow Description
Overlay's on-screen structure (title/context header band → 3×3-grid panel with docked callout rows →
"So what?" footer band) is unchanged. What changes is purely how large the panel is and how its
internal 3×3 grid is positioned, plus one font size. Concretely:

**Panel width — becomes responsive via two Tailwind breakpoint classes (`w-[280px] xl:w-[780px]`),
replacing the current single inline `style={{ width: PANEL_W }}`:**
- Below the `xl` breakpoint (<1280px browser viewport width, covers phones, tablets, and narrower
  desktop windows): panel renders at **280px** wide.
- At/above `xl` (≥1280px browser viewport width): panel renders at **780px** wide.
- Rationale for the specific breakpoint and both values is in Section 2.1/Section 9 — `xl` (not the
  file's existing `md`) is required because a narrower "desktop-tier" breakpoint would still overflow
  once the `w-[200px]` sidebar and shell padding are subtracted (see the rejected-approach note above);
  780 (not something larger) is required because it must stay safely under the admin-preview's fixed
  816px content-width even though that box is reviewed on a typical wide monitor that will trigger the
  `xl:` tier regardless of the box's own local width.

**Panel height — becomes a single new fixed constant, 340px (down from 420px):**
- Chosen so the total vertical assembly (264px of callout rows/gaps + `PANEL_H`) fits inside the
  652px available at a common 1440×900 laptop viewport with a comfortable 48px margin, converting
  today's actual 32px clip into a fixed gap.
- At the tighter 1366×768 laptop, this reduces (does not fully eliminate) the pre-existing overflow
  from 164px to 84px — a real, measured improvement, honestly not a full fix at that specific window
  size (Section 9).

**Zone marker grid (`SLOT_GRID`/`dockSide()` untouched) — internal cell math updated to match:**
- `CELL_W` (horizontal cell size/offset, feeding `Marker`'s `left`/`width`) switches from a pixel
  number (`PANEL_W / 3`) to a percentage string, `33.333%`, of the panel's own rendered width. This is
  what lets one set of `Marker` code work correctly at both the 280px and 780px panel widths with zero
  JS breakpoint-detection logic — CSS percentages simply resolve against whatever the panel's actual
  width is at render time.
- `CELL_H` (vertical cell size/offset, feeding `Marker`'s `top`/`height`) stays a plain pixel number,
  now `340 / 3 ≈ 113.33px` (down from 140px) — height isn't responsive, so no percentage conversion is
  needed here.

**`zone_label` text — `text-xs` (12px) → `text-sm` (14px):**
- At the primary `xl:` desktop tier, `CELL_W` grows from today's fixed 233px to 260px (+11.5%),
  comfortably fitting the longest real labels ("Application Layer", "Governance Layer") at 14px without
  new truncation. At the base/mobile tier, `CELL_W` shrinks to 93px (down from 233px, since the panel
  itself is much narrower there) — long labels will truncate more eagerly than today via the *existing*
  `line-clamp-1` safety net already present on this field (Marker, line 115) — not a new failure mode,
  just the same graceful-degradation mechanism working harder at a much smaller size.

Nothing about the header band, footer band, `CalloutCard`, `Connector`, shell padding, `SLOT_GRID`,
`dockSide()`, or the TMPL-01 style-override mechanism changes.

## 5. Visual Examples

```
┌──────────────────────────────────────────────────────────────────┐
│  Desktop live session (≥1280px viewport), BEFORE                 │
│  ──────────────────────────────────────────────────              │
│  Where AI Fits In Your Stack                                     │
│  Four places AI touches your existing systems today.             │
│                                                                    │
│         [Feeds Everything]      [The Reasoning Engine]           │
│                 │                        │                       │
│         ┌───────┴────────────────────────┴───────┐  ← 700px wide │
│         │  ⚬ Data Layer      ⚬ Model Layer        │    (56–67%    │
│         │                                          │     of avail-│
│         │         Your Technology Stack            │     able     │
│         │                                          │     width)   │
│         │  ⚬ Application Layer  ⚬ Governance Layer │              │
│         └───────┬────────────────────────┬───────┘              │
│                 │                        │                       │
│         [What Employees Touch]  [Your Real Job]                  │
│                                                                    │
│  ← wide margins of unused space either side of the panel →       │
│  So what? As a CEO, you don't own the model layer...              │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Desktop live session (≥1280px viewport), AFTER                  │
│  ──────────────────────────────────────────────────              │
│  Where AI Fits In Your Stack                                     │
│  Four places AI touches your existing systems today.             │
│                                                                    │
│      [Feeds Everything]              [The Reasoning Engine]      │
│              │                                │                  │
│    ┌─────────┴────────────────────────────────┴─────────┐ ← 780px│
│    │   ⚬ Data Layer            ⚬ Model Layer             │ (70–75%│
│    │                                                       │ avail-│
│    │            Your Technology Stack                     │ able  │
│    │                                                       │ width,│
│    │   ⚬ Application Layer     ⚬ Governance Layer         │ 340px │
│    └─────────┬────────────────────────────────┬─────────┘ tall)  │
│              │                                │                  │
│      [What Employees Touch]         [Your Real Job]              │
│                                                                    │
│  So what? As a CEO, you don't own the model layer...              │
└──────────────────────────────────────────────────────────────────┘

┌───────────────────────────┐
│  Mobile (<1280px viewport,│
│  e.g. 375px width), AFTER │
│  ───────────────────────  │
│  Where AI Fits In...      │
│  Four places AI...        │
│                            │
│   [Feeds Everything]      │
│         │                 │
│   ┌─────┴─────┐  ← 280px  │
│   │⚬Data Layer│    wide,  │
│   │  Your...  │   fits    │
│   │⚬Applic...│   inside   │
│   └─────┬─────┘  311px    │
│         │        available│
│   [What Employees Touch]  │
│                            │
│  So what? ...              │
└───────────────────────────┘
```

## 6. Data Requirements
No data model, database, or API changes. Purely a renderer-file (`Overlay.tsx`) change:
- No new fields read from `OverlayData`/`OverlayZonePosition` (unchanged type usage).
- No new `styleOverrides` keys read or written — `zone-color-*`, `callout-width`, `callout-height`,
  `panel-border-width` continue to resolve exactly as today (Section 12 notes a *possible future*
  `panel-width`/`panel-height` slot pair; not built now).
- No `content_items`/`template_library`/`sample_data` changes — the existing frozen mock/seed data is
  reused as-is (it is in fact the data that drove the "both top and bottom rows" worst-case finding
  above).
- No localStorage/sessionStorage usage (none exists in this component today).

## 7. Success Criteria (Acceptance Tests)

✓ Given a browser viewport ≥1280px wide (e.g. 1440×900) and the real frozen mock data (2 top-docked +
2 bottom-docked zones), when `Overlay` renders in a live session slide, then the panel is 780px wide,
340px tall, and the full assembly (both callout rows + panel) renders with no clipping — a ~48px margin
between the bottom callout row and the footer band's top edge, replacing today's ~32px clip.

✓ Given the same viewport, when the panel renders, then it occupies ~70% of the available body content
width (780/1112px), a measured increase from today's ~63%.

✓ Given a browser viewport <1280px wide (including exactly 375px), when `Overlay` renders, then the
panel renders at 280px wide, which fits inside the available body content width (311px at 375px
viewport) with margin on both sides — eliminating today's ~225%-overflowing 700px panel at that width.

✓ Given the admin-preview tool's fixed 944×520px box (content-width 816px) viewed on a typical
reviewer monitor (≥1280px, so the `xl:` tier is what actually renders), when `Overlay`'s preview
renders, then the 780px panel fits within the 816px content-width with a 36px margin — no *new*
horizontal clipping is introduced versus today (today's 700px panel already fit; this preserves that).

✓ Given any zone's `zone_label` at the `xl:` desktop tier (`CELL_W` = 260px), when the longest real
label text renders ("Application Layer", "Governance Layer" — 16–17 characters), then it displays at
`text-sm` (14px) without being cut off by `line-clamp-1` under normal conditions (verified against the
~230px of text-safe width remaining inside the pill after its own padding/icon/gap).

✓ Given the `SLOT_GRID`/`dockSide()` mapping and the TMPL-01 `styleOverrideSlots.ts` allowlist, when
this change ships, then neither is modified — `SLOT_GRID`'s row/col values, `dockSide()`'s edge
mapping, and every existing style-override key (`zone-color-*`, `callout-width`, `callout-height`,
`panel-border-width`) behave identically to before the change.

## 8. Error States
This is a static rendering fix with no user input, no API call, and no async data fetch — there is no
"request fails" or "loading" state to define. The only failure mode possible is a rendering/CSS
regression (e.g. an unexpectedly narrow container clipping content) which Section 9 covers as edge
cases, not runtime errors. No new error handling code is required in `Overlay.tsx` beyond what exists
today (there is none, and none is needed).

## 9. Edge Cases
- **Admin-preview tool (944×520 box) — vertical clipping is not fully resolved by this fix and is
  explicitly out of scope to fully fix here.** Per Section 2.1's table, that box's 272px body-height
  budget is smaller than the callout rows alone (264px) plus any panel height at all when both a top
  and bottom zone row are present (the real mock/seed data's exact shape). This fix reduces the
  severity (fewer wasted pixels once other numbers shift) but cannot eliminate it without either
  changing the shared 520px preview-box height in `TemplateApprovalClient.tsx` (affects all 27
  templates' previews — explicitly out of scope per the brief) or reducing the header/footer/shell
  padding values that the code comments explicitly document as "standard shell pattern" shared across
  templates (touching those risks visual inconsistency with the rest of the library — also avoided).
- **Browser windows between 768px and 1279px CSS width (e.g. a tablet in landscape, or a
  non-maximized laptop browser window) render the compact 280px panel tier, same as true mobile.**
  This is a deliberate, conservative choice: the alternative (a mid-size tier around 600–900px) was
  checked against the sidebar-inclusive worst case at those widths and found to overflow (see the
  rejected-approaches note); staying at 280px here guarantees no overflow at the cost of using less of
  the available space in that specific window-width range.
- **1366×768 laptops (very common resolution)** still clip by ~84px after this fix (down from 164px
  today) — a real, but not fully eliminated, improvement; see Section 2.1. Fully eliminating this would
  require accepting a much shorter/flatter panel than 340px, which was judged to compromise the panel's
  proportions more than the residual clip compromises legibility (the clipped region is callout-card
  whitespace/border, not the load-bearing panel content).
- **Zone configurations using only left/mid/right docking** (not present in the current mock data, but
  representable in `OverlayZonePosition`) have a much smaller vertical footprint (no top/bottom callout
  rows at all) — these fit comfortably in every container this document checks; the worst case analyzed
  throughout (top+bottom docking) is the binding constraint, not the average case.
- **Fewer than 4 zones, or zones only on one side** — layout math is unaffected; `topZones`/
  `bottomZones`/`leftZones`/`rightZones` filtering (unchanged) simply produces empty arrays for absent
  sides, and the vertical/horizontal budget only gets easier to satisfy, never harder.
- **`zone_label` truncation at the base/mobile 280px panel tier** — `CELL_W` shrinks to 93px there
  (down from today's uniform 233px); long labels will hit `line-clamp-1` truncation more readily than
  before. This is accepted as a reasonable trade at a tier whose entire point is being deliberately
  compact, and truncation was already the field's designed overflow behavior, not a new one.

## 10. Out of Scope
- Any change to `CalloutCard` or `Connector` sizing, spacing, or styling — these are unaffected and
  already independently adjustable via TMPL-01's existing `callout-width`/`callout-height` slots.
- Any change to the header band, footer ("So what?") band, or the `px-8 md:px-16 py-12`/`pb-20` shell
  padding values — these are shared "standard shell pattern" conventions (per the code's own comments)
  used for visual consistency across the template library; changing them here would risk Overlay
  looking inconsistent with the other 26 templates.
- Any change to `SLOT_GRID`, `dockSide()`, or the zone-position→edge mapping logic.
- Any change to `lib/templates/styleOverrideSlots.ts` or TMPL-01's fix-loop mechanism (no new slot keys
  added — see Section 12 for a possible future `panel-width`/`panel-height` slot pair).
- Any change to `containerBudgets.ts` character-budget numbers.
- Any change to any other template's renderer file.
- A systematic canvas-utilization audit of the other 26 templates — worth a future, separate pass
  (flagged, not started; TMPL-02 already covered font-size/overflow for all 27, but did not audit
  "does this template's canvas make good use of its container" the way this document does for Overlay
  specifically).
- Fully eliminating vertical clipping in the admin-preview tool or on 1366×768-class laptops for the
  top+bottom zone configuration — both are documented, bounded, honestly-reported residual limitations
  (Section 9), not solved by this pass.
- A fully fluid/container-query-based sizing approach — considered and rejected for this pass (Section
  4/above); documented as a future option below.

## 11. Open Questions
None.

## 12. Dependencies
- No new packages, environment variables, database migrations, or other agents' output are required —
  this is a self-contained change to `components/templates/renderers/Overlay.tsx`.
- Depends on nothing from TMPL-02 beyond it already having landed (confirmed: `callout_detail` is
  already `text-sm`, and `TemplateApprovalClient.tsx`'s preview box already has `position: relative`)
  — both were verified present in the current codebase, not assumed.
- **Future option (not built now, flagged per the brief's explicit instruction):** add `panel-width`/
  `panel-height` entries to `lib/templates/styleOverrideSlots.ts`'s `Overlay` allowlist (following the
  existing `RangeSlotSpec` pattern already used for `callout-width`/`callout-height`), so Arun's
  TMPL-01 automated-fix-loop feedback could adjust panel size directly in the future without a new code
  change. Not needed today since this document already sets the size to measured, justified values.
- **Future option:** a real container-query-based fully fluid panel size, if `@tailwindcss/
  container-queries` (or an equivalent already-approved mechanism) is ever added to the approved
  library list — would remove the need for the two-tier breakpoint compromise described in Section 4,
  at the cost of a new dependency not currently approved.
- **Future option:** a broader canvas-utilization pass across the other 26 templates (Section 10) —
  separate scope, separate BA document, not this one.

---

## CEO Review

Approved. Section 11 confirmed empty. Independently spot-checked the single most load-bearing claim
before approval: confirmed directly against `lib/templates/generator.ts`'s real `Overlay` mock data
that the 4 zones are exactly `top-left, top-right, bottom-left, bottom-right` — meaning the "worst
case" vertical layout (both a top row and a bottom row of callouts) this entire document is built on
is not a hypothetical, it is the exact configuration shown in every review and demo today. Traced the
vertical-budget arithmetic (Section 2.1's table) by hand and it is internally consistent across all
three container sizes checked.

The honesty in this document is exactly right and is explicitly endorsed, not just tolerated: it
would have been easy to quietly report "fixed" and stop there. Instead it discloses two real residual
limitations — the admin-preview tool's fixed 520px height cannot fit this zone configuration at any
panel height, and 1366×768 laptops still clip by 84px after this change (down from 164px) — and
explains precisely why each is out of scope for this specific pass rather than glossing over them.
That is the standard expected throughout this project.

The decision to reduce `PANEL_H` (420→340) rather than increase it, once the vertical-budget math
showed the current assembly is already clipping today, is approved as the correct, evidence-driven
call — it directly explains the "overlaps" language in Arun's original feedback, which a
naive "just make it bigger" response would have made worse, not better.

Developer agent: implement exactly what Section 4 specifies. Do not touch `SLOT_GRID`, `dockSide()`,
`CalloutCard`, `Connector`, the header/footer shell padding, `containerBudgets.ts`, or
`lib/templates/styleOverrideSlots.ts` — this is a bounded change to `Overlay.tsx`'s panel/grid
dimensions and one font size only.
