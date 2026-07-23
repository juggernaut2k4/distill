-- B2B-33 — "Learn with AI" Demo: Real Bot Dispatch with Per-Topic Meeting URL.
-- See docs/specs/B2B-33-requirement-document.md §0/§6/§12.
--
-- Two additive, isolated changes: (1) demo_meeting_urls, one row per public demo topic slug holding
-- the Google Meet URL Arun wants Clio's bot to join for that demo; (2) a dedicated internal partner
-- account ("Clio Internal — Public Demo") so this feature's dispatches never touch any real partner's
-- data or wallet — test_mode-only, mirroring migration 092's own dedicated-internal-account precedent
-- (B2B-32, "Clio Internal — Test Harness"), but a new, separate row: that account remains on hold and
-- untouched by this migration.

CREATE TABLE IF NOT EXISTS demo_meeting_urls (
  slug                        TEXT PRIMARY KEY,
  meeting_url                 TEXT NOT NULL,
  last_dispatch_attempted_at  TIMESTAMPTZ,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_demo_meeting_urls_updated_at
  BEFORE UPDATE ON demo_meeting_urls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE demo_meeting_urls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on demo_meeting_urls"
  ON demo_meeting_urls FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE demo_meeting_urls IS
  'B2B-33: one row per public "Learn with AI" demo topic slug, holding the Google Meet URL Arun wants
  Clio''s bot to join for that demo. Public-write (passcode-gated at the API layer, not RLS — this
  table has no anon/authenticated policy at all) and public-read (no passcode on the GET). Not a
  partner-facing table; the slug is app/demo/_content.ts''s DemoTopic.slug, not a DB foreign key,
  because demo topics are static in-code data, not DB-backed.';

-- ─── Dedicated internal partner account for billing/data isolation (§0 point 1, §12 step 1) ───────
-- account_kind defaults to 'partner' (migration 086) — correct, not 'channel_partner'. Every dispatch
-- from this feature authenticates as this account via a test-mode API key minted separately
-- (POST /api/admin/partner-keys, §12 step 2 — not part of this migration, requires a
-- partner_admin_users row linking Arun's Clerk user id first).
INSERT INTO partner_accounts (name, status)
VALUES ('Clio Internal — Public Demo', 'active')
ON CONFLICT DO NOTHING;
