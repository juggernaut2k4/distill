-- Migration 037: Switch embedding dimensions from 1536 (OpenAI) to 1024 (Voyage AI).
-- Voyage AI is Anthropic's official embeddings partner — no separate OpenAI key needed.
-- The embedding column is empty (no data yet) so this is safe to alter without backfill.

-- Drop the HNSW index before altering the column type (Postgres requires this)
DROP INDEX IF EXISTS topic_content_cache_embedding_idx;

-- Alter the column to 1024 dimensions (Voyage voyage-3-lite default output)
ALTER TABLE topic_content_cache
  ALTER COLUMN embedding TYPE vector(1024);

-- Recreate the HNSW index with the correct dimension
CREATE INDEX topic_content_cache_embedding_idx
  ON topic_content_cache
  USING hnsw (embedding vector_cosine_ops);

-- Update the match_topic_content RPC to match the new dimension
CREATE OR REPLACE FUNCTION match_topic_content(
  query_embedding vector(1024),
  match_industry  text,
  match_role      text,
  match_count     int DEFAULT 3
)
RETURNS TABLE (
  topic_id        text,
  subtopic_slug   text,
  subtopic_title  text,
  section_data    jsonb,
  training_script jsonb,
  similarity      float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    topic_id,
    subtopic_slug,
    subtopic_title,
    section_data,
    training_script,
    1 - (embedding <=> query_embedding) AS similarity
  FROM topic_content_cache
  WHERE
    pipeline_status = 'ready'
    AND embedding IS NOT NULL
    AND industry = match_industry
    AND role     = match_role
    AND expires_at > now()
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
