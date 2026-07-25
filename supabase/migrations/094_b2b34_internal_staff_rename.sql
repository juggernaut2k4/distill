-- B2B-34 Piece 5 — reserve `sales_partner` for the reseller entity only (B2B-26/28's `channel_partner`
-- concept). Renames the OTHER (B2B-21, internal-Clio-staff) concept's token to `internal_staff`.
-- Zero live rows with role='sales_partner' confirmed 2026-07-23 (query below, run against project
-- nqxlpcshouboplhnuvrh) — clean constraint swap, no UPDATE needed.
--   SELECT count(*) FROM internal_admin_users WHERE role='sales_partner';  -- => 0

ALTER TABLE internal_admin_users DROP CONSTRAINT IF EXISTS internal_admin_users_role_check;
ALTER TABLE internal_admin_users ADD CONSTRAINT internal_admin_users_role_check
  CHECK (role IN ('super_admin', 'internal_staff'));

ALTER TABLE sales_partner_assignments RENAME TO internal_staff_assignments;
ALTER INDEX idx_sales_partner_assignments_admin_user RENAME TO idx_internal_staff_assignments_admin_user;
ALTER INDEX idx_sales_partner_assignments_partner_account RENAME TO idx_internal_staff_assignments_partner_account;
ALTER POLICY "Service role full access on sales_partner_assignments"
  ON internal_staff_assignments RENAME TO "Service role full access on internal_staff_assignments";

COMMENT ON COLUMN internal_admin_users.role IS
  'B2B-34 Piece 5 (renamed from sales_partner, 2026-07-23): internal_staff = a Clio-internal team member with scoped dashboard access (formerly named sales_partner — collided with the unrelated reseller/channel_partner concept introduced by B2B-26/28). super_admin = full cross-partner reach. See docs/specs/B2B-34-requirement-document.md Part A.';
COMMENT ON TABLE internal_staff_assignments IS
  'B2B-34 Piece 5 (renamed from sales_partner_assignments, 2026-07-23): many-to-many join, Clio-internal staff <-> the partner_accounts (reseller or direct-partner) rows they are scoped to manage. See docs/specs/B2B-34-requirement-document.md Part A.';
