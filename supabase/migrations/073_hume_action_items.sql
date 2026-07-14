-- HUME-NATIVE-02 Part B — post-session action-item and glitch extraction.
-- Modeled directly on 039_session_insights.sql's shape (see requirement doc
-- Section 6.2: "Why a new table, not new columns on sessions"), for
-- consistency with this codebase's established per-session-extraction table
-- pattern. `extraction_status` intentionally distinguishes 'success_empty'
-- (extraction ran, genuinely found nothing) from 'failed' (extraction did not
-- complete) — see requirement doc Section 4 step 5 / the CONTENT-02
-- false-ready-state precedent this document explicitly follows.

CREATE TABLE IF NOT EXISTS session_action_items (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id          uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id             text        NOT NULL,
  hume_chat_id        text,
  extraction_status   text        NOT NULL DEFAULT 'pending',
    -- 'pending' | 'success' | 'success_empty' | 'failed'
  action_items        jsonb       DEFAULT NULL,
    -- [{ text: string }], NULL until a terminal state is reached
  glitches             jsonb       DEFAULT NULL,
    -- [{ type: string, description: string }], NULL until a terminal state is reached
  transcript_event_count integer  DEFAULT NULL,
    -- count of USER_MESSAGE/AGENT_MESSAGE events actually sent to Claude, for debugging/audit
  attempt_count       integer     NOT NULL DEFAULT 0,
  error_message       text        DEFAULT NULL,
  extracted_at        timestamptz DEFAULT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_action_items_session ON session_action_items (session_id);
CREATE INDEX IF NOT EXISTS idx_session_action_items_user ON session_action_items (user_id, extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_action_items_status ON session_action_items (extraction_status)
  WHERE extraction_status IN ('pending', 'failed');

ALTER TABLE session_action_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_saitems" ON session_action_items
  USING (auth.role() = 'service_role');
