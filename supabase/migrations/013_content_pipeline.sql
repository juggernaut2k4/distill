-- Content pipeline additions to topic_content_cache and sessions.
-- Adds training script and content outline columns so the 6-step content
-- pipeline can persist its output alongside the existing template data.

-- ─── TOPIC CONTENT CACHE ─────────────────────────────────────────────────────

ALTER TABLE topic_content_cache
  ADD COLUMN IF NOT EXISTS content_outline  jsonb,      -- Step 1: topic summary + key concepts
  ADD COLUMN IF NOT EXISTS training_script  jsonb,      -- Step 2: TEACH/CHECKPOINT/PROBE/CONTINUE
  ADD COLUMN IF NOT EXISTS pipeline_status  text NOT NULL DEFAULT 'pending';
  -- Values: pending | generating | ready | failed

-- Index to poll pipeline status across all subtopics for a topic
CREATE INDEX IF NOT EXISTS idx_topic_content_cache_pipeline
  ON topic_content_cache (topic_id, pipeline_status);

-- ─── SESSIONS ─────────────────────────────────────────────────────────────────

-- Tracks the overall content pipeline state for a session
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS content_status text NOT NULL DEFAULT 'pending';
  -- Values: pending | generating | ready | failed

CREATE INDEX IF NOT EXISTS idx_sessions_content_status
  ON sessions (content_status);
