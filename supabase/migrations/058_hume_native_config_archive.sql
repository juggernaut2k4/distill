-- HUME-NATIVE-01 Phase C — durable archive of a Hume-native session's Config
-- details and full transcript, written before the Hume-side Config is deleted.
-- Append-only: once a session's data is archived here, it is never updated —
-- this is the permanent record that survives independent of Hume's own retention.
-- Follows the exact RLS/append-only conventions of session_billing_audit_log
-- (migration 051) and minutes_ledger (migration 057).
--
-- Per docs/specs/HUME-NATIVE-01-phase-c-nightly-cleanup-requirement-doc.md
-- Section 6.3, with one correction applied per Arun's clarification: the
-- spec's cron/eligibility-window timezone assumption ("CST" = fixed UTC-6)
-- has been corrected to real America/Chicago local time (CST/CDT,
-- DST-aware) at the code level — see inngest/hume-native-nightly-cleanup.ts.
-- This migration's schema is unaffected by that correction.

CREATE TABLE IF NOT EXISTS hume_native_config_archives (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id           UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- Full raw response body from GET /v0/evi/configs/{id} at archive time — the
  -- complete Config document (prompt, voice settings, tool wiring, versions),
  -- captured verbatim since we lose access to it entirely once the Config is
  -- deleted on Hume's side.
  config_snapshot      JSONB       NOT NULL,

  -- Full concatenated array of every event returned by
  -- GET /v0/evi/chats/{chat_id}/events across all pages — the complete
  -- transcript, captured verbatim. This is the same data the (separately
  -- scoped) action-item/glitch extraction job (Section 4.8 of
  -- HUME-NATIVE-01-requirement-doc.md) consumes; this table is its durable
  -- source, not a duplicate of its own storage.
  transcript_events    JSONB       NOT NULL,

  -- The Hume config_id and chat_id this archive was captured from — kept
  -- alongside the snapshot (not just on `sessions`) so this row is a
  -- self-contained historical record even if `sessions` columns are ever
  -- restructured later.
  hume_config_id       TEXT        NOT NULL,
  hume_chat_id         TEXT        NOT NULL,

  -- Whether the DELETE /v0/evi/configs/{id} call that followed this archive
  -- succeeded (true), returned 404/already-deleted (true — treated as success
  -- per the non-fatal-404 rule), or the delete step itself failed after a
  -- successful archive write (false — an archive can exist with a Config
  -- still live on Hume's side if the delete sub-step failed; the next
  -- nightly run will retry only the delete, see requirement doc Section 7).
  hume_config_deleted  BOOLEAN     NOT NULL DEFAULT false,

  archived_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hume_native_config_archives_session
  ON hume_native_config_archives(session_id);

-- ─── APPEND-ONLY ENFORCEMENT (mirrors session_billing_audit_log / minutes_ledger) ───
ALTER TABLE hume_native_config_archives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hume native config archives"
  ON hume_native_config_archives FOR SELECT
  USING (
    auth.uid()::text = (SELECT user_id FROM sessions WHERE sessions.id = session_id)
  );

CREATE POLICY "Service role can insert hume native config archives"
  ON hume_native_config_archives FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can read all hume native config archives"
  ON hume_native_config_archives FOR SELECT
  USING (auth.role() = 'service_role');

-- Idempotency marker: set once a session's Config + transcript have been
-- durably archived AND the Hume-side Config delete step has been attempted
-- (success or non-fatal 404). NULL means "not yet processed by the nightly
-- cleanup job" — this is the sole gate the eligibility query checks.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hume_config_archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_hume_config_archived_at
  ON sessions(hume_config_archived_at) WHERE hume_config_archived_at IS NULL;
