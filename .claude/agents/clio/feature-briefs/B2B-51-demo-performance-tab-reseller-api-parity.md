# Feature Brief: Demo Performance Tab — Literal Table of Reseller-Sent Session Fields

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-30 (superseding revision)

## STATUS: This brief supersedes the original 2026-07-30 draft's glitches workstream

The original version of this brief (git history) proposed adding a **Glitches** section to the demo
Performance tab, reversing B2B-34 Part C's exclusion of glitches from this tab. Arun corrected that
in a follow-up message, in his own words: **"sorry please ignore my response earlier."** Glitches are
struck from this brief's scope entirely — not filtered, not scoped down, not referenced anywhere on
this tab. They stay exactly where B2B-34 Part C put them: the internal glitch tracker (B2B-17) only.

## What Arun Said

First (superseded — do not build):
> "yes you are right the glitches are internal only but the glitches caused due to demo - topic
> alone can be displayed here..."

Then, correcting himself (this is the governing instruction):
> "sorry please ignore my response earlier. in the performance tab we should not show any glitch. we
> need to capture the response we send for each session with the action item.. etc we already
> defined what we are sending to resellers. only that information we need to publish here in a
> table.. no information related to glitches here. glitches are currently displayed correctly in the
> dashboard"

## The Problem Being Solved

Two things, both now unambiguous:

1. **Zero glitch information anywhere on this tab.** Glitches are already shown correctly elsewhere
   (the internal dashboard / glitch tracker, B2B-17). Duplicating or referencing them here — even in
   a filtered or demo-topic-scoped form — is explicitly ruled out by Arun's own words twice in the
   same message ("we should not show any glitch," "no information related to glitches here").
2. **Format, not new content.** Arun's phrase "we already defined what we are sending to resellers...
   only that information we need to publish here in a table" is a statement that the content is
   settled and the only remaining work is displaying it as a literal table (field name → value),
   rather than the tab's current narrative/prose layout.

## Independent Re-Verification (done fresh for this revision, not trusted from the prior draft)

I re-read the actual code rather than relying on the earlier brief's summary of it:

- **`lib/partner/webhooks.ts`'s `WebhookPayload` interface** (lines 35-74) — confirmed this is the
  real, complete wire contract Clio sends a reseller about a session via the `session.insights_ready`
  webhook (B2B-09). Full field list confirmed by direct read: `event_id, event_type,
  clio_session_ref, partner_reference, quantity, unit, generation_type, occurred_at, dispatched_at,
  test_mode, extraction_status, action_items, glitches, learner_insight, end_client_id, reseller_id,
  reseller_unique_id, hume_config_id`.
- **`app/api/demo/[slug]/performance/route.ts`** — confirmed the Supabase select is `.select('extraction_status,
  action_items, learner_insight')` (line 105) — it does **not** select `glitches` at all today. The
  route is already clean; there is nothing to remove here, only something to keep excluded.
- **`app/(demo)/demo/[slug]/DemoTopicClient.tsx`** (lines 691-753) — confirmed the "ready" render
  path is a narrative layout: an `<h3>`/`<p>` block for **Duration**, a `<ul>` for **Action items**,
  and for **Learner insight** a `<p>` summary plus three sub-groups (`Topics of interest` as pills,
  `Engagement style` as a paragraph, `Suggested next topics` as pills) — not a `<table>` anywhere.

## What Success Looks Like

The Performance tab's "ready" state becomes a **literal key-value table** — one row per field,
sourced from exactly the session-outcome fields already established as sent to resellers. No new
data pipeline: every value below is already fetched by the existing route/query.

**Resolved field list for the table** (CEO judgment call, documented rather than left open — see
rationale below):

| Table row | Source |
|---|---|
| Duration | `duration_minutes` (Hume-sourced ground truth, same value shown today) |
| Action items | `action_items[].text` (list, same content shown today) |
| Summary | `learner_insight.summary` |
| Topics of interest | `learner_insight.topics_of_interest[]` |
| Engagement style | `learner_insight.engagement_style` |
| Suggested next topics | `learner_insight.suggested_next_topics[]` |

**Explicitly NOT in the table, and why:**
- **Glitches** — struck per Arun's explicit instruction, no exception.
- **`extraction_status`** — this is delivery/pipeline plumbing, not "the response we send... with the
  action item.. etc" in Arun's sense. It already does its job invisibly: it's what the tab's
  existing `session_state` gating uses to decide whether to show the pending/failed/ready view in
  the first place. No behavior change needed; not a table row.
- **Identifiers** (`clio_session_ref`, `partner_reference`, `reseller_unique_id`, `end_client_id`,
  `reseller_id`, `hume_config_id`) **and delivery metadata** (`event_id`, `occurred_at`,
  `dispatched_at`, `test_mode`, `generation_type`) — these are wire-envelope/routing fields that
  exist to make the webhook mechanism work, not values *about the session's content* a reseller
  would read in a report. Arun's own language, both in this message ("the response we send for each
  session with the action item.. etc") and the earlier F-01 instruction it echoes ("transcription
  summary, action items... meeting duration"), describes session-outcome content, not wire plumbing.
  I'm resolving this as CEO judgment rather than leaving it as an open BA question — this brief
  answers it so BA does not have to guess or re-ask.

This closes both open questions the prior draft of this brief left for BA/Arun: "literal table vs.
narrative layout" is now literal table (per Arun's own word "table," used explicitly this time), and
"scope of all values" is now resolved to session-outcome content only, excluding glitches, identifiers,
and delivery metadata.

## Known Constraints

- No portal/config UI implied — read-only display change to an existing internal demo page.
- Do not touch `lib/partner/webhooks.ts`'s `WebhookPayload` contract, `GET
  /api/partner/v1/sessions/[clio_session_ref]`, or `GET /api/partner/v1/usage` — none are broken;
  this is purely a demo-tab display/format change.
- Do not add a `glitches` column back to the Supabase select in
  `app/api/demo/[slug]/performance/route.ts` under any framing (filtered, demo-topic-scoped, or
  otherwise). The route's current query is already correct for this instruction — leave it that way.
- Empty/pending/failed states (`not_dispatched`, `in_progress`/`pending_extraction`,
  `extraction_failed`) are unaffected — this brief only changes the "ready" state's presentation from
  narrative sections to a table. BA should confirm table row treatment when a given value is empty
  (e.g., no action items) — recommend the same explicit "None identified" / "—" convention the
  narrative layout already uses per field, just inside a table cell instead of a paragraph.

## Questions for BA

None outstanding on scope or content — both are resolved above. Remaining work for BA is purely
presentation-layer: table wireframe (columns, row order matching the list above, empty-cell
treatment per row, responsive behavior per the standing mobile-friendly policy since this change
touches the tab regardless of framing).
