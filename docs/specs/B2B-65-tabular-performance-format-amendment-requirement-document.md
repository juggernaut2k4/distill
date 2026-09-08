# Demo Performance Tab — Literal Tabular Format Amendment — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-08-02
Amends: `docs/specs/B2B-65-requirement-document.md` (the original B2B-65 spec, Built and shipped
2026-08-01, per `docs/b2b-pivot-status.md`'s B2B-65 row)

---

## Relationship to the original B2B-65 spec — what this document changes vs. leaves alone

This is a **second, separate amendment** to the already-shipped B2B-65 feature (a first same-day
amendment on 2026-08-01 changed the empty-state/non-ready-state text into an always-shown table
shell — see the original spec's own `docs/b2b-pivot-status.md` row for that history). Filed as its
own document (following the CEO brief's own precedent of filing this second amendment as a
separate, dedicated file, `.claude/agents/clio/feature-briefs/B2B-65-tabular-performance-format-
amendment.md`, rather than editing the original file in place) so the original spec remains an
intact, accurate historical record of exactly what was built and approved on 2026-08-01.

**This document supersedes, specifically:**
- Original §4.B's entries-list rendering (State B1's per-entry card, and the four/five bullet
  Field/Value rows shown per card) — replaced by a genuine `<table>`, one `<tr>` per session, one
  `<td>` per field, all confirmed real columns.
- Original §5 (wireframes for the entries list) — replaced by this document's own wireframes below.
- Original §6.4 (the `entries` query's `.select()` list and the `PerformanceEntry` TypeScript shape)
  — widened from 6 fields to all 18 real `partner_session_insights` columns (learner_insight's 4
  sub-fields rendered as their own columns, for 21 total table columns — see §6 below).

**This document leaves completely unchanged (confirmed by direct re-read, §0 below):**
- The admin toggle mechanism (`system_demo_performance_config`, `DemoPerformanceToggleCard.tsx`,
  `getDemoPerformanceAppendEnabled()`) — original §4.A, §6.1, §6.3. Not touched, not re-verified
  beyond confirming the file still exists unmodified.
- The extraction-completion write that sets `demo_performance_visible` — original §6.3. Not touched.
- The permanence/no-retroactive-re-evaluation design — original §6.2, §9. Not touched.
- The per-topic (`partner_reference`) scoping of the accumulating list — original §11 Q1. Not
  touched; this document's widened query keeps the exact same scoping.
- The single-latest-session "ready + 0 entries" Field/Value table (Duration/Usage block, original
  lines ~808–873 as re-read below) — entirely unrelated to the `entries` list, confirmed unaffected.
- The B3 "processing" note and B4 "failed dispatch, entries still show" priority logic — same
  behavior, just wrapping a `<table>` instead of a stack of cards.

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Per this project's standing rule (`docs/specs/B2B-63-requirement-document.md` §0, `docs/specs/
B2B-64-requirement-document.md` §0, and the original B2B-65 spec's own §0), every load-bearing claim
in the amendment brief was re-checked directly against source before writing this document.

- **`app/api/demo/[slug]/performance/route.ts`, confirmed by direct read (full file, 274 lines,
  current as of this writing — NOT the 193-line version the original B2B-65 spec's §0 described; the
  route has since been rewritten once more).** A **2026-08-02 root-cause fix**, applied after the
  original B2B-65 spec was written and independent of this amendment, rewrote every `.maybeSingle()`
  call on this route to a plain array-fetch-plus-`[0]` pattern (a Supabase/PostgREST client
  reliability issue, documented in the route's own comment, lines 101–108) and — separately —
  rewrote the `entries` query from the original spec's single query with an embedded
  `partner_sessions!inner(partner_reference)` filter into **two plain queries**: first resolve
  matching `partner_sessions.id` values for this slug (lines 122–127), then
  `.in('partner_session_id', ids)` against `partner_session_insights` (lines 131–137) — the embedded-
  filter form was independently found to return zero rows for confirmed-matching sessions (route
  comment, lines 117–120). **This is the load-bearing, corrected basis for this document's §6 API
  change below** — the widened `.select()` this document specifies is added to the *second* of these
  two queries (line 133's `.select('extracted_at, action_items, learner_insight')`), not to the
  single-query form the CEO brief's Known Constraints section describes quoting the original spec.
  Confirmed the current `PerformanceEntry` interface (lines 58–65) and `PerformanceResponse` shape
  (lines 67–74) exactly as the brief described (6 fields), and confirmed the exact current mapping
  logic (lines 141–152) this document's widened mapping extends.
- **`partner_session_insights`'s real, current, live column set — confirmed directly against every
  migration that touches this table** (`grep -l "partner_session_insights" supabase/migrations/*.sql`
  → `078`, `082`, `095`, `096`, `099`, `101`, `107`; migrations `082`/`101` confirmed by direct read to
  touch only `glitch_instances`/`glitch_issues`, never adding/removing a column on
  `partner_session_insights` itself). **This produced two corrections to the CEO brief's own field
  table, both flagged here explicitly per this project's verification convention — not silently
  fixed:**
  1. **The brief's "Reseller ID | `reseller_id`" row does not correspond to any real column on
     `partner_session_insights`.** Confirmed by full-file read of migration `099_b2b38_session_
     traceability_ids.sql`: `reseller_id` is added as its own column only on **`partner_session_trace_
     logs`** (a different table entirely, line 31) and **`glitch_instances`** (line 89, populated by
     the `fanout_glitch_instances()` trigger, line 136: `NEW.partner_account_id — reseller_id, always
     equal to partner_account_id`). `partner_session_insights` itself was never given a same-named
     column — on this table, the reseller identity is carried entirely by `partner_account_id` (the
     brief's own separate, correctly-identified "Partner Account ID" row), exactly the same
     duplicate-by-construction relationship migration 099's own comment documents for the sibling
     tables ("`reseller_id` duplicates `partner_account_id` on every row by construction... kept as
     its own named column anyway" — stated there for `partner_session_trace_logs`, not for this
     table). **Resolution: no separate "Reseller ID" table column is queried or rendered; the "Partner
     Account ID" column's own description below notes it doubles as the reseller identifier.**
  2. **The brief's field table omits two real columns that do exist on `partner_session_insights`:
     `hume_chat_id` (TEXT, migration 078, line 43) and `created_at` (TIMESTAMPTZ NOT NULL, migration
     078, line 58).** Both are confirmed live, real, currently-populated columns. Arun's own instruction
     was **"display everything in this table"** — an explicit, literal "all fields" directive, not
     the brief's own necessarily-exhaustive enumeration of them. Since the brief's list has one
     phantom entry and two omissions relative to the real schema, and Arun's actual words say
     "everything," this document resolves the field list to the **verified real 18-column schema**
     (below) rather than the brief's slightly-off 19-row list — net effect is +2 columns
     (`hume_chat_id`, `created_at`) and −1 phantom row (`reseller_id`), i.e. genuinely closer to "all
     fields," not a narrowing of Arun's decision. This is a technical/schema-verification correction
     (exactly what this project's §0 convention exists to catch), not a reopening of the field-
     inclusion policy question Arun already decided.
  - **Confirmed final, real, live `partner_session_insights` column list (18 columns):** `id`,
    `partner_session_id`, `partner_account_id`, `hume_chat_id`, `extraction_status`, `action_items`,
    `glitches`, `transcript_event_count`, `attempt_count`, `error_message`, `extracted_at`,
    `full_detail_purged_at`, `created_at`, `end_client_id` (migration 095), `learner_insight`
    (migration 096, replaced the now-fully-removed `psychology_keywords`), `reseller_unique_id`
    (migration 099), `hume_config_id` (migration 099), `demo_performance_visible` (migration 107,
    default `false`, `NOT NULL`). No migration after `107` touches this table (confirmed:
    `107_b2b65_demo_performance_toggle_and_accumulation.sql` is the current highest-numbered
    migration in `supabase/migrations/`, re-confirmed via `ls` at the time of writing).
  - **`glitches`'s real shape, confirmed from migration 078's purge function (lines 111–117) and
    migration 082's fan-out trigger**: a JSONB array of objects, each `{ type: string, description:
    string | null }` — `description` is present for the first 30 days after `extracted_at`, then the
    daily purge job (migration 078's `purge_partner_session_insights_full_detail`) permanently
    rewrites each element to `{ type }` only (description dropped). This document's rendering (§6)
    accounts for both shapes.
- **`app/(demo)/demo/[slug]/DemoTopicClient.tsx`, confirmed by direct read of the full relevant
  ranges (lines 1–210 for style constants/cell components, lines 780–953 for the render block, 953
  lines total — up from the original spec's confirmed 866, reflecting the B2B-57a Usage block and
  the first B2B-65 amendment landing since).** Confirmed exactly:
  - `PerfScalarCell` (lines 169–174) and `PerfListCell` (lines 179–190) are plain functions with no
    row/label wrapper of their own — they render only the cell's *value* (a string, or a `<ul>` of
    bullets), with the existing "Not available"/"None identified" muted-placeholder fallback. **These
    two are directly reusable inside a `<td>`, unchanged, with zero modification** — confirmed the
    right reuse target the brief pointed to.
  - `PerfTableRow` (lines 192–199) is a **label-left/value-right flex row** (`perfTableRowStyle`,
    lines 97–103: `display: flex, flexWrap: wrap`) — this is the old card format's row primitive, not
    compatible with a literal grid table's columns-across layout. **This document does NOT reuse
    `PerfTableRow`/`perfTableRowStyle`/`perfTableWrapperStyle`/`perfEntryCardStyle`/
    `perfEntryTimestampStyle` for the entries list** (§6 below defines new, table-specific style
    constants instead) — but confirms these are NOT deleted, since the unrelated "ready + 0 entries"
    single-session table (lines 808–873) keeps using them unchanged, exactly as this amendment's own
    non-goals require.
  - The current entries-list render block (lines 885–945) is exactly the "always show table shell"
    structure the first amendment produced: a `perfEntriesProcessingNoteStyle` note conditionally
    above, then a `perfTableWrapperStyle`-wrapped block containing either a `.map()` over
    `performanceData.entries` (one `perfEntryCardStyle` div per entry, each containing 5
    `PerfTableRow`s) or, when `entries.length === 0`, one placeholder set of the same 5 `PerfTableRow`s
    each rendering their own null-fallback. **This document's new table replaces exactly this
    `.map()`/placeholder structure** (lines 895–943), leaving the conditional processing-note
    (line 887) and the `session_state === 'ready' && entries.length === 0` branch above it (lines
    808–873, a completely different code path for a completely different scenario) untouched.
- **Horizontal-scroll precedent, confirmed by direct read of `app/(with-clerk)/dashboard/
  configurator/api/ApiClient.tsx` (lines 16–49, 129–169).** Confirmed real and exactly as the brief
  described: a `<div style={{ overflowX: 'auto' }}>` wrapper around a plain `<table>` styled with
  local `tableStyle`/`thStyle`/`tdStyle` constants (border-collapse, `12px` font, `borderBottom`
  dividers, no fixed column widths, `verticalAlign: 'top'` on cells) — added there for the exact same
  reason (B2B-64, per that file's own comment at lines 141–145: "a genuine responsive gap in the exact
  table being edited"). This document's new table reuses this same shape (its own locally-scoped
  style constants, §6 below), not a copy-paste import across files (matching this codebase's existing
  convention of duplicating small, page-local style objects rather than sharing them cross-file, per
  the original B2B-65 spec's own §0 note on `PerformanceEntry` type duplication).
- **Call-site/backward-compatibility check for `GET /api/demo/[slug]/performance` (CEO brief's
  Question 2's "is this endpoint used anywhere else" ask), confirmed by repo-wide search.** The only
  production consumer of this route is `DemoTopicClient.tsx` itself (this document's own target
  file). Five test files reference "demo"+"performance" (`demo-performance-route.test.ts`,
  `b2b65-extractor-demo-visibility.test.ts`, `b2b65-demo-performance-config-api.test.ts`,
  `b2b65-demo-performance-toggle-card.test.tsx`, `b2b65-performance-config-helper.test.ts`) — these
  will need their `entries` assertions extended to the new field set (a Dev/Testing-agent task, not a
  spec ambiguity) but confirm no other page, API route, or job reads this endpoint's `entries` field.
  **Adding fields to `entries` objects is additive and non-breaking for this route's one real
  consumer** — no backward-compatibility risk exists.

Nothing in the CEO brief's claims was found to invalidate its actual decisions (the field-inclusion
policy, the 3-record cap, the horizontal-scroll approach) — the two corrections above are schema-
verification fixes only, both flagged transparently. This document resolves all 6 of the brief's
open questions below with direct-code-backed reasoning, leaving zero items in Section 11.

---

## 1. Purpose

Arun wants to personally review real, accumulating demo-session outcomes in the most literal,
information-dense form possible — a genuine spreadsheet-style table, one row per session, one column
per database field — rather than the current card/Field-Value layout, while he runs real demo
sessions over the next several days. He has explicitly and knowingly chosen to include every column
of `partner_session_insights`, including internal identifiers and diagnostic fields normally kept off
any partner-facing or public surface, as a temporary, self-owned exception he will personally remove
before production. Without this change, Arun cannot see the full raw shape of what's being captured
per session at a glance — the current card format only surfaces 5 of the table's 18 real columns, one
session at a time, requiring him to scroll through cards rather than scan rows.

## 2. User Story

As Arun (product owner, personally reviewing accumulating demo-session data before production),
I want the Performance tab's accumulating entries list to render as a literal table — one row per
session, one column per real database field, all fields included — capped to the 3 most recent
records,
So that I can scan real session outcomes at a glance in the most literal, unfiltered form while
deciding whether the data quality is good enough, with full awareness that I will personally remove
this table before any production/customer-facing use.

## 3. Trigger / Entry Point

Unchanged from the original B2B-65 spec §3, restated for completeness:
- **Route:** `/demo/claude-ai` and `/demo/oop-fundamentals`, "Performance" tab (public page, no auth,
  no passcode — confirmed unchanged, §0).
- **Trigger:** tab click (`activeTab === 'Performance'`, existing tab-state mechanism, unmodified).
- **Backing read:** `GET /api/demo/[slug]/performance`, extended per §6 below — same route, same
  public/unauthenticated posture, same "always 200, no HTTP-layer error state" contract.
- **Required state:** none — identical to today, matches every other `/api/demo/[slug]/*` route.

No new route, no new page, no new trigger. Only the shape of the `entries` array and the markup that
renders it change.

## 4. Screen / Flow Description

### 4.A — What does NOT change

- The Performance tab's "ready + 0 entries" single-latest-session Field/Value table (Duration, Action
  items, Summary, Topics of interest, Engagement style, Suggested next topics, then the B2B-57a Usage
  block) — confirmed unchanged, §0. Still renders via `PerfTableRow`/`perfTableRowStyle`/
  `perfTableWrapperStyle`, unmodified.
- The muted "A new session is being processed and will be added here once ready." note, shown above
  the accumulating section whenever the latest dispatch is `in_progress`/`pending_extraction` —
  unchanged condition, unchanged copy, unchanged position (directly above the new table).
- The entries-list-takes-priority-over-latest-failure behavior (State B4 below) — unchanged logic,
  only the visual container changes from stacked cards to table rows.
- The admin toggle (`/dashboard/admin`, `DemoPerformanceToggleCard.tsx`) — zero changes, not
  re-described here; see the original spec's §4.A for its full state set.

### 4.B — What changes: the accumulating entries section

Everywhere the original spec's §4.B States B1–B5 described a **stack of Field/Value cards**, this
document replaces it with a **single literal `<table>`**, described state-by-state below. All state
*triggers/conditions* are identical to the original spec — only the visual container for
"the accumulating entries" changes.

**State B1 — 1 or more real entries have accumulated for this slug (real data — see the explicit
non-illustrative-data note below):**

A genuine HTML table, wrapped in a horizontal-scroll container, header row with all 21 column labels
(§6 defines the exact list/order), one data row per accumulated session (newest-first by
`extracted_at`), capped to the **3 most recent** (§6, `DEMO_PERFORMANCE_TABLE_DISPLAY_LIMIT`). Full
wireframe in §5 State B1 below.

**This wireframe (§5) is a labeled mockup only, illustrating SHAPE (column order, row structure,
horizontal-scroll affordance) — never real session content.** Per the hard constraint carried
forward unchanged from the original spec (§ Known Constraints, § Out of Scope): the live
implementation renders zero rows until real demo sessions have actually been dispatched, extracted,
and appended — never synthetic/illustrative rows in any environment.

**State B2 — zero entries exist yet for this slug:** Table shell still renders (header row with all
21 columns), with exactly **one** placeholder data row: every scalar-type column shows "Not
available", every list-type column (Glitches/Action Items/Topics of Interest/Suggested Next Topics)
shows "None identified" — the identical per-field-type placeholder convention the first B2B-65
amendment already established for the 6-column card format (`docs/b2b-pivot-status.md`'s B2B-65 row:
"show the table headers and empty table... whenever you get the API with values, you can just
populate it"), now simply extended to all 21 columns instead of 5. This carries the established
precedent forward rather than reverting to the older plain-text "No performance examples yet..."
copy the very original (pre-first-amendment) design used — resolves CEO brief Question 6.

**State B3 — 1+ entries exist, but the LATEST dispatch is still processing:** The existing muted
"A new session is being processed and will be added here once ready." note appears above the table,
exactly as today — unchanged condition (`session_state === 'in_progress' || 'pending_extraction'`),
unchanged copy, unchanged position. The table itself renders exactly as State B1.

**State B4 — 1+ entries exist, but the LATEST dispatch's extraction failed:** No error copy shown
anywhere. The table renders exactly as State B1 — the already-accumulated real entries are
unaffected by the most recent attempt's own failure (unchanged from the original spec's design
intent).

**State B5 — toggle is OFF, entries exist from when it was ON:** Rendered identically to State B1 —
the toggle's current state has zero visual effect on already-appended rows (unchanged permanence
design, original spec §6.2/§6.3). No "paused" banner on the public page.

## 5. Visual Examples

**State B1 — wireframe (illustrating shape only, never real content — see the explicit non-
illustrative-data note in §4.B):**

```
┌────────────────────────────────────────────────────────────────────────────────────────── … ┐
│ Performance                                                                                    │
│                                                                                                 │
│  Scroll horizontally to see all columns →                                                      │
│  ┌───────────────────────────────────────────────────────────────────────────────────────── … │
│  │ ID       │ Session  │ Partner  │ End      │ Reseller │ Hume     │ Hume     │ Extraction│ …  │
│  │          │ ID       │ Account  │ Client   │ Unique   │ Chat ID  │ Config   │ Status    │    │
│  │          │          │ ID       │ ID       │ ID       │          │ ID       │           │    │
│  ├───────────────────────────────────────────────────────────────────────────────────────── … ─┤
│  │ 3f2a…e91 │ 88b1…04c │ 30d4…13a │ Not      │ Not      │ hc_9f2…  │ Not      │ success   │ …  │
│  │          │          │          │ available│ available│          │ available│           │    │
│  ├───────────────────────────────────────────────────────────────────────────────────────── … ─┤
│  │ 7c1e…22d │ ab90…7f1 │ 30d4…13a │ Not      │ Not      │ hc_1a4…  │ Not      │ success   │ …  │
│  │          │          │          │ available│ available│          │ available│           │    │
│  ├───────────────────────────────────────────────────────────────────────────────────────── … ─┤
│  │ 0d4f…b3a │ 51ce…9d0 │ 30d4…13a │ Not      │ Not      │ hc_5e0…  │ Not      │ success_  │ …  │
│  │          │          │          │ available│ available│          │ available│ empty     │    │
│  └───────────────────────────────────────────────────────────────────────────────────────── … ─┘
│  … (scrolled further right) …                                                                  │
│  │ … │ Attempt │ Error     │ Transcript │ Full Detail│ Created  │ Demo Perf│ Glitches │ …       │
│  │   │ Count   │ Message   │ Event Count│ Purged At  │ At       │ Visible  │          │         │
│  ├───┼─────────┼───────────┼────────────┼────────────┼──────────┼──────────┼──────────┤         │
│  │ … │ 1       │ Not       │ 42         │ Not        │ Aug 1,   │ Yes      │ • misunderstanding:│
│  │   │         │ available │            │ available  │ 2026,    │          │   asked twice about│
│  │   │         │           │            │            │ 9:14 AM  │          │   pricing tiers    │
│  ├───┼─────────┼───────────┼────────────┼────────────┼──────────┼──────────┼──────────┤         │
│  │ … (more rows, more columns — Extracted At / Action Items / Summary / Topics of Interest /     │
│  │     Engagement Style / Suggested Next Topics follow, each per §6's exact column list) …       │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**State B2 — zero real entries, table shell + one placeholder row:**

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ Performance                                                                           │
│                                                                                        │
│  Scroll horizontally to see all columns →                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────────  │
│  │ ID           │ Session ID   │ Partner Account ID │ End Client ID │ … (21 cols) …  │
│  ├─────────────────────────────────────────────────────────────────────────────────  │
│  │ Not available│ Not available│ Not available       │ Not available │ …             │
│  └─────────────────────────────────────────────────────────────────────────────────  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Mobile wireframe, 375px viewport width (State B1, resolves CEO brief Question 3):**

```
┌───────────────────────────────┐
│ Performance                    │
│                                 │
│ Scroll horizontally to see      │
│ all columns →                   │
│ ┌───────────┬───────────┬─ … ▸ │  ← visible: ID + partial Session ID column, before the
│ │ ID        │ Session ID│     │    viewport's right edge clips the row — the "Scroll
│ ├───────────┼───────────┼─ … ▸│    horizontally…" caption line (always shown, not
│ │ 3f2a…e91  │ 88b1…04c  │     │    conditional on overflow-detection) is the explicit
│ ├───────────┼───────────┼─ … ▸│    visual affordance a mobile user sees BEFORE
│ │ 7c1e…22d  │ ab90…7f1  │     │    touching the table, telling them more columns exist
│ ├───────────┼───────────┼─ … ▸│    off-screen — no JS overflow-detection needed, the
│ │ 0d4f…b3a  │ 51ce…9d0  │     │    caption is unconditional (§6 reasoning).
│ └───────────┴───────────┴─ … ▸│
└───────────────────────────────┘
    (touch-scroll right reveals Partner Account ID, End Client ID, … through all 21 columns,
     in the same fixed order as desktop — no column reordering/hiding on mobile, per the
     brief's own "no reflow into stacked cards" instruction)
```

## 6. Data Requirements

### 6.1 — Exact final column list (21 table columns, from 18 real `partner_session_insights` columns
— confirmed against live migrations, §0)

| # | Column header | Source field | DB type | Renders as |
|---|---|---|---|---|
| 1 | ID | `id` | UUID NOT NULL | Raw UUID, monospace font |
| 2 | Session ID | `partner_session_id` | UUID NOT NULL | Raw UUID, monospace font |
| 3 | Partner Account ID | `partner_account_id` | UUID NOT NULL | Raw UUID, monospace font — this is the reseller identifier by construction (§0); no separate "Reseller ID" column exists on this table |
| 4 | End Client ID | `end_client_id` | UUID NULLABLE | Raw UUID (monospace) or "Not available" |
| 5 | Reseller Unique ID | `reseller_unique_id` | TEXT NULLABLE | Plain text or "Not available" |
| 6 | Hume Chat ID | `hume_chat_id` | TEXT NULLABLE | Plain text or "Not available" — **BA-added; omitted from the CEO brief's own list, confirmed real via migration 078 (§0)** |
| 7 | Hume Config ID | `hume_config_id` | TEXT NULLABLE | Plain text or "Not available" |
| 8 | Extraction Status | `extraction_status` | TEXT NOT NULL (enum: `pending`/`success`/`success_empty`/`failed`) | Plain text, always present |
| 9 | Attempt Count | `attempt_count` | INTEGER NOT NULL DEFAULT 0 | Plain number, always present |
| 10 | Error Message | `error_message` | TEXT NULLABLE | Plain text or "Not available" |
| 11 | Transcript Event Count | `transcript_event_count` | INTEGER NULLABLE | Plain number or "Not available" |
| 12 | Full Detail Purged At | `full_detail_purged_at` | TIMESTAMPTZ NULLABLE | `formatSavedAt()`-formatted or "Not available" |
| 13 | Created At | `created_at` | TIMESTAMPTZ NOT NULL | `formatSavedAt()`-formatted, always present — **BA-added; omitted from the CEO brief's own list, confirmed real via migration 078 (§0)** |
| 14 | Demo Performance Visible | `demo_performance_visible` | BOOLEAN NOT NULL | "Yes" / "No" (BA formatting decision, §9 — will always read "Yes" for every row this query can ever return, since the query itself filters `eq('demo_performance_visible', true)`; included anyway per Arun's literal "everything" instruction) |
| 15 | Glitches | `glitches` | JSONB NULLABLE, array of `{ type, description \| null }` | Bulleted list, one glitch per line: `"{type}: {description}"` when `description` is present, or just `"{type}"` when absent (post-30-day-purge shape, §0) — "None identified" if null/empty array |
| 16 | Extracted At | `extracted_at` | TIMESTAMPTZ NULLABLE | `formatSavedAt()`-formatted or "Not available" |
| 17 | Action Items | `action_items` | JSONB NULLABLE, array of `{ text }` | Bulleted list (one `text` per line) via `PerfListCell` — "None identified" if null/empty |
| 18 | Summary | `learner_insight.summary` (sub-field) | TEXT NULLABLE | Plain text via `PerfScalarCell` or "Not available" |
| 19 | Topics of Interest | `learner_insight.topics_of_interest` (sub-field) | TEXT[] | Bulleted list via `PerfListCell` — "None identified" if empty |
| 20 | Engagement Style | `learner_insight.engagement_style` (sub-field) | TEXT NULLABLE | Plain text via `PerfScalarCell` or "Not available" |
| 21 | Suggested Next Topics | `learner_insight.suggested_next_topics` (sub-field) | TEXT[] | Bulleted list via `PerfListCell` — "None identified" if empty |

Column order above is the **fixed, final** header/data order — identifiers first, then operational/
diagnostic fields, then the toggle flag, then glitches, then the existing 6 content fields last (in
their pre-existing relative order), so the columns a prospect/viewer already recognizes from the old
card format land at the end, in the same relative sequence as before.

### 6.2 — Exact API change: `app/api/demo/[slug]/performance/route.ts`

The route's **second** `partner_session_insights` query (line 133, confirmed §0 — NOT the single
embedded-join query the original spec/brief described, which no longer exists in the live code) gets
its `.select()` widened from:

```ts
.select('extracted_at, action_items, learner_insight')
```
to:
```ts
.select(
  'id, partner_session_id, partner_account_id, end_client_id, reseller_unique_id, hume_chat_id, ' +
  'hume_config_id, extraction_status, attempt_count, error_message, transcript_event_count, ' +
  'full_detail_purged_at, created_at, demo_performance_visible, glitches, extracted_at, ' +
  'action_items, learner_insight'
)
```

`PerformanceEntry` (currently lines 58–65) widens from 6 fields to:

```ts
interface PerformanceEntry {
  id: string
  partner_session_id: string
  partner_account_id: string
  end_client_id: string | null
  reseller_unique_id: string | null
  hume_chat_id: string | null
  hume_config_id: string | null
  extraction_status: 'pending' | 'success' | 'success_empty' | 'failed'
  attempt_count: number
  error_message: string | null
  transcript_event_count: number | null
  full_detail_purged_at: string | null
  created_at: string
  demo_performance_visible: boolean
  glitches: { type: string; description: string | null }[]
  extracted_at: string | null
  action_items: { text: string }[]
  summary: string | null
  topics_of_interest: string[]
  engagement_style: string | null
  suggested_next_topics: string[]
}
```

The mapping block (currently lines 142–152) widens correspondingly:

```ts
entries = entryRows.map((row) => {
  const insight = row.learner_insight as LearnerInsight | null
  return {
    id: row.id as string,
    partner_session_id: row.partner_session_id as string,
    partner_account_id: row.partner_account_id as string,
    end_client_id: (row.end_client_id as string | null) ?? null,
    reseller_unique_id: (row.reseller_unique_id as string | null) ?? null,
    hume_chat_id: (row.hume_chat_id as string | null) ?? null,
    hume_config_id: (row.hume_config_id as string | null) ?? null,
    extraction_status: row.extraction_status as PerformanceEntry['extraction_status'],
    attempt_count: row.attempt_count as number,
    error_message: (row.error_message as string | null) ?? null,
    transcript_event_count: (row.transcript_event_count as number | null) ?? null,
    full_detail_purged_at: (row.full_detail_purged_at as string | null) ?? null,
    created_at: row.created_at as string,
    demo_performance_visible: row.demo_performance_visible as boolean,
    glitches: (row.glitches as { type: string; description: string | null }[] | null) ?? [],
    extracted_at: (row.extracted_at as string | null) ?? null,
    action_items: (row.action_items as { text: string }[] | null) ?? [],
    summary: insight?.summary ?? null,
    topics_of_interest: insight?.topics_of_interest ?? [],
    engagement_style: insight?.engagement_style ?? null,
    suggested_next_topics: insight?.suggested_next_topics ?? [],
  }
})
```

`PerformanceResponse['entries']` type updates to `PerformanceEntry[]` with the widened shape above —
no other field of `PerformanceResponse` changes. **Confirmed additive/non-breaking** (§0) — the
route's only consumer (`DemoTopicClient.tsx`) is updated in the same change; no other caller exists.

### 6.3 — Exact table markup and responsive behavior in `DemoTopicClient.tsx`

New, page-local style constants (added alongside the existing `perfTable*` constants, none of which
are removed — §0):

```ts
const DEMO_PERFORMANCE_TABLE_DISPLAY_LIMIT = 3

const perfEntriesScrollWrapperStyle = { overflowX: 'auto', marginTop: 'clamp(20px, 3vw, 28px)' } as const

const perfEntriesCaptionStyle = { fontSize: 13, color: COLORS.textMuted, marginBottom: 8 } as const

const perfEntriesTableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 } as const

const perfEntriesThStyle = {
  textAlign: 'left',
  color: COLORS.textSecondary,
  fontWeight: 600,
  padding: '8px 12px',
  borderBottom: `1px solid ${COLORS.border}`,
  whiteSpace: 'nowrap',
} as const

const perfEntriesTdStyle = {
  padding: '8px 12px',
  borderBottom: `1px solid ${COLORS.border}`,
  color: COLORS.textPrimary,
  verticalAlign: 'top',
} as const

const perfEntriesMonoTdStyle = { ...perfEntriesTdStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } as const
```

Reused as-is, unmodified: `PerfScalarCell`, `PerfListCell` (§0 — both render only the cell's value,
directly usable inside a `<td>`), `perfTableMutedStyle` (for the "Not available"/"None identified"
fallback color), `formatSavedAt()` (existing timestamp formatter already used elsewhere on this
page).

**Column `min-width` per type** (no fixed pixel widths on the table/columns themselves — only a
`min-width` on identifier/list columns so they stay scannable inside the scroll container, per the
brief's own instruction): UUID columns (ID, Session ID, Partner Account ID, End Client ID) —
`minWidth: 140`; list-valued columns (Glitches, Action Items, Topics of Interest, Suggested Next
Topics) — `minWidth: 220`; everything else — no explicit `min-width` (content-sized).

**The "Scroll horizontally to see all columns →" caption (`perfEntriesCaptionStyle`) is always shown
above the table, unconditionally** — not gated behind a JS overflow-detection check. Reasoning: with
21 columns, the table overflows essentially every viewport (mobile and most desktop windows alike),
so a static caption is simpler, has zero risk of a detection bug making the affordance silently not
appear, and directly answers CEO brief Question 3's "how does a user discover there's more to scroll
to" ask with a concrete, unconditional, always-correct answer.

**Render structure** (replaces lines 895–943 of the current file, per §0):

```tsx
<div style={perfEntriesScrollWrapperStyle}>
  <p style={perfEntriesCaptionStyle}>Scroll horizontally to see all columns →</p>
  <table style={perfEntriesTableStyle}>
    <thead>
      <tr>
        {ENTRY_COLUMNS.map((col) => (
          <th key={col.header} style={perfEntriesThStyle}>{col.header}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {(performanceData.entries ?? []).length > 0 ? (
        performanceData.entries
          .slice(0, DEMO_PERFORMANCE_TABLE_DISPLAY_LIMIT)
          .map((entry) => <tr key={entry.id}>{/* one <td> per ENTRY_COLUMNS entry, §6.1 */}</tr>)
      ) : (
        <tr>{/* one placeholder <td> per ENTRY_COLUMNS entry — "Not available"/"None identified" per column type, §4.B State B2 */}</tr>
      )}
    </tbody>
  </table>
