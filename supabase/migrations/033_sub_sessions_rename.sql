-- TERM-01 Phase 2: rename sessions.subtopics → sessions.sub_sessions
-- Step 1: Add the new column alongside the old one (dual-write period)
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS sub_sessions JSONB DEFAULT '[]';

-- Step 2: Copy existing data into the new column
UPDATE sessions
  SET sub_sessions = subtopics
  WHERE subtopics IS NOT NULL AND sub_sessions = '[]'::jsonb;

COMMENT ON COLUMN sessions.sub_sessions IS
  'Sub-session tabs for this session (renamed from subtopics — TERM-01 Phase 2). See docs/specs/TERM-01-terminology-migration-plan.md';
