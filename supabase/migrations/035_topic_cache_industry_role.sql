-- Migration 035: Add industry + role to topic_content_cache key
-- Separate cache rows per user context so Financial Services ≠ Retail content.
-- Empty string '' is the "generic" value — existing rows are backfilled to ''.

ALTER TABLE topic_content_cache
  ADD COLUMN IF NOT EXISTS industry TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS role     TEXT NOT NULL DEFAULT '';

-- Backfill existing rows to empty string (they become the generic shared cache)
UPDATE topic_content_cache SET industry = '', role = '' WHERE industry = '' OR industry IS NULL;

-- Drop the old unique constraint (shared key across all users)
ALTER TABLE topic_content_cache
  DROP CONSTRAINT IF EXISTS topic_content_cache_topic_id_subtopic_slug_key;

-- New unique constraint: (topic, subtopic, industry, role)
-- '' = generic/shared, 'financial-services' + 'vp' = tailored row
ALTER TABLE topic_content_cache
  ADD CONSTRAINT topic_content_cache_composite_key
  UNIQUE (topic_id, subtopic_slug, industry, role);
