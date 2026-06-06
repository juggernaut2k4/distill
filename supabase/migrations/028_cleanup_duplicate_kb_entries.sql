-- FB-002: Clean up duplicate topic_content_cache rows produced before FB-001 was deployed.
--
-- Background:
--   Before FB-001, the schedule route could fire distill/session.content.generate with
--   topicId = '' (empty string). The Inngest pipeline resolved that internally to
--   'ai-fundamentals' via: session.topic_id ?? session.curriculum_session_id ?? 'ai-fundamentals'
--   This produced two distinct cache rows per subtopic_slug — one keyed on '' and one on
--   'ai-fundamentals' — both visible as duplicates on the KB page.
--
-- After FB-001:
--   The schedule route guarantees topicId is always a non-empty string (z.string().min(1)).
--   No new duplicate rows are created. This migration removes the pre-existing ones.
--
-- Safety rule:
--   A row where topic_id = 'ai-fundamentals' is only deleted if a correctly-keyed row
--   exists for the same subtopic_slug (i.e. it is a fallback duplicate, not genuine content).
--   If no other row exists for that subtopic_slug, the 'ai-fundamentals' row is preserved.
--
-- Deployment order (per FB-002 spec):
--   1. Apply 027_repair_topic_ids.sql (FB-001)
--   2. Deploy FB-001 code fix
--   3. Run the preview SELECT below and verify the row counts
--   4. Apply this migration (028)
--   5. Verify Step 3 returns 0
--
-- Prerequisites: 027_repair_topic_ids.sql must already be applied.

-- ── Preview (run this SELECT before the DELETEs to confirm scope) ──────────────
-- SELECT topic_id, subtopic_slug, COUNT(*)
-- FROM topic_content_cache
-- WHERE topic_id IN ('', 'ai-fundamentals')
-- GROUP BY topic_id, subtopic_slug
-- ORDER BY topic_id, subtopic_slug;

-- ── Step 1a: Delete all rows with empty-string topic_id ────────────────────────
-- These were generated with a corrupt empty-string cache key and have no valid
-- session reference. FB-001 guarantees no new rows will ever have topic_id = ''.
DELETE FROM topic_content_cache
WHERE topic_id = '';

-- ── Step 1b: Delete 'ai-fundamentals' fallback rows that are genuine duplicates ─
-- A row is a duplicate if another row exists for the same subtopic_slug under a
-- different, correctly-keyed topic_id (non-empty, non-'ai-fundamentals').
-- Rows where 'ai-fundamentals' is the only key for a given subtopic_slug are kept.
DELETE FROM topic_content_cache AS bad
WHERE bad.topic_id = 'ai-fundamentals'
  AND EXISTS (
    SELECT 1
    FROM topic_content_cache AS good
    WHERE good.subtopic_slug = bad.subtopic_slug
      AND good.topic_id != 'ai-fundamentals'
      AND good.topic_id != ''
  );

-- ── Step 2: Verify — both queries must return 0 after this migration ──────────
-- Run manually to confirm:
--
-- SELECT COUNT(*) AS empty_topic_id_rows
-- FROM topic_content_cache
-- WHERE topic_id = '';
-- Expected: 0
--
-- SELECT COUNT(*) AS orphaned_ai_fundamentals_rows
-- FROM topic_content_cache AS a
-- WHERE a.topic_id = 'ai-fundamentals'
--   AND EXISTS (
--     SELECT 1 FROM topic_content_cache AS b
--     WHERE b.subtopic_slug = a.subtopic_slug
--       AND b.topic_id NOT IN ('ai-fundamentals', '')
--   );
-- Expected: 0
--
-- SELECT COUNT(*) AS remaining_duplicates
-- FROM (
--   SELECT topic_id, subtopic_slug, COUNT(*)
--   FROM topic_content_cache
--   GROUP BY topic_id, subtopic_slug
--   HAVING COUNT(*) > 1
-- ) dup;
-- Expected: 0
