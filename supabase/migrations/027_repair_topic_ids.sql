-- Migration: 027_repair_topic_ids.sql
-- Purpose: Repair existing sessions rows that have a null or empty topic_id.
--
-- IMPORTANT: Run this migration BEFORE deploying the code fix (planner.ts + route.ts).
-- The code fix closes the gap for new writes; this migration repairs historical rows.
-- Only 'scheduled' sessions are repaired — completed/active sessions are left untouched.
--
-- Deployment order:
--   1. Apply this migration to the production database.
--   2. Deploy the FB-001 code fix (planner.ts + route.ts).
--
-- Preview (what will be updated — run this SELECT first for sign-off):
-- SELECT id, session_index, session_title, topic_id
-- FROM sessions
-- WHERE (topic_id IS NULL OR topic_id = '')
--   AND status = 'scheduled'
-- ORDER BY session_index;

-- Step 1: Repair rows that have a non-null, non-empty session_title.
-- Derives the same kebab-slug the fixed planner.ts would produce:
--   lower(title) → replace non-alphanumeric runs with '-' → strip leading/trailing hyphens.
UPDATE sessions
SET topic_id = lower(regexp_replace(
                 regexp_replace(
                   regexp_replace(session_title, '[^a-zA-Z0-9]+', '-', 'g'),
                   '^-+', '', 'g'
                 ),
                 '-+$', '', 'g'
               ))
WHERE (topic_id IS NULL OR topic_id = '')
  AND session_title IS NOT NULL
  AND session_title != ''
  AND status = 'scheduled';

-- Step 2: Positional fallback for any remaining rows with no usable session_title.
-- These receive 'session-N' matching the planner's last-resort fallback.
UPDATE sessions
SET topic_id = 'session-' || session_index::text
WHERE (topic_id IS NULL OR topic_id = '')
  AND status = 'scheduled';

-- Step 3: Verification — must return 0 after both updates above.
-- If this returns > 0, do not deploy the code fix until the cause is investigated.
SELECT COUNT(*) AS remaining_null_or_empty
FROM sessions
WHERE topic_id IS NULL OR topic_id = '';
