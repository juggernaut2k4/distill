-- LIVE-01: Real-Time Teaching Architecture (script-less live conductor)
--
-- Additive-only migration. Adds storage for the new toggle-gated live-conductor
-- path without touching any existing column, table, or the old script/template
-- pipeline. When NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED is off/unset, these columns
-- are simply never read or written.
--
-- live_conductor_content on `sessions`: holds the two-layer content produced by
-- the new branch in inngest/session-content-pipeline.ts — the whole-topic
-- background (generated once) plus the ordered list of per-tab ContentArticles
-- (reusing generateContentArticles as-is). Shape (documented, not enforced by
-- Postgres — this is a JSONB column):
--   {
--     "topic_background": string,
--     "tabs": [ { "subtopic_slug": string, "subtopic_title": string, "article": ContentArticle } ],
--     "generated_at": string (ISO)
--   }
--
-- live_conductor_tab_index / live_conductor_visual on `walkthrough_state`: the
-- per-user live session pointer into the tabs above, plus the most recently
-- generated live visual for the CURRENT tab (swapped, not appended, on every
-- advance_tab call — see lib/voice/live-conductor-bridge.ts).

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS live_conductor_content JSONB;

ALTER TABLE walkthrough_state
  ADD COLUMN IF NOT EXISTS live_conductor_tab_index INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS live_conductor_visual JSONB;
