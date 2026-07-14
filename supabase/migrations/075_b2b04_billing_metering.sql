-- B2B-04 — Billing / Metering
-- See docs/specs/B2B-04-requirement-document.md and architecture.md Section 13 for full rationale.
--
-- Additive only: no existing partner_accounts/partner_sessions/webhook_dispatch_log column is
-- modified. usage_events gains 3 new columns (amount_usd, billing_rate_version_id, billed) plus one
-- unique index that closes the real idempotency gap flagged by the CEO brief — see 13.3's exact fix
-- to lib/partner/webhooks.ts, applied alongside this migration.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── PARTNER_WALLETS ────────────────────────────────────────────────────────────
-- One unified prepaid credit wallet per top-level partner_account_id (Option B —
-- decided, docs/brainstorm-b2b-platform-pivot.md §7.4). USD-denominated
-- (NUMERIC(14,6)), not a credit-unit abstraction — see requirement doc Section 6
-- for the denomination rationale. May go negative — a live meeting-bot session's
-- per-minute billing cannot be paused mid-call; see requirement doc Section 9.

CREATE TABLE IF NOT EXISTS partner_wallets (
  id                                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id                UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,

  balance_usd                       NUMERIC(14,6) NOT NULL DEFAULT 0,

  -- Commitment-size/support-level tiering only (Objective 6 — "no feature
  -- gating by tier"). Every tier gets the identical API surface; this column
  -- only ever affects which POST /api/admin/billing/* funding route was used
  -- and which billing_rate_versions override (if any) applies.
  tier                              TEXT NOT NULL DEFAULT 'self_serve'
                                      CHECK (tier IN ('self_serve', 'mid_market', 'enterprise')),

  funding_mechanism                 TEXT
                                      CHECK (funding_mechanism IN ('checkout_topup', 'subscription_auto_recharge', 'invoicing')),

  monthly_minimum_usd               NUMERIC(12,2),   -- mid-market only

  -- Stripe object references only — never raw payment data. Per Arun's
  -- explicit instruction ("not payment details, Stripe owns that").
  stripe_customer_id                TEXT,
  stripe_subscription_id            TEXT,            -- mid-market auto-recharge subscription only
  stripe_default_payment_method_id  TEXT,
  payment_method_card_brand         TEXT,
  payment_method_card_last4         TEXT,
  payment_method_type               TEXT CHECK (payment_method_type IN ('card', 'us_bank_account')),

  -- Cached from the relevant Stripe subscription/invoice object at webhook
  -- time — never a live Stripe API round-trip per admin-page render.
  next_billing_date                 TIMESTAMPTZ,

  -- Denominator for the 80%-consumed low-balance threshold (requirement doc
  -- Section 5.B.5). Set/reset every time a new top-up lands (re-arm).
  reference_topup_amount_usd        NUMERIC(14,6),
  low_balance_alert_fired_at        TIMESTAMPTZ,     -- NULL = armed; set = already fired this depletion cycle

  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_partner_wallets_updated_at
  BEFORE UPDATE ON partner_wallets
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_wallets"
  ON partner_wallets FOR ALL
  USING (auth.role() = 'service_role');

-- ─── BILLING_RATE_VERSIONS ──────────────────────────────────────────────────────
-- Versioned burn rates keyed by usage_events.event_type (a superset of the two
-- rate categories Arun originally named — voice-minutes and LLM-generation
-- calls — since usage_events already differentiates 8 sub-types post-B2B-03).
-- Never mutated in place: a rate change closes the currently-open row
-- (effective_to) and opens a new one, so a usage_events row inserted before the
-- change keeps citing the rate that was genuinely in effect at occurred_at,
-- forever, regardless of later rate changes (F-02's eventual real-numbers
-- correction included).

CREATE TABLE IF NOT EXISTS billing_rate_versions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- NULL = platform default. Non-null = a negotiated per-account override
  -- (mid-market/enterprise discount), applied at the rate-table level per
  -- docs/brainstorm-b2b-platform-pivot.md §7.4's tiering recommendation.
  partner_account_id  UUID REFERENCES partner_accounts(id) ON DELETE CASCADE,

  event_type          TEXT NOT NULL
                        CHECK (event_type IN (
                          'voice_minute', 'llm_generation_topic', 'llm_generation_content',
                          'llm_generation_prerequisite', 'llm_generation_skeleton',
                          'llm_generation_discovery', 'llm_generation_sample_fill',
                          'llm_generation_new_template'
                        )),

  unit                TEXT NOT NULL CHECK (unit IN ('minute', 'call')),
  rate_usd            NUMERIC(14,8) NOT NULL CHECK (rate_usd >= 0),

  -- Always an explicit placeholder label, never presented as final pricing —
  -- per the Feature Brief's constraint that no real dollar figure may be
  -- invented; F-02's deferred research pass is the only path to a non-
  -- placeholder rate_basis value.
  rate_basis          TEXT NOT NULL,

  effective_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to        TIMESTAMPTZ,   -- NULL = currently in effect

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_rate_versions_lookup
  ON billing_rate_versions(event_type, effective_from DESC);

-- At most one open-ended row per (partner_account_id, event_type), including
-- the platform-default case — COALESCE gives NULL partner_account_id a stable
-- sentinel so the constraint applies to default rows too, not only overrides.
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_rate_versions_open_unique
  ON billing_rate_versions(COALESCE(partner_account_id, '00000000-0000-0000-0000-000000000000'::uuid), event_type)
  WHERE effective_to IS NULL;

ALTER TABLE billing_rate_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on billing_rate_versions"
  ON billing_rate_versions FOR ALL
  USING (auth.role() = 'service_role');

-- ─── WALLET_LEDGER ──────────────────────────────────────────────────────────────
-- Append-only wallet balance audit trail. Mirrors the existing BILLING-LEDGER-01
-- pattern (lib/session-billing.ts's minutes_ledger) exactly: every row's
-- resulting_balance_usd is the atomic RPC's own returned value, never
-- independently recomputed, so the ledger can never drift from the real balance.

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id        UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,

  entry_type                TEXT NOT NULL
                              CHECK (entry_type IN (
                                'topup_checkout', 'topup_subscription_recharge', 'topup_invoice',
                                'usage_decrement', 'manual_adjustment'
                              )),

  delta_usd                 NUMERIC(14,6) NOT NULL,   -- signed: +N credit, -N decrement
  resulting_balance_usd     NUMERIC(14,6) NOT NULL,

  usage_events_id           UUID REFERENCES usage_events(id) ON DELETE SET NULL,          -- set for usage_decrement rows
  billing_rate_version_id   UUID REFERENCES billing_rate_versions(id) ON DELETE SET NULL, -- rate cited, for usage_decrement rows
  stripe_object_id          TEXT,                     -- Checkout Session / Invoice id, for topup_* rows

  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_account_time
  ON wallet_ledger(partner_account_id, created_at DESC);

-- Idempotency for Stripe-triggered top-ups: a webhook redelivery for the same
-- Stripe object must never double-credit the wallet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_stripe_idempotency
  ON wallet_ledger(stripe_object_id, entry_type)
  WHERE stripe_object_id IS NOT NULL;

ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on wallet_ledger"
  ON wallet_ledger FOR ALL
  USING (auth.role() = 'service_role');
-- No UPDATE/DELETE policy for any role — append-only, matching minutes_ledger
-- and webhook_dispatch_log's existing conventions.

-- ─── usage_events extensions ────────────────────────────────────────────────────
-- Additive only. amount_usd + billing_rate_version_id give every historical row
-- an immutable citation of exactly what it was charged and at what rate — the
-- literal mechanism behind "a rate change must never silently reprice already-
-- recorded historical usage." billed distinguishes a row that was actually
-- decremented from one that couldn't be (no rate configured yet — see the 7
-- unrated llm_generation_* event types, requirement doc Section 6).

ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(14,6);
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS billing_rate_version_id UUID REFERENCES billing_rate_versions(id) ON DELETE SET NULL;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS billed BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── Idempotency close ───────────────────────────────────────────────────────────
-- The real gap the CEO brief flagged as no longer "moot" once real money is
-- decremented per row: paired with the lib/partner/webhooks.ts code fix
-- (architecture.md Section 13.3 — only insert usage_events when the
-- webhook_dispatch_log upsert actually created a NEW row, not on a duplicate-
-- ignored conflict), this unique index guarantees at most one usage_events row
-- per genuinely-new webhook_dispatch_log row, inheriting that table's own
-- existing (partner_account_id, event_type, clio_session_ref, payload_hash)
-- idempotent unique index by construction.

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_dispatch_log_unique
  ON usage_events(webhook_dispatch_log_id)
  WHERE webhook_dispatch_log_id IS NOT NULL;

-- ─── RPCs ────────────────────────────────────────────────────────────────────────
-- Mirror lib/session-billing.ts's deduct_minutes/add_minutes atomic-update-
-- returning pattern exactly. Both lazily create the wallet row at 0 if none
-- exists yet (ON CONFLICT DO UPDATE), so there is never a distinct "wallet not
-- found" error state for calling code to handle.

CREATE OR REPLACE FUNCTION credit_wallet_balance(p_partner_account_id UUID, p_amount_usd NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  INSERT INTO partner_wallets (partner_account_id, balance_usd)
    VALUES (p_partner_account_id, p_amount_usd)
    ON CONFLICT (partner_account_id)
    DO UPDATE SET balance_usd = partner_wallets.balance_usd + p_amount_usd, updated_at = NOW()
    RETURNING balance_usd INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_wallet_balance(p_partner_account_id UUID, p_amount_usd NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  INSERT INTO partner_wallets (partner_account_id, balance_usd)
    VALUES (p_partner_account_id, -p_amount_usd)
    ON CONFLICT (partner_account_id)
    DO UPDATE SET balance_usd = partner_wallets.balance_usd - p_amount_usd, updated_at = NOW()
    RETURNING balance_usd INTO new_balance;
  -- Deliberately NOT clamped at 0 — a live session's per-minute voice billing
  -- cannot be paused mid-call. See docs/specs/B2B-04-requirement-document.md
  -- Section 9 for the accepted-negative-balance edge case.
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- ─── Seed: the one placeholder rate genuinely on record ────────────────────────
-- docs/b2b-pivot-status.md F-02: Recall.ai $0.0108/min + Claude Sonnet
-- ~$0.0002/min + infra ~$0.004/min = $0.0150/min. Explicitly labeled as a
-- COGS-basis placeholder carrying NO margin (the customer-facing markup is a
-- separate, also-deferred F-02 decision — see requirement doc Section 6).
--
-- Deliberately NO seed rows for the 7 llm_generation_* event types: no stale
-- (or any) per-call generation-cost figure exists on record anywhere in this
-- repo's history — the ~$0.0002/min Claude figure above is a cost-per-minute-
-- of-conversation number, not a cost-per-generation-call number, and is not a
-- valid substitute. Per the Feature Brief's explicit "never invent real dollar
-- figures" constraint, this migration does not manufacture one. Those 7 event
-- types launch with usage_events.billed = FALSE until a real figure lands via
-- F-02's already-tracked research pass and a row is inserted for that
-- event_type (see requirement doc Section 12 "Dependencies").

INSERT INTO billing_rate_versions (partner_account_id, event_type, unit, rate_usd, rate_basis, effective_from)
VALUES (NULL, 'voice_minute', 'minute', 0.01500000, 'cogs_placeholder_2026_05_no_margin', NOW())
ON CONFLICT DO NOTHING;

COMMENT ON TABLE partner_wallets IS 'B2B-04: one unified prepaid credit wallet per top-level partner_account_id, USD-denominated (Option B — single unified wallet, decided). May go negative — see docs/specs/B2B-04-requirement-document.md Section 9.';
COMMENT ON TABLE billing_rate_versions IS 'B2B-04: versioned, event_type-keyed burn rates. Never mutated in place — a rate change closes the old row (effective_to) and opens a new one, so historical usage_events rows always cite the rate genuinely in effect at occurred_at.';
COMMENT ON TABLE wallet_ledger IS 'B2B-04: append-only wallet balance audit trail, mirrors minutes_ledger (BILLING-LEDGER-01). Idempotent on (stripe_object_id, entry_type) for topup rows.';
