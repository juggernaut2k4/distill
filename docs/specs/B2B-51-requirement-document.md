# Demo Performance Tab — Literal Table of Reseller-Sent Session Fields — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-29

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Per this project's standing rule that specs must be grounded in real code, every load-bearing claim
in the CEO brief
(`.claude/agents/clio/feature-briefs/B2B-51-demo-performance-tab-reseller-api-parity.md`) was
re-checked directly against live code, not assumed:

- **`lib/partner/webhooks.ts`'s `WebhookPayload` interface** (lines 35-74) — confirmed by direct read.
  This is the real wire contract for the `session.insights_ready` webhook (B2B-09). Confirmed present:
  `extraction_status?`, `action_items?`, `glitches?`, `learner_insight?` (with exactly the four
  sub-fields `summary`, `topics_of_interest`, `engagement_style`, `suggested_next_topics`), plus
  identifier/envelope fields (`event_id`, `clio_session_ref`, `partner_reference`, `end_client_id`,
  `reseller_id`, `reseller_unique_id`, `hume_config_id`, `occurred_at`, `dispatched_at`, `test_mode`,
  `quantity`, `unit`, `generation_type`). This confirms the CEO brief's field list and its exclusions
  (glitches, `extraction_status`, and every identifier/envelope field) both trace to real fields in a
  real interface — nothing invented.
- **`app/api/demo/[slug]/performance/route.ts`** — confirmed by direct read (lines 1-135). The
  `PerformanceResponse` type actually returned to the client (line 38-43) is:
  ```ts
  type SessionState = 'not_dispatched' | 'in_progress' | 'pending_extraction' | 'extraction_failed' | 'ready'
  interface LearnerInsight {
    summary: string
    topics_of_interest: string[]
    engagement_style: string
    suggested_next_topics: string[]
  }
  interface PerformanceResponse {
    session_state: SessionState
    duration_minutes: number | null
    action_items: { text: string }[] | null
    learner_insight: LearnerInsight | null
  }
  ```
  The Supabase select at line 105 is `.select('extraction_status, action_items, learner_insight')` —
  confirmed it does **not** select `glitches`. `extraction_status` is read only to decide which
  `session_state` to return (lines 109-127); it is **never included in the JSON response body itself**
  — the route's own response objects never set an `extraction_status` key. So there is nothing to
  strip from the payload — it was never being sent to the client in the first place, only used
  server-side for state gating. This tab's route is already exactly as scoped as the CEO brief
  describes.
