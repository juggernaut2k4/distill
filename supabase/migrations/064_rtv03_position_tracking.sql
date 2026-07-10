-- RTV-03: Live position-tracking state machine + transition cues (observe-only)
-- Additive only — no existing column or table is touched.
-- See .claude/agents/clio/requirement-docs/RTV-03-live-position-tracking.md
-- Section 6.2 for the full data-requirements rationale.

-- Per-session record of whether the RTV-03 tracker was active for this
-- specific session, independent of today's env var value (mirrors why
-- hume_native_enabled is persisted per-session rather than re-derived later).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtv03_tracking_enabled boolean;

-- One row per evaluated session, upserted by session_id (same idempotency
-- convention session-quality-evaluator.ts already relies on for its own
-- per-session writes).
CREATE TABLE IF NOT EXISTS rtv03_accuracy_reports (
  session_id                 UUID        PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  generated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  topics_total               INT         NOT NULL,
  topics_matched             INT         NOT NULL,
  max_topics_out_of_sync     INT         NOT NULL,
  self_correction_events     INT         NOT NULL,
  mean_abs_delta_seconds     NUMERIC,
  median_abs_delta_seconds   NUMERIC,
  max_delta_seconds          NUMERIC,
  per_topic                  JSONB       NOT NULL,
  transcript_fetch_error     TEXT
);

-- Service-role write/read only, matching session_billing_audit_log's
-- convention (migration 051) — no end-user access path needed (Section 6.2):
-- this is never read by any user-facing route, only the Clerk-authenticated
-- GET /api/admin/rtv03-accuracy-report endpoint, which uses the admin/
-- service-role Supabase client.
ALTER TABLE rtv03_accuracy_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert rtv03 accuracy reports"
  ON rtv03_accuracy_reports FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update rtv03 accuracy reports"
  ON rtv03_accuracy_reports FOR UPDATE
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can read rtv03 accuracy reports"
  ON rtv03_accuracy_reports FOR SELECT
  USING (auth.role() = 'service_role');
