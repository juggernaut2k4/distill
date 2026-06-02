-- ─── 023_plan_templates.sql ──────────────────────────────────────────────────
-- Shared curriculum plan template cache.
-- When two users have the same role + maturity + topics (same profile hash),
-- only the first user triggers an LLM call. All subsequent users get the plan
-- instantly from this table.

CREATE TABLE IF NOT EXISTS curriculum_plan_templates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_hash     text        NOT NULL UNIQUE,
  visible_sessions jsonb       NOT NULL DEFAULT '[]',
  queue_sessions   jsonb       NOT NULL DEFAULT '[]',
  generated_at     timestamptz NOT NULL DEFAULT now(),
  use_count        integer     NOT NULL DEFAULT 1,
  is_fallback      boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_plan_templates_profile_hash ON curriculum_plan_templates (profile_hash);

COMMENT ON TABLE curriculum_plan_templates IS
  'Cross-user cache for LLM-generated curriculum plans. Key: hash(role+maturity+sorted_topics).';
