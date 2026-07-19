-- B2B-28 — Direct-partner invite-only signup + sales-partner revenue-share
-- tracking. See docs/specs/B2B-28-requirement-document.md §6.1 for rationale.
--
-- Migration numbering note: the spec's own draft assumed 087 would be
-- next-free, but 087_b2b27_card_verification.sql landed first (sibling brief
-- B2B-27). This is 088, file-tagged b2b28 per this repo's convention of
-- naming the file after the brief that actually produced it.

-- ─── direct_partner_invites ─────────────────────────────────────────────────
-- Super-admin-issued, single-use links that create a BRAND-NEW partner_accounts
-- row (account_kind='partner', owning_channel_partner_id=NULL) on acceptance —
-- unlike partner_team_invites (B2B-26), which adds a member to an EXISTING
-- account. Structurally closer to internal_admin_users' own embedded
-- invite_token_hash/expires_at/status shape (migration 084) than to
-- partner_team_invites, but deliberately its own table, not a reuse of
-- internal_admin_users (that table is B2B-21's own internal-staff identity
-- layer, explicitly out of scope to touch).
CREATE TABLE IF NOT EXISTS direct_partner_invites (
  id                                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label                             TEXT,  -- super-admin's own note; never shown to the invitee
  status                            TEXT NOT NULL DEFAULT 'pending'
                                      CHECK (status IN ('pending', 'accepted', 'revoked')),
  invite_token_hash                 TEXT NOT NULL,
  invite_token_expires_at           TIMESTAMPTZ NOT NULL,
  created_by_internal_admin_user_id UUID NOT NULL REFERENCES internal_admin_users(id),
  created_partner_account_id        UUID REFERENCES partner_accounts(id),  -- set on accept, NULL until then
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at                       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_partner_invites_token_hash
  ON direct_partner_invites(invite_token_hash);

CREATE INDEX IF NOT EXISTS idx_direct_partner_invites_status
  ON direct_partner_invites(status);

ALTER TABLE direct_partner_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on direct_partner_invites"
  ON direct_partner_invites FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE direct_partner_invites IS
  'B2B-28: super-admin-issued single-use links that create a new account_kind=partner partner_accounts row on acceptance. The ONLY write path for a new direct-partner row as of this migration — /partner-signup now always produces account_kind=channel_partner. See docs/specs/B2B-28-requirement-document.md.';

-- ─── partner_accounts.revenue_share_percent ─────────────────────────────────
-- Purely a stored reference number for Arun's own bookkeeping (Arun's own
-- words: "we will not be paying anything for the sales partner" — no payout
-- mechanism computes against this, in this brief or any named follow-on).
-- Meaningful only on a channel_partner-kind row (a sales-partner's own
-- account); NULL for every direct-partner row regardless of how it was
-- created (self-serve-era or invite-created — both 100% Clio revenue).
ALTER TABLE partner_accounts
  ADD COLUMN IF NOT EXISTS revenue_share_percent NUMERIC(5,2)
    CHECK (revenue_share_percent IS NULL OR (revenue_share_percent >= 0 AND revenue_share_percent <= 100));

COMMENT ON COLUMN partner_accounts.revenue_share_percent IS
  'B2B-28: the sales-partner''s own share of revenue, 0-100, set/edited by super-admin only via /dashboard/admin/sales-partners/[id]. Meaningful only where account_kind=channel_partner (enforced by check_account_kind_invariants, extended below). Never a computed payout — reference data only.';

-- ─── extend the existing account_kind invariant trigger (B2B-26 §6.15) ─────
-- Defense-in-depth, same rationale as B2B-26's own trigger comment: this
-- brief adds a THIRD write path against partner_accounts (the invite-accept
-- flow) and a new column (revenue_share_percent) whose own semantic
-- constraint ("only meaningful on a channel_partner row") is enforced here
-- at the DB layer rather than left to every future write path to remember.
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

  -- NEW (B2B-28) — revenue_share_percent is Clio-internal reference data
  -- about a sales-partner's OWN account; it must never be set on a
  -- direct-partner (account_kind='partner') row, regardless of write path.
  IF NEW.revenue_share_percent IS NOT NULL AND NEW.account_kind <> 'channel_partner' THEN
    RAISE EXCEPTION 'revenue_share_percent may only be set on a channel_partner-kind partner_accounts row';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-created (CREATE OR REPLACE on the function above already updates the
-- trigger's behavior; the trigger definition itself gains revenue_share_percent
-- to its watched-columns list so an UPDATE that only touches that column
-- still fires the check).
DROP TRIGGER IF EXISTS enforce_account_kind_invariants ON partner_accounts;
CREATE TRIGGER enforce_account_kind_invariants
  BEFORE INSERT OR UPDATE OF account_kind, owning_channel_partner_id, revenue_share_percent ON partner_accounts
  FOR EACH ROW EXECUTE PROCEDURE check_account_kind_invariants();
