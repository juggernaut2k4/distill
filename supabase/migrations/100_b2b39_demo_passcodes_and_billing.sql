-- B2B-39 — Per-Reseller Demo Passcodes + Demo Billing
-- See docs/specs/B2B-39-requirement-document.md Section 6 for full rationale.
--
-- Migration numbering note: 099 was claimed by B2B-38
-- (099_b2b38_session_traceability_ids.sql, already applied to production per commit 006a02a) — this
-- feature takes 100, per docs/specs/B2B-39-requirement-document.md §12.
--
-- Additive only. Adds:
--  - demo_passcodes (new table) — one active passcode per channel_partner/admin-sentinel account,
--    hashed at rest, shown once at issuance.
--  - partner_wallets — three new additive columns (demo_minutes_balance, demo_reference_topup_minutes,
--    demo_low_balance_alert_fired_at), structurally separate from trial_minutes_used/
--    test_minutes_balance (migration 077) — zero existing trial/test-minutes code path is touched.
--  - Two new RPCs (credit_demo_minutes_balance, consume_demo_minutes), mirroring
--    credit_test_minutes_balance/consume_trial_and_test_minutes's own atomic lazy-create pattern.
--  - demo_dispatches (new table) — attribution row written at dispatch time, consumed by
--    inngest/demo-dispatch-minutes-consumer.ts at session end.
--  - wallet_ledger — one new entry_type value ('demo_topup_purchase') + one new nullable column
--    (resulting_demo_minutes_balance), mirroring migration 077's own test_block_purchase addition.
--  - One-time data statement: 20-minute demo-minutes grant for the "Clio Internal — Public Demo"
--    sentinel account (admin's own initial-setup analog — §6.4).

-- ─── DEMO_PASSCODES ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demo_passcodes (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id      UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  passcode_hash           TEXT NOT NULL,   -- SHA-256 hex digest, only form ever persisted
  passcode_prefix         TEXT NOT NULL,   -- first 4 chars (before the hyphen), display-safe only —
                                            -- NOT sufficient to guess the remaining 6-char/31-symbol
                                            -- suffix; used only for admin-facing diagnostics, never
                                            -- shown to the account owner as a "your passcode starts
                                            -- with..." UI.
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at              TIMESTAMPTZ,     -- set (not deleted) on regeneration — audit trail, mirrors
                                            -- this codebase's existing soft-invalidation convention.
  created_by_clerk_user_id TEXT            -- who clicked Generate/Regenerate; nullable defensively —
                                            -- every row in this design is user-initiated (§6.4).
);

-- At most one ACTIVE passcode per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_passcodes_active_per_account
  ON demo_passcodes(partner_account_id) WHERE revoked_at IS NULL;

-- Global hash uniqueness — dispatch-time resolution is a single indexed lookup with no account
-- context yet (the visitor only typed a passcode, not an account).
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_passcodes_hash ON demo_passcodes(passcode_hash);

ALTER TABLE demo_passcodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on demo_passcodes"
  ON demo_passcodes FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE demo_passcodes IS
  'B2B-39: per-account demo passcode, hashed at rest, shown once at issuance/regeneration. At most
  one active (revoked_at IS NULL) row per partner_account_id. Resolved at dispatch time by
  lib/demo/passcode-accounts.ts''s resolveDemoPasscodeToAccount() — a wholly separate mechanism from
  lib/demo/passcode.ts''s DEMO_MEETING_PASSCODE gate, which stays unchanged.';

-- ─── PARTNER_WALLETS — three new additive columns ──────────────────────────────────────
-- Mirrors test_minutes_balance''s own shape exactly (migration 077). Same table as every other
-- wallet dimension — 1:1 keyed by partner_account_id, avoiding an extra join with no countervailing
-- benefit. "Structurally separate" (Known Constraint) is satisfied by dedicated columns/RPCs/
-- arithmetic, touched by zero existing trial/test-minutes code path.
ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS demo_minutes_balance NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE partner_wallets DROP CONSTRAINT IF EXISTS partner_wallets_demo_minutes_balance_nonneg;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_demo_minutes_balance_nonneg
  CHECK (demo_minutes_balance >= 0);

ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS demo_reference_topup_minutes NUMERIC(10,2);
ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS demo_low_balance_alert_fired_at TIMESTAMPTZ;

COMMENT ON COLUMN partner_wallets.demo_minutes_balance IS
  'B2B-39: demo-only minutes balance, structurally separate from trial_minutes_used/
  test_minutes_balance (B2B-08). Floored at 0 by consume_demo_minutes(). Never blocks a dispatch at
  0 — see docs/specs/B2B-39-requirement-document.md §6.3/§9/AT-9.';
COMMENT ON COLUMN partner_wallets.demo_reference_topup_minutes IS
  'B2B-39: mirrors reference_topup_amount_usd''s role for the demo-minutes dimension — set to the
  size of the most recent credit (20-minute grant or a paid top-up tier), never cumulative. Used as
  the 80%-consumed alert threshold''s denominator.';
COMMENT ON COLUMN partner_wallets.demo_low_balance_alert_fired_at IS
  'B2B-39: mirrors low_balance_alert_fired_at''s compare-and-set race-safe single-fire-per-cycle
  role, for the demo-minutes dimension. Re-armed only by a new demo-minutes credit landing.';

-- ─── RPCs ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION credit_demo_minutes_balance(p_partner_account_id UUID, p_minutes NUMERIC)
RETURNS NUMERIC AS $$
DECLARE new_balance NUMERIC;
BEGIN
  INSERT INTO partner_wallets (partner_account_id, demo_minutes_balance, demo_reference_topup_minutes, demo_low_balance_alert_fired_at)
    VALUES (p_partner_account_id, p_minutes, p_minutes, NULL)
    ON CONFLICT (partner_account_id) DO UPDATE SET
      demo_minutes_balance = partner_wallets.demo_minutes_balance + p_minutes,
      demo_reference_topup_minutes = p_minutes,      -- always the size of THIS credit, not cumulative
      demo_low_balance_alert_fired_at = NULL,         -- re-arm on every new credit
      updated_at = NOW()
    RETURNING demo_minutes_balance INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION consume_demo_minutes(p_partner_account_id UUID, p_minutes NUMERIC)
RETURNS NUMERIC AS $$
DECLARE new_balance NUMERIC;
BEGIN
  INSERT INTO partner_wallets (partner_account_id) VALUES (p_partner_account_id) ON CONFLICT (partner_account_id) DO NOTHING;
  UPDATE partner_wallets SET demo_minutes_balance = GREATEST(0, demo_minutes_balance - p_minutes), updated_at = NOW()
    WHERE partner_account_id = p_partner_account_id
    RETURNING demo_minutes_balance INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION credit_demo_minutes_balance IS
  'B2B-39: atomically credits p_minutes to demo_minutes_balance (lazy-create on first credit),
  resets demo_reference_topup_minutes to p_minutes (not cumulative) and re-arms
  demo_low_balance_alert_fired_at to NULL. Called by the 20-minute registration/admin-bootstrap grant
  and by the demo-topup Stripe webhook branch.';
COMMENT ON FUNCTION consume_demo_minutes IS
  'B2B-39: atomically decrements demo_minutes_balance by p_minutes, floored at 0. Unlike
  consume_trial_and_test_minutes, there is only one bucket — never blocks a dispatch outright, only
  affects the visible balance and low-balance alert. Called by
  inngest/demo-dispatch-minutes-consumer.ts at session end.';

-- ─── DEMO_DISPATCHES ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demo_dispatches (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clio_session_ref          UUID NOT NULL UNIQUE REFERENCES partner_sessions(id) ON DELETE CASCADE,
  billed_partner_account_id UUID NOT NULL REFERENCES partner_accounts(id),      -- resolved from the passcode
  demo_passcode_id          UUID NOT NULL REFERENCES demo_passcodes(id),        -- which passcode row was used, for audit
  slug                      TEXT NOT NULL,                                      -- app/demo/_content.ts slug (not a DB FK — mirrors demo_meeting_urls.slug's own precedent)
  demo_minutes_consumed     NUMERIC(10,2),                                      -- filled in at session end
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demo_dispatches_billed_account ON demo_dispatches(billed_partner_account_id, created_at DESC);

ALTER TABLE demo_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on demo_dispatches"
  ON demo_dispatches FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE demo_dispatches IS
  'B2B-39: written by app/api/demo/[slug]/dispatch/route.ts immediately after a successful dispatch —
  attributes billing identity (which passcode-holder''s account gets charged) separately from
  outbound dispatch authentication (which always uses the fixed DEMO_PARTNER_API_KEY account,
  unchanged). Consumed by inngest/demo-dispatch-minutes-consumer.ts on clio/partner-session.ended.
  Internal-only — no dashboard reads this table, per §10 Out of Scope.';

-- ─── WALLET_LEDGER — new entry_type value + one new nullable column ────────────────────
ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_entry_type_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_entry_type_check
  CHECK (entry_type IN (
    'topup_checkout', 'topup_subscription_recharge', 'topup_invoice',
    'usage_decrement', 'manual_adjustment', 'test_block_purchase', 'plan_allowance_credit',
    'demo_topup_purchase'
  ));

ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS resulting_demo_minutes_balance NUMERIC(10,2);

COMMENT ON COLUMN wallet_ledger.resulting_demo_minutes_balance IS
  'B2B-39: set only for demo_topup_purchase rows, mirrors how resulting_test_minutes_balance is only
  set for test_block_purchase rows.';

-- ─── One-time admin bootstrap grant ─────────────────────────────────────────────────────
-- Admin has no "registration" event — the 20-minute grant analog for the "Clio Internal — Public
-- Demo" sentinel account (§6.4/§6.5) is this one-off statement, run once at deploy time, mirroring
-- migration 093's own one-off INSERT ... ON CONFLICT DO NOTHING pattern for that same account.
SELECT credit_demo_minutes_balance('30d40f51-5d6e-49e9-bdda-519b7d70e13a'::uuid, 20);
