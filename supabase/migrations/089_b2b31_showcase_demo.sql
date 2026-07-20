-- B2B-31 — Partner Showcase Demo. See docs/specs/B2B-31-requirement-document.md §0/§6.

-- ─── Access allowlist: one column, not a new table (§0 point 1) ────────────
ALTER TABLE partner_accounts
  ADD COLUMN IF NOT EXISTS showcase_access_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN partner_accounts.showcase_access_enabled IS
  'B2B-31: gates the private "Showcase" tab (lib/partner/auth.ts requireShowcaseAccess). Meaningful
  only on a channel_partner-kind row (enforced by check_account_kind_invariants, extended below).
  Flipped directly via SQL by the Orchestrator, scoped by clerk_user_id via partner_admin_users, not
  a UI toggle — see requirement doc §0 point 1/8 for why a clerk_user_id-scoped UPDATE is required
  rather than one on a single partner_accounts.id.';

-- Extend the existing invariant trigger (B2B-26 §6.15, B2B-28 §6.1 precedent) — same pattern as
-- revenue_share_percent: this flag must never be true on a direct-partner (account_kind='partner') row.
CREATE OR REPLACE FUNCTION check_account_kind_invariants()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_kind = 'channel_partner' AND NEW.owning_channel_partner_id IS NOT NULL THEN
    RAISE EXCEPTION 'A channel_partner-kind partner_accounts row cannot itself have an owning_channel_partner_id (no nested sales-partner chains)';
  END IF;

  IF NEW.owning_channel_partner_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM partner_accounts
      WHERE id = NEW.owning_channel_partner_id AND account_kind = 'channel_partner'
    ) THEN
      RAISE EXCEPTION 'owning_channel_partner_id must reference a partner_accounts row with account_kind = channel_partner';
    END IF;
  END IF;

  IF NEW.revenue_share_percent IS NOT NULL AND NEW.account_kind <> 'channel_partner' THEN
    RAISE EXCEPTION 'revenue_share_percent may only be set on a channel_partner-kind partner_accounts row';
  END IF;

  -- NEW (B2B-31)
  IF NEW.showcase_access_enabled = true AND NEW.account_kind <> 'channel_partner' THEN
    RAISE EXCEPTION 'showcase_access_enabled may only be set on a channel_partner-kind partner_accounts row';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_account_kind_invariants ON partner_accounts;
CREATE TRIGGER enforce_account_kind_invariants
  BEFORE INSERT OR UPDATE OF account_kind, owning_channel_partner_id, revenue_share_percent, showcase_access_enabled
  ON partner_accounts
  FOR EACH ROW EXECUTE PROCEDURE check_account_kind_invariants();

-- ─── partner_showcase_content: one row per channel-partner account (§0 point 3) ─
CREATE TABLE IF NOT EXISTS partner_showcase_content (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,
  title              TEXT,
  subtitle           TEXT,
  content_to_explain TEXT,
  content_source_id  UUID REFERENCES partner_content_sources(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_partner_showcase_content_updated_at
  BEFORE UPDATE ON partner_showcase_content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── partner_showcase_topics: 2-3 rows per Content, from the LLM grouping call ─
CREATE TABLE IF NOT EXISTS partner_showcase_topics (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  showcase_content_id      UUID NOT NULL REFERENCES partner_showcase_content(id) ON DELETE CASCADE,
  partner_account_id       UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  title                    TEXT NOT NULL,
  position                 SMALLINT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_showcase_topics_content
  ON partner_showcase_topics(showcase_content_id);

-- ─── partner_showcase_visualizations: 1 row per topic, once Saved ──────────
CREATE TABLE IF NOT EXISTS partner_showcase_visualizations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  showcase_topic_id   UUID NOT NULL UNIQUE REFERENCES partner_showcase_topics(id) ON DELETE CASCADE,
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  excerpt_text        TEXT NOT NULL,
  transition_trigger  TEXT NOT NULL,
  template_section    JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_partner_showcase_visualizations_updated_at
  BEFORE UPDATE ON partner_showcase_visualizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE partner_showcase_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_showcase_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_showcase_visualizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on partner_showcase_content"
  ON partner_showcase_content FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on partner_showcase_topics"
  ON partner_showcase_topics FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on partner_showcase_visualizations"
  ON partner_showcase_visualizations FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE partner_showcase_content IS
  'B2B-31: Showcase demo content, one row per channel_partner-kind partner_accounts row. NEVER read
  by any real partner-content pipeline (content-generation.ts, personalizer, session-content-generator)
  — fully isolated, no expiry job, no cleanup. See requirement doc §0 point 3.';
COMMENT ON TABLE partner_showcase_topics IS
  'B2B-31: LLM-grouped topics from partner_showcase_content, via lib/partner/showcase.ts groupShowcaseContentIntoTopics(). No expiry.';
COMMENT ON TABLE partner_showcase_visualizations IS
  'B2B-31: one saved, rendered visualization per topic — real TemplateSection JSON, produced by the
  real selectTemplate/generateTemplateData pipeline. Rendered publicly, no auth, at
  /showcase-render/[id]. No expiry.';

-- ─── Orchestrator access-toggle SQL pattern (documented, no UI — §0/§6.1) ──
-- Grant Showcase access to a specific Clerk user's channel-partner account(s):
--   UPDATE partner_accounts
--   SET showcase_access_enabled = true
--   WHERE id IN (
--     SELECT partner_account_id FROM partner_admin_users
--     WHERE clerk_user_id = '<clerk_user_id>'
--   ) AND account_kind = 'channel_partner';
--
-- Revoke (same shape, false):
--   UPDATE partner_accounts SET showcase_access_enabled = false
--   WHERE id IN (SELECT partner_account_id FROM partner_admin_users WHERE clerk_user_id = '<clerk_user_id>')
--     AND account_kind = 'channel_partner';
--
-- Run via the Supabase MCP execute_sql tool (or the Supabase dashboard) directly by the
-- Orchestrator — no admin UI, per the CEO brief's own "doesn't need its own UI" allowance. The
-- clerk_user_id-scoped subquery (rather than a single partner_accounts.id) is deliberate — see
-- requirement doc §0 point 8 for why Arun's own account currently has 2 duplicate
-- channel_partner-kind rows.

-- No changes to partner_content_sources, partner_sessions, partner_content_items, or any migration
-- file before 089.
