-- B2B-02 — F-01 Resolution A branch (opaque-reference aggregating usage ledger)
--
-- NOT part of the required B2B-02 baseline (071_b2b02_partner_accounts_and_api_keys.sql
-- applies cleanly without this file). This migration exists so that IF F-01
-- resolves to "Clio keeps its own opaque-reference usage ledger for
-- billing/dashboard purposes," B2B-04 can apply this file as-is without
-- reopening the B2B-02 spec.
--
-- If F-01 instead resolves to "zero-storage, live round-trip to partner
-- APIs" (Resolution B), this file is simply never applied — B2B-04's
-- dashboards would instead read/aggregate directly from
-- webhook_dispatch_log.payload (already present in 071) or round-trip to
-- the partner's own API at read time. Either way, the partner-facing
-- webhook contract is byte-for-byte identical — only this internal storage
-- layer differs. See docs/specs/B2B-02-requirement-document.md Section 6
-- "F-01 Handling" for the full reasoning.

CREATE TABLE IF NOT EXISTS usage_events (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id    UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,

  event_type            TEXT NOT NULL
                          CHECK (event_type IN ('voice_minute', 'llm_generation_topic', 'llm_generation_content', 'llm_generation_prerequisite')),

  -- Minutes as a decimal (e.g. 1.5), LLM-call events as a whole-number count
  -- (almost always 1 per row, one row per generation call).
  quantity              NUMERIC NOT NULL CHECK (quantity > 0),

  clio_session_ref      UUID REFERENCES partner_sessions(id) ON DELETE SET NULL,
  partner_reference       TEXT, -- opaque sub-tenant/correlation passthrough, same value as the webhook that reported it

  webhook_dispatch_log_id UUID REFERENCES webhook_dispatch_log(id) ON DELETE SET NULL, -- traceability back to the exact dispatch that reported this

  test_mode              BOOLEAN NOT NULL DEFAULT FALSE, -- test-key-originated events are excluded from all billing sums

  occurred_at            TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Burn-rate / dashboard query pattern this indexes for: "sum quantity for
-- partner X, event_type Y, over date range Z" — the exact shape B2B-04's
-- admin page (7.2) and partner dashboard (7.3) will run.
CREATE INDEX IF NOT EXISTS idx_usage_events_account_type_time
  ON usage_events(partner_account_id, event_type, occurred_at DESC)
  WHERE test_mode = FALSE;

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on usage_events"
  ON usage_events FOR ALL
  USING (auth.role() = 'service_role');

-- Append-only: no UPDATE/DELETE policy for any role, matching
-- webhook_dispatch_log and minutes_ledger.

COMMENT ON TABLE usage_events IS 'B2B-02 / F-01 Resolution A (optional): aggregating opaque-reference usage ledger. Apply only if F-01 resolves this way — see file header.';
