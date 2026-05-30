-- ─── 019_curriculum_engine.sql ───────────────────────────────────────────────
-- Adds role_topic_cache for pre-computed curated topic lists per role×industry×maturity.
-- Also adds graph relationship fields to topic_catalog for future curriculum engine use.

-- ─── TOPIC_CATALOG GRAPH FIELDS ──────────────────────────────────────────────
ALTER TABLE topic_catalog
  ADD COLUMN IF NOT EXISTS arc_position       text        NOT NULL DEFAULT 'interest',
  ADD COLUMN IF NOT EXISTS requires           text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS expands_to         text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mandatory_for      text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS interest_keywords  text[]      NOT NULL DEFAULT '{}';

COMMENT ON COLUMN topic_catalog.arc_position IS 'foundation|interest|context|deploy|govern — where in the learning arc this topic sits';
COMMENT ON COLUMN topic_catalog.requires IS 'topic slugs that must precede this topic as prerequisites';
COMMENT ON COLUMN topic_catalog.expands_to IS 'topic slugs generated when user names this as their interest';
COMMENT ON COLUMN topic_catalog.mandatory_for IS 'industry slugs where this topic is always included regardless of user interest';
COMMENT ON COLUMN topic_catalog.interest_keywords IS 'keywords that trigger this topic when user names an interest';

-- ─── ROLE TOPIC CACHE ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_topic_cache (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role           text        NOT NULL,
  industry       text        NOT NULL,
  maturity       text        NOT NULL,
  topics         jsonb       NOT NULL DEFAULT '[]',
  -- topics shape: Array<{ title, description, domain_id, is_trending, trending_score, popularity_rank, tags }>
  generated_at   timestamptz NOT NULL DEFAULT now(),
  version        int         NOT NULL DEFAULT 1,
  UNIQUE(role, industry, maturity)
);

COMMENT ON TABLE role_topic_cache IS 'Pre-computed curated topic lists per role×industry×maturity. Refreshed monthly by Inngest.';

CREATE INDEX IF NOT EXISTS idx_role_topic_cache_lookup
  ON role_topic_cache (role, industry, maturity);

ALTER TABLE role_topic_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_role_topic_cache"
  ON role_topic_cache FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_write_role_topic_cache"
  ON role_topic_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
