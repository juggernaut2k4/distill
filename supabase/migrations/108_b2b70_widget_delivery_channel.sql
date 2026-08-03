-- B2B-70 — Embeddable Widget Delivery Channel
-- docs/specs/B2B-70-requirement-document.md §6.1-6.3
--
-- New, wholly independent delivery channel for Clio: a "Learn with AI" button embedded in a
-- reseller's own page (iframe), no meeting platform/Attendee bot/Google Meet involved at all.
-- Every change in this migration is additive-only — no existing table's existing behavior changes.
-- New columns on partner_sessions are nullable/defaulted so every existing row (and every existing
-- meeting-bot session created after this migration) is unaffected; delivery_channel defaults to
-- 'meeting_bot', matching today's only channel byte-for-byte.

-- ─── 1. New table: partner_widget_containers (§6.1) ─────────────────────────

CREATE TABLE IF NOT EXISTS partner_widget_containers (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),  -- the container_id
  partner_account_id      UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,

  label                   TEXT NOT NULL,   -- admin/reseller-facing display name

  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'disabled')),

  -- Stored now for Pattern-B forward-compatibility (Feature Brief §Phasing point 2). NOT enforced
  -- server-side by Pattern A's session-creation route (see §6.5 reasoning) — Pattern A is
  -- server-to-server, authenticated by the reseller's own private API key, which is already the
  -- trust boundary; there is no reliable browser-Origin signal to check on a backend-to-backend
  -- call. Becomes an ACTIVE, enforced check only when Pattern B (browser-direct, public widget key)
  -- ships and has a real Origin/Referer header to validate against.
  allowed_domains         TEXT[] NOT NULL DEFAULT '{}',

  -- Pattern-B forward-compat only (Feature Brief §Phasing point 2) — unused, unpopulated, and not
  -- read anywhere by Pattern A. Reserved so Pattern B's public widget key can be added by an UPDATE,
  -- not a migration rewrite. Same hashing convention as partner_api_keys.key_hash (hashApiKey(),
  -- reused not duplicated) when Pattern B populates it.
  widget_public_key_hash  TEXT,

  -- Content/topic mapping (Feature Brief §Questions for BA point 2) — deliberately the SAME shape as
  -- partner_sessions' own existing inline-content columns (content_pages/content_source_id/
  -- content_to_explain/content_title/content_subtitle/expected_duration_minutes), because a widget
  -- session's content is resolved from THIS row instead of being resent on every session-creation
  -- call (§6.5 for why: a reseller's in-app session-creation frequency is expected to be far higher
  -- than the meeting-bot flow's one-per-scheduled-meeting pattern).
  content_source_id       UUID REFERENCES partner_content_sources(id) ON DELETE SET NULL,
  content_pages           JSONB NOT NULL,   -- same per-page shape as ContentPageSchema, pre-marker-generation
  content_to_explain      TEXT,
  content_title           TEXT,
  content_subtitle        TEXT,
  expected_duration_minutes INTEGER,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_widget_containers_account
  ON partner_widget_containers(partner_account_id, created_at DESC);

CREATE TRIGGER update_partner_widget_containers_updated_at
  BEFORE UPDATE ON partner_widget_containers
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_widget_containers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_widget_containers"
  ON partner_widget_containers FOR ALL
  USING (auth.role() = 'service_role');

-- ─── 2. New table: demo_widget_container_map (§6.2) ─────────────────────────
-- Demo-scoped only, mirrors demo_meeting_urls' own slug-keyed shape. Keeps the generic,
-- partner-facing partner_widget_containers table demo-agnostic (no demo-specific columns),
-- matching this codebase's own existing separation between partner_content_sources (generic) and
-- demo_meeting_urls (demo-only, slug-keyed).

CREATE TABLE IF NOT EXISTS demo_widget_container_map (
  slug          TEXT PRIMARY KEY,   -- matches DEMO_TOPICS slug
  container_id  UUID NOT NULL REFERENCES partner_widget_containers(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_demo_widget_container_map_updated_at
  BEFORE UPDATE ON demo_widget_container_map
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE demo_widget_container_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on demo_widget_container_map"
  ON demo_widget_container_map FOR ALL
  USING (auth.role() = 'service_role');

-- ─── 3. partner_sessions additive columns (§6.3) ─────────────────────────────

ALTER TABLE partner_sessions
  ADD COLUMN IF NOT EXISTS container_id      UUID REFERENCES partner_widget_containers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_channel  TEXT NOT NULL DEFAULT 'meeting_bot'
                              CHECK (delivery_channel IN ('meeting_bot', 'widget'));

-- Widen the existing status CHECK (same widening pattern already used by migration 083 for
-- end_reason) to admit the widget channel's own "ready to render, no bot to dispatch" status.
ALTER TABLE partner_sessions DROP CONSTRAINT IF EXISTS partner_sessions_status_check;
ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_status_check
  CHECK (status IN ('requested', 'bot_dispatch_failed', 'bot_active', 'widget_active', 'completed', 'failed'));

COMMENT ON COLUMN partner_sessions.container_id IS 'B2B-70: the partner_widget_containers row this widget session was created against. NULL for every meeting-bot session (delivery_channel=''meeting_bot'').';
COMMENT ON COLUMN partner_sessions.delivery_channel IS 'B2B-70: ''meeting_bot'' (default, every pre-B2B-70 session) or ''widget''. Orthogonal to voice_provider.';
