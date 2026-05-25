-- ─── 017_learning_platform.sql ──────────────────────────────────────────────
-- Multi-domain learning platform foundation.
-- Adds:
--   1. content_profile_cache  — role+domain+proficiency keyed content store
--   2. user_learning_profiles — cross-domain learner profile updated after every session
--   3. users table columns    — multi-domain onboarding fields

-- ─── 1. CONTENT PROFILE CACHE ────────────────────────────────────────────────
-- Shared across users: any user with the same (role, domain, proficiency, topic,
-- subtopic) combination gets the same pre-generated, AI-validated content.
-- profile_key = buildProfileKey(role, domain, proficiency)

CREATE TABLE IF NOT EXISTS content_profile_cache (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Profile dimensions (cache key components)
  profile_key          text        NOT NULL,   -- deterministic hash of role+domain+proficiency
  role                 text        NOT NULL,
  domain               text        NOT NULL,   -- domain slug e.g. 'ai-ml', 'devops', 'react'
  proficiency          text        NOT NULL,   -- 'beginner' | 'intermediate' | 'advanced' | 'expert'

  -- Content location
  topic_slug           text        NOT NULL,
  subtopic_slug        text        NOT NULL,

  -- Content
  section_data         jsonb       NOT NULL,
  template_type        text        NOT NULL,

  -- QA state
  overflow_validated   boolean     DEFAULT false,  -- passed server-side word-count validation
  qa_score             int,                        -- AI QA score 0-100
  validation_notes     text,                       -- why it passed/failed validation

  -- Timestamps
  generated_at         timestamptz DEFAULT now(),
  expires_at           timestamptz DEFAULT (now() + interval '90 days'),

  UNIQUE (profile_key, topic_slug, subtopic_slug)
);

CREATE INDEX IF NOT EXISTS idx_cpc_lookup
  ON content_profile_cache (profile_key, topic_slug, subtopic_slug);

CREATE INDEX IF NOT EXISTS idx_cpc_domain_role
  ON content_profile_cache (domain, role, proficiency);

-- ─── 2. USER LEARNING PROFILES ───────────────────────────────────────────────
-- One record per user. Updated after every Clio session.
-- Drives proactive Clio personalisation and cross-domain connections.

CREATE TABLE IF NOT EXISTS user_learning_profiles (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              text        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Domains the user is actively learning
  domains_active       text[]      DEFAULT '{}',      -- domain slugs e.g. ['ai-ml', 'devops']

  -- Per-domain proficiency inferred from interactions
  -- { "ai-ml": "intermediate", "devops": "beginner" }
  per_domain_levels    jsonb       DEFAULT '{}',

  -- Per-domain topics the user engages with most
  -- { "ai-ml": ["rag", "agents", "fine-tuning"], "devops": ["kubernetes"] }
  per_domain_interests jsonb       DEFAULT '{}',

  -- Per-domain knowledge gaps — things user repeatedly asks about
  -- { "ai-ml": ["how to evaluate llms", "what is overfitting"] }
  per_domain_gaps      jsonb       DEFAULT '{}',

  -- Rolling last 50 questions asked across all sessions, tagged by domain
  -- [{ "question": "...", "domain": "ai-ml", "session_id": "...", "asked_at": "..." }]
  questions_history    jsonb       DEFAULT '[]',

  -- Summary of each completed session
  -- [{ "session_id": "...", "domain": "...", "topic": "...", "key_insights": [], "completed_at": "..." }]
  session_history      jsonb       DEFAULT '[]',

  -- User's stated overall learning goal (from onboarding)
  overall_goal         text,

  -- Claude-written summary paragraph — injected into Clio's system prompt
  -- "This learner is a CTO who has completed 8 sessions on AI and 3 on DevOps.
  --  They repeatedly ask about cost of running LLMs in production and are
  --  building an internal AI platform. They engage most with framework-based
  --  content and prefer concrete vendor comparisons."
  profile_summary      text,

  -- Cross-domain connection opportunities identified by AI
  -- ["Your Kubernetes scaling knowledge maps directly to LLM inference serving"]
  cross_domain_bridges jsonb       DEFAULT '[]',

  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ulp_user_id ON user_learning_profiles (user_id);

-- auto-update updated_at
CREATE OR REPLACE FUNCTION update_user_learning_profile_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_ulp_updated_at ON user_learning_profiles;
CREATE TRIGGER trg_ulp_updated_at
  BEFORE UPDATE ON user_learning_profiles
  FOR EACH ROW EXECUTE FUNCTION update_user_learning_profile_timestamp();

-- ─── 3. USERS TABLE — MULTI-DOMAIN COLUMNS ───────────────────────────────────

-- Selected domains from onboarding (domain slugs)
ALTER TABLE users ADD COLUMN IF NOT EXISTS domains           text[]  DEFAULT '{}';

-- Custom domains the user typed in free text
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_domains    text[]  DEFAULT '{}';

-- Primary domain for content prioritisation
ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_domain    text    DEFAULT 'ai-ml';

-- Per-domain proficiency selected during onboarding
-- { "ai-ml": "intermediate", "devops": "beginner" }
ALTER TABLE users ADD COLUMN IF NOT EXISTS domain_proficiency jsonb  DEFAULT '{}';

-- Learning pace goal from onboarding
ALTER TABLE users ADD COLUMN IF NOT EXISTS learning_goal     text    DEFAULT 'steady_progress';

-- Migrate existing users: set their primary domain to ai-ml and domains to [ai-ml]
-- so they don't see a broken state
UPDATE users
SET
  domains          = ARRAY['ai-ml'],
  primary_domain   = 'ai-ml',
  domain_proficiency = jsonb_build_object('ai-ml', COALESCE(ai_maturity, 'intermediate'))
WHERE domains IS NULL OR domains = '{}';

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE content_profile_cache    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_learning_profiles   ENABLE ROW LEVEL SECURITY;

-- content_profile_cache is read-only from the client (server reads/writes via service role)
CREATE POLICY "service_role_all_cpc" ON content_profile_cache
  USING (true) WITH CHECK (true);

-- user_learning_profiles: users can only read their own profile
CREATE POLICY "users_own_profile" ON user_learning_profiles
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "service_role_all_ulp" ON user_learning_profiles
  USING (true) WITH CHECK (true);
