-- B2B-05: subdomain-first + custom-domain white-label infrastructure, plus the v1.1 onboarding
-- wizard amendment. See docs/specs/B2B-05-requirement-document.md and architecture.md §14 for full
-- rationale. Additive only — no existing partner_accounts column is modified or dropped.

ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS subdomain_slug TEXT;
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain_status TEXT NOT NULL DEFAULT 'none'
  CHECK (custom_domain_status IN ('none', 'pending_verification', 'verified', 'failed'));
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain_error TEXT;
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain_verification JSONB;
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain_added_at TIMESTAMPTZ;
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_accounts_subdomain_slug
  ON partner_accounts (subdomain_slug) WHERE subdomain_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_accounts_custom_domain
  ON partner_accounts (custom_domain) WHERE custom_domain IS NOT NULL;

COMMENT ON COLUMN partner_accounts.subdomain_slug IS 'B2B-05: lowercase DNS label, unique, resolves {slug}.{CLIO_ROOT_DOMAIN} to this partner.';
COMMENT ON COLUMN partner_accounts.custom_domain IS 'B2B-05: lowercase hostname, unique, registered via Vercel Domains API. NULL until custom_domain_status leaves ''none''.';

-- ── B2B-05 v1.1: onboarding wizard progress + go-live flag. Additive only. ─────────────────────

ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- Backfill: every partner_accounts row that exists BEFORE this migration runs is treated as
-- already onboarded. The wizard only ever intercepts accounts created after this ships
-- (Requirement Doc Section 13.3/13.9 — "no impact on existing", the standing project rule).
UPDATE partner_accounts
  SET onboarding_completed_at = COALESCE(onboarding_completed_at, created_at)
  WHERE onboarding_completed_at IS NULL;

CREATE TABLE IF NOT EXISTS partner_onboarding_progress (
  partner_account_id       UUID PRIMARY KEY REFERENCES partner_accounts(id) ON DELETE CASCADE,

  current_step              TEXT NOT NULL DEFAULT 'questionnaire'
                               CHECK (current_step IN
                                 ('questionnaire','topics','content','visualization','domain','payment','go_live')),

  questionnaire_status      TEXT NOT NULL DEFAULT 'pending'
                               CHECK (questionnaire_status IN ('pending','completed','skipped')),
  questionnaire_status_at   TIMESTAMPTZ,

  topics_status             TEXT NOT NULL DEFAULT 'pending'
                               CHECK (topics_status IN ('pending','completed','skipped')),
  topics_status_at          TIMESTAMPTZ,

  content_status            TEXT NOT NULL DEFAULT 'pending'
                               CHECK (content_status IN ('pending','completed','skipped')),
  content_status_at         TIMESTAMPTZ,

  visualization_status      TEXT NOT NULL DEFAULT 'pending'
                               CHECK (visualization_status IN ('pending','completed','skipped')),
  visualization_status_at   TIMESTAMPTZ,

  domain_status             TEXT NOT NULL DEFAULT 'pending'
                               CHECK (domain_status IN ('pending','completed','skipped')),
  domain_status_at          TIMESTAMPTZ,

  payment_status            TEXT NOT NULL DEFAULT 'pending'
                               CHECK (payment_status IN ('pending','completed','skipped')),
  payment_status_at         TIMESTAMPTZ,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_partner_onboarding_progress_updated_at
  BEFORE UPDATE ON partner_onboarding_progress
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on partner_onboarding_progress"
  ON partner_onboarding_progress FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON COLUMN partner_accounts.onboarding_completed_at IS
  'B2B-05 v1.1: set once by POST /api/admin/configurator/wizard/go-live, never cleared. NULL = wizard mode (Requirement Doc Section 13.3).';
COMMENT ON TABLE partner_onboarding_progress IS
  'B2B-05 v1.1: one row per partner_account_id, lazily created on first wizard-progress read. Historical/audit only after go-live (Requirement Doc Section 13.6).';
