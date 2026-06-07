-- 030_async_jobs.sql
-- Async job tracking table for LLM operations that must not block HTTP connections.
-- All LLM-heavy routes create a row here, fire an Inngest event, and return { jobId } immediately.
-- Clients poll GET /api/jobs/:jobId until status = 'complete' | 'failed'.

CREATE TABLE IF NOT EXISTS async_jobs (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           TEXT         NOT NULL,                    -- 'curriculum_generate' | 'session_content' | 'topic_delta'
  status         TEXT         NOT NULL DEFAULT 'queued',   -- 'queued' | 'running' | 'complete' | 'failed'
  progress       NUMERIC(4,3) NOT NULL DEFAULT 0,          -- 0.000 to 1.000
  payload        JSONB,                                    -- input params saved at job creation
  result         JSONB,                                    -- output populated on completion
  error_message  TEXT,                                     -- detail populated on failure
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_async_jobs_user    ON async_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_async_jobs_status  ON async_jobs(status);
CREATE INDEX IF NOT EXISTS idx_async_jobs_type_user ON async_jobs(type, user_id);

-- Auto-bump updated_at
CREATE OR REPLACE FUNCTION update_async_jobs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_async_jobs_updated_at ON async_jobs;
CREATE TRIGGER trg_async_jobs_updated_at
  BEFORE UPDATE ON async_jobs
  FOR EACH ROW EXECUTE FUNCTION update_async_jobs_updated_at();

-- RLS: users can only read their own jobs; service role can write
ALTER TABLE async_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_jobs_select" ON async_jobs
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "service_role_all_jobs" ON async_jobs
  USING (true) WITH CHECK (true);
