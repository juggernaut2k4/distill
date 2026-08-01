# Demo Performance Tab — Global Toggle + Per-Topic Accumulating Table — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-08-01

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Per this project's standing rule that specs must be grounded in real code (`docs/specs/B2B-64-requirement-document.md`
§0, `docs/specs/B2B-63-requirement-document.md` §0), every load-bearing claim in
`.claude/agents/clio/feature-briefs/B2B-65-demo-performance-tab-toggle-and-accumulating-table.md` was re-checked
directly against source before writing this document:

- **`app/api/demo/[slug]/performance/route.ts`, confirmed by direct read (full file, 193 lines).** Today's route
  resolves exactly one `partner_sessions` row (`.eq('partner_account_id', demoPartnerAccountId).eq('partner_reference',
  params.slug).order('created_at', {ascending:false}).limit(1).maybeSingle()`), then a single `partner_session_insights`
  lookup keyed on that one session's id. Confirmed: `partner_reference` is the exact column already used to scope a
  session to one demo slug — this is the load-bearing fact behind this document's per-topic decision in §11 Q1 below.
- **`app/(demo)/demo/[slug]/DemoTopicClient.tsx`, confirmed by direct read (full file, 866 lines).** The 'ready' branch
  (lines 792–857) renders one fixed Field/Value table via `PerfTableRow`/`PerfScalarCell`/`PerfListCell` — Duration,
  Action items, Summary, Topics of interest, Engagement style, Suggested next topics, then a B2B-57a "Usage" block
  (Minutes billed/Generation type/Mode/Event ID/Recorded at). Non-ready states (`not_dispatched`/`in_progress`/
  `pending_extraction`/`extraction_failed`) render dimmed heading/body pairs (`perfEmptyHeadingStyle`/
  `perfEmptyBodyStyle`) — confirmed exact current copy strings, reused verbatim below where unchanged.
- **`inngest/partner-session-insights-extractor.ts`, confirmed by direct read (full file, 563 lines).**
  `extractInsightsForPartnerSession()` is the single, shared, idempotent extraction path for **every** partner session
  (not demo-specific) — real resellers and the demo partner account both flow through it. Its terminal `.update()` call
  (lines 305–316) already threads several session-specific fields through unconditionally (`extraction_status`,
  `action_items`, `glitches`, `learner_insight`, `transcript_event_count`, `error_message`, `extracted_at`). This is the
  one and only place a `success`/`success_empty` result is finalized — confirmed the correct, minimal insertion point
  for this document's new column write (§6), and confirmed it runs identically regardless of any new toggle (satisfying
  the brief's "extraction itself must never be gated" constraint by construction, not by added conditional logic around
  the extraction call itself).
- **`markInsightsExtractionFailed()`, confirmed by direct read (lines 375–430).** This is the only path that writes
  `extraction_status: 'failed'`. It does not go through the same `.update()` block as the success path — confirmed
  structurally impossible for a failed row to pick up this document's new column unless explicitly added there too,
  which this document deliberately does NOT do (§8 — failed extractions never populate the new column, by omission,
  not by an added guard clause).
