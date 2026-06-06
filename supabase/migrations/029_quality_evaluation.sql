-- ─── 029_quality_evaluation.sql ───────────────────────────────────────────────
-- FB-008: Post-session quality evaluation pipeline.
-- Adds quality evaluation columns to sessions and creates knowledge_profiles table.

-- ─── sessions: quality evaluation columns ─────────────────────────────────────

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS quality_evaluated      BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_error          TEXT,
  ADD COLUMN IF NOT EXISTS quality_criteria_results JSONB;

-- Partial index: only index completed sessions that haven't been evaluated yet.
-- Used by the cron query (status='completed', quality_evaluated=false, ended_at window).
CREATE INDEX IF NOT EXISTS idx_sessions_quality_evaluated
  ON sessions (quality_evaluated, ended_at)
  WHERE status = 'completed';

-- ─── knowledge_profiles table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_profiles (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT        NOT NULL,
  topic_id              TEXT        NOT NULL,
  sessions_count        INTEGER     NOT NULL DEFAULT 0,
  avg_variant_score     NUMERIC(4,2) NOT NULL DEFAULT 0,
  comprehension_status  TEXT        NOT NULL DEFAULT 'queued'
                          CHECK (comprehension_status IN ('queued', 'in-progress', 'understood', 'gap')),
  gaps                  TEXT[]      NOT NULL DEFAULT '{}',
  maturity_signal       TEXT,
  last_evaluated_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_profiles_user_id
  ON knowledge_profiles (user_id);

ALTER TABLE knowledge_profiles ENABLE ROW LEVEL SECURITY;

-- Internal data only — service_role has full access; users cannot read directly.
CREATE POLICY "service_role_all_knowledge_profiles"
  ON knowledge_profiles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- updated_at trigger — reuses the shared update_updated_at_column() function
CREATE TRIGGER update_knowledge_profiles_updated_at
  BEFORE UPDATE ON knowledge_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
