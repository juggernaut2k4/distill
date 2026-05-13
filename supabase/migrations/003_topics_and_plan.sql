-- Clio: Topic interests, curriculum plan, and session enhancements
-- Migration 003

-- ─── TOPIC INTERESTS ON USERS ─────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS topic_interests     TEXT[]    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS curriculum_plan     JSONB,
  ADD COLUMN IF NOT EXISTS plan_approved       BOOLEAN   DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS plan_generated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduling_prefs    JSONB;

-- ─── SESSIONS: ADD TOPICS ARRAY AND SESSION INDEX ─────────────────────────────

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS topics          TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS session_index   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_title   TEXT;

-- ─── INDEX ON PLAN APPROVAL STATE ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_plan_approved ON users(plan_approved);
