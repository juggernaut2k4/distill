-- B2B-38 — Session Traceability IDs
-- Per docs/specs/B2B-38-requirement-document.md Section 6.
--
-- Adds reseller-supplied traceability (reseller_id, reseller_unique_id) to the session-creation
-- contract, a per-reseller idempotent-replay guard, a new internal trace-log table (60-day full
-- delete), a best-effort hume_config_id persist point, and propagation of the five trace
-- identifiers into the internal glitch tracker (glitch_instances) via the existing fan-out trigger.
--
-- Numbering note: 098 (b2b36_end_user_name_industry) is the highest existing migration; 099 is the
-- next free number as of this writing (confirmed via `ls supabase/migrations/`).

-- ─── 1. New table — partner_session_trace_logs (§6.3) ──────────────────────────────────────────────
-- Standalone table (not a view) — populated at session-creation (identity fields) and
-- updated/finalized at session-end (duration_seconds/hume_config_id/ended_at) by
-- partnerSessionTraceLogFinalizer (inngest/partner-session-trace-log.ts), listening on the same
-- clio/partner-session.ended event B2B-37 established. Purged in full (row deleted, not redacted)
-- 60 days after created_at by partnerSessionTraceLogPurge. Internal-only — no partner-facing
-- surface reads this table.
--
-- reseller_id duplicates partner_account_id on every row by construction (a request's reseller_id
-- is validated to exactly equal auth.partnerAccountId before anything is written — see
-- app/api/partner/v1/sessions/route.ts). Kept as its own named column anyway, per §6.1 — the CEO
-- brief names reseller_id as one of "the same five trace identifiers" required by name on both this
-- table and glitch_instances, so a future dashboard/support engineer reading these tables doesn't
-- need to know partner_account_id silently doubles as reseller_id. Enforced, not just documented.

CREATE TABLE IF NOT EXISTS partner_session_trace_logs (
  id                  UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  clio_session_ref    UUID        NOT NULL UNIQUE REFERENCES partner_sessions(id) ON DELETE CASCADE,
  partner_account_id  UUID        NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  reseller_id         UUID        NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  end_client_id       UUID        REFERENCES partner_accounts(id) ON DELETE SET NULL,
  reseller_unique_id  TEXT,
  hume_config_id      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at            TIMESTAMPTZ,
  duration_seconds    INTEGER,
  CONSTRAINT chk_trace_log_reseller_matches_account CHECK (reseller_id = partner_account_id)
);

CREATE INDEX IF NOT EXISTS idx_trace_logs_partner_account ON partner_session_trace_logs(partner_account_id);
CREATE INDEX IF NOT EXISTS idx_trace_logs_created_at      ON partner_session_trace_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_trace_logs_reseller_unique
  ON partner_session_trace_logs(partner_account_id, reseller_unique_id)
  WHERE reseller_unique_id IS NOT NULL;

ALTER TABLE partner_session_trace_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on partner_session_trace_logs" ON partner_session_trace_logs;
CREATE POLICY "Service role full access on partner_session_trace_logs"
  ON partner_session_trace_logs FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE partner_session_trace_logs IS
  'B2B-38: one row per partner session, for future dashboard/billing/auditing. Populated at session
  creation (identity fields) and finalized at session end (ended_at/duration_seconds/hume_config_id)
  by partnerSessionTraceLogFinalizer, listening on the same clio/partner-session.ended event B2B-37
  established. Purged in full (row deleted, not redacted) 60 days after created_at by
  partnerSessionTraceLogPurge. Internal-only — no partner-facing surface reads this table.';

-- ─── 2. partner_sessions schema changes (§6.4) ──────────────────────────────────────────────────────

ALTER TABLE partner_sessions ADD COLUMN IF NOT EXISTS reseller_unique_id TEXT;
ALTER TABLE partner_sessions ADD COLUMN IF NOT EXISTS hume_config_id TEXT;

-- Open Item 2's actual enforcement mechanism: a partial unique index, scoped per-reseller
-- (partner_account_id). A replay of the same (partner_account_id, reseller_unique_id) pair fails
-- this exact insert with a Postgres unique-violation (23505), which the route catches and branches
-- on to return the original session's response instead of dispatching a second bot join.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_sessions_reseller_unique_id
  ON partner_sessions(partner_account_id, reseller_unique_id)
  WHERE reseller_unique_id IS NOT NULL;

COMMENT ON COLUMN partner_sessions.reseller_unique_id IS
  'B2B-38: optional, reseller-supplied idempotency key for this specific session-creation request.
  Uniqueness enforced per-reseller (idx_partner_sessions_reseller_unique_id) — a replay with the same
  (partner_account_id, reseller_unique_id) returns the original session response instead of creating
  a new row or dispatching a second bot join.';
COMMENT ON COLUMN partner_sessions.hume_config_id IS
  'B2B-38: the Hume native config id actually provisioned for this session (lib/partner/live-render.ts,
  provisionNativeConfig()). Best-effort, non-fatal write — null if provisioning failed or never ran.';

