-- B2B-80 (docs/specs/B2B-80-requirement-document.md §6.1/§6.2) — sales-partner acquisition:
-- retire self-serve /partner-signup, add a public lead-capture form + admin review, and
-- generalize the existing B2B-28 direct_partner_invites mechanism to also produce
-- channel_partner accounts, rather than building a parallel invite table.

-- ─── SALES_PARTNER_LEADS ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_partner_leads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  company_name    TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'invited', 'declined')),
  submitted_ip    TEXT,   -- best-effort abuse-review signal only, never displayed in the admin UI
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contacted_at    TIMESTAMPTZ,
  invite_id       UUID REFERENCES direct_partner_invites(id)  -- set when "Invite" is clicked
);
CREATE INDEX idx_sales_partner_leads_status ON sales_partner_leads(status, created_at DESC);

ALTER TABLE sales_partner_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on sales_partner_leads"
  ON sales_partner_leads FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE sales_partner_leads IS
  'B2B-80: public /partner-inquiry submissions. No end-user Supabase session ever reads/writes this
  table — the public POST /api/partner-inquiry route uses the admin client server-side, since
  submitters have no Clerk/Supabase session at all.';

-- ─── DIRECT_PARTNER_INVITES — two additive columns, no rename ──────────────────────────────────
-- DEFAULT 'partner' means every existing row and every existing call site that doesn't yet know
-- about this column keeps working byte-identically. Table name stays direct_partner_invites
-- despite now serving both kinds (B2B-80 §6.2) — an additive column over a rename, consistent with
-- this project's general precedent (B2B-26/28/34) when a rename buys no new behavior.
ALTER TABLE direct_partner_invites
  ADD COLUMN IF NOT EXISTS target_account_kind TEXT NOT NULL DEFAULT 'partner'
    CHECK (target_account_kind IN ('partner', 'channel_partner'));
ALTER TABLE direct_partner_invites
  ADD COLUMN IF NOT EXISTS source_lead_id UUID REFERENCES sales_partner_leads(id);

COMMENT ON COLUMN direct_partner_invites.target_account_kind IS
  'B2B-80: which partner_accounts.account_kind this invite produces on acceptance. Defaults to
  partner so every pre-existing row (and any in-flight invite link accepted after this column
  lands) keeps its original, unchanged behavior.';
COMMENT ON COLUMN direct_partner_invites.source_lead_id IS
  'B2B-80: set when an admin clicks "Invite" from a sales_partner_leads row. Optional — an admin
  generating a sales-partner invite for someone who never went through the public form (e.g. a
  phone conversation) leaves this null.';
