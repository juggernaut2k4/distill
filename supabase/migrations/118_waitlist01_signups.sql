-- WAITLIST-01 (docs/specs/WAITLIST-01-requirement-document.md §6.1) — public homepage waitlist.
-- Structurally modeled on 116_b2b80_sales_partner_leads.sql, with a hard UNIQUE constraint on
-- email instead of B2B-80's 24h soft duplicate window — a waitlist is a one-time membership list,
-- not a rate-limited inquiry channel, so the same email joining twice should always resolve to
-- "you're already on the list," not a second row.

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  submitted_ip  TEXT,   -- best-effort abuse-review signal only, never displayed in the admin UI
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_waitlist_signups_created_at ON waitlist_signups(created_at DESC);

ALTER TABLE waitlist_signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on waitlist_signups"
  ON waitlist_signups FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE waitlist_signups IS
  'WAITLIST-01: public homepage waitlist submissions (name + email only, no PII beyond that per
  standing privacy rule). No end-user Supabase session ever reads/writes this table — the public
  POST /api/waitlist route uses the admin client server-side, since submitters have no Clerk
  session at all, mirroring sales_partner_leads.';
