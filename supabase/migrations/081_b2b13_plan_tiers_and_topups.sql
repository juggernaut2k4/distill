-- B2B-13 — Recurring Plan Tiers + Configurable Top-Up Amounts
-- See docs/specs/B2B-13-requirement-document.md for full rationale.
--
-- Additive only, mirrors migration 075's own discipline: no existing
-- partner_wallets/wallet_ledger column, row, or CHECK value is removed or
-- narrowed. Adds 5 new nullable partner_wallets columns for per-partner Plan
-- subscription state, widens partner_wallets.funding_mechanism's CHECK by one
-- value ('plan_subscription'), and widens wallet_ledger.entry_type's CHECK by
-- one value ('plan_allowance_credit'), reproducing migration 077's own
-- widening pattern byte-for-byte. No new table — the Plan catalog (tier
-- names, prices, included allowance) lives in code (lib/billing/plan-tiers.ts),
-- not the database.
--
-- NOT APPLIED by the Backend Agent that wrote this file — Arun reviews and
-- applies it himself (see B2B-13 developer instructions).

-- ─── partner_wallets — new nullable Plan-subscription-state columns ─────────

ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS plan_tier_key TEXT;
ALTER TABLE partner_wallets DROP CONSTRAINT IF EXISTS partner_wallets_plan_tier_key_check;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_plan_tier_key_check
  CHECK (plan_tier_key IS NULL OR plan_tier_key IN ('starter', 'growth'));

ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS plan_billing_period TEXT;
ALTER TABLE partner_wallets DROP CONSTRAINT IF EXISTS partner_wallets_plan_billing_period_check;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_plan_billing_period_check
  CHECK (plan_billing_period IS NULL OR plan_billing_period IN ('monthly', 'annual'));

-- Deliberately a NEW column, not a reuse of stripe_subscription_id — that column's
-- own comment (migration 075) scopes it to "mid-market auto-recharge subscription
-- only." A Plan subscription is a structurally different Stripe Subscription object.
ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS stripe_plan_subscription_id TEXT;

ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS plan_current_period_end TIMESTAMPTZ;

ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS plan_status TEXT;
ALTER TABLE partner_wallets DROP CONSTRAINT IF EXISTS partner_wallets_plan_status_check;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_plan_status_check
  CHECK (plan_status IS NULL OR plan_status IN ('active', 'past_due', 'canceled'));

-- ─── partner_wallets.funding_mechanism — widen by one value ─────────────────

ALTER TABLE partner_wallets DROP CONSTRAINT IF EXISTS partner_wallets_funding_mechanism_check;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_funding_mechanism_check
  CHECK (funding_mechanism IS NULL OR funding_mechanism IN (
    'checkout_topup', 'subscription_auto_recharge', 'invoicing', 'plan_subscription'
  ));

-- ─── wallet_ledger.entry_type — widen by one value ───────────────────────────
-- Reproduces migration 077's own widening pattern exactly (drop-and-recreate the
-- named constraint).

ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_entry_type_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_entry_type_check
  CHECK (entry_type IN (
    'topup_checkout', 'topup_subscription_recharge', 'topup_invoice',
    'usage_decrement', 'manual_adjustment', 'test_block_purchase',
    'plan_allowance_credit'
  ));

COMMENT ON COLUMN partner_wallets.plan_tier_key IS 'B2B-13: references a key in the code-only PLAN_TIERS catalog (lib/billing/plan-tiers.ts), not an FK — the catalog is not DB-backed. NULL if the partner is not on a recurring Plan.';
COMMENT ON COLUMN partner_wallets.plan_billing_period IS 'B2B-13: monthly or annual, set at Plan checkout time.';
COMMENT ON COLUMN partner_wallets.stripe_plan_subscription_id IS 'B2B-13: Plan subscription only — distinct from stripe_subscription_id, which is scoped to auto-recharge only (migration 075).';
COMMENT ON COLUMN partner_wallets.plan_current_period_end IS 'B2B-13: cached from the Plan subscription''s invoice line item at webhook time, mirrors next_billing_date''s existing cache-not-live-call convention.';
COMMENT ON COLUMN partner_wallets.plan_status IS 'B2B-13: coarse mirror of the Plan subscription''s Stripe status. See docs/specs/B2B-13-requirement-document.md Section 9 for the exact lifecycle policy.';
