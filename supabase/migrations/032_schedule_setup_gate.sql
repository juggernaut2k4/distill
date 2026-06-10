-- Unique index: prevent duplicate (user_id, session_index) for non-completed/cancelled sessions
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_session_index
  ON sessions (user_id, session_index)
  WHERE status NOT IN ('completed', 'cancelled');

-- Track 24h schedule nudge email (NULL = not sent)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS schedule_nudge_sent_at TIMESTAMPTZ;

-- Denormalized plan_approved_at for the nudge cron query (avoids join to curriculum_plans)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan_approved_at TIMESTAMPTZ;
