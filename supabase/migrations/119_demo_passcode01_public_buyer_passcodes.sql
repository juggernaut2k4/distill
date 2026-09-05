-- DEMO-PASSCODE-01 (docs/specs/DEMO-PASSCODE-01-requirement-document.md §6.1/§6.2) — public $10
-- demo-passcode purchase flow. A wholly separate, lightweight passcode model for public buyers —
-- deliberately NOT an extension of demo_passcodes (B2B-39), which is minutes-balance-based and
-- rooted in partner_accounts. See docs/b2b-pivot-status.md / BACKLOG.md for feature status.

-- ─── PUBLIC_DEMO_PASSCODES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public_demo_passcodes (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passcode_hash               TEXT NOT NULL UNIQUE,   -- SHA-256 hex digest, only form ever persisted
  passcode_prefix             TEXT NOT NULL,           -- first 4 chars, display-safe only (admin diagnostics)
  buyer_email                 TEXT NOT NULL,           -- from Stripe Checkout's own email collection
  uses_remaining              SMALLINT NOT NULL DEFAULT 2 CHECK (uses_remaining >= 0),
  stripe_checkout_session_id  TEXT NOT NULL UNIQUE,    -- webhook idempotency key for this table
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_public_demo_passcodes_created_at ON public_demo_passcodes(created_at DESC);

ALTER TABLE public_demo_passcodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on public_demo_passcodes"
  ON public_demo_passcodes FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public_demo_passcodes IS
  'DEMO-PASSCODE-01: a wholly separate, lightweight passcode model for public $10 demo buyers —
  exactly-2-uses, no expiry, no partner_account_id, no minutes balance. Deliberately NOT an extension
  of demo_passcodes (B2B-39), which is minutes-balance-based and rooted in partner_accounts. Resolved
  at dispatch time by lib/demo/public-buyer-passcode.ts, tried only after the B2B-39 reseller passcode
  model fails to match (app/api/demo/[slug]/widget-dispatch/route.ts).';

-- ─── PUBLIC_DEMO_PASSCODE_REDEMPTIONS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public_demo_passcode_redemptions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passcode_id       UUID NOT NULL REFERENCES public_demo_passcodes(id) ON DELETE CASCADE,
  redeemed_name     TEXT NOT NULL,     -- the name typed into the Widget Demo tab's existing "Name" field
  slug              TEXT NOT NULL,     -- app/demo/_content.ts slug (not a DB FK — mirrors demo_dispatches.slug's own precedent)
  clio_session_ref  UUID REFERENCES partner_sessions(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_public_demo_passcode_redemptions_passcode ON public_demo_passcode_redemptions(passcode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_demo_passcode_redemptions_created_at ON public_demo_passcode_redemptions(created_at DESC);

ALTER TABLE public_demo_passcode_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on public_demo_passcode_redemptions"
  ON public_demo_passcode_redemptions FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public_demo_passcode_redemptions IS
  'DEMO-PASSCODE-01: one row per successful public-buyer widget-demo redemption — who (redeemed_name,
  correlated to the owning passcode''s buyer_email via passcode_id) and when. Written by
  app/api/demo/[slug]/widget-dispatch/route.ts immediately after a successful dispatch. ON DELETE
  SET NULL on clio_session_ref (not CASCADE) — unlike demo_dispatches, this row is Arun''s permanent
  audit record and must survive even if the underlying partner_sessions row is ever cleaned up.';

-- ─── consume_public_demo_passcode_use RPC ───────────────────────────────────────────────
-- Atomic decrement, mirroring credit_wallet_balance/credit_test_minutes_balance's own
-- lazy-atomic-update pattern (this codebase's existing convention for balance mutations that must
-- never race negative). Called by lib/demo/public-buyer-passcode.ts's consumePublicDemoPasscodeUse(),
-- only after a successful upstream widget-session dispatch — see §6.6/§9 of the spec for the
-- resulting, accepted race window on the very last use.
CREATE OR REPLACE FUNCTION consume_public_demo_passcode_use(p_passcode_id UUID)
RETURNS SMALLINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_uses_remaining SMALLINT;
BEGIN
  UPDATE public_demo_passcodes
  SET uses_remaining = uses_remaining - 1
  WHERE id = p_passcode_id AND uses_remaining > 0
  RETURNING uses_remaining INTO v_new_uses_remaining;

  RETURN v_new_uses_remaining; -- NULL if the row was already at 0 (or didn't exist) — a race, see §9
END;
$$;
