-- Cache pre-generated template sections per topic+subtopic so repeated sessions
-- on the same topic serve content instantly from the database rather than
-- calling Claude on every session launch.
--
-- TTL varies by template type (14–60 days) since time-sensitive content
-- (stats, timelines, case studies) goes stale faster than conceptual content.

CREATE TABLE IF NOT EXISTS topic_content_cache (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  topic_id      text        NOT NULL,
  subtopic_slug text        NOT NULL,   -- normalized subtopic title (subtopicToId output)
  subtopic_title text       NOT NULL,   -- original human-readable title
  template_type text        NOT NULL,   -- TemplateName value
  section_data  jsonb       NOT NULL,   -- full TemplateSection JSON
  generated_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,   -- TTL varies by template type
  use_count     integer     NOT NULL DEFAULT 1,
  UNIQUE (topic_id, subtopic_slug)
);

-- Partial index covering only unexpired rows — the only rows we ever query
CREATE INDEX IF NOT EXISTS idx_topic_content_cache_lookup
  ON topic_content_cache (topic_id, subtopic_slug)
  WHERE expires_at > now();

-- Service-role access only — no user-facing reads needed
ALTER TABLE topic_content_cache ENABLE ROW LEVEL SECURITY;
