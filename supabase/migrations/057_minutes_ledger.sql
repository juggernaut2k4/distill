-- BILLING-LEDGER-01 — Durable, append-only ledger of every balance-changing event
-- (Stripe topups and session-end deductions). Purely additive observability layered
-- alongside the existing, unchanged `add_minutes`/`deduct_minutes` RPCs — see
-- docs/specs/BILLING-LEDGER-01-requirement-doc.md Section 6.

CREATE TABLE IF NOT EXISTS minutes_ledger (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'recharge' = a Stripe topup (add_minutes). 'session_deduction' = minutes billed
  -- for a completed/force-ended coaching session (deduct_minutes). Exactly two
  -- values for this initial ship — any future balance-changing action (e.g. a
  -- manual admin credit) would add a new value here, not a new table.
  event_type        TEXT        NOT NULL
                        CHECK (event_type IN ('recharge', 'session_deduction')),

  -- Signed delta actually applied to the balance: +N for recharge, -N for
  -- deduction. This makes SUM(delta_minutes) over a user's rows always equal
  -- their current balance, which is the core integrity property.
  delta_minutes     INTEGER     NOT NULL,

  -- The balance immediately after this event was applied — captured at write
  -- time (reusing the RPC's own return value), not recomputed later. This is
  -- what makes the ledger a true audit trail rather than requiring
  -- replay/summation to answer "what was the balance after event X."
  resulting_balance INTEGER     NOT NULL,

  -- Nullable: only present for event_type = 'session_deduction'. NOT ON DELETE
  -- CASCADE to sessions, deliberately — the ledger row must survive even if the
  -- session row is ever deleted (append-only, dispute-defensible; a deleted
  -- session must not silently erase its billing history).
  session_id        UUID        REFERENCES sessions(id) ON DELETE SET NULL,

  -- Nullable: only present for event_type = 'recharge'. The Stripe Checkout
  -- Session ID, giving a direct cross-reference to the Stripe dashboard for
  -- dispute resolution.
  stripe_checkout_session_id TEXT,

  -- Free-form context (e.g. minutes purchased in a topup, plan tier at time of
  -- event) — JSONB for the same forward-compatibility reason as
  -- session_billing_audit_log.metadata. Never store secrets/PII here.
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,

  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_minutes_ledger_user_time
  ON minutes_ledger(user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_minutes_ledger_session
  ON minutes_ledger(session_id) WHERE session_id IS NOT NULL;

-- ─── APPEND-ONLY ENFORCEMENT (mirrors session_billing_audit_log's pattern) ───
ALTER TABLE minutes_ledger ENABLE ROW LEVEL SECURITY;

-- Users may read their own ledger rows (powers the all-time-total query and any
-- future user-facing breakdown beyond this spec's two display points).
CREATE POLICY "Users can view own minutes ledger"
  ON minutes_ledger FOR SELECT
  USING (auth.uid()::text = user_id);

-- Service role (admin client) is the only writer. No UPDATE or DELETE policy is
-- defined for any role — matches session_billing_audit_log's dispute-defensible,
-- immutable pattern exactly.
CREATE POLICY "Service role can insert minutes ledger events"
  ON minutes_ledger FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can read all minutes ledger events"
  ON minutes_ledger FOR SELECT
  USING (auth.role() = 'service_role');
