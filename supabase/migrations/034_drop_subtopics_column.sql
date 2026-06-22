-- Migration 034: Drop sessions.subtopics column (TERM-01 Phase 2 cleanup)
--
-- PREREQUISITES before applying this migration:
--   1. Phase 2 (migration 033) must be applied — adds sessions.sub_sessions
--   2. Phase 3 code must be deployed — all reads/writes use sub_sessions
--   3. Confirm no active dual-write code still writes only to subtopics
--
-- ROLLBACK: There is no automatic rollback after this migration.
-- Before applying, ensure sub_sessions data is correct via:
--   SELECT id, sub_sessions FROM sessions WHERE sub_sessions IS NOT NULL LIMIT 5;
--
-- Apply in Supabase Dashboard → SQL Editor, or via supabase db push.

ALTER TABLE sessions DROP COLUMN IF EXISTS subtopics;

COMMENT ON COLUMN sessions.sub_sessions IS 'Sub-session tabs for this session (TERM-01: renamed from subtopics in migration 033)';