- **`app/(demo)/demo/[slug]/DemoTopicClient.tsx`** — confirmed by direct read (lines 90-193 for state/
  polling, lines 661-755 for the render). The "ready" branch (`else` clause starting line 691, ending
  line 753 — CEO brief's "roughly 691-753" is accurate) is the narrative layout: `<h3>`/`<p>` for
  Duration, `<ul>` (`listStyle`) for Action items, and for Learner insight a `<p>` summary plus three
  sub-groups — `topics_of_interest` and `suggested_next_topics` each rendered as `pillRowStyle`/
  `pillStyle` pill rows, `engagement_style` as a plain paragraph. No `<table>` element exists anywhere
  in this file today. The five non-"ready" branches (`performanceLoading`, `performanceFetchFailed ||
  !performanceData`, `not_dispatched`, `in_progress`/`pending_extraction`, `extraction_failed`) are
  confirmed structurally identical to each other — each renders a two-line dimmed heading/body pair
  (`perfEmptyHeadingStyle`/`perfEmptyBodyStyle`) and nothing else. None of these five branches read
  `action_items` or `learner_insight` at all (confirmed: both are `null` in every `PerformanceResponse`
  the route returns for `session_state !== 'ready'`, lines 90-125), so there is no possible code path
  by which a non-"ready" state could leak table content.
- **`app/(demo)/demo/_styles.ts`** — confirmed the file's established fluid-responsive conventions used
  throughout: `clamp()`-based spacing/typography (e.g. `tabRowStyle` line 239, `codeBlockStyle` line
  298), and `overflowX: 'auto'` used twice for genuinely horizontal content (`tabRowStyle` line 242's
  scrollable tab bar, `codeBlockStyle` line 299's scrollable code lines) — confirmed neither existing
  precedent is a field/value content table, which matters for the mobile-layout decision in §6.3 below.
  `COLORS`, `demoLabelStyle`, `pillStyle`/`pillRowStyle`, `listStyle`, `chapterBodyStyle` all confirmed
  present and reusable as-is.

All CEO brief claims held up under independent re-verification. No corrections needed.

## 1. Purpose

The demo's "Learn with AI" Performance tab exists so a reseller previewing the demo course can see,
concretely, the kind of post-session data Clio will actually send them once they're live — building
confidence the integration is worth building against. Today this content is presented as narrative
prose (headings, paragraphs, bullet lists, pill rows), which reads well for a human skimming a single
session but does not communicate "this is a defined data shape you can build against." Arun's
instruction is to reformat it as a literal table — field name in one row, the session's actual value in
the other — containing exactly the session-outcome fields Clio already sends resellers via the
`session.insights_ready` webhook, and nothing else. Two things are explicitly excluded, per Arun's own
direct correction after initially considering a filtered version: **glitches must never appear on this
tab in any form** (they are already shown correctly elsewhere, the internal glitch tracker, B2B-17),
and wire-envelope/pipeline-plumbing fields (identifiers, `extraction_status`) are excluded as
mechanism, not session content.

Failure without this: the tab keeps presenting data as loose prose, which under-communicates the "this
is a real, stable API contract" message the demo is meant to convey to a reseller evaluating whether to
integrate — and any accidental inclusion of glitch data here would directly contradict Arun's explicit
instruction and duplicate information that belongs solely in the internal glitch tracker.

## 2. User Story

As a **reseller evaluating Clio during a demo walkthrough**,
I want to see the exact fields and values Clio will send me about a completed session, presented as a
literal table rather than prose,
so that I can concretely evaluate the data shape I'd be integrating against and trust that what I see
in the demo matches what I'll actually receive in production.

As **Arun**,
I want the Performance tab to show only the reseller-facing session-outcome fields — never glitch data,
never wire-envelope/routing fields — presented as a table,
so that the demo accurately represents the real reseller contract without leaking internal-only
diagnostic information onto a reseller-facing surface.

## 3. Trigger / Entry Point

No new trigger. This is a display-only change to an existing screen:

- **Route:** `/demo/[slug]` (e.g. `/demo/claude-ai`, `/demo/oop-fundamentals`) — the existing "Learn
  with AI" demo topic page, `app/(demo)/demo/[slug]/DemoTopicClient.tsx`.
- **Action:** clicking the existing "Performance" tab (`TABS` array, line 35) — no new tab is added,
  no tab is removed, no tab is renamed.
- **State required:** none beyond what already gates this tab today. No auth, no passcode (this route
  is confirmed public/no-auth per the route's own header comment, unchanged by this brief). Content
  differs only by the existing `session_state` value already returned by
  `GET /api/demo/[slug]/performance` — no new state is introduced, no existing state is removed.

## 4. Screen / Flow Description

**Unchanged states (5 of 6) — confirmed explicitly in scope of this brief as "do not touch":**

1. **Loading** (`performanceLoading === true`): unchanged. Single muted line: "Loading…"
2. **Fetch failed / no data** (`performanceFetchFailed || !performanceData`): unchanged. Heading
   "Performance data is being prepared." + body "This usually takes a few minutes after the meeting
   ends. Check back shortly."
3. **`not_dispatched`**: unchanged. Heading "No meeting dispatched yet." + body "Once the bot has
   joined a meeting for this course, its performance data will appear here."
4. **`in_progress` / `pending_extraction`**: unchanged. Same two-line message as state 2 above.
5. **`extraction_failed`**: unchanged. Heading "Performance data couldn't be generated." + body
   "Something went wrong analyzing this meeting. Contact Clio if this keeps happening."

**Changed state (1 of 6) — `session_state === 'ready'`:**

Today: narrative sections (Duration paragraph, Action items bullet list, Learner insight
summary/pills/paragraph/pills). After this change: a single literal key-value table, always exactly
six rows, in this fixed order, present regardless of whether a given value is populated:

| Row (label shown in "Field" column) | Data source (unchanged from today) |
|---|---|
| Duration | `performanceData.duration_minutes` |
| Action items | `performanceData.action_items[].text` |
| Summary | `performanceData.learner_insight.summary` |
| Topics of interest | `performanceData.learner_insight.topics_of_interest[]` |
| Engagement style | `performanceData.learner_insight.engagement_style` |
| Suggested next topics | `performanceData.learner_insight.suggested_next_topics[]` |

The table has a header row: "Field" | "Value" (see §6.1 for reasoning). Row order is fixed and always
identical — the table's shape never changes based on what data is present; only cell contents change
(see §6.2 for empty-cell treatment). No row is ever added, removed, or reordered based on data.

User interaction: none beyond the existing tab click that reveals this content — the table itself is
static/read-only, no sorting, no filtering, no per-row actions.

## 5. Visual Examples

### 5.1 Ready state, table view — desktop/tablet width, fully populated session

```
┌──────────────────────────────────────────────────────────────────────┐
│  Course Overview   Transcript   Visuals   Resources   Discussion      │
│  Meeting   Learning Check   [Performance]                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌────────────────────────┬───────────────────────────────────────┐  │
│  │ Field                  │ Value                                 │  │
│  ├────────────────────────┼───────────────────────────────────────┤  │
│  │ Duration               │ 14.5 minutes                          │  │
│  ├────────────────────────┼───────────────────────────────────────┤  │
│  │ Action items           │ • Review the pricing page before the  │  │
│  │                        │   next call                           │  │
│  │                        │ • Share the onboarding checklist      │  │
│  ├────────────────────────┼───────────────────────────────────────┤  │
│  │ Summary                │ The learner asked mostly about        │  │
│  │                        │ pricing tiers and integration effort. │  │
│  ├────────────────────────┼───────────────────────────────────────┤  │
│  │ Topics of interest     │ • pricing                             │  │
│  │                        │ • integration effort                  │  │
│  ├────────────────────────┼───────────────────────────────────────┤  │
│  │ Engagement style       │ Asked clarifying questions throughout │  │
│  ├────────────────────────┼───────────────────────────────────────┤  │
│  │ Suggested next topics  │ • rollout planning                    │  │
│  │                        │ • team onboarding                     │  │
│  └────────────────────────┴───────────────────────────────────────┘  │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 Ready state, table view — sparse/empty session (e.g. `extraction_status: 'success_empty'`,
`action_items: []`, `learner_insight: null`)

```
┌────────────────────────┬───────────────────────────────────────┐
│ Field                  │ Value                                 │
├────────────────────────┼───────────────────────────────────────┤
│ Duration               │ 2.1 minutes                           │
├────────────────────────┼───────────────────────────────────────┤
│ Action items           │ None identified                       │
├────────────────────────┼───────────────────────────────────────┤
│ Summary                │ Not available                         │
├────────────────────────┼───────────────────────────────────────┤
│ Topics of interest     │ None identified                       │
├────────────────────────┼───────────────────────────────────────┤
│ Engagement style       │ Not available                         │
├────────────────────────┼───────────────────────────────────────┤
│ Suggested next topics  │ None identified                       │
└────────────────────────┴───────────────────────────────────────┘
```

(All six rows are still present — the table's shape does not collapse or shrink when the underlying
session produced little or no data. This is deliberate: showing the full, stable field set even when
mostly empty is part of what demonstrates "this is a fixed contract" to a reseller.)

### 5.3 Ready state, table view — narrow/mobile width (stacked field-above-value)

```
┌──────────────────────────┐
│ Course Overview ▸ ... ▸  │
│ [Performance]            │
├──────────────────────────┤
│                          │
│ Field                    │
│ Duration                 │
│ Value                    │
│ 14.5 minutes             │
│──────────────────────────│
│ Field                    │
│ Action items             │
│ Value                    │
│ • Review the pricing     │
│   page before the next   │
│   call                   │
│ • Share the onboarding   │
│   checklist              │
│──────────────────────────│
│ Field                    │
│ Summary                  │
│ Value                    │
│ The learner asked mostly │
│ about pricing tiers and  │
│ integration effort.      │
│──────────────────────────│
│  ... (remaining 3 rows,  │
│  same stacked pattern)   │
└──────────────────────────┘
```

This is not a separate visual design — it is the *same* row markup as 5.1/5.2 reflowing via CSS
flex-wrap once the viewport is too narrow to fit both columns side by side (see §6.3). No JavaScript
breakpoint detection, no separate mobile component.

### 5.4 Unchanged states (for completeness — no visual change from today)

```
┌─────────────────────────────────────┐   ┌─────────────────────────────────────┐
│ Loading…                             │   │ No meeting dispatched yet.           │
└─────────────────────────────────────┘   │ Once the bot has joined a meeting    │
                                            │ for this course, its performance     │
┌─────────────────────────────────────┐   │ data will appear here.               │
│ Performance data is being prepared.  │   └─────────────────────────────────────┘
│ This usually takes a few minutes     │
│ after the meeting ends. Check back   │   ┌─────────────────────────────────────┐
│ shortly.                             │   │ Performance data couldn't be         │
└─────────────────────────────────────┘   │ generated.                           │
                                            │ Something went wrong analyzing this  │
                                            │ meeting. Contact Clio if this keeps  │
                                            │ happening.                           │
                                            └─────────────────────────────────────┘
```

## 6. Data Requirements

No new data is read or written anywhere. This is a pure presentation change against the exact same
`PerformanceResponse` payload already fetched today.

- **Read from API (unchanged):** `GET /api/demo/[slug]/performance` → `PerformanceResponse` —
  `session_state`, `duration_minutes`, `action_items`, `learner_insight` (see §0 for the confirmed
  live shape). No new fields are requested; `glitches` and `extraction_status` are confirmed never
  present in this response body today (§0) and must never be added to it as part of this brief.
- **Written to database:** none. This route is read-only; no write path exists or is touched.
- **localStorage/sessionStorage:** none, unchanged.

### 6.1 Table layout decision — column headers

**Decision (BA, documented rather than left open):** the table has a visible header row reading
"Field" and "Value" — headerless field/value pairs were considered and rejected. Reasoning: this
table's entire purpose is to read like a small piece of API documentation to a reseller ("here is the
literal shape of what you'll receive") — the CEO brief itself presents the resolved field list the
same way, as a two-column table with an explicit header ("Table row" / "Source"). A header row costs
nothing and removes any ambiguity for a first-time reader about which column is the field name and
which is the value, especially once the table is scanned quickly rather than read top-to-bottom.
Header style: reuse `demoLabelStyle`'s existing small/muted/semi-bold treatment (already used
elsewhere on this page for field labels, e.g. "Topics of interest" today), with a `borderBottom: 1px
solid ${COLORS.border}` beneath the header row to separate it from data rows, consistent with the
divider convention already used by `chapterRowStyle`.

### 6.2 Multi-value field rendering within a single cell (BA design decision — resolved, not left open)

**Decision:** every multi-value field (Action items, Topics of interest, Suggested next topics) renders
as a vertical bulleted list inside its Value cell — reusing the existing `listStyle` bullet convention
already used for Action items today — **uniformly, regardless of item count** (a single-item list still
renders as one bullet, not collapsed to plain text). This applies even to `Topics of interest` and
`Suggested next topics`, which today render as pill rows (`pillRowStyle`/`pillStyle`) in the narrative
layout — pills are deliberately **not** carried into the table.

Reasoning:
1. **Consistency across the table.** A literal field/value table reads as a single coherent artifact;
   mixing a bullet list (Action items) with pill tags (Topics/Suggested topics) inside the same table
   would look like two different UI languages bolted together in adjacent rows. A bulleted list is the
   one representation that works cleanly for all three multi-value fields, whether the items are short
   tags ("pricing") or full sentences ("Review the pricing page before the next call").
2. **Comma-separation was considered and rejected** for the same three fields — action item text is
   free-form sentence content that may itself contain commas, making comma-joined text ambiguous about
   where one item ends and the next begins. A bulleted list has no such ambiguity for any of the three
   fields, so one rule covers all of them rather than needing per-field special-casing.
3. **Always-bulleted (even for 1 item) rather than count-dependent** keeps the render logic a single,
   unconditional rule ("array → bulleted list") with no branching on `.length`, which is both simpler
   to implement correctly and more predictable to test (§7).

### 6.3 Empty-cell / missing-data treatment (BA design decision — resolved, not left open)

Two rules, one for scalar fields and one for list fields, replacing the current narrative layout's
mixed per-field copy with a stable, table-appropriate convention (per the CEO brief's own suggestion to
translate "the same explicit convention the narrative layout already uses" into cell form — resolved
here as two simple rules rather than six separately-worded sentences, since a table cell should read as
short data, not a paragraph):

- **Scalar fields** (Duration, Summary, Engagement style) — when the underlying value is `null`, an
  empty string, or (for Duration/Summary/Engagement style specifically) the parent `learner_insight`
  object itself is `null` → render **"Not available"** in muted color (`COLORS.textMuted`), matching
  Duration's existing today's exact copy for this exact condition.
- **List fields** (Action items, Topics of interest, Suggested next topics) — when the array is `null`,
  absent, empty, or (for the two `learner_insight`-derived list fields) the parent `learner_insight`
  object itself is `null` → render **"None identified"** in muted color (`COLORS.textMuted`).

This means when `learner_insight` is `null` in its entirety (a real, confirmed-possible case per §0 —
`extraction_status: 'success_empty'` yields `learner_insight: null` while `duration_minutes` and
`action_items` may still be populated), all four `learner_insight`-derived rows (Summary, Topics of
interest, Engagement style, Suggested next topics) independently show their own empty-value text — the
table never collapses those four rows into one merged notice, because the table's row structure must
stay identical across every session (§4/§5.2) so a reseller always sees the same six-field shape.

### 6.4 Responsive/mobile behavior (BA design decision — resolved, per the standing responsive policy)

**Decision:** each table row is its own flex container that reflows via CSS `flex-wrap` — **not** a
horizontal-scroll table (the pattern already established elsewhere in this same stylesheet for
`codeBlockStyle`/`tabRowStyle`) and **not** a JS/media-query-driven breakpoint switch.

```
Row container:  display: flex; flexWrap: wrap; gap: '6px 20px';
                 padding: 'clamp(10px, 1.6vw, 14px) 0';
                 borderBottom: `1px solid ${COLORS.border}`
Field cell:      flexBasis: 'clamp(100px, 22%, 170px)'; minWidth: 100px; flexShrink: 0;
                 (demoLabelStyle-derived: small, semi-bold, COLORS.textMuted)
Value cell:      flex: '1 1 260px'; minWidth: 0;
                 (chapterBodyStyle-derived body copy; listStyle for list fields per §6.2)
Table wrapper:   marginTop: 'clamp(20px, 3vw, 28px)' (matches the existing spacing convention
                 already used immediately above this tab's content elsewhere on the page)
```

**Reasoning for diverging from the horizontal-scroll precedent:** `overflowX: 'auto'` is the right tool
for genuinely horizontal content where scrolling preserves meaning — a long code line, a row of tabs.
This table's Value cells contain prose (a summary sentence) and bulleted lists (action items) — content
that wants to **wrap and grow vertically**, not scroll horizontally. Scrolling a 2-column field/value
table sideways on a narrow phone would not solve anything (there's nothing wide to reveal by scrolling;
the problem on a narrow screen is the *label* column squeezing the *value* column, not extra columns
off-screen). A `flex-wrap` row, by contrast, is a genuinely fluid, tiered layout exactly in the spirit
of this project's standing responsive rule (no hardcoded breakpoint, no JS — the row naturally drops
the Value cell onto its own line below the Field label once the container can't fit both at their
minimum comfortable widths, and naturally un-stacks again as the viewport widens) — it is the correct,
non-boilerplate application of "genuinely responsive" for this specific content shape, not a copy-paste
of the nearest existing pattern.

**Existing `maxWidth: 760` outer tab-content wrapper — deliberately left untouched, flagged not
overlooked.** The Performance tab's content sits inside the same `<div style={{ maxWidth: 760,
marginTop: 24 }}>` wrapper every other tab on this page uses (Course Overview, Learning Check, etc.) —
a page-wide, pre-existing, uniformly-applied prose-column convention, not something specific to
Performance or introduced by this brief. It is not touched here because: (a) at 760px it does not
constrain real mobile viewports, which are almost universally narrower than 760px, so it never
"squeezes" content on the devices the standing policy is protecting; (b) changing it only for the
Performance tab would make this one tab's content column wider than every sibling tab's on the same
page, a worse inconsistency than leaving it alone; (c) fixing it page-wide (all 8 tabs) is a
page-level change well beyond this brief's CEO-approved "format change" scope. Logged in §10 as a
deliberate scope boundary, not a gap this spec missed.

## 7. Success Criteria (Acceptance Tests)

✓ AT-1: Given `session_state: 'ready'` with `duration_minutes: 14.5`, when the Performance tab renders,
then the table's "Duration" row Value cell reads exactly "14.5 minutes".

✓ AT-2: Given `session_state: 'ready'` with `action_items: [{text: 'Review the pricing page'}, {text:
'Share the onboarding checklist'}]`, when the Performance tab renders, then the "Action items" row
Value cell renders a bulleted list with exactly those two items, in the same order as the array.

✓ AT-3: Given `session_state: 'ready'` with a populated `learner_insight`, when the Performance tab
renders, then "Summary" shows `learner_insight.summary` verbatim, "Engagement style" shows
`learner_insight.engagement_style` verbatim, "Topics of interest" and "Suggested next topics" each
render as bulleted lists matching their respective arrays exactly.

✓ AT-4 (negative assertion — glitches never appear): Given any `session_state: 'ready'` payload,
including one where a test double injects a `glitches` array onto the `PerformanceResponse` object
(simulating a future accidental regression), when the Performance tab renders, then the rendered output
contains no table row, heading, or text referencing "glitch" in any form (case-insensitive substring
check on the full rendered DOM text), and the component's source never reads
`performanceData.glitches` or any property named `glitches` — verified both by rendered-output
assertion and by a static check that `DemoTopicClient.tsx` contains no reference to `glitches`.

✓ AT-5: Given `session_state: 'ready'` with `action_items: []` and `learner_insight: null` (the
`success_empty` case), when the Performance tab renders, then all six rows are present in the fixed
order (§4), "Duration" shows its actual value or "Not available" per its own null-check, "Action items"
shows "None identified", and "Summary"/"Topics of interest"/"Engagement style"/"Suggested next topics"
each independently show "Not available" (scalar fields) or "None identified" (list fields) per §6.3 —
no row is omitted, merged, or reordered.

✓ AT-6: Given `session_state` is any of `not_dispatched`, `in_progress`, `pending_extraction`, or
`extraction_failed`, when the Performance tab renders, then no `<table>` element (or table-row markup)
is present anywhere in the tab's content — only the existing unchanged heading/body message for that
state renders, byte-for-byte identical to today's copy.

✓ AT-7: Given the viewport is narrowed below the width at which the Field/Value flex row can fit both
cells side by side (per §6.4's `flex-wrap` rule), when the Performance table renders, then each row's
Value cell visually wraps onto its own line below the Field label (verified via a rendered
bounding-box/offset check — the Value cell's top offset exceeds the Field cell's bottom offset — rather
than a hardcoded pixel breakpoint assertion, since no fixed breakpoint exists by design).

✓ AT-8: Given `session_state: 'ready'` with `learner_insight.topics_of_interest: ['pricing']` (a single
item), when the Performance tab renders, then "Topics of interest" still renders as a one-item bulleted
list (a single bullet), not as plain unbulleted text — confirming the always-bulleted rule (§6.2)
applies regardless of count.

## 8. Error States

- **API fetch fails or returns non-OK** (`performanceFetchFailed === true`): unchanged from today — the
  existing "Performance data is being prepared." fallback message renders; the table is never attempted
  with partial/undefined data, since this branch is checked before the `'ready'`-state table render is
  reached (confirmed in the existing conditional chain, §0).
- **`performanceData` is present but malformed** (e.g. `learner_insight` present but missing an expected
  sub-field due to an unexpected upstream change): each Value cell's render logic must independently
  null/empty-check its own field per §6.3's two rules rather than assuming the whole `learner_insight`
  object is well-formed — a missing `engagement_style` string, for example, renders "Not available" for
  that row alone, without affecting the other three `learner_insight`-derived rows.
- **Slow network on first load**: unchanged — the existing muted "Loading…" line (§4, state 1) covers
  this; no new loading state is introduced for the table specifically, since the table only ever renders
  once `performanceData` is already available.

## 9. Edge Cases

- **`extraction_status: 'success_empty'`** (confirmed real, §0): duration may be populated while
  `action_items` is `[]` and `learner_insight` is `null` — covered explicitly by AT-5/§5.2. This is the
  single most important edge case for this brief, since it is the clearest real-world case where "some
  or all of these fields could legitimately be empty for a real session" (per the CEO brief's own
  caution) actually happens.
- **`duration_minutes: null`** (Hume duration lookup failed or session still resolving — confirmed
  possible per the route's own comment, §0): "Duration" row shows "Not available", independent of
  whatever `action_items`/`learner_insight` show.
- **Partial `learner_insight` data** (e.g. `learner_insight` has a populated `summary` but an empty
  `engagement_style` string, or one of the two arrays populated while the other is empty) — each of the
  six rows evaluates its own null/empty condition independently per §6.3; no row's rendering depends on
  any other row's data being present or absent.
- **A single-item vs. multi-item list** — always renders as a bulleted list regardless of count (§6.2,
  AT-8) — no special-casing collapses a one-item array to plain inline text.
- **Very long Summary text or a long Action item sentence** — the Value cell wraps naturally (no
  `nowrap`, no truncation, no ellipsis) via the same `chapterBodyStyle`/`listStyle` wrapping behavior
  already used for this content today; `minWidth: 0` on the Value flex cell (§6.4) is required
  specifically so long unbroken content does not force the row wider than its flex container instead of
  wrapping.
- **Mobile vs. desktop**: covered by §6.4's flex-wrap reflow — no separate mobile-only component, no
  JS-based viewport detection, no hardcoded pixel breakpoint.
- **User who never dispatched a session for this demo slug, or whose session is still in progress**:
  unaffected — these map to `session_state` values other than `'ready'` and render exactly as they do
  today (§4, AT-6).
- **Slow network / API timeout**: unchanged from today's existing handling (§8).

## 10. Out of Scope

- **Glitches, in any form, anywhere on this tab.** Not filtered, not demo-topic-scoped, not referenced
  even as a "see the glitch tracker for more" pointer. Per Arun's explicit, twice-repeated instruction.
- **`extraction_status`** — internal pipeline-gating value; already correctly never included in the API
  response body today (§0) and must stay that way. Not a table row.
- **All wire-envelope/routing/identifier fields** from `WebhookPayload` — `event_id`, `clio_session_ref`,
  `partner_reference`, `reseller_id`, `reseller_unique_id`, `end_client_id`, `hume_config_id`,
  `occurred_at`, `dispatched_at`, `test_mode`, `generation_type`, `quantity`, `unit`. None of these are
  fetched by this route today and none should be added.
- **Any change to `lib/partner/webhooks.ts`'s `WebhookPayload` contract**, `GET
  /api/partner/v1/sessions/[clio_session_ref]`, or `GET /api/partner/v1/usage` — this is a demo-tab
  display-only change; the real reseller webhook contract is untouched.
- **Any change to `app/api/demo/[slug]/performance/route.ts`'s Supabase `.select()`** — already correct
  (`extraction_status, action_items, learner_insight`, no `glitches`); left exactly as-is.
- **The existing `maxWidth: 760` outer tab-content wrapper** — deliberately left untouched; see §6.4's
  reasoning. Flagged here as a conscious scope boundary for the Orchestrator/developer, not an
  oversight.
- **The five non-"ready" `session_state` branches** — confirmed unaffected (§4, §9, AT-6); no code
  change to their markup or copy.
- **`isFirstPartyDemoPageUrl()`/`resolveInlineSessionRender()`'s first-party branch and
  `PartnerRenderClient.tsx`'s `sourceUrl` iframe branch** — per the CEO brief's explicit protection;
  confirmed nowhere near this brief's touched file.
- **Sorting, filtering, or per-row interactivity within the table** — it is a static, read-only display,
  matching the read-only nature of the data it presents.

## 11. Open Questions

None. All scope and content questions were resolved by the CEO brief. The two presentation-layer
decisions the CEO brief explicitly left for BA (exact list-rendering-within-a-cell format, and
responsive/mobile behavior) are resolved above with documented reasoning, not left open:

1. Multi-value-in-cell rendering — §6.2 (uniform bulleted list, always, regardless of item count).
2. Mobile/responsive behavior — §6.4 (flex-wrap row reflow, not horizontal scroll, not a hardcoded
   breakpoint).
3. Table header row — §6.1 (visible "Field"/"Value" header, reasoned rather than defaulted).
4. Empty-cell convention — §6.3 (two simple rules: scalar → "Not available", list → "None identified"),
   translating the CEO brief's own suggested-but-unspecified convention into a concrete, uniform rule.

## 12. Dependencies

- **No new libraries, no new environment variables, no new vendor.** Pure JSX/CSS using this codebase's
  existing `app/(demo)/demo/_styles.ts` tokens (`COLORS`, `demoLabelStyle`, `chapterBodyStyle`,
  `listStyle`) — `pillStyle`/`pillRowStyle` are deliberately **not** reused for this table (§6.2).
- **No schema/migration changes** — no database involvement at all in this brief.
- **Depends on** `GET /api/demo/[slug]/performance` continuing to return exactly the confirmed
  `PerformanceResponse` shape (§0) — no change requested to that route.

## 13. Test Plan

- **Unit/component tests** (new file, e.g. `tests/unit/b2b51-performance-tab-table.test.tsx`, or
  integrated into whatever existing test convention covers `DemoTopicClient.tsx` if one exists — none
  was found in this repo's `tests/` tree at spec-writing time, so this may be the first dedicated test
  file for this component): covers AT-1 through AT-8 via rendering the "ready"-state branch with
  constructed `PerformanceResponse` fixtures (full data, `success_empty`-shaped sparse data, and a
  glitches-injected fixture for the AT-4 negative assertion) and asserting on rendered DOM text/
  structure.
- **Static/negative check** (part of the same test file or a lightweight source-grep test): assert
  `DemoTopicClient.tsx` contains no substring `glitches` anywhere in the file — a second, independent
  layer of the AT-4 guarantee beyond the rendered-output check, so a future edit that merely stops
  *rendering* glitches but still imports/reads the field would still fail this check.
- **Responsive check** (AT-7): a rendered layout assertion (bounding-box/offset comparison) at a narrow
  simulated viewport width, confirming the flex-wrap reflow — not a Playwright/E2E test, since this is
  pure CSS layout behavior verifiable at the component level; an E2E pass is optional/nice-to-have, not
  required, given no existing Playwright coverage of this page was found.
- **Regression check for the five unaffected states** (AT-6): re-run/confirm any existing test coverage
  (if present) for `not_dispatched`/`in_progress`/`pending_extraction`/`extraction_failed`/loading/
  fetch-failed continues to pass unmodified — this brief's diff should not touch those branches' JSX at
  all, so this is a low-risk confirmation rather than new test-writing.
