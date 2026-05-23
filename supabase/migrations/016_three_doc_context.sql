-- Split Clio's session context into three distinct documents.
-- session_brief: agenda + rules (session-specific, built without Claude)
-- topic_context: rich Q&A knowledge base (cached per subtopic, built with Claude)
-- session_script: TEACH/CHECKPOINT/PROBE/CONTINUE per section (session-specific)

ALTER TABLE walkthrough_state
  ADD COLUMN IF NOT EXISTS session_brief    text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS topic_context   text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS session_script  text DEFAULT NULL;

-- Cached per subtopic — reused across sessions on the same topic
ALTER TABLE topic_content_cache
  ADD COLUMN IF NOT EXISTS topic_context_doc text DEFAULT NULL;
