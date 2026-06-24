-- Migration 045: Add qa_passed column to topic_content_cache
-- The session-content-pipeline QA step writes a boolean result per subtopic.
-- Without this column every upsert throws "column qa_passed not found" and
-- the entire content generation step fails with no KB content written.

ALTER TABLE topic_content_cache
  ADD COLUMN IF NOT EXISTS qa_passed BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN topic_content_cache.qa_passed IS
  'True if the QA check (word count, So-what sentence, sentence count) passed. '
  'Null for rows generated before CONTENT-01. Set by session-content-pipeline.';
