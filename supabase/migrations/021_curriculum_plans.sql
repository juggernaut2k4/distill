-- ─── 021_curriculum_plans.sql ────────────────────────────────────────────────
-- Intelligent Curriculum Engine: curriculum_plans + session_completions tables.
-- Also adds active_plan_id FK to users.

-- ─── CURRICULUM PLANS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS curriculum_plans (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text        NOT NULL,
  raw_llm_output      jsonb       NOT NULL DEFAULT '{}',
  visible_sessions    jsonb       NOT NULL DEFAULT '[]',
  queue_sessions      jsonb       NOT NULL DEFAULT '[]',
  dismissed_recs      jsonb       NOT NULL DEFAULT '[]',
  generated_at        timestamptz NOT NULL DEFAULT now(),
  user_profile_hash   text        NOT NULL DEFAULT '',
  is_approved         boolean     NOT NULL DEFAULT false,
  approved_at         timestamptz,
  superseded_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE curriculum_plans IS 'LLM-generated curriculum plans per user. One active plan per user (superseded_at IS NULL).';
COMMENT ON COLUMN curriculum_plans.raw_llm_output IS 'Full JSON from LLM or {fallback:true,reason:string} if fallback used.';
COMMENT ON COLUMN curriculum_plans.visible_sessions IS 'Ordered array of session objects shown to user (tier-limited).';
COMMENT ON COLUMN curriculum_plans.queue_sessions IS 'Shadow queue of session objects not yet shown to user.';
COMMENT ON COLUMN curriculum_plans.dismissed_recs IS 'Array of session_id strings permanently dismissed from recommendations.';
COMMENT ON COLUMN curriculum_plans.user_profile_hash IS 'SHA-256 of role+ai_maturity+sorted(topic_interests). Changes trigger regeneration.';

CREATE INDEX IF NOT EXISTS idx_curriculum_plans_user_id ON curriculum_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_plans_active ON curriculum_plans(user_id) WHERE superseded_at IS NULL;

ALTER TABLE curriculum_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_curriculum_plans"
  ON curriculum_plans FOR ALL
  TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "service_role_all_curriculum_plans"
  ON curriculum_plans FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── SESSION COMPLETIONS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_completions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text        NOT NULL,
  plan_id             uuid        NOT NULL REFERENCES curriculum_plans(id) ON DELETE CASCADE,
  session_id          text        NOT NULL,
  completed_at        timestamptz NOT NULL DEFAULT now(),
  time_spent_seconds  integer     NOT NULL DEFAULT 0,
  completion_method   text        NOT NULL CHECK (completion_method IN ('explicit', 'time_threshold')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE session_completions IS 'Records each completed session. Drives queue promotion and progression engine.';
COMMENT ON COLUMN session_completions.session_id IS 'session_id slug from the session JSONB object in curriculum_plans.';
COMMENT ON COLUMN session_completions.completion_method IS 'explicit = user clicked Mark Complete; time_threshold = 4min on page.';

CREATE INDEX IF NOT EXISTS idx_session_completions_user_id ON session_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_session_completions_plan_id ON session_completions(plan_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_completions_unique
  ON session_completions(user_id, plan_id, session_id);

ALTER TABLE session_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_session_completions"
  ON session_completions FOR ALL
  TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "service_role_all_session_completions"
  ON session_completions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── USERS TABLE EXTENSION ───────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_plan_id uuid REFERENCES curriculum_plans(id);

COMMENT ON COLUMN users.active_plan_id IS 'FK to the user''s currently approved curriculum plan.';

-- ─── UPDATED_AT TRIGGER ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_curriculum_plans_updated_at ON curriculum_plans;
CREATE TRIGGER update_curriculum_plans_updated_at
  BEFORE UPDATE ON curriculum_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
