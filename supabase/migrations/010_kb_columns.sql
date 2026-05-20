-- Knowledge Base: add previous_section_data for single-level revert
-- and kb_feedback to record what feedback was applied for audit purposes.

ALTER TABLE topic_content_cache
  ADD COLUMN IF NOT EXISTS previous_section_data JSONB,
  ADD COLUMN IF NOT EXISTS kb_feedback TEXT;
