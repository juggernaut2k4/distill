-- Migration 036: pgvector semantic search on topic_content_cache
-- Enables finding the most relevant section for any arbitrary query (e.g. off-script
-- user questions during a live Recall.ai session) without exact keyword matching.
--
-- Embedding model: OpenAI text-embedding-3-small (1536 dimensions).
-- Index: HNSW (hierarchical navigable small world) — sub-10ms approximate nearest-neighbour search.
-- Filter: queries always include industry + role so semantic search stays personalised.

-- Enable pgvector extension (already available on all Supabase projects, safe to re-run)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to topic_content_cache
ALTER TABLE topic_content_cache
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW index: faster than IVFFlat for incremental inserts (no rebuild needed when rows are added)
CREATE INDEX IF NOT EXISTS topic_content_cache_embedding_idx
  ON topic_content_cache
  USING hnsw (embedding vector_cosine_ops);

-- RPC function: match_topic_content
-- Called by lib/embeddings.ts semanticSearchContent().
-- Returns rows ordered by cosine similarity, filtered by industry + role context.
-- match_industry='' and match_role='' queries the generic/shared rows.
CREATE OR REPLACE FUNCTION match_topic_content(
  query_embedding vector(1536),
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
