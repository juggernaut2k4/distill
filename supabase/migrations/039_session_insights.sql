CREATE TABLE IF NOT EXISTS session_insights (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id          uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id             text        NOT NULL,
  subtopic_slug       text        NOT NULL,
  raw_transcript      text        NOT NULL,
  segment_type        text        NOT NULL DEFAULT 'ice_breaker_response',
  captured_at         timestamptz NOT NULL DEFAULT now(),
  extracted_signals   jsonb       DEFAULT NULL,
  -- { learning_intent, knowledge_level, organizational_context, urgency: low|medium|high, primary_driver }
  analysis_status     text        NOT NULL DEFAULT 'pending',
  analyzed_at         timestamptz DEFAULT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_insights_session ON session_insights (session_id);
CREATE INDEX IF NOT EXISTS idx_session_insights_user ON session_insights (user_id, captured_at DESC);

ALTER TABLE session_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_si" ON session_insights
  USING (auth.role() = 'service_role');
