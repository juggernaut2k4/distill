-- B2B-08 — Testing / Metering
-- See docs/specs/B2B-08-requirement-document.md and architecture.md Section 15 for full rationale.
--
-- Additive only, on top of B2B-04's billing/metering schema (migration 075). No existing
-- partner_wallets/usage_events/partner_sessions/wallet_ledger column or CHECK value is removed or
-- narrowed. Two new columns on partner_wallets (trial_minutes_used, test_minutes_balance), one new
-- column on usage_events (is_metered_test_usage), one new column on partner_sessions (end_reason),
-- one new wallet_ledger.entry_type value ('test_block_purchase') plus one new nullable
-- wallet_ledger column (resulting_test_minutes_balance), and two new RPCs
-- (credit_test_minutes_balance, consume_trial_and_test_minutes) mirroring B2B-04's
-- credit_wallet_balance/decrement_wallet_balance atomic lazy-create pattern exactly.
--
-- Does NOT touch balance_usd, billing_rate_versions, or any of the three existing funding paths —
-- this brief's counters (trial_minutes_used, test_minutes_balance) are structurally separate from
-- the production wallet balance, per the Requirement Document Section 6 rationale.
--
-- Reconstructed 2026-07-15 from the exact SQL applied to Supabase (project nqxlpcshouboplhnuvrh) —
-- the local file was lost to a concurrent-agent git-stash collision after application; content is
-- authoritative (copied from the apply_migration call itself), not re-derived.

-- ─── partner_wallets — two new additive columns ─────────────────────────────────────────
ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS trial_minutes_used NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE partner_wallets DROP CONSTRAINT IF EXISTS partner_wallets_trial_minutes_used_nonneg;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_trial_minutes_used_nonneg
  CHECK (trial_minutes_used >= 0);

ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS test_minutes_balance NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE partner_wallets DROP CONSTRAINT IF EXISTS partner_wallets_test_minutes_balance_nonneg;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_test_minutes_balance_nonneg
  CHECK (test_minutes_balance >= 0);

-- ─── usage_events — one new additive column ─────────────────────────────────────────────
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS is_metered_test_usage BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── partner_sessions — one new additive column ─────────────────────────────────────────
ALTER TABLE partner_sessions ADD COLUMN IF NOT EXISTS end_reason TEXT;
ALTER TABLE partner_sessions DROP CONSTRAINT IF EXISTS partner_sessions_end_reason_check;
ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN ('trial_limit_reached', 'trial_exhausted'));

-- ─── wallet_ledger — new entry_type value + one new nullable column ─────────────────────
ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_entry_type_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_entry_type_check
  CHECK (entry_type IN (
    'topup_checkout', 'topup_subscription_recharge', 'topup_invoice',
    'usage_decrement', 'manual_adjustment', 'test_block_purchase'
  ));

ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS resulting_test_minutes_balance NUMERIC(10,2);

-- ─── RPCs ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION credit_test_minutes_balance(p_partner_account_id UUID, p_minutes NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  INSERT INTO partner_wallets (partner_account_id, test_minutes_balance)
    VALUES (p_partner_account_id, p_minutes)
    ON CONFLICT (partner_account_id)
    DO UPDATE SET test_minutes_balance = partner_wallets.test_minutes_balance + p_minutes, updated_at = NOW()
    RETURNING test_minutes_balance INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION consume_trial_and_test_minutes(p_partner_account_id UUID, p_minutes NUMERIC)
RETURNS TABLE(trial_minutes_used NUMERIC, test_minutes_balance NUMERIC) AS $$
BEGIN
  INSERT INTO partner_wallets (partner_account_id) VALUES (p_partner_account_id)
    ON CONFLICT (partner_account_id) DO NOTHING;

  RETURN QUERY
  UPDATE partner_wallets pw
  SET
    trial_minutes_used = LEAST(
      20.00,
      pw.trial_minutes_used + LEAST(p_minutes, GREATEST(0, 20.00 - pw.trial_minutes_used))
    ),
    test_minutes_balance = GREATEST(
      0,
      pw.test_minutes_balance - GREATEST(0, p_minutes - LEAST(p_minutes, GREATEST(0, 20.00 - pw.trial_minutes_used)))
    ),
    updated_at = NOW()
  WHERE pw.partner_account_id = p_partner_account_id
  RETURNING pw.trial_minutes_used, pw.test_minutes_balance;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN partner_wallets.trial_minutes_used IS 'B2B-08: lifetime, once-ever free-trial minutes consumed, per partner_account_id. Capped at 20.00 by consume_trial_and_test_minutes() (RPC-layer, not a DB CHECK). Never reset.';
COMMENT ON COLUMN partner_wallets.test_minutes_balance IS 'B2B-08: purchased 2-hour-test-block minutes remaining, structurally separate from balance_usd. Floored at 0 by consume_trial_and_test_minutes().';
COMMENT ON COLUMN usage_events.is_metered_test_usage IS 'B2B-08: Clio-internal-only, additive signal — true for usage_events rows produced by the trial/test-block metering mechanism. Orthogonal to test_mode (unchanged: still permanently unbilled to the partner). Never partner-facing.';
COMMENT ON COLUMN partner_sessions.end_reason IS 'B2B-08: NULL for an ordinary partner-ended session; trial_limit_reached for a mid-session forced cutoff; trial_exhausted for a pre-dispatch rejection (status=failed).';
COMMENT ON COLUMN wallet_ledger.resulting_test_minutes_balance IS 'B2B-08: set only for test_block_purchase rows, mirrors how usage_events_id/billing_rate_version_id are only set for usage_decrement rows.';
COMMENT ON FUNCTION consume_trial_and_test_minutes IS 'B2B-08: atomically consumes p_minutes, first from trial_minutes_used (capped 20.00), remainder from test_minutes_balance (floored 0). Called by the trial-cutoff Inngest job (full availableMinutes) and by handleSessionEnd() (actual durationMinutes) for test-mode sessions.';
