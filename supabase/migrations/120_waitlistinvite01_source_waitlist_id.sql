-- WAITLIST-INVITE-01 (docs/specs/WAITLIST-INVITE-01-requirement-document.md §6.1) — one-click invite
-- from the waitlist admin page, reusing the existing direct_partner_invites mechanism (B2B-28/B2B-80)
-- rather than a parallel invite system. Purely additive: does not touch, widen, or drop
-- source_lead_id (116_b2b80_sales_partner_leads.sql) or any existing column/row.

ALTER TABLE direct_partner_invites
  ADD COLUMN IF NOT EXISTS source_waitlist_id UUID REFERENCES waitlist_signups(id);

-- UNIQUE (not a plain index): closes the double-click/double-request race server-side, the same way
-- WAITLIST-01's own waitlist_signups.email UNIQUE constraint (118_waitlist01_signups.sql) closes the
-- analogous duplicate-signup race with a hard DB constraint rather than a check-then-insert dance. A
-- second concurrent invite attempt for the same waitlist row hits a 23505 unique violation, which
-- issueDirectPartnerInvite() (lib/internal-admin/direct-partner-invites.ts) maps to
-- errorCode: 'duplicate_source_waitlist', and the new route maps to HTTP 409 (§6.2, §9).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_direct_partner_invites_source_waitlist_id
  ON direct_partner_invites(source_waitlist_id)
  WHERE source_waitlist_id IS NOT NULL;

COMMENT ON COLUMN direct_partner_invites.source_waitlist_id IS
  'WAITLIST-INVITE-01: set when an admin clicks "Invite" on a waitlist_signups row from
  /dashboard/admin/waitlist. Mutually exclusive with source_lead_id by construction (only one call
  site sets each column) — a row has at most one of the two set, or neither for a manually-generated
  invite with no source. target_account_kind is always ''partner'' for a waitlist-sourced invite (a
  waitlist signup is a prospective ordinary partner, never a channel partner).';
