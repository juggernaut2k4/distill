-- Removes B2B-28's revenue_share_percent tracking entirely, per Arun's direct
-- instruction (2026-07-21): "drop the revenue sharings. we are not going to
-- do any revenue sharings. so remove all requirements and development on
-- revenue sharings." Never had a payout mechanism (B2B-28's own migration
-- comment: "we will not be paying anything for the sales partner" — reference
-- data only), so dropping it has zero effect on billing/settlement logic.
--
-- direct_partner_invites (088's other table) is untouched — invite-only
-- direct-partner signup is a separate, still-live feature; only the
-- revenue-share column and its trigger clause are being removed.

-- ─── Re-narrow the shared invariant trigger (B2B-26 §6.15, extended by 088 and
-- 089) — strip the revenue_share_percent clause and its column from the
-- watched-columns list, leaving the account_kind/owning_channel_partner_id
-- and showcase_access_enabled checks (089) exactly as they are.
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

  IF NEW.showcase_access_enabled = true AND NEW.account_kind <> 'channel_partner' THEN
    RAISE EXCEPTION 'showcase_access_enabled may only be set on a channel_partner-kind partner_accounts row';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_account_kind_invariants ON partner_accounts;
CREATE TRIGGER enforce_account_kind_invariants
  BEFORE INSERT OR UPDATE OF account_kind, owning_channel_partner_id, showcase_access_enabled
  ON partner_accounts
  FOR EACH ROW EXECUTE PROCEDURE check_account_kind_invariants();

-- ─── Drop the column and its CHECK constraint ───────────────────────────────
ALTER TABLE partner_accounts DROP COLUMN IF EXISTS revenue_share_percent;
