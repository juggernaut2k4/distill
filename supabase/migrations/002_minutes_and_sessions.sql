-- Clio: Minutes tracking and sessions schema
-- Migration 002 — adds minute balance columns to users and creates sessions table

-- ─── ADD MINUTES COLUMNS TO USERS ────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS minutes_balance   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minutes_included  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minutes_reset_at  TIMESTAMPTZ;

-- ─── SESSIONS ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic             TEXT,
  status            TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  scheduled_at      TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  duration_mins     INTEGER DEFAULT 0,
  minutes_used      INTEGER DEFAULT 0,
  recall_bot_id     TEXT,
  meeting_url       TEXT,
  notes             TEXT,
  questions_raised  TEXT[],
  follow_up_needed  BOOLEAN DEFAULT FALSE,
  follow_up_session_id UUID REFERENCES sessions(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id     ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status      ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_scheduled   ON sessions(scheduled_at DESC);

-- Updated_at trigger
CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- RLS
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions"
  ON sessions FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can update own sessions"
  ON sessions FOR UPDATE
  USING (auth.uid()::text = user_id);

CREATE POLICY "Service role full access on sessions"
  ON sessions FOR ALL
  USING (auth.role() = 'service_role');

-- ─── HELPER: DEDUCT MINUTES ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION deduct_minutes(
  p_user_id TEXT,
  p_minutes  INTEGER
)
RETURNS INTEGER AS $$
DECLARE
  new_balance INTEGER;
BEGIN
  UPDATE users
    SET minutes_balance = GREATEST(0, minutes_balance - p_minutes),
        updated_at = NOW()
    WHERE id = p_user_id
  RETURNING minutes_balance INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── HELPER: ADD MINUTES (top-up or renewal) ─────────────────────────────────

CREATE OR REPLACE FUNCTION add_minutes(
  p_user_id TEXT,
  p_minutes  INTEGER
)
RETURNS INTEGER AS $$
DECLARE
  new_balance INTEGER;
BEGIN
  UPDATE users
    SET minutes_balance = minutes_balance + p_minutes,
        updated_at = NOW()
    WHERE id = p_user_id
  RETURNING minutes_balance INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
