-- Knowledge Base QA rules: stores candidate rules (pending review) and approved rules
-- that get injected into the generation prompt permanently.

CREATE TABLE IF NOT EXISTS kb_qa_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_text      TEXT NOT NULL,
  justification  TEXT NOT NULL,
  evidence       JSONB NOT NULL DEFAULT '[]',   -- [{section, quote}]
  category       TEXT NOT NULL DEFAULT 'content', -- content | layout | data_structure
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | paused
  user_suggestion TEXT,                          -- user's amendment request
  refined_rule_text TEXT,                        -- Claude's refined version after suggestion
  source_topic_id TEXT,                          -- which topic run produced this rule
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_qa_rules_status ON kb_qa_rules (status);

-- QA results stored per section in topic_content_cache
ALTER TABLE topic_content_cache
  ADD COLUMN IF NOT EXISTS qa_score     INT,
  ADD COLUMN IF NOT EXISTS qa_result    JSONB,
  ADD COLUMN IF NOT EXISTS qa_run_at    TIMESTAMPTZ;
