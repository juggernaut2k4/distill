-- Migration 049: add sequencing fields to curriculum_plans
-- CURR-SEQ-01: tracks whether sessions were pedagogically resequenced after plan generation.

ALTER TABLE curriculum_plans
  ADD COLUMN IF NOT EXISTS sequencing_rationale TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sequencing_status TEXT DEFAULT 'pending';

COMMENT ON COLUMN curriculum_plans.sequencing_rationale IS 'Claude explanation of why sessions are ordered this way';
COMMENT ON COLUMN curriculum_plans.sequencing_status IS 'pending | completed | fallback_order';
