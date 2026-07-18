-- B2B-21 — Internal Admin Identity (Super-Admin + Sales-Partner)
-- See docs/specs/B2B-21-requirement-document.md Section 6 for full rationale.
--
-- This is a new, orthogonal identity layer for Clio's OWN internal team,
-- deliberately independent from `partner_admin_users` (a partner's own staff,
-- scoped to that one partner's own account, populated by the Clerk
-- Organizations webhook). Neither table here is ever joined to, written by,
-- or read by anything in the partner_admin_users / Clerk-Org webhook path.
-- Requirement Doc Section 12: `partner_admin_users`,
-- `app/api/webhooks/clerk-organization/route.ts`, and `requirePartnerAdmin`
-- are untouched by this migration.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── INTERNAL_ADMIN_USERS ──────────────────────────────────────────────────────
-- One row per Clio-internal operator: a super-admin (full cross-partner
-- reach, equal peers, no hierarchy) or a sales-partner (invite-only, scoped
-- to specific partner_accounts via sales_partner_assignments below).

CREATE TABLE IF NOT EXISTS internal_admin_users (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                     TEXT NOT NULL,
  clerk_user_id             TEXT,
  role                      TEXT NOT NULL CHECK (role IN ('super_admin', 'sales_partner')),
  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'active', 'deactivated')),
  invited_by                UUID REFERENCES internal_admin_users(id),
  invite_token_hash         TEXT,
  invite_token_expires_at   TIMESTAMPTZ,
  invited_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness — one email can never hold two internal_admin_users
-- rows (Requirement Doc §10 edge case 11), regardless of role.
CREATE UNIQUE INDEX IF NOT EXISTS idx_internal_admin_users_email_lower
  ON internal_admin_users (lower(email));

-- A Clerk user can bind to at most one internal_admin_users row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_internal_admin_users_clerk_user_id
  ON internal_admin_users (clerk_user_id) WHERE clerk_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_internal_admin_users_status
  ON internal_admin_users (status);

CREATE TRIGGER update_internal_admin_users_updated_at
  BEFORE UPDATE ON internal_admin_users
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE internal_admin_users ENABLE ROW LEVEL SECURITY;

-- No end-user-facing RLS policy — this table is never read via a
-- browser-authenticated Supabase client. Every read goes through the new
-- server-side helpers (lib/internal-admin/auth.ts) using
-- createSupabaseAdminClient(), exactly like requirePartnerAdmin does today.
CREATE POLICY "Service role full access on internal_admin_users"
  ON internal_admin_users FOR ALL
  USING (auth.role() = 'service_role');

-- ─── SALES_PARTNER_ASSIGNMENTS ─────────────────────────────────────────────────
-- Many-to-many join: a sales-partner may be tagged to several partner
-- accounts, and a partner account may carry more than one tagged
-- sales-partner (Requirement Doc §6.1 / §11 Q6). The FK to a row with
-- role='sales_partner' is enforced in application code, not a DB CHECK
-- (cross-table CHECKs aren't portable in Postgres) — mirrors how
-- partner_sessions' auth-credential pairing is enforced.

CREATE TABLE IF NOT EXISTS sales_partner_assignments (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  internal_admin_user_id  UUID NOT NULL REFERENCES internal_admin_users(id) ON DELETE CASCADE,
  partner_account_id      UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  assigned_by             UUID REFERENCES internal_admin_users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (internal_admin_user_id, partner_account_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_partner_assignments_admin_user
  ON sales_partner_assignments (internal_admin_user_id);

CREATE INDEX IF NOT EXISTS idx_sales_partner_assignments_partner_account
  ON sales_partner_assignments (partner_account_id);

ALTER TABLE sales_partner_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on sales_partner_assignments"
  ON sales_partner_assignments FOR ALL
  USING (auth.role() = 'service_role');

-- ─── SEED — first super-admin ──────────────────────────────────────────────────
-- Idempotent across environments and repeated migration runs (Requirement
-- Doc §6.1 / §11 Q9). No clerk_user_id at seed time — binds lazily on Arun's
-- first authenticated request post-migration via resolveInternalAdmin()
-- (lib/internal-admin/auth.ts), the same lazy-bind path every other
-- super-admin uses. No special-cased bootstrap logic.
INSERT INTO internal_admin_users (email, role, status, invited_by, accepted_at)
VALUES ('hello.arunprakash83@gmail.com', 'super_admin', 'pending', NULL, NULL)
ON CONFLICT (lower(email)) DO NOTHING;
