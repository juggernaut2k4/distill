-- AUTOGEN-01 Part D — Verified minute billing audit log.
-- Records a timestamped, append-only sequence of voice/billing lifecycle events per
-- session so minute billing is derived from real speak-readiness signals (not bot-join
-- time) and is defensible against user billing disputes (AC-D4, AC-D7).
--
-- Column/type choices are an engineering judgment call (spec Section 7 explicitly
-- leaves exact schema to engineering) — see notes inline below.

CREATE TABLE IF NOT EXISTS session_billing_audit_log (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id     UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id        TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Ordered sequence of billing/voice lifecycle events. `speak_verified` is the
  -- billing-start instant; `disconnected` is the billing-end instant.
  event_type     TEXT        NOT NULL
                    CHECK (event_type IN (
                      'bot_joined',
                      'voice_connect_attempt',
                      'speak_verified',
                      'gap_start',
                      'gap_end',
                      'disconnected'
                    )),

  -- Which voice adapter was active for this session when the event was recorded.
  -- Nullable because 'bot_joined' happens before any voice adapter is selected/attempted.
  voice_provider TEXT        CHECK (voice_provider IS NULL OR voice_provider IN ('elevenlabs', 'hume')),

  -- Free-form context (e.g. close code/reason for a gap, error message) — kept as
  -- JSONB rather than a fixed TEXT column so future event types don't require a
  -- migration just to attach metadata. Never store secrets/PII here.
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- occurred_at is the authoritative timestamp used for all billing math
  -- (distinct from created_at, which is purely row-insertion bookkeeping and would
  -- be identical in practice but is kept separate for clarity/future replay tolerance).
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queryable by session_id for support/dispute resolution (AC-D4), ordered by time.
CREATE INDEX IF NOT EXISTS idx_session_billing_audit_session_time
  ON session_billing_audit_log(session_id, occurred_at ASC);

CREATE INDEX IF NOT EXISTS idx_session_billing_audit_user
  ON session_billing_audit_log(user_id);

-- ─── APPEND-ONLY ENFORCEMENT (AC-D7) ─────────────────────────────────────────
-- No application code path may update or delete rows in this table. RLS below
-- denies UPDATE/DELETE entirely (even to authenticated users) and only allows the
-- service role (used exclusively by the event-writer functions in
-- lib/session-billing.ts) to INSERT/SELECT. This makes the log dispute-defensible:
-- there is no code path, anywhere, that can alter a row once written.

ALTER TABLE session_billing_audit_log ENABLE ROW LEVEL SECURITY;

-- Users may read their own audit trail (needed for the future user-facing minute
-- breakdown view — Section 8/AC-D9 — once its BA follow-up spec exists).
CREATE POLICY "Users can view own billing audit log"
  ON session_billing_audit_log FOR SELECT
  USING (auth.uid()::text = user_id);

-- Service role (admin client) has full INSERT/SELECT access — this is the only
-- writer, via lib/session-billing.ts's writeAuditEvent(). No UPDATE or DELETE
-- policy is defined for any role, including service_role, so no grant exists for
-- those operations through PostgREST regardless of caller.
CREATE POLICY "Service role can insert billing audit events"
  ON session_billing_audit_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can read all billing audit events"
  ON session_billing_audit_log FOR SELECT
  USING (auth.role() = 'service_role');
