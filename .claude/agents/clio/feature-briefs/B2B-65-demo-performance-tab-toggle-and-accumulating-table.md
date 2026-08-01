# Feature Brief: Demo Performance Tab — Accumulating Real-Session Table Behind a Global Toggle

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-08-01

---

## What Arun Said

Verbatim, relayed by the Orchestrator from Arun's direct instruction:

1. "no if future sessions post-session insights come to performance tab for the demo sessions then i m good" — confirms the existing real-session-to-reseller webhook path is fine as-is; nothing to change there.
2. "leave the past. future sessions api values need to append here with the existing values" — do not touch/backfill historical failed extractions; going forward, each new demo session's result should be **appended** to a growing set, not replace the single latest result as today.
3. "extractions should run but when off just that those api need not get appended to the table in performance. if on then the api push add those entries to the table" — defines the toggle precisely: extraction always runs and always writes to the database regardless of toggle state; the toggle only controls whether that result also gets appended to what the Performance tab displays.
4. "not illustrative, i want to add the values for the next few days then i will toggle it off so it will get added to the table" — this is real data from real demo runs, accumulating over the next several days while the toggle is ON, specifically so prospective customers browsing the demo page see genuine example entries. Once Arun judges there's enough, he flips the toggle OFF to freeze the table's contents — no further sessions get appended after that point. This is explicitly **not** sample/mock/illustrative data.
5. "no one common switch for demo all together" — one single global toggle governs this for all demo topics combined (both `claude-ai` and `oop-fundamentals`), not a per-topic toggle.

## The Problem Being Solved

Today, the demo page's Performance tab (`app/(demo)/demo/[slug]/DemoTopicClient.tsx`, rendered from `app/api/demo/[slug]/performance/route.ts`) shows only the single most recent session's extracted result for that slug (the route resolves the latest `partner_sessions` row via `.order('created_at', {ascending:false}).limit(1)` and then a single `.maybeSingle()` lookup into `partner_session_insights` — confirmed by direct read). If extraction failed or hasn't run yet, the tab shows an error/pending state instead of anything useful.

For a prospect evaluating Clio by trying the public demo, this means the Performance tab is fragile and thin — one bad extraction and there's nothing to show, and even on a good day it's a single example, not a convincing body of evidence. Arun wants to fix this by having real demo-session results accumulate into a durable, growing table of genuine examples, controllable with one switch so he can freeze it once it looks good — without touching the confirmed-working real-partner webhook path or backfilling old broken sessions.

## What Success Looks Like

1. A new global toggle exists in the admin dashboard, following the same established mechanism as the Hume/OpenAI voice provider toggle (`system_voice_config` table + `VoiceProviderCard.tsx` pattern in `app/(with-clerk)/dashboard/admin/`) — a singleton config row, a staged-selection admin card component, confirm-before-save. BA to name the config table/row and the toggle's on/off semantics precisely, but it must be a **single** switch governing all demo topics together, not per-slug.
2. Demo-session extraction (`inngest/partner-session-insights-extractor.ts`, triggered by `clio/partner-session.ended`) is **completely unaffected** by the toggle's state — it always runs, always writes to `partner_session_insights`, exactly as it does today. The toggle never touches the extraction job itself.
3. When the toggle is ON (default): once a demo session's extraction completes, its result is appended as a new entry to the Performance tab's accumulating table/list — in addition to whatever is already there, not replacing it.
4. When the toggle is OFF: extraction still completes and still writes to the database as normal — the only difference is nothing new gets appended to what the Performance tab shows. The table's contents stay exactly as they were at the moment of toggling off.
5. The Performance tab (`DemoTopicClient.tsx`) renders this as a list of real entries rather than today's single fixed Field/Value table, for both `claude-ai` and `oop-fundamentals` slugs (the two entries in `app/(demo)/demo/_content.ts`'s `DEMO_TOPICS`).

## Known Constraints

- **No changes to the real-session reseller webhook path.** `lib/partner/webhooks.ts`'s `recordInsightsReadyEvent()` / `session.insights_ready` dispatch to real partners is confirmed working and explicitly out of scope — do not touch it, do not let this brief's changes share code paths with it beyond what's already shared today.
- **No backfilling of historical/past demo sessions.** Whatever is in `partner_session_insights` from before this ships stays exactly as-is, untouched, not migrated into the new accumulating table.
- **No sample, mock, or illustrative data of any kind.** Every entry that appears in the accumulating table must come from a real extracted demo session run while the toggle was ON. Do not use an AI-generated call to fill this screen speculatively.
- **One global toggle only** — explicitly not per-topic. Both demo slugs share the same on/off state.
- **Extraction itself must never be gated by the toggle** — this is a display-append gate only, never a "should we extract" gate.

## Questions for BA

Section 11 of your spec must resolve all of these before this goes back to me for approval — do not guess, document exact behavior with a worked example/wireframe for each:

1. **Is the accumulating table combined across both demo topics, or does each demo topic (`claude-ai`, `oop-fundamentals`) keep its own separate accumulating list even though the toggle is shared?** Arun's words describe the toggle as one shared switch but never say whether the table itself is unified or per-topic. Given the Performance tab is rendered per-slug (`/demo/[slug]`), my working assumption is the table stays per-topic (a visitor on the `claude-ai` demo page shouldn't see `oop-fundamentals` results mixed in) and only the *switch* is shared — but you must confirm this explicitly with Arun-facing wording and a wireframe, not assume it silently.
2. What is the exact data model for "the accumulating table" — is it a new table, or a derived query (all `partner_session_insights` rows for a slug's sessions, ordered by time, since the toggle was last turned on or since inception)? Must account cleanly for the OFF state freezing the list without deleting the underlying extraction rows.
3. Exact UI for the Performance tab's new list view: what fields per entry (reuse the existing 6-row shape per entry, or a condensed card/row), ordering (newest first vs. oldest first), any cap on how many entries display, and empty-state copy for a demo topic with zero entries yet.
4. Exact admin toggle UI copy, label, and location within the admin dashboard's existing layout (near `VoiceProviderCard` or its own card).
5. Behavior for a session whose extraction fails or is still pending while the toggle is ON — does a failed/pending entry ever get appended, or only fully-`ready` extractions?