- **`supabase/migrations/078_b2b09_session_delivery_glitch_dashboard.sql`, confirmed by direct read.** The
  `partner_session_insights` table's real current columns are: `id, partner_session_id, partner_account_id,
  hume_chat_id, extraction_status, action_items, glitches, psychology_keywords → learner_insight (migration 096),
  transcript_event_count, attempt_count, error_message, extracted_at, full_detail_purged_at, created_at`, `UNIQUE
  (partner_session_id)`. No existing column expresses "should this appear on a public demo page" — confirmed a new
  column is required, not a re-use of an existing one (§6).
- **`app/(with-clerk)/dashboard/admin/VoiceProviderCard.tsx` + `app/api/admin/voice-config/route.ts` +
  `supabase/migrations/104_b2b61_system_voice_config.sql`, confirmed by direct read (all three, full files).** The
  established "global singleton config" mechanism the brief asks this document to mirror is: (1) a `CREATE TABLE`
  with a hardcoded UUID primary key and a `CHECK (id = '<fixed-uuid>')` singleton constraint, seeded once; (2) a
  `GET`/`PATCH` route pair under `/api/admin/`, gated by `requireSuperAdmin()`; (3) a `'use client'` card component,
  fetch-on-mount, with a `window.confirm(...)`-gated save action and a disabled-while-saving button label swap. This
  document's toggle (§6) follows this exact three-part shape, changing only the table/column names and the two option
  labels (ON/OFF instead of hume/openai_realtime).
- **`app/(with-clerk)/dashboard/admin/page.tsx`, confirmed by direct read (full file, 84 lines).** `DemoAccessCard` and
  `VoiceProviderCard` are both composed directly into the admin home page's server component, in that order, above the
  static `ADMIN_LINKS` grid. This document's new card is added as a third card in this same stack (§4, placement
  decision reasoned there).
- **`DEMO_TOPICS` in `app/(demo)/demo/_content.ts`, confirmed by direct read (full file, 481 lines).** Exactly two
  demo topics exist today: `claude-ai` and `oop-fundamentals`, each with a `slug` field that the dispatch route already
  writes into `partner_sessions.partner_reference` (B2B-33 convention, reused unmodified by the performance route's
  existing query — confirmed above). No third demo topic exists; this document's schema and queries are written
  generically by `partner_reference`, so a future third demo topic needs zero schema change to get its own accumulating
  list (§12).

Nothing in the CEO brief's claims was found to be inaccurate. This document resolves all five of the brief's Section-11
open questions below with direct-code-backed reasoning, leaving zero items in Section 11.

---

## 1. Purpose

Today the demo page's Performance tab (`/demo/claude-ai` and `/demo/oop-fundamentals`) shows only the single most
recently dispatched demo session's extracted result. One bad extraction, and prospects see "Performance data couldn't
be generated" with nothing else to look at — even on a good day, it's one example, not a body of evidence. Arun wants
to run real demo sessions over the next several days and have every genuine, successfully-extracted result accumulate
into a durable, growing table of real examples per demo topic, governed by a single global on/off switch so he can
freeze the table's contents once he judges there's enough there — all without touching the real-partner webhook path,
without backfilling old broken sessions, and without ever using fabricated or illustrative data.

What failure looks like without this: the Performance tab keeps being fragile (one failed extraction erases the only
example) and thin (never more than one data point), undermining exactly the "look how good Clio's session insights
are" impression the demo page exists to create for prospects evaluating Clio.

## 2. User Story

As Arun (product owner, operating the admin dashboard),
I want a single global toggle that controls whether newly-completed demo session results get added to each demo
topic's Performance tab, independent of whether extraction itself runs,
So that I can run real demo sessions for a few days to build up a genuine example table, then freeze it by flipping
the toggle off, without any risk of extraction breaking or old broken sessions polluting the table.

As a prospect browsing a public demo page's Performance tab (`claude-ai` or `oop-fundamentals`),
I want to see a growing list of real, genuine session-outcome examples for that specific course,
So that I trust Clio's session insights are real and substantial, not a single fragile data point.

## 3. Trigger / Entry Point

- **Admin toggle:** `/dashboard/admin` (existing admin home page) — new card, fetch-on-mount, `requireSuperAdmin()`
  gated exactly like `VoiceProviderCard`. No new route/page; composed into the existing page.
- **Toggle read/write API:** `GET`/`PATCH /api/admin/demo-performance-config` — new route, mirroring
  `/api/admin/voice-config`'s exact shape (`requireSuperAdmin()` on both verbs).
- **Extraction-completion write:** inside `extractInsightsForPartnerSession()` in
  `inngest/partner-session-insights-extractor.ts`, at the exact point the terminal `.update()` already fires (line
  ~305) — no new trigger, no new event, no new Inngest function. Fires for every partner session exactly as today;
  the new column is simply one more field in the same existing write, populated conditionally (§6).
- **Read (Performance tab):** `GET /api/demo/[slug]/performance` — existing route, extended (not replaced) to also
  return the accumulating list. Public, no auth, unchanged posture (§0).
- **Required state:** identical to today for every part of this — the admin toggle requires `requireSuperAdmin()`;
  the demo Performance tab requires nothing (public, unauthenticated, matching every other `/api/demo/[slug]/*`
  route).

## 4. Screen / Flow Description

### 4.A — Admin dashboard: new "Demo Performance entries" card

A new card, `DemoPerformanceToggleCard.tsx`, placed on `/dashboard/admin` directly **below `DemoAccessCard` and above
`VoiceProviderCard`** — reasoning: `DemoAccessCard` already owns "settings that control what happens on the public
demo pages" (its own doc-comment says exactly this, confirmed §0), and this toggle is squarely in that same
category (it controls demo-page content), whereas `VoiceProviderCard` is an unrelated platform-wide voice-provider
concern. Grouping the two demo-scoped cards together, before the voice card, is the more legible ordering.

**State A1 — card loads successfully, toggle currently ON (the default):**
```
┌──────────────────────────────────────────────────────────────┐
│ Demo Performance tab entries                                  │
│ Controls whether newly completed demo sessions get added to    │
│ the Performance tab's example list on /demo pages.             │
│                                                                  │
│  ┌────────────────────────┐  ┌────────────────────────┐        │
│  │ Appending        ●     │  │ Paused                  │        │
│  │ ACTIVE                  │  │                          │        │
│  └────────────────────────┘  └────────────────────────┘        │
│                                                                  │
│ New demo-session results are being added to the Performance     │
│ tab as they're extracted. Existing entries never disappear —    │
│ pausing only stops new ones from being added.                   │
└──────────────────────────────────────────────────────────────┘
```

**State A2 — admin clicks the "Paused" tile (pending selection, not yet saved):**
Same two tiles, "Paused" now shows the `SELECTED` badge (purple border/tint, exactly `VoiceProviderCard`'s own
`pendingSelection` visual convention), a "Save changes" button appears below the info line.

**State A3 — admin clicks "Save changes":**
`window.confirm(...)` dialog, exact text:
```
Pausing stops NEW demo sessions from being added to the Performance tab. Sessions already extracted while this
was on stay exactly as they are — nothing is removed. Continue?
```
On confirm → `PATCH /api/admin/demo-performance-config` → tile flips to "Paused ACTIVE" non-optimistically (same
"only update the UI after the 200 response" convention as `VoiceProviderCard` §0), success line: `"Saved — new demo
sessions will no longer be added to the Performance tab."` (auto-clears after 4s, same pattern).
Turning it back ON shows the symmetric confirm text: `"Demo sessions completed from now on will be added to the
Performance tab. Continue?"` and success line `"Saved — new demo sessions will now be added to the Performance
tab."`

**State A4 — load failure:** `"Couldn't load demo performance settings. Try refreshing the page."` (matches
`VoiceProviderCard`'s `loadError` copy pattern exactly, substituting the noun).

**State A5 — save failure:** `"Couldn't save — try again."` (verbatim reuse of `VoiceProviderCard`'s own string).

### 4.B — Public demo page: `/demo/claude-ai` and `/demo/oop-fundamentals`, Performance tab

The tab's **non-ready states are unchanged** (`not_dispatched`/`in_progress`/`pending_extraction`/
`extraction_failed`/fetch-failure all keep their exact current copy — §0) — these describe the *latest single
dispatch attempt's own status*, which this document keeps tracking independently of the accumulating list, because
a prospect who just clicked "Learn with AI" still needs to know their own live session is being processed.

What changes is layered **on top of, and takes priority over,** those states: if one or more accumulating entries
exist for this slug, the entries list renders **regardless of the latest single session's own state** — a
previously-successful entry must never disappear just because the most recent dispatch happened to fail or is
still mid-flight (this is the direct product point of "leave the past" + durable accumulation). The latest-session
states above only govern what's shown when the entries list is empty.

**State B1 — toggle has been ON for a few days, 3 real entries have accumulated for `claude-ai` (example shape only
— see the explicit non-illustrative-data note directly below):**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Performance                                                           │
│                                                                        │
│  Aug 1, 2026, 9:14 AM                                                 │
│  ────────────────────────────────────────────────────────────────    │
│  Action items          • Compare Sonnet vs Opus pricing for the       │
│                           team's Q3 workload before the next call.    │
│  Summary               This learner is weighing model choice for a   │
│                         cost-sensitive, high-volume use case.         │
│  Topics of interest     • Haiku vs Sonnet cost tradeoffs               │
│                          • agentic tool-use reliability                │
│  Engagement style        Asks pointed, comparison-driven questions.    │
│  Suggested next topics   • Choosing the Right Model deep-dive          │
│                          • Agentic Use Cases follow-up                 │
│                                                                        │
│  Jul 31, 2026, 4:02 PM                                                 │
│  ────────────────────────────────────────────────────────────────    │
│  Action items          None identified                                │
│  Summary               This learner is new to AI and wants a plain-   │
│                         language mental model before going deeper.    │
│  Topics of interest     • what Constitutional AI means                │
│  Engagement style        Listens fully before asking clarifying        │
│                          questions.                                   │
│  Suggested next topics   • What Is Claude? recap                       │
│                                                                        │
│  Jul 30, 2026, 11:47 AM                                                │
│  ────────────────────────────────────────────────────────────────    │
│  Action items          • Read the Model Family chapter before the     │
│                           team retro.                                 │
│  Summary               This learner wants a quick reference to        │
│                         justify a model choice to their team.         │
│  Topics of interest     • Opus vs Sonnet for research tasks             │
│  Engagement style        Asks pointed, comparison-driven questions.    │
│  Suggested next topics   • What Makes Claude Different                 │
└─────────────────────────────────────────────────────────────────────┘
```
**This is a labeled mockup only, illustrating the SHAPE of the list (field order, one card per entry, newest first,
timestamp label per card) — it is explicitly NOT sample/mock/illustrative content that will ever be shown to a real
visitor.** Per the brief's own hard constraint (§ Known Constraints) and Arun's own words ("not illustrative"), the
live implementation renders **zero** entries until real demo sessions have actually been dispatched, extracted, and
appended — never synthetic placeholder rows of any kind, on any environment.

Each card's rows reuse the exact existing `PerfTableRow`/`PerfScalarCell`/`PerfListCell` rendering primitives and
copy conventions already in `DemoTopicClient.tsx` (§0) — "Not available" for a null scalar, "None identified" for an
empty/absent list, never collapsed to plain text. **Duration and the B2B-57a Usage block (Minutes billed/Generation
type/Mode/Event ID/Recorded at) are deliberately NOT part of each accumulating entry** — see the explicit decision
and reasoning in §6 below. This is a scope decision this document makes explicitly, not a gap.

**State B2 — toggle is ON (or OFF, doesn't matter for this state), zero entries exist yet for this slug (first
real session hasn't completed extraction yet, or hasn't been marked visible):**
```
┌─────────────────────────────────────────────────────────────┐
│ Performance                                                   │
│                                                                 │
│  No performance examples yet.                                  │
│  Once a demo session for this course finishes and its results   │
│  are ready, they'll appear here.                                 │
└─────────────────────────────────────────────────────────────┘
```
(Same dimmed-heading/dimmed-body visual treatment as today's other empty tabs — `perfEmptyHeadingStyle`/
`perfEmptyBodyStyle`, reused verbatim.)

**State B3 — entries list has 1+ items, but the LATEST dispatch is still processing (in_progress/pending_extraction):**
A single muted line appears above the entries list: `"A new session is being processed and will be added here once
ready."` — informational only, does not block or replace the existing entries below it.

**State B4 — entries list has 1+ items, but the LATEST dispatch's extraction failed:** No error copy shown at all —
the existing entries render exactly as State B1, with no mention of the failed latest attempt. (This is the direct,
literal consequence of "leave the past" plus the entries-list-takes-priority design — a failed dispatch attempt
must never make already-accumulated genuine examples disappear or look broken.)

**State B5 — toggle is OFF, entries exist from when it was ON:** Rendered identically to State B1 — the toggle's
current state has zero visual effect on what's already been appended (§6 permanence decision). There is no "paused"
banner on the public page — pausing is an admin-only, backend-only concept; a prospect never needs to know the
toggle exists.

## 5. Visual Examples

Covered inline in §4 above (both the admin card's 5 states and the public tab's 5 states are shown as wireframes
there, per this project's convention when a screen has many small state variants — see `docs/specs/B2B-64-
requirement-document.md` §4/§5 for the same combined convention).

## 6. Data Requirements

### 6.1 — New table: `system_demo_performance_config` (singleton, mirrors `system_voice_config` exactly)

```sql
CREATE TABLE IF NOT EXISTS system_demo_performance_config (
  id             UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000002'::uuid,
  append_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE system_demo_performance_config
  ADD CONSTRAINT system_demo_performance_config_singleton_id
  CHECK (id = '00000000-0000-0000-0000-000000000002'::uuid);

CREATE TRIGGER update_system_demo_performance_config_updated_at
  BEFORE UPDATE ON system_demo_performance_config
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE system_demo_performance_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on system_demo_performance_config"
  ON system_demo_performance_config FOR ALL
  USING (auth.role() = 'service_role');

INSERT INTO system_demo_performance_config (id, append_enabled)
VALUES ('00000000-0000-0000-0000-000000000002', true)
ON CONFLICT (id) DO NOTHING;
```
Uses a **different** fixed UUID (`...002`) than `system_voice_config`'s `...001` — confirmed necessary since both
are real singleton rows that must coexist. **Default `append_enabled = true`** — per Arun's stated intent to start
accumulating immediately (§ CEO brief Known Constraints / his own "for the next few days" framing presumes it's
already on).

### 6.2 — New column on the existing `partner_session_insights` table (no new table for entries themselves)

```sql
ALTER TABLE partner_session_insights
  ADD COLUMN IF NOT EXISTS demo_performance_visible BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_partner_session_insights_demo_performance_visible
  ON partner_session_insights(partner_session_id)
  WHERE demo_performance_visible = true;
```
**Decision — reuse `partner_session_insights` with a flag, not a new table.** The accumulating "table" a prospect
sees is a **derived, filtered read** of rows that already exist in `partner_session_insights` (the exact same row
the non-demo glitch dashboard and real-partner webhook already read) — a new table would duplicate data that's
already fully present. `demo_performance_visible` is set **once, permanently, at the moment extraction completes**
(§6.3) and is never re-evaluated or flipped by a later toggle change — this is what makes the OFF-state "freeze"
behavior Arun described ("so it will get added to the table" implying permanence) work correctly with zero extra
bookkeeping: a row's visibility is decided once, at write time, based on the toggle's state at that exact moment,
and then never touched again.

### 6.3 — The extraction-completion write (`inngest/partner-session-insights-extractor.ts`)

`extractInsightsForPartnerSession()`'s existing terminal `.update()` (confirmed §0, current lines ~305–316) gains
exactly one more computed field, following the identical "fetch once at the top, thread through" convention this
same function already uses for `test_mode`/`partner_reference`/`end_client_id`:

```ts
// Resolved once, near the top of extractInsightsForPartnerSession(), alongside the existing
// session SELECT — session.partner_account_id is already fetched (line 224, confirmed §0).
const isDemoSession = session.partner_account_id === process.env.DEMO_PARTNER_ACCOUNT_ID
const shouldMakeVisible =
  isDemoSession &&
  (result.extraction_status === 'success' || result.extraction_status === 'success_empty') &&
  (await getDemoPerformanceAppendEnabled())

// ...existing .update() call, one field added:
.update({
  extraction_status: result.extraction_status,
  action_items: result.actionItems,
  glitches: result.glitches,
  learner_insight: result.learnerInsight,
  transcript_event_count: result.eventCount,
  error_message: result.isMock ? '...' : null,
  extracted_at: new Date().toISOString(),
  demo_performance_visible: shouldMakeVisible,   // NEW — false for every non-demo/real-partner session, always
})
```
- **Real-partner sessions:** `isDemoSession` is `false` (their `partner_account_id` never equals
  `DEMO_PARTNER_ACCOUNT_ID`), so `demo_performance_visible` is always written as `false` — zero behavior change,
  zero new read, for every non-demo session. This satisfies the brief's "extraction itself must never be gated by
  the toggle" constraint by construction: nothing about whether, when, or how extraction runs changes for anyone;
  exactly one additional boolean is computed and stored alongside a write that already happens today.
- **`markInsightsExtractionFailed()` is NOT touched** (confirmed §0 it's a structurally separate `.update()` call) —
  a failed extraction's row keeps `demo_performance_visible` at its column default (`false`), which is exactly
  correct: a failed extraction must never be appended (resolves brief Question 5, §11).
- New helper, `lib/demo/performance-config.ts`:
  ```ts
  export async function getDemoPerformanceAppendEnabled(): Promise<boolean> {
    const supabase = createSupabaseAdminClient()
    const { data } = await supabase
      .from('system_demo_performance_config')
      .select('append_enabled')
      .eq('id', '00000000-0000-0000-0000-000000000002')
      .maybeSingle()
    return data?.append_enabled ?? true // fail open to the default — matches this table's own DEFAULT true
  }
  ```

### 6.4 — Read side: `app/api/demo/[slug]/performance/route.ts`

Extended (not replaced). Existing single-latest-session logic (§0) is **unchanged** — it still resolves
`session_state`/`duration_minutes` for the latest dispatch, still used to drive States B2/B3 above. **Added**: a
second, independent query for the accumulating entries list, scoped by the same `partner_reference = slug` column
the existing query already uses (confirmed §0 — this is the direct code-level basis for the per-topic decision in
§11 Q1):

```ts
const { data: entryRows } = await supabase
  .from('partner_session_insights')
  .select('extracted_at, action_items, learner_insight, partner_sessions!inner(partner_reference)')
  .eq('demo_performance_visible', true)
  .eq('partner_sessions.partner_account_id', demoPartnerAccountId)
  .eq('partner_sessions.partner_reference', params.slug)
  .order('extracted_at', { ascending: false })
  .limit(200) // defensive cap only — see reasoning below, not expected to ever bind in practice
```
`PerformanceResponse` gains one new field:
```ts
entries: {
  extracted_at: string
  action_items: { text: string }[]
  summary: string | null
  topics_of_interest: string[]
  engagement_style: string | null
  suggested_next_topics: string[]
}[]
```
**Decision — no Duration/Usage per entry.** Duration is a live, per-request Hume API lookup today (`§0`, not a
stored column); Usage is a separate `webhook_dispatch_log` join. Re-deriving either for a growing list of historical
entries, on every public page load, adds real cost/latency/failure-surface for fields Arun's own words never
mention wanting accumulated (he describes "post-session insights," i.e. the learner_insight/action_items shape).
Each entry therefore surfaces only the durably-stored qualitative fields already sitting in
`partner_session_insights` — no new fetch, no new join, no new external API call added to this route's `entries`
query. Duration/Usage remain exactly as they are today, solely as part of the (unchanged) latest-single-session
status tracking, not per accumulating entry. If Arun later wants Duration/Usage snapshotted per historical entry
too, that requires storing them at extraction time (a schema addition) — a small, separate, clearly-scoped follow-on
if ever requested, not assumed here.

**`.limit(200)` reasoning:** Arun's own stated plan ("add values for the next few days") implies dozens of entries
per topic at most, not thousands — this cap is a defensive ceiling against unbounded growth, not a designed-for
product limit, and is not expected to ever be reached in the described usage.

### 6.5 — APIs called (new)
- `GET`/`PATCH /api/admin/demo-performance-config` — new route file, `requireSuperAdmin()`-gated both verbs,
  structurally identical to `/api/admin/voice-config/route.ts` (§0).

### 6.6 — localStorage/sessionStorage
None. No change to any client-side persisted state.

### 6.7 — Migration file
`supabase/migrations/107_b2b65_demo_performance_toggle_and_accumulation.sql` (next free number after `106_voice_
provider_per_session.sql`, confirmed §0) — contains §6.1 and §6.2's SQL in full.

## 7. Success Criteria (Acceptance Tests)

✓ Given the toggle is ON (default) and a demo session under `claude-ai` completes extraction with
`extraction_status: 'success'`, when the extraction's terminal write runs, then that row's `demo_performance_visible`
is `true`, and a subsequent `GET /api/demo/claude-ai/performance` includes it in `entries`, newest-first.

✓ Given the toggle is OFF and a demo session under `claude-ai` completes extraction successfully, when the terminal
write runs, then that row's `demo_performance_visible` is `false`, and it never appears in `entries` for any future
`GET /api/demo/claude-ai/performance` call, even after the toggle is later switched back ON (permanence, §6.2/§6.3).

✓ Given the toggle is ON and a demo session's extraction ultimately fails (3 attempts exhausted,
`markInsightsExtractionFailed()` runs), when checked, then `demo_performance_visible` for that row is `false` (its
unchanged column default) and it never appears in `entries` — confirms failed extractions are never appended
(resolves brief Question 5).

✓ Given a real (non-demo) partner session completes extraction successfully with the toggle ON, when the terminal
write runs, then `demo_performance_visible` is `false` for that row (its `partner_account_id` is never
`DEMO_PARTNER_ACCOUNT_ID`) — confirms zero effect on any real-partner session or the reseller webhook path.

✓ Given `claude-ai` has 3 visible entries and `oop-fundamentals` has 0, when `GET /api/demo/claude-ai/performance`
and `GET /api/demo/oop-fundamentals/performance` are each called, then the first returns 3 entries and the second
returns 0 — confirms the accumulating list is scoped per demo topic (`partner_reference`), not combined.

✓ Given `claude-ai` has 2 visible entries and the LATEST `claude-ai` dispatch's `session_state` is
`extraction_failed`, when `DemoTopicClient.tsx`'s Performance tab renders, then the 2 entries render exactly as
State B1 with no error copy shown anywhere — confirms the entries list takes priority over the latest-session
error state (State B4).

✓ Given `claude-ai` has 0 visible entries (fresh demo topic, or toggle just turned on with nothing extracted yet),
when the Performance tab renders, then it shows the exact copy "No performance examples yet. Once a demo session
for this course finishes and its results are ready, they'll appear here." (State B2), never any illustrative/sample
row.

✓ Given a super-admin loads `/dashboard/admin`, when the page renders, then a new "Demo Performance tab entries"
card appears between `DemoAccessCard` and `VoiceProviderCard`, defaulting to showing "Appending" as ACTIVE
(matching the migration's `DEFAULT true`).

✓ Given a super-admin clicks the "Paused" tile then "Save changes" then confirms the dialog, when the PATCH
succeeds, then `system_demo_performance_config.append_enabled` becomes `false`, the card shows "Paused" as ACTIVE
non-optimistically (only after the 200 response), and the next demo-session extraction (any slug) writes
`demo_performance_visible: false` regardless of its own extraction success.

✓ Given a non-super-admin (or unauthenticated request) calls `PATCH /api/admin/demo-performance-config` directly,
then the response matches `requireSuperAdmin()`'s existing rejection shape (401/403, identical to every other
`/api/admin/*` route) — no new auth bypass introduced.

## 8. Error States

- **Extraction-completion write fails (DB error on the `.update()` call):** already covered by
  `extractInsightsForPartnerSession()`'s existing `writeError` handling (§0, throws → Inngest retries) — this
  document adds a field to an existing write, not a new failure mode; the existing retry/backstop-sweep behavior
  covers it unchanged.
- **`getDemoPerformanceAppendEnabled()` read fails (DB error/row somehow missing):** fails **open** to `true` (the
  column's own default) — reasoning: failing closed would silently and invisibly stop accumulation with no visible
  signal to Arun, whereas failing open matches the table's stated default and is self-correcting (the row is
  seeded once by migration and never deleted, so this path is expected to be unreachable in practice, not a real
  operational risk).
- **`GET /api/demo/[slug]/performance`'s new `entries` query fails:** falls back to `entries: []` for that response
  only (logged, never thrown) — the existing `session_state`/`duration_minutes` fields are computed independently
  and still return normally; the client falls back to State B2's empty copy exactly as if there were genuinely zero
  entries, never a broken page. Matches this route's own stated "no error state at the HTTP layer" contract (§0).
- **Admin card load/save failures:** covered in §4.A States A4/A5, verbatim reuse of `VoiceProviderCard`'s existing
  copy conventions.
- **`PATCH` with `openai_realtime`-style invalid body:** N/A — this toggle only has two valid values
  (`true`/`false`), Zod-validated (`z.object({ append_enabled: z.boolean() })`), returning the same generic
  `{ error: 'Validation failed', details }` 400 shape every other admin PATCH route uses on a bad body.

## 9. Edge Cases

- **A demo session dispatched, but extraction never completes (still 'pending' indefinitely, e.g. Hume API down):**
  Never appended — `demo_performance_visible` only gets set at the terminal success/success_empty write; a row
  stuck at `'pending'` simply never reaches that code path yet. Matches the backstop sweep's existing retry
  behavior (§0) — once it eventually succeeds, this document's logic runs exactly as for the fast path.
- **Toggle flips OFF, then back ON, multiple times over several days:** Each individual session's
  `demo_performance_visible` is decided once, at ITS OWN extraction-completion moment, based on the toggle's state
  at that exact instant — a session extracted during an OFF window is permanently excluded even if the toggle is
  later turned back on; a session extracted during an ON window stays visible forever even after the toggle is
  later turned off. No retroactive re-evaluation of any past row, ever (§6.2).
- **Two demo sessions for the same slug complete extraction within seconds of each other:** No special handling
  needed — each is its own independent row with its own `demo_performance_visible` value, and the `entries` query
  naturally orders both by `extracted_at DESC`; no race condition specific to this document (the existing
  idempotency guard, §0, already prevents duplicate rows per session).
- **A demo topic slug that doesn't exist is queried (`/api/demo/nonexistent-slug/performance`):** Unchanged —
  the existing `getDemoTopicBySlug()` 404 guard (line 62, §0) fires before any of this document's new logic runs.
- **`DEMO_PARTNER_ACCOUNT_ID` is unset/a placeholder:** Unchanged existing behavior — the route's existing early
  return (§0, lines 81–83) already returns the `empty` response before any session lookup; this document's new
  `entries` query is likewise never reached in that case, returning `entries: []` implicitly via the same early
  `empty`-response path (extended to include `entries: []` in that object).
- **Mobile vs. desktop:** Per the standing responsive rule, this change touches `DemoTopicClient.tsx`'s Performance
  tab, so the new entries-list markup must meet the same bar. The existing `perfTableRowStyle`'s flex-wrap
  reflow-per-row behavior (§0, deliberately no `overflowX`, content wraps vertically) is reused unchanged for each
  entry's internal rows; the only new layout element is a bordered wrapper + timestamp heading per entry card,
  built with the same `clamp()`-based spacing convention already used throughout this file (`perfTableWrapperStyle`,
  `perfTableRowStyle`) — no fixed pixel widths, no new breakpoint logic needed since each entry is just another
  stacked instance of the already-responsive existing row block.
- **A partner topic is added in the future (3rd demo topic) after this ships:** No schema or code change needed —
  `partner_reference` scoping is already generic per-slug (§0/§6.4); a new slug simply starts with 0 entries
  (State B2) until its own real sessions accumulate.

## 10. Out of Scope

- Any change to `lib/partner/webhooks.ts`'s `recordInsightsReadyEvent()` / the real-partner `session.insights_ready`
  webhook dispatch — confirmed untouched, zero shared code path added beyond the one pre-existing shared
  `.update()` call this document adds one field to (§0, §6.3).
- Any backfill or migration of historical/already-extracted demo sessions into visibility — explicitly out of
  scope per Arun's own "leave the past" instruction; `demo_performance_visible` defaults to `false` for every
  existing row and stays that way; no `UPDATE ... WHERE extracted_at < now()` of any kind ships with this migration.
- Any mock/sample/illustrative data of any kind, in any environment, ever appearing in the live `entries` field —
  confirmed as a hard constraint throughout §4/§7.
- Per-topic toggles — explicitly one single shared switch governs both `claude-ai` and `oop-fundamentals` (and any
  future demo topic) together, per Arun's own words (§6.1's single migration row).
- Duration and the B2B-57a Usage block (Minutes billed/Generation type/Mode/Event ID/Recorded at) as part of each
  accumulating entry — explicit scope cut with reasoning in §6.4; these remain solely part of the unchanged
  latest-single-session status tracking.
- Any cap/pagination UI on the entries list beyond the defensive `.limit(200)` query ceiling (§6.4) — not expected
  to bind given the described real-world volume; no "load more" control is built.
- Any change to the extraction job's own execution, retry policy, or triggers (`clio/partner-session.ended`, the
  30-minute backstop sweep, the daily purge) — all confirmed unchanged (§0, §6.3).
- Any change to the four hidden Configurator authoring screens, `TEMPLATE_MODE_SESSIONS_ENABLED` (B2B-64), or any
  other concurrent feature brief's scope.
- A wider responsive audit of `DemoTopicClient.tsx` or any other demo page beyond the Performance tab's new entries
  markup itself — the standing rule caps this to what's actually touched (§9).

## 11. Open Questions

None. All five of the CEO brief's questions are resolved above with direct-code-backed reasoning:

1. **Per-topic vs. combined accumulating table** — resolved: **per-topic**. Each demo slug (`claude-ai`,
   `oop-fundamentals`) keeps its own independent, separately-scoped accumulating list; only the on/off switch is
   shared. Reasoning: the existing `GET /api/demo/[slug]/performance` route already scopes every query by
   `partner_reference = params.slug` (confirmed §0) — this is the established, pre-existing convention for
   "which demo topic does this session belong to," set once at dispatch time (B2B-33) and never touched by this
   document. Combining across slugs would require a brand-new cross-slug query that discards this existing scoping
   column, with no support anywhere in Arun's actual words (he only ever describes the switch as shared, never the
   table's contents) and no product benefit (a `claude-ai` prospect gains nothing from seeing `oop-fundamentals`
   examples mixed in — if anything it would look like a bug). Worked example table shown in §4.B State B1/the
   acceptance test in §7 confirming `claude-ai`'s 3 entries and `oop-fundamentals`'s 0 entries are independent.
2. **Exact data model for the accumulating table** — resolved: no new table; a new `demo_performance_visible`
   boolean column on the existing `partner_session_insights` table, set once and permanently at extraction-
   completion time based on the toggle's state at that exact moment, never re-evaluated later (§6.2/§6.3/§9).
3. **Exact UI for the Performance tab's list view** — resolved: one card per entry, newest-first
   (`extracted_at DESC`), reusing the existing qualitative fields (Action items/Summary/Topics of interest/
   Engagement style/Suggested next topics) via the existing `PerfTableRow`/`PerfScalarCell`/`PerfListCell`
   primitives, no Duration/Usage per entry (reasoned in §6.4), defensive `.limit(200)` with no visible cap/pagination
   UI, empty-state copy given verbatim in §4.B State B2.
4. **Exact admin toggle UI copy, label, location** — resolved: "Demo Performance tab entries" card, placed
   between `DemoAccessCard` and `VoiceProviderCard` on `/dashboard/admin`, exact copy given in §4.A, defaulting to
   ON (`append_enabled = true`) per Arun's stated intent to start accumulating immediately.
5. **Behavior for a session whose extraction fails or is pending while the toggle is ON** — resolved: never
   appended, ever, for either state; only a terminal `success`/`success_empty` extraction ever sets
   `demo_performance_visible = true` (§6.3, acceptance test in §7).

## 12. Dependencies

- **B2B-09** (`partner_session_insights` table, the extraction pipeline) — must exist; confirmed already shipped
  and is the table this document adds one column to (§0).
- **B2B-34 Piece 1** (`learner_insight` schema — summary/topics_of_interest/engagement_style/suggested_next_topics)
  — must exist; confirmed already shipped (migration 096) and is the exact shape each accumulating entry surfaces
  (§6.4).
- **B2B-51** (Field/Value table rendering primitives `PerfTableRow`/`PerfScalarCell`/`PerfListCell`) — must exist;
  confirmed already shipped and reused verbatim per entry card (§4.B, §6.4).
- **B2B-61 Part B** (`system_voice_config` + `VoiceProviderCard.tsx` pattern) — the direct structural precedent
  this document's toggle mechanism copies; confirmed already shipped (§0).
- **New migration:** `supabase/migrations/107_b2b65_demo_performance_toggle_and_accumulation.sql` (§6.1/§6.2/§6.7).
- **New files:** `app/api/admin/demo-performance-config/route.ts`,
  `app/(with-clerk)/dashboard/admin/DemoPerformanceToggleCard.tsx`, `lib/demo/performance-config.ts`.
- **Modified files:** `app/(with-clerk)/dashboard/admin/page.tsx` (compose the new card),
  `inngest/partner-session-insights-extractor.ts` (one new field in the existing terminal `.update()`),
  `app/api/demo/[slug]/performance/route.ts` (new `entries` query + response field),
  `app/(demo)/demo/[slug]/DemoTopicClient.tsx` (render the entries list, State B1/B3/B4 logic).
- **No dependency on, or conflict with, B2B-64** (concurrent) — B2B-64 scopes itself entirely to
  `/api/partner/v1/sessions` session-creation and Configurator docs pages; zero file overlap with this document.

---

Once approved by the CEO Agent, this spec is ready for Dev with zero open questions.