</div>
```

`ENTRY_COLUMNS` is a small ordered array-of-column-definitions constant (header label + accessor +
cell-type) driving both the `<thead>` and each `<tr>`'s cells from one single source of truth, so the
21-column list in §6.1 is defined exactly once in code, not duplicated across header/row/placeholder
render logic — a BA/dev implementation-organization choice, not a product-shape decision.

### 6.4 — Where the 3-record cap applies (resolves CEO brief Question 4)

**Client-side, via `.slice(0, DEMO_PERFORMANCE_TABLE_DISPLAY_LIMIT)`** on the existing `entries` array
already returned by `GET /api/demo/[slug]/performance` — not a new query param. Reasoning (confirmed,
matches the brief's own recommendation): the API's existing `.limit(200)` defensive ceiling (§0,
unchanged) already bounds what's fetched; no other consumer of this endpoint needs a different
display limit (confirmed §0, single consumer); a client-side slice is the smaller, simpler change and
is trivially adjustable (or removable) later by editing one constant, exactly as the brief itself
requested.

### 6.5 — APIs called

None new. `GET /api/demo/[slug]/performance` is extended, not replaced (§6.2). No new endpoint.

### 6.6 — localStorage/sessionStorage

None. Unchanged from the original spec.

### 6.7 — Migration

**None required.** Confirmed (§0, CEO brief's own "Known Constraints") — every column this document
needs already exists on `partner_session_insights` as of migration `107` (the current highest-
numbered migration). This is a `.select()`/TypeScript/render change only.

## 7. Success Criteria (Acceptance Tests)

✓ Given `claude-ai` has 3+ accumulated visible entries, when `GET /api/demo/claude-ai/performance` is
called, then the response's `entries` array items each contain all 18 real `partner_session_insights`
fields listed in §6.1 (not just the previous 3), correctly mapped from the corresponding DB row.

✓ Given `claude-ai` has exactly 5 accumulated visible entries, when the Performance tab renders, then
the table shows exactly 3 `<tr>` data rows (the 3 most recent by `extracted_at`), not 5 — confirms the
`DEMO_PERFORMANCE_TABLE_DISPLAY_LIMIT = 3` cap.

✓ Given an accumulated entry has `end_client_id: null`, `error_message: null`, and `glitches: []`,
when that entry's row renders, then its End Client ID cell shows "Not available", its Error Message
cell shows "Not available", and its Glitches cell shows "None identified" — confirms per-field-type
null/empty handling is correct across scalar and list columns alike.

✓ Given an accumulated entry has a non-empty `glitches` array where one element has `description:
null` (post-30-day-purge shape) and another has a real `description` string, when that entry's
Glitches cell renders, then the purged element shows only its `type`, and the other element shows
`"{type}: {description}"` — confirms both glitch shapes render correctly.

✓ Given `claude-ai` has zero accumulated visible entries, when the Performance tab renders, then the
table shell (all 21 column headers) still renders, with exactly one placeholder `<tr>` showing "Not
available" in every scalar column and "None identified" in every list column — confirms State B2,
never a blank/message-only fallback.

✓ Given the Performance tab renders on a 375px-wide viewport, when the page loads, then the "Scroll
horizontally to see all columns →" caption is visible above the table and the table itself is
horizontally scrollable within its wrapper (`overflowX: auto`) without breaking the surrounding page
layout — confirms the mobile/responsive behavior.

✓ Given `claude-ai` has 2 accumulated entries and the LATEST `claude-ai` dispatch's `session_state` is
`extraction_failed`, when the Performance tab renders, then the table renders exactly as it would with
no error (State B4) — confirms the entries table still takes priority over the latest-session error
state, unchanged from the original spec's design.

✓ Given the existing "ready + 0 entries" single-latest-session Field/Value table (Duration/Usage
block) is showing (a session extracted successfully but `demo_performance_visible` was false at that
moment), when the Performance tab renders, then that table is completely unaffected by this
amendment — same fields, same layout, same styles as before this change — confirms this amendment is
scoped only to the accumulating `entries` table.

## 8. Error States

- **The widened `entries` query fails (DB error):** unchanged from the original spec (§0, §8) — falls
  back to `entries: []` for that response only, logged via `console.error`, never thrown; the route's
  other fields (`session_state`, `duration_minutes`, etc.) compute independently and still return
  normally. The client renders State B2's placeholder table exactly as if there were genuinely zero
  entries.
- **A `learner_insight` sub-field is missing/malformed on a given row** (defensive, not expected):
  each of the 4 sub-field columns (Summary/Topics of Interest/Engagement Style/Suggested Next Topics)
  independently falls back to its own null-handling ("Not available"/"None identified") exactly as
  every other nullable column does — no row-level failure, no dropped row.
- **A `glitches` array element is missing its `type` key** (defensive, not expected — schema/trigger
  guarantee this never happens in practice, §0): renders as an empty bullet line rather than throwing;
  not a real operational risk given the write path is fully internal and controlled.

## 9. Edge Cases

- **`demo_performance_visible` will always read "Yes" for every row this table ever shows,** since the
  API's own query filters `eq('demo_performance_visible', true)` — this column is genuinely redundant
  information in this specific table, included anyway because Arun's instruction was literally "all
  fields," not "all fields except ones that are always the same value here." Flagged explicitly so a
  future reader isn't confused about why a column exists that never varies.
- **Boolean rendering convention:** `demo_performance_visible` renders as the literal strings "Yes" /
  "No" (a BA formatting decision — this codebase has no pre-existing boolean-cell rendering
  convention to reuse, confirmed by inspecting every existing `Perf*` component, §0), not the raw
  `true`/`false` JS values and not a colored badge (no `Badge` component is imported anywhere in this
  file, so introducing one would be a new dependency for a single low-stakes cell in a table being
  removed before production).
- **A row's `error_message` is a long raw error string:** no truncation/ellipsis is applied — the
  horizontal-scroll wrapper already accommodates arbitrarily wide content without squeezing any
  column illegibly thin, so truncating would only hide information Arun explicitly wants to see in
  full, undermining the literal "everything" instruction this document implements.
- **Mobile vs. desktop:** per the standing responsive rule, this amendment touches the Performance
  tab's entries rendering, so it must meet the genuinely-responsive bar. Resolved via the horizontal-
  scroll wrapper (§6.3) rather than any column-hiding/stacking on narrow viewports — a 21-column table
  does not reflow cleanly into a card layout without losing the literal "one row per session, one
  column per field" structure Arun specifically asked for, so horizontal scroll (with the explicit,
  unconditional affordance caption) is the correct approach for this specific screen, not a general
  precedent for how every future wide table on this codebase must behave.
- **A future partner-facing surface someday wants to show `partner_session_insights` data:** this
  amendment's all-columns exposure is scoped **only** to this one table, on this one public demo page,
  and does not reopen or alter B2B-53's decision to keep `glitches` out of the reseller webhook, or
  the "internal-only, never partner-facing" status of `reseller_unique_id`/`hume_config_id`/
  `end_client_id` anywhere else in the codebase (unchanged, confirmed §0).
- **Arun's own removal commitment — tracked as a real, standing gate, not a note (per the CEO brief's
  explicit ask):** this entire all-columns table is an **explicit, time-boxed, personally-owned
  exception Arun has committed to removing before production.** Concretely tracked via: (1) this
  document's own existence, permanently on record as the spec that knowingly authorized it; (2) a
  code comment at the top of the new `ENTRY_COLUMNS`/table-render block in `DemoTopicClient.tsx`,
  reading (verbatim, to be included at build time): `// REMOVE BEFORE PRODUCTION — all 21
  partner_session_insights columns, including internal IDs and glitches, are shown here per Arun's
  own explicit 2026-08-02 exception (docs/specs/B2B-65-tabular-performance-format-amendment-
  requirement-document.md). Arun has personally committed to removing this table before production.`;
  (3) `docs/b2b-pivot-status.md`'s Backlog section, which the CEO Agent has already separately flagged
  as a standing, undismissable item pending Arun's own confirmation it's done (per the CEO brief's own
  text) — the Orchestrator should keep that row live until Arun confirms removal, not close it as part
  of merging this feature. This is stewardship of an already-made decision, not a re-litigation of it.

## 10. Out of Scope

- Any change to the already-built, already-shipped admin toggle mechanism (`system_demo_performance_
  config`, `DemoPerformanceToggleCard.tsx`, `getDemoPerformanceAppendEnabled()`) — confirmed untouched,
  §0.
- Any change to the extraction-completion write that sets `demo_performance_visible`
  (`inngest/partner-session-insights-extractor.ts`) — confirmed untouched, §0.
- Any change to the permanence/no-retroactive-re-evaluation design, or the per-topic
  (`partner_reference`) scoping of the accumulating list — both confirmed untouched, §0.
- Any change to the "ready + 0 entries" single-latest-session Field/Value table (Duration/Usage block)
  — confirmed untouched, §0; acceptance test in §7 explicitly verifies this.
- **Adding authentication/access control to `GET /api/demo/[slug]/performance` or the `/demo/[slug]`
  page itself.** This route remains, exactly as today, public and unauthenticated (§0/§3) — showing
  literally all `partner_session_insights` fields, including internal IDs and `glitches`, on a public,
  unauthenticated route is a **known, accepted risk Arun explicitly chose** ("that is ok display
  everything in this table.. i will remove this table before going to production"), not a gap this
  document silently resolves by adding auth. **Whether this public route should ever gain auth/a
  passcode is a separate, unaddressed product-policy question this document deliberately does not
  answer** — flagged here as a known-accepted-risk under Arun's own explicit, time-boxed exception,
  not something for a developer to unilaterally "fix" by bolting on access control as part of this
  change.
- Any cap/pagination UI beyond the fixed `DEMO_PERFORMANCE_TABLE_DISPLAY_LIMIT = 3` display slice, or
  beyond the existing defensive `.limit(200)` query ceiling (both unchanged in spirit from the
  original spec) — no "load more"/"show all" control is built.
- Any change to `lib/partner/webhooks.ts`'s real-partner webhook payload shape, or to any other
  admin/internal view of `partner_session_insights` — this amendment's all-columns exposure is scoped
  to this one public table only (§9).
- A wider responsive audit of `DemoTopicClient.tsx` beyond the entries table's own new markup — the
  standing responsive rule caps this to what's actually touched.
- Any change to any other concurrent feature brief's scope (B2B-63, B2B-64, B2B-66, etc.) — zero file
  overlap.

## 11. Open Questions

None. All 6 items the CEO brief posed to BA are resolved above with direct-code-backed reasoning:

1. **Re-verify the full field list against the live schema** — resolved: **18 real columns**
   confirmed directly against every migration touching `partner_session_insights`, with two
   corrections to the brief's own list flagged and resolved in §0 (dropped a phantom "Reseller ID"
   column that does not exist on this table; added two real columns the brief's list omitted,
   `hume_chat_id` and `created_at`). Final 21-column table (18 DB columns, with `learner_insight`
   expanded into its 4 sub-fields) given in full in §6.1.
2. **Exact table markup and column order** — resolved: full markup, style constants, and fixed column
   order given in §6.3/§6.1; multi-line bulleted cells (Glitches/Action Items/Topics of
   Interest/Suggested Next Topics) are explicitly allowed to make their row taller than single-line
   cells, no cap on bullet count — confirmed fine, no truncation needed given the horizontal-scroll
   (not vertical-squeeze) approach.
3. **Exact mobile wireframe** — given in §5; the horizontal-scroll affordance is an unconditional,
   always-shown caption line, not JS overflow-detection, per the reasoning in §6.3.
4. **Where the 3-record cap applies** — resolved: client-side `.slice()` in `DemoTopicClient.tsx`, per
   §6.4's reasoning (matches the brief's own recommendation).
5. **Interaction with existing B2B-65 amendment states (B3/B4/B2)** — resolved: all three carry over
   identically, with the table shell replacing the card stack as the only visual change; full
   state-by-state confirmation in §4.B.
6. **Whether the empty-state needs a table-shaped placeholder** — resolved: yes, carries over the
   already-established (first-amendment) precedent of an always-shown table shell plus one
   placeholder row using the same per-field-type "Not available"/"None identified" convention, now
   extended to all 21 columns (§4.B State B2, §7 acceptance test).

## 12. Dependencies

- **The already-shipped original B2B-65 feature** (toggle, extraction-completion write, permanence
  design, per-topic scoping) — must exist unchanged; confirmed still in place, §0. This document adds
  no new dependency beyond what B2B-65 already shipped.
- **B2B-09** (`partner_session_insights` table itself) — must exist; confirmed, this document only
  widens which of its already-existing columns are queried/rendered, adds none.
- **B2B-34 Piece 1** (`learner_insight` schema) — must exist; confirmed, migration 096, unchanged.
- **B2B-38** (`reseller_unique_id`, `hume_config_id` columns) — must exist; confirmed, migration 099,
  unchanged.
- **B2B-51** (`PerfScalarCell`/`PerfListCell` rendering primitives) — must exist; confirmed, reused
  verbatim inside the new table's `<td>`s (§6.3).
- **B2B-64** (`ApiClient.tsx`'s horizontal-scroll table precedent) — the direct structural precedent
  this document's scroll wrapper/table styling copies; confirmed shipped, §0. No file overlap, no
  code sharing — pattern reuse only.
- **No new migration.** §6.7.
- **Modified files (both existing, no new files):**
  - `app/api/demo/[slug]/performance/route.ts` — widen the `entries` query's `.select()`, widen
    `PerformanceEntry`, widen the row-mapping block (§6.2).
  - `app/(demo)/demo/[slug]/DemoTopicClient.tsx` — widen the duplicated `PerformanceEntry` type to
    match; replace the entries-list card/`.map()` render block (current lines 895–943) with the new
    `<table>` structure and its new style constants; add the `DEMO_PERFORMANCE_TABLE_DISPLAY_LIMIT`
    constant and the `ENTRY_COLUMNS` definition; add the "REMOVE BEFORE PRODUCTION" tracked-gate
    comment (§9) at the top of this new block (§6.3).
- **Test files needing extension (Dev/Testing-agent task, not a spec ambiguity):**
  `tests/unit/demo-performance-route.test.ts` (extend `entries` assertions to the new field set),
  and a review of `tests/unit/b2b65-extractor-demo-visibility.test.ts` /
  `b2b65-demo-performance-config-api.test.ts` / `b2b65-performance-config-helper.test.ts` /
  `b2b65-demo-performance-toggle-card.test.tsx` to confirm none assert on the old 6-field `entries`
  shape in a way this widening would break (none of the toggle/config/extractor tests are expected to,
  since they don't exercise the read-side route, but confirming this is an explicit dev-time check,
  not assumed here).

---

Once approved by the CEO Agent, this spec is ready for Dev with zero open questions. Per the standing
gate, Arun's own removal commitment (§9) travels with this feature as a tracked, standing item in
`docs/b2b-pivot-status.md`'s Backlog section until he confirms it's done — this is not closed out
just because the feature itself ships.
