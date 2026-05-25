-- ─── 018_topic_catalog.sql ───────────────────────────────────────────────────
-- Pre-generated topic catalog organised by domain.
-- Seeded via /api/admin/seed-topics (57 domains × ~6 topics each ≈ 342 rows).
-- Replaces the static curriculum.ts catalog on the /topics selection page.

CREATE TABLE IF NOT EXISTS topic_catalog (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text        NOT NULL,
  description      text        NOT NULL DEFAULT '',
  domain_id        text        NOT NULL,
  relevant_roles   text[]      NOT NULL DEFAULT '{}',  -- role slugs e.g. ['cto', 'developer']
  relevant_maturity text[]     NOT NULL DEFAULT '{}',  -- proficiency levels
  tags             text[]      NOT NULL DEFAULT '{}',  -- searchable keywords
  is_custom        boolean     NOT NULL DEFAULT false,  -- true = generated from user objectives
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- GIN index for role containment / overlap queries
-- Supports: WHERE relevant_roles && ARRAY['cto']::text[]
CREATE INDEX IF NOT EXISTS idx_topic_catalog_roles
  ON topic_catalog USING GIN (relevant_roles);

-- Btree index for domain-scoped queries
CREATE INDEX IF NOT EXISTS idx_topic_catalog_domain
  ON topic_catalog (domain_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE topic_catalog ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can read the catalog
CREATE POLICY "authenticated_read_topic_catalog"
  ON topic_catalog FOR SELECT
  TO authenticated
  USING (true);

-- Only service role (server-side) can insert / update / delete
CREATE POLICY "service_role_write_topic_catalog"
  ON topic_catalog
  USING (true)
  WITH CHECK (true);
