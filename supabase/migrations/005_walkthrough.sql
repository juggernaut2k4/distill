-- Clio: Live session walkthrough state and user session context
-- Migration 005

-- ─── WALKTHROUGH STATE ────────────────────────────────────────────────────────
-- Tracks the current visual being shown per user during a live session

CREATE TABLE IF NOT EXISTS walkthrough_state (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL UNIQUE,
  session_id  UUID REFERENCES sessions(id) ON DELETE SET NULL,
  topic_id    TEXT,
  topic_title TEXT,
  visual_spec JSONB,
  status      TEXT NOT NULL DEFAULT 'idle'
                CHECK (status IN ('idle', 'generating', 'ready', 'wiping')),
  bot_id      TEXT,
  meeting_url TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── USER SESSION CONTEXT ─────────────────────────────────────────────────────
-- Persists per-user sentiment profile and personality notes across sessions

CREATE TABLE IF NOT EXISTS user_session_context (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL UNIQUE,
  personality_notes   TEXT DEFAULT '',
  sentiment_history   JSONB DEFAULT '[]',
  unresolved_questions JSONB DEFAULT '[]',
  communication_style TEXT NOT NULL DEFAULT 'formal'
                        CHECK (communication_style IN ('formal', 'casual', 'direct')),
  engagement_level    TEXT NOT NULL DEFAULT 'medium'
                        CHECK (engagement_level IN ('high', 'medium', 'low')),
  key_concerns        JSONB DEFAULT '[]',
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_walkthrough_state_user ON walkthrough_state(user_id);
CREATE INDEX IF NOT EXISTS idx_user_session_context_user ON user_session_context(user_id);

-- ─── UPDATED_AT TRIGGERS ──────────────────────────────────────────────────────

CREATE TRIGGER update_walkthrough_state_updated_at
  BEFORE UPDATE ON walkthrough_state
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_user_session_context_updated_at
  BEFORE UPDATE ON user_session_context
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE walkthrough_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_session_context ENABLE ROW LEVEL SECURITY;

-- Service role has full access (bot runs server-side)
CREATE POLICY "service_walkthrough"
  ON walkthrough_state FOR ALL
  USING (true);

CREATE POLICY "service_user_context"
  ON user_session_context FOR ALL
  USING (true);

-- Users can read their own walkthrough state (for the live page)
CREATE POLICY "users_read_own_walkthrough"
  ON walkthrough_state FOR SELECT
  USING (auth.uid()::text = user_id);

-- Users can read their own session context
CREATE POLICY "users_read_own_context"
  ON user_session_context FOR SELECT
  USING (auth.uid()::text = user_id);
