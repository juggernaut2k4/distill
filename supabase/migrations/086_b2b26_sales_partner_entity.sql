-- B2B-26 — Sales-Partner Entity: Signup Branch, Client Roster, Own Team
-- See docs/specs/B2B-26-requirement-document.md §6.1, §6.15 for full rationale.
--
-- Naming discipline (§0 of the spec): the literal string `sales_partner` is
-- already owned by B2B-21 (`internal_admin_users`/`sales_partner_assignments`,
-- Clio's own internal-staff concept) — a completely different concept from
-- what this migration models. Every identifier here uses the collision-free
-- `channel_partner` token instead. User-visible copy always says
-- "sales-partner"; this is a code-level-only distinction.

-- ─── partner_accounts: two new columns + one informational column ─────────
ALTER TABLE partner_accounts
  ADD COLUMN IF NOT EXISTS account_kind TEXT NOT NULL DEFAULT 'partner'
    CHECK (account_kind IN ('partner', 'channel_partner'));

ALTER TABLE partner_accounts
  ADD COLUMN IF NOT EXISTS owning_channel_partner_id UUID
    REFERENCES partner_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partner_accounts_owning_channel_partner
  ON partner_accounts(owning_channel_partner_id) WHERE owning_channel_partner_id IS NOT NULL;

-- Purely informational, distinct from outbound_base_url (the Integration
-- webhook target, B2B-27 scope). company_url is a client-identification label
-- only, shown in the sales-partner's own Clients list — never called by Clio,
-- never validated as a real reachable URL. See B2B-26 spec §6.1 "Resolved
-- technical finding" for why this must not be conflated with outbound_base_url.
ALTER TABLE partner_accounts
  ADD COLUMN IF NOT EXISTS company_url TEXT;

-- ─── partner_team_invites ───────────────────────────────────────────────────
-- A sales-partner's own team invites. Deliberately NOT internal_admin_users
-- (that table is B2B-21's own internal-staff concept, untouched) and
-- deliberately NOT columns bolted onto partner_admin_users (that table has no
-- pending/status concept today and every existing consumer — createOrClaim-
-- PartnerAccount's idempotency check, requirePartnerAdmin, getPartnerAccounts-
-- ForClerkUser — assumes every row it reads is already a real member; adding
-- a pending state there would force every one of those call sites to filter
-- by a new status column just to keep working, a much larger blast radius
-- than one new small table).
CREATE TABLE IF NOT EXISTS partner_team_invites (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id        UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  email                     TEXT NOT NULL,
  role                      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member')),
  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by_clerk_user_id  TEXT NOT NULL,
  invite_token_hash         TEXT NOT NULL,
  invite_token_expires_at   TIMESTAMPTZ NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_partner_team_invites_account
  ON partner_team_invites(partner_account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_team_invites_token_hash
  ON partner_team_invites(invite_token_hash);

-- Case-insensitive: an email can only have one *pending* invite per account
-- at a time (§8's "already has access or a pending invite" check reads this
-- shape directly rather than needing a DB constraint to enforce it, since a
-- revoked/accepted row for the same email must remain queryable historically
-- — matching internal_admin_users' own no-hard-uniqueness-on-repeat-invites
-- precedent).
CREATE INDEX IF NOT EXISTS idx_partner_team_invites_email_pending
  ON partner_team_invites (partner_account_id, lower(email)) WHERE status = 'pending';

ALTER TABLE partner_team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on partner_team_invites"
  ON partner_team_invites FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON COLUMN partner_accounts.account_kind IS
  'B2B-26: partner = direct partner or a sales-partner-owned client (same shape). channel_partner = a sales-partner''s own account. Code-level token only — user-visible copy always says "sales-partner", never "channel_partner". See docs/specs/B2B-26-requirement-document.md §0.';
COMMENT ON COLUMN partner_accounts.owning_channel_partner_id IS
  'B2B-26: set only on a client row created by a sales-partner (account_kind=channel_partner). NULL for a direct partner or a sales-partner''s own account row.';
COMMENT ON TABLE partner_team_invites IS
  'B2B-26: pending/accepted/revoked invites for a sales-partner''s own team. Accepting creates a partner_admin_users row (role=member) on the inviting account — this table itself is never the membership record.';

-- ─── account_kind / owning_channel_partner_id invariants ───────────────────
-- Defense-in-depth (CEO review, v1.1): today's single write path
-- (createClientForChannelPartner, §6.7, hardcoded account_kind='partner')
-- makes a violation unreachable in practice, but B2B-27/B2B-28 will add more
-- write paths against this same table, so the invariant is enforced at the
-- DB layer now rather than left to every future write path to remember.
CREATE OR REPLACE FUNCTION check_account_kind_invariants()
RETURNS TRIGGER AS $$
BEGIN
  -- No nested sales-partner chains: a channel_partner-kind row can never
  -- itself be owned by another channel_partner-kind row.
  IF NEW.account_kind = 'channel_partner' AND NEW.owning_channel_partner_id IS NOT NULL THEN
    RAISE EXCEPTION 'A channel_partner-kind partner_accounts row cannot itself have an owning_channel_partner_id (no nested sales-partner chains)';
  END IF;

  -- owning_channel_partner_id, when set, must point at an actual channel_partner-kind row.
  IF NEW.owning_channel_partner_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM partner_accounts
      WHERE id = NEW.owning_channel_partner_id AND account_kind = 'channel_partner'
    ) THEN
      RAISE EXCEPTION 'owning_channel_partner_id must reference a partner_accounts row with account_kind = channel_partner';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_account_kind_invariants
  BEFORE INSERT OR UPDATE OF account_kind, owning_channel_partner_id ON partner_accounts
  FOR EACH ROW EXECUTE PROCEDURE check_account_kind_invariants();
