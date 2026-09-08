# Feature Brief: Demo Performance Tab — Literal Tabular Format (Field = Column) Amendment to B2B-65

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-08-02

---

## Confirming Understanding (Arun asked directly: "do you understand")

Yes. Arun's instruction, restated back:

1. The Performance tab's current display is wrong — he wants **every field of `partner_session_insights` shown as
   its own column** in a genuine tabular layout (columns = fields, rows = session records), not the Field/Value
   card format currently shipped.
2. As of today, show the **3 most recent records** in that table.
3. Going forward, each new session's record should keep getting **appended** to the Performance tab, gated by the
   admin toggle he already set up — exactly the behavior already built and shipped under B2B-65.

**Update, 2026-08-02, same day — Arun's direct follow-up on the field-inclusion question below.** After I flagged
the public/unauthenticated exposure concern in the original version of this brief, Arun responded directly (relayed
by the Orchestrator): **"that is ok display everything in this table.. i will remove this table before going to
production."** This is an explicit, knowing decision from the owner — not a silent oversight, not me guessing, not
the CEO Agent resolving a security tradeoff on my own authority. He is choosing the literal-everything reading over
either alternative I offered (the 6-field-only default, or the admin-only debug view). Section below is rewritten
to reflect this. Per Product Principle #1 ("implement literally"), his explicit instruction now controls.

## The Problem Being Solved

The Performance tab (`/demo/[slug]`, backed by `app/api/demo/[slug]/performance/route.ts` and rendered in
`app/(demo)/demo/[slug]/DemoTopicClient.tsx`) currently renders each accumulated session as a **card** of
Field/Value rows (`PerfTableRow`/`PerfScalarCell`/`PerfListCell`) — one card per session, stacked vertically. Arun
is asking for a different, more literal presentation: **one row per session, one column per field**, the way a
spreadsheet or database export looks. He's not reporting a bug in the accumulation logic itself (that part —
appending each new session's record per the admin toggle — is confirmed already working); he's asking for a
visual/structural redesign of how the accumulated records are laid out.

## What Success Looks Like

1. The Performance tab renders a genuine HTML table: one `<tr>` per accumulated session record, one `<td>` per
   included field, with column headers in the `<thead>`.
2. Every column of `partner_session_insights` is shown, one per table column (see decision below, resolved
   directly by Arun) — including internal identifiers, `glitches`, and operational/diagnostic fields, as an
   explicit, time-boxed exception he will personally remove before production.
3. The table shows the **3 most recent records** today (newest first, same `extracted_at DESC` ordering already
   used).
4. The already-built append-on-toggle mechanism (B2B-65) continues to run completely unchanged — this brief is a
   presentation-layer change only.
5. The table is genuinely usable on mobile — this is one of the harder responsive cases (a real multi-column
   table), so BA must give explicit direction rather than leaving it to whoever builds it.

## The Field-Inclusion Decision — Resolved Directly by Arun (2026-08-02)

