-- ─── 022_session_designer.sql ────────────────────────────────────────────────
-- Adds session designer columns to sessions table.
-- Designed sessions are created at curriculum plan approval time, broken into
-- user-duration-appropriate chunks with LLM-generated subtopics.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS curriculum_plan_id     uuid    REFERENCES curriculum_plans(id),
  ADD COLUMN IF NOT EXISTS curriculum_session_id  text,
  ADD COLUMN IF NOT EXISTS subtopics              jsonb   DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_sessions_curriculum_plan ON sessions(curriculum_plan_id);
CREATE INDEX IF NOT EXISTS idx_sessions_curriculum_session ON sessions(curriculum_session_id);

COMMENT ON COLUMN sessions.curriculum_plan_id IS 'FK to curriculum_plans. Set when session was designed at approval time.';
COMMENT ON COLUMN sessions.curriculum_session_id IS 'Slug from curriculum_plans.visible_sessions. Groups actual sessions back to a curriculum topic.';
COMMENT ON COLUMN sessions.subtopics IS 'LLM-designed subtopics for this session: [{title, type, duration_mins, learning_objective}].';
