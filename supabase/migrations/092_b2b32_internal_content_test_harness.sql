-- B2B-32 — Internal Content Test Harness. See docs/specs/B2B-32-requirement-document.md §0/§6.
-- Fully isolated from every partner-facing content table (test_harness_topics/_screens are never
-- read by any real partner-content code path) — mirrors B2B-31's own isolation precedent (§0 pt 1/3).

CREATE TABLE IF NOT EXISTS test_harness_topics (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title              TEXT,
  subtitle           TEXT,
  content_to_explain TEXT,
  content_source_id  UUID REFERENCES partner_content_sources(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_test_harness_topics_updated_at
  BEFORE UPDATE ON test_harness_topics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS test_harness_screens (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  topic_id           UUID NOT NULL REFERENCES test_harness_topics(id) ON DELETE CASCADE,
  screen_type        TEXT NOT NULL CHECK (screen_type IN ('html', 'image')),
  position           SMALLINT NOT NULL,
  title              TEXT,
  transition_trigger TEXT NOT NULL,
  html_content       TEXT,               -- populated only when screen_type = 'html'; capped 500,000 chars at the API layer
  storage_path       TEXT,               -- populated only when screen_type = 'image'; path within the 'test-harness-screens' Supabase Storage bucket
  image_mime_type    TEXT,               -- populated only when screen_type = 'image'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT test_harness_screens_content_check CHECK (
    (screen_type = 'html' AND html_content IS NOT NULL AND storage_path IS NULL)
    OR (screen_type = 'image' AND storage_path IS NOT NULL AND html_content IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_test_harness_screens_topic ON test_harness_screens(topic_id);

CREATE TRIGGER set_test_harness_screens_updated_at
  BEFORE UPDATE ON test_harness_screens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE test_harness_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_harness_screens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on test_harness_topics"
  ON test_harness_topics FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on test_harness_screens"
  ON test_harness_screens FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE test_harness_topics IS
  'B2B-32: internal, Arun-only test fixtures for the real B2B-19 inline-content pipeline. No AI
  generation anywhere in this table''s write path. Not read by any partner-facing code.';
COMMENT ON TABLE test_harness_screens IS
  'B2B-32: one row per hand-authored HTML or image screen. Served publicly, unauthenticated, at
  /test-harness-render/[id] so the real safeFetchPartnerPage() pipeline can fetch it exactly as it
  would fetch any real partner page. See requirement doc §0 point 2/6.';

-- ─── Supabase Storage bucket for uploaded image screens (§0 point 3) ───────
-- Private (no public read policy) — accessed only via createSupabaseAdminClient().storage
-- (service-role key). No public/signed URL is ever issued for this bucket; the public render
-- route (/test-harness-render/[id]) downloads bytes server-side and streams them back itself.
INSERT INTO storage.buckets (id, name, public)
VALUES ('test-harness-screens', 'test-harness-screens', false)
ON CONFLICT (id) DO NOTHING;
