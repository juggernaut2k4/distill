-- Fix for a real production race condition, found 2026-07-19: createOrClaimPartnerAccount()
-- (lib/partner/signup.ts) does a check-then-insert with no locking — two near-simultaneous calls for
-- the same clerk_user_id (e.g. a Clerk webhook retry racing the claim route) can both pass the
-- "does this user already have an account" check before either commits, creating two partner_accounts
-- rows + two partner_admin_users(role='owner') rows for the same user. Reproduced live: 2 of the 2
-- Clerk users who signed up during tonight's testing got duplicate rows this way.
--
-- Fix: a partial unique index enforcing "at most one role='owner' partner_admin_users row per
-- clerk_user_id" — this is the actual product invariant already documented in
-- createOrClaimPartnerAccount's own comment ("no-ops if they already administer a partner account").
-- Scoped to role='owner' only (not a blanket unique on clerk_user_id) so a user who owns their own
-- account can still legitimately be invited as staff (role='member') on a different account via the
-- existing team-invite flow, without conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_admin_users_one_owner_per_clerk_user
  ON partner_admin_users(clerk_user_id)
  WHERE role = 'owner';