**This route is public, unauthenticated** (`app/api/demo/[slug]/performance/route.ts`'s own doc comment: "Public,
no auth, no passcode — read-only"). I flagged this directly to Arun before writing this section, laying out exactly
what "all fields" would expose:

- `id`, `partner_session_id`, `partner_account_id`, `end_client_id`, `reseller_id`, `reseller_unique_id`,
  `hume_config_id` — raw internal UUIDs/identifiers. `reseller_unique_id` and `hume_config_id` are explicitly
  commented in migration `099_b2b38_session_traceability_ids.sql` as **"Internal-only — never partner-facing."**
- `glitches` — a prior CEO decision (B2B-53, 2026-07-30) explicitly removed this field from even the
  **reseller-facing** webhook payload, per Arun's own words at the time: "this goes only to internal clio, more
  specifically me."
- `extraction_status`, `error_message`, `transcript_event_count`, `attempt_count`, `full_detail_purged_at` —
  internal operational/diagnostic fields (retry counts, purge timestamps, raw error strings).
- `demo_performance_visible` — the toggle-state flag itself.

**Arun's direct decision (relayed by the Orchestrator, exact words): "that is ok display everything in this
table.. i will remove this table before going to production."** This is a knowing, explicit acceptance of the
exposure I flagged — not a security oversight being silently shipped, and not a call I'm making on his behalf. He
has chosen the full-literal reading over both alternatives I offered (6-field-only default, or an admin-only debug
view), on the explicit, stated basis that this is a **temporary, testing-only state he will personally remove
before production.**

**Resolved: every column of `partner_session_insights` is shown**, one column per field, in addition to the
already-existing `extracted_at`/`action_items`/`learner_insight` fields the current `entries` response already
returns:

| Column header | Source field | Category |
|---|---|---|
| ID | `id` | Internal identifier |
| Session ID | `partner_session_id` | Internal identifier |
| Partner Account ID | `partner_account_id` | Internal identifier |
| End Client ID | `end_client_id` | Internal identifier |
| Reseller ID | `reseller_id` | Internal identifier |
| Reseller Unique ID | `reseller_unique_id` | Internal identifier — previously marked "never partner-facing" |
| Hume Config ID | `hume_config_id` | Internal identifier — previously marked "never partner-facing" |
| Extraction Status | `extraction_status` | Internal/operational |
| Attempt Count | `attempt_count` | Internal/operational |
| Error Message | `error_message` | Internal/operational |
| Transcript Event Count | `transcript_event_count` | Internal/operational |
| Full Detail Purged At | `full_detail_purged_at` | Internal/operational |
| Demo Performance Visible | `demo_performance_visible` | Toggle-state flag |
| Glitches | `glitches` | Previously excluded from even the reseller-facing webhook (B2B-53) |
| Extracted At | `extracted_at` | Already public today |
| Action Items | `action_items` | Already public today |
| Summary | `learner_insight.summary` | Already public today |
| Topics of Interest | `learner_insight.topics_of_interest` | Already public today |
| Engagement Style | `learner_insight.engagement_style` | Already public today |
| Suggested Next Topics | `learner_insight.suggested_next_topics` | Already public today |

BA: re-verify this list directly against the current, live `partner_session_insights` schema (per this project's
own standing §0 re-verification convention) before finalizing column order — the list above is drawn from the
migrations I could confirm (`078`, `095`, `096`, `099`), but confirm nothing has been added/renamed since.

**This is a one-time, explicit, time-boxed exception — not a new default policy for public routes.** It does not
reopen or reverse the B2B-53 decision to keep `glitches` out of the reseller webhook, or the "internal-only" status
of `reseller_unique_id`/`hume_config_id` anywhere else in the codebase. It applies only to this one table, on this
one page, and only until Arun removes it before production.

### Tracking Arun's own removal commitment — flagged so it isn't lost, not overriding his decision

Arun has stated he will personally remove this table before production. To make sure a verbal/chat commitment made
today doesn't quietly get forgotten weeks from now once the demo page is otherwise stable, I'm asking BA to add one
explicit line to Section 10 (Out of Scope) or Section 9 (Edge Cases) capturing this as a **tracked pre-production
gate**, and I'm separately flagging it in `docs/b2b-pivot-status.md`'s Backlog section (below) as a standing,
undismissable item until Arun confirms it's done. This is stewardship, not second-guessing his call — he made the
decision, I'm just making sure it has a paper trail so "before production" actually happens.

## List-Valued Fields in a Single Table Cell — Concrete Call

`topics_of_interest`, `suggested_next_topics`, and `action_items` are all arrays. In a literal table, each is one
cell. My call: **render each array item on its own line within the cell, bullet-prefixed** (not comma-joined) —
these are often full sentences (especially `action_items`), and comma-joining multi-sentence items into one run-on
line is unreadable. Reuse the existing empty-state convention already in `PerfListCell` ("None identified") for an
empty array, and "Not available" for a null scalar (`summary`/`engagement_style`) — do not invent new copy for
these two cases.

## "Recent 3 Records" — My Call on What This Means

Arun's own words: "as of now display the table with the recent 3 records... going forward you can append the
record for that call... based on the toggle." Read literally, "recent 3" is most naturally a **display cap on the
table**, not just an observation that only 3 real records happen to exist today. My call: **the client renders
only the 3 most recent entries (newest-first, unchanged ordering), even once more than 3 have accumulated in the
database.**

This is a display-layer cap only — it does **not** touch the already-approved, already-shipped accumulation/
permanence design underneath (B2B-65's `demo_performance_visible` column keeps recording every appended session
forever; the `.limit(200)` defensive query ceiling stays exactly as built). BA: implement the 3-record cap as a
named constant (e.g. `DEMO_PERFORMANCE_TABLE_DISPLAY_LIMIT = 3`) applied client-side (or as a query param default)
on top of the existing `entries` array — a one-line change if Arun later wants more than 3 visible, or wants the
cap removed entirely once he's accumulated a larger body of examples. Flag this interpretation explicitly in the
spec as an assumption resolved by the CEO, not silently baked in.

## Known Constraints

- **The append-on-toggle mechanism is already built — do not re-verify or rebuild it.** `system_demo_performance_
  config.append_enabled`, read via `getDemoPerformanceAppendEnabled()` in `lib/demo/performance-config.ts`, and
  `partner_session_insights.demo_performance_visible` set once at extraction-completion time in
  `inngest/partner-session-insights-extractor.ts` — all shipped under B2B-65 (2026-08-01), confirmed still in
  place. Nothing about this mechanism changes.
- **No migration/schema change needed — but the API query does need to change.** All columns this brief now needs
  already exist on `partner_session_insights` (no new column, no new table). However, `GET
  /api/demo/[slug]/performance`'s existing `entries` query (`docs/specs/B2B-65-requirement-document.md` §6.4) only
  `.select()`s `extracted_at, action_items, learner_insight, partner_sessions!inner(partner_reference)` — it does
  **not** currently select `id`/`partner_session_id`/`partner_account_id`/`end_client_id`/`reseller_id`/
  `reseller_unique_id`/`hume_config_id`/`glitches`/`extraction_status`/`attempt_count`/`error_message`/
  `transcript_event_count`/`full_detail_purged_at`/`demo_performance_visible`. The route's `.select()` and its
  `PerformanceResponse['entries']` TypeScript type both need extending to include the full field list. This is
  still a small, additive, well-scoped change (widen one existing `.select()` call), not a new query/table/
  migration — but BA must document it explicitly rather than assume the API is untouched, since the "presentation-
  layer only" framing from the original version of this brief no longer holds now that all fields are in scope.
- **All fields, including `glitches` and internal IDs, are shown as columns per Arun's explicit 2026-08-02
  decision above** — this supersedes the earlier default recommendation in this brief's original version. This is
  a knowing exception, scoped to this one table on this one page, and time-boxed to "before production" by Arun's
  own stated commitment — it does not change the exclusion of these fields anywhere else (reseller webhook
  payloads, other admin views, etc.).
- **No mock/illustrative rows, ever** — same hard constraint as the original B2B-65 spec. This governs the display
  cap and column set, not the underlying accumulation, which already enforces this.
- **This must be removed before production.** BA: add this as an explicit tracked item in the spec (Section 9 or
  10) so it's visible to whoever eventually does the pre-production checklist, not just a verbal commitment. CEO is
  separately tracking this in `docs/b2b-pivot-status.md`'s Backlog section until Arun confirms it's done.
- **Responsive/mobile — explicit direction, not left to the builder's judgment:** per the standing responsive
  rule, wrap the literal `<table>` in a horizontal-scroll container (`overflow-x: auto`) rather than attempting to
  reflow columns into a stacked card layout on narrow viewports — a genuine multi-column table does not reflow
  cleanly, and this project has direct precedent for exactly this pattern (`ApiClient.tsx`'s `requestFields` table,
  B2B-64, gained the same `overflowX` scroll wrapper for the same reason). No fixed pixel column widths; give the
  list-valued columns (Topics of Interest, Suggested Next Topics, Action Items) a sensible `min-width` inside the
  scroll container so they stay scannable rather than being squeezed unreadably thin — exact `min-width` values are
  a BA/dev implementation detail, not a product-shape decision needing my sign-off.

## Questions for BA

Section 11 must resolve all of these before this comes back to me for approval — worked example/wireframe for
each, do not guess:

1. **Re-verify the full field list above against the live schema** (not open — resolved by Arun to "all fields" —
   but BA must confirm the exact current column set of `partner_session_insights` directly against source, per
   this project's own §0 convention, since some fields (`glitches`, IDs, `extraction_status`, etc.) are not in
   today's `entries` API response and will need the query in `app/api/demo/[slug]/performance/route.ts` extended
   to select them, unlike the 6 fields already returned today).
2. **Exact table markup and column order** — give a wireframe of the actual `<table>` with sample column widths/
   header labels, and show exactly how a multi-line bulleted cell renders (e.g., does "Action Items" needing 3
   lines make that row visibly taller than a row with a single-line action item — confirm this is fine, or specify
   a cap).
3. **Exact mobile wireframe** — show the horizontal-scroll container in practice at a narrow viewport width (e.g.,
   375px), confirming which columns are visible without scrolling and how a user discovers there's more to scroll
   to (a visual affordance, not just an invisible overflow).
4. **Where exactly the 3-record cap applies** — client-side slice of the existing `entries` array in
   `DemoTopicClient.tsx`, or a new query param on `GET /api/demo/[slug]/performance` (e.g. `?limit=3`)? Recommend
   the simpler client-side slice given no other consumer of this endpoint needs a different limit, but confirm.
5. **Interaction with the existing B2B-65 amendment states** (B3 "a new session is being processed," B4 "latest
   dispatch failed but entries still show," B2 zero-entries empty state) — confirm each of these still applies
   identically under the new table layout, just with the table shell shown instead of the card shell (mirroring how
   B2B-65's own same-day amendment handled this for the card format — same-shaped decision, now for a table).
6. **Whether the empty-state ("No performance examples yet...") also needs a table-shaped placeholder** (empty
   `<thead>` + one placeholder row) similar to how B2B-65's amendment showed table headers even with zero real
   data — confirm whether that same treatment carries over to this new literal-column format, or whether the
   existing text-only empty state (§4.B State B2 in the B2B-65 spec) is still correct here.
