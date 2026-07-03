-- ─── 053_curriculum_plans_one_active_per_user.sql ────────────────────────────
-- Structural safeguard for the "duplicate curriculum_plans row" bug
-- (topic-change race produced 2+ non-superseded rows per user, seconds apart).
--
-- Invariant this enforces: a user has exactly one non-superseded
-- (superseded_at IS NULL) curriculum_plans row at any time. Once this index is
-- live, a concurrent INSERT that races another run for the same user fails
-- with a unique_violation (23505) instead of silently creating a duplicate
-- live row. inngest/curriculum-generator.ts already catches 23505 on this
-- insert and re-resolves to the winning row (see save-plan step).
--
-- NOT YET APPLIED as of 2026-07-03. As of this date, 8 existing accounts
-- violate this invariant (2 non-superseded rows each, from the historical
-- bug), so this CREATE UNIQUE INDEX will fail until those rows are resolved.
-- Resolving those 8 accounts (choosing a canonical "keep" row per account,
-- likely the is_approved=true row or the most recently generated one) is
-- explicitly OUT OF SCOPE for the fix that introduced this migration file —
-- it is separate, more delicate per-account data work tracked in BACKLOG.md.
--
-- To apply once the 8 accounts are cleaned up:
--   1. Verify: SELECT user_id, count(*) FROM curriculum_plans
--        WHERE superseded_at IS NULL GROUP BY user_id HAVING count(*) > 1;
--      must return zero rows.
--   2. Run this migration.

CREATE UNIQUE INDEX IF NOT EXISTS idx_curriculum_plans_one_active_per_user
  ON curriculum_plans (user_id)
  WHERE superseded_at IS NULL;

COMMENT ON INDEX idx_curriculum_plans_one_active_per_user IS
  'Enforces at most one non-superseded curriculum_plans row per user. See migration file header before applying — will fail if historical duplicate rows have not been resolved first.';
