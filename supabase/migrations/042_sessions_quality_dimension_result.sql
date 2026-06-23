-- Migration 042: Add quality_dimension_result column to sessions
-- Stores the per-session 7-dimension keyword classification from session-quality-evaluator.
-- Apply BEFORE the CURR-01 code change ships so the column exists when the evaluator writes to it.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS quality_dimension_result JSONB DEFAULT NULL;

COMMENT ON COLUMN sessions.quality_dimension_result IS
  'JSONB: 7-dimension keyword classification of this session transcript. '
  'Shape: { evaluated_at: string, dimensions: Record<string, { covered: boolean, match_count: number }>, covered_count: number }. '
  'Null until session-quality-evaluator runs. Written by CURR-01.';
