-- Migration 047: Add sections_loaded_at to walkthrough_state
-- Records when sections were last written from topic_content_cache.
-- The GET handler compares this against topic_content_cache.generated_at
-- to detect stale sections and reload them if content was regenerated
-- after the session was launched (LIVE-05).

ALTER TABLE walkthrough_state
  ADD COLUMN IF NOT EXISTS sections_loaded_at TIMESTAMPTZ;
