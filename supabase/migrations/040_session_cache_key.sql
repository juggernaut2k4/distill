-- Migration 040: SESS-01 — session UUID as primary content cache key
--
-- The content pipeline already writes topic_content_cache rows with
-- topic_id = sessions.id (UUID). This migration adds an explicit session_id
-- column as a typed FK so queries can join directly to sessions, and adds an
-- index to support the per-session KB lookup.
--
-- The existing topic_id column is kept as-is (backward compatibility) —
-- it holds the same UUID value written by the pipeline.
-- The unique constraint (topic_id, subtopic_slug, industry, role) is unchanged
-- because it is what the pipeline's upsert onConflict clause depends on.

-- Add session_id column (nullable: old rows pre-dating this migration may not have it)
ALTER TABLE topic_content_cache
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES sessions(id) ON DELETE CASCADE;

-- Back-fill session_id from topic_id where topic_id matches a sessions.id UUID.
-- This covers all rows the pipeline wrote after the SESS-01 code landed.
UPDATE topic_content_cache tcc
SET    session_id = tcc.topic_id::uuid
FROM   sessions s
WHERE  tcc.topic_id = s.id::text
  AND  tcc.session_id IS NULL;

-- Index to support GET /api/kb/topics (per-user session UUID lookup)
CREATE INDEX IF NOT EXISTS idx_topic_content_cache_session_id
  ON topic_content_cache (session_id);

-- Index on topic_id retained for legacy queries that still filter by topic_id text slug
-- (already existed, listed here for documentation)
-- CREATE INDEX IF NOT EXISTS idx_topic_content_cache_topic_id ON topic_content_cache (topic_id);