-- ─── 3. partner_session_insights + glitch_instances (§6.9, Question 3) ─────────────────────────────

ALTER TABLE partner_session_insights ADD COLUMN IF NOT EXISTS reseller_unique_id TEXT;
ALTER TABLE partner_session_insights ADD COLUMN IF NOT EXISTS hume_config_id TEXT;
-- end_client_id already exists (migration 095) — reused, not re-added.

ALTER TABLE glitch_instances ADD COLUMN IF NOT EXISTS reseller_id UUID;
ALTER TABLE glitch_instances ADD COLUMN IF NOT EXISTS end_client_id UUID;
ALTER TABLE glitch_instances ADD COLUMN IF NOT EXISTS reseller_unique_id TEXT;
ALTER TABLE glitch_instances ADD COLUMN IF NOT EXISTS hume_config_id TEXT;
-- No new column for clio_session_ref — glitch_instances.partner_session_id already IS the session's
-- id (== clio_session_ref, per partner_sessions' own "id UUID PRIMARY KEY -- == clio_session_ref"
-- column comment, migration 071 line 175).

COMMENT ON COLUMN glitch_instances.reseller_id IS
  'B2B-38: copied from partner_session_insights.partner_account_id by fanout_glitch_instances() —
  always equal to partner_account_id on this row (see partner_session_trace_logs.reseller_id''s own
  comment for why this is still a separately-named column). Internal-only — never partner-facing.';
COMMENT ON COLUMN glitch_instances.end_client_id IS
  'B2B-38: copied from partner_session_insights.end_client_id by fanout_glitch_instances() (fixes a
  pre-existing gap — migration 095 added end_client_id to partner_session_insights but the trigger was
  never updated to copy it here). Internal-only — never partner-facing.';
COMMENT ON COLUMN glitch_instances.reseller_unique_id IS
  'B2B-38: copied from partner_session_insights.reseller_unique_id by fanout_glitch_instances(). Internal-only — never partner-facing.';
COMMENT ON COLUMN glitch_instances.hume_config_id IS
  'B2B-38: copied from partner_session_insights.hume_config_id by fanout_glitch_instances(). Internal-only — never partner-facing.';

-- Re-create the fan-out trigger function to also copy the 4 new trace columns. Guard logic
-- (capture-only, never re-fires on the daily JSONB purge rewrite) is unchanged from migration 082 —
-- see that migration's own header comment for why the OLD.glitches IS NOT NULL check excludes the
-- purge rewrite.
CREATE OR REPLACE FUNCTION fanout_glitch_instances()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.glitches IS NULL OR jsonb_array_length(NEW.glitches) = 0 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.glitches IS NOT NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO glitch_instances (
    partner_session_id, partner_account_id, glitch_type, description, ordinal, extracted_at,
    reseller_id, end_client_id, reseller_unique_id, hume_config_id
  )
  SELECT
    NEW.partner_session_id,
    NEW.partner_account_id,
    g.value->>'type',
    g.value->>'description',
    (g.ordinality - 1)::int,
    COALESCE(NEW.extracted_at, now()),
    NEW.partner_account_id,      -- reseller_id — always equal to partner_account_id, §6.1
    NEW.end_client_id,
    NEW.reseller_unique_id,
    NEW.hume_config_id
  FROM jsonb_array_elements(NEW.glitches) WITH ORDINALITY AS g(value, ordinality)
  ON CONFLICT (partner_session_id, ordinal) DO NOTHING;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- One-time backfill for pre-existing rows (this dev/staging DB may already have test rows from
-- prior work — zero real production rows exist as of this writing, per the CEO brief's own
-- verification, but backfilling is nearly free and matches migration 082's own precedent backfill).
UPDATE glitch_instances gi
SET reseller_id = psi.partner_account_id,
    end_client_id = psi.end_client_id,
    reseller_unique_id = psi.reseller_unique_id,
    hume_config_id = psi.hume_config_id
FROM partner_session_insights psi
WHERE gi.partner_session_id = psi.partner_session_id;

-- ─── 4. Purge RPC for partner_session_trace_logs (§6.7) ────────────────────────────────────────────
-- Full row DELETE (Open Item 4), not redact-in-place — this table has no free-text transcript/glitch
-- detail to selectively strip while preserving structured fields; every column here IS the
-- structured metadata. Cutoff basis: created_at (session-creation time), not ended_at — a session
-- that never reaches a terminal status has a null ended_at forever and would never be purged if the
-- cutoff were ended_at-based.

CREATE OR REPLACE FUNCTION purge_partner_session_trace_logs(p_cutoff TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM partner_session_trace_logs WHERE created_at < p_cutoff RETURNING id
  )
  SELECT count(*) INTO v_count FROM deleted;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_partner_session_trace_logs IS
  'B2B-38: called daily by inngest/partner-session-trace-log.ts (partnerSessionTraceLogPurge, cron
  0 3 * * * UTC) with p_cutoff = now() - 60 days. Full row DELETE, not redact — Open Item 4.';
