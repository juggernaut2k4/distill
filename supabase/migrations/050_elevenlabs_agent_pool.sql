-- AGENT-POOL-01: ElevenLabs agent pool for pre-warmed per-session KB injection.
-- Toggle: set AGENT_POOL_MODE=true in Vercel env vars. Default: off (no-op).

-- Pool table: one row per ElevenLabs agent we maintain
CREATE TABLE IF NOT EXISTS elevenlabs_agent_pool (
  agent_id     TEXT        PRIMARY KEY,
  status       TEXT        NOT NULL DEFAULT 'available'
                           CHECK (status IN ('available', 'in_session')),
  session_id   UUID        REFERENCES sessions(id) ON DELETE SET NULL,
  leased_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- walkthrough_state: which pool agent is serving this session
ALTER TABLE walkthrough_state ADD COLUMN IF NOT EXISTS agent_id TEXT;

-- topic_content_cache: pre-created ElevenLabs KB doc ID for this subtopic
ALTER TABLE topic_content_cache ADD COLUMN IF NOT EXISTS elevenlabs_kb_doc_id TEXT;

-- Atomic reservation: SELECT ... FOR UPDATE SKIP LOCKED prevents race conditions
-- when two sessions start simultaneously and both try to grab the same agent.
CREATE OR REPLACE FUNCTION reserve_elevenlabs_agent(p_session_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_agent_id TEXT;
BEGIN
  SELECT agent_id INTO v_agent_id
  FROM elevenlabs_agent_pool
  WHERE status = 'available'
  ORDER BY leased_at ASC NULLS FIRST
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_agent_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE elevenlabs_agent_pool
  SET status = 'in_session', session_id = p_session_id, leased_at = NOW()
  WHERE agent_id = v_agent_id;

  RETURN v_agent_id;
END;
$$;
