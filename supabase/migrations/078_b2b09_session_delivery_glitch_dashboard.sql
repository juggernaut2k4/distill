-- B2B-09 — Session Delivery Extraction Fix + Internal Glitch Dashboard
-- Per docs/specs/B2B-09-requirement-document.md Section 6, architecture.md §16.
--
-- Additive only. Does NOT modify session_action_items (migration 073) or any of its columns/FKs —
-- the legacy sessions-table extractor is explicitly out of scope for this brief (Requirement Doc
-- Section 10, "no impact on existing" project rule).
--
-- Numbering note: 077 is B2B-08's testing/metering migration (landed concurrently with this
-- document's own research pass — supabase/migrations/077_b2b08_testing_metering.sql). Verified by
-- direct read that 077 does not touch webhook_dispatch_log, partner_sessions.hume_chat_id, or any
-- table this migration introduces — no overlap, this migration is simply the next free number.
--
-- Reconstructed 2026-07-15 from the exact SQL applied to Supabase (project nqxlpcshouboplhnuvrh) —
-- the local file was lost to a concurrent-agent git-stash collision after application; content is
-- authoritative (copied from the apply_migration call itself), not re-derived.

-- ─── 1. partner_sessions — the missing link (Requirement Doc Section 6) ────────────────────────────
-- Hume's chat_ended webhook can now resolve a partner session by hume_chat_id, exactly as it already
-- does for the legacy sessions table.

ALTER TABLE partner_sessions ADD COLUMN IF NOT EXISTS hume_chat_id TEXT;

CREATE INDEX IF NOT EXISTS idx_partner_sessions_hume_chat_id
  ON partner_sessions(hume_chat_id) WHERE hume_chat_id IS NOT NULL;

-- ─── 2. PARTNER_SESSION_INSIGHTS ────────────────────────────────────────────────────────────────────
-- Parallel in SHAPE to session_action_items (migration 073) — same idempotency-guard columns
-- (extraction_status/attempt_count/error_message) — but a genuinely separate table, keyed to
-- partner_sessions(id), not sessions(id). Carries partner_account_id directly so the glitch dashboard
-- never needs an extra join (Feature Brief's own explicit instruction). Adds psychology_keywords and
-- full_detail_purged_at, neither of which session_action_items has any equivalent of.
--
-- Bounded retention: action_items/glitches/psychology_keywords hold full detail for 30 days after
-- extracted_at (Requirement Doc Section 9), then the daily purge job (see function below) reduces
-- action_items/psychology_keywords to NULL and glitches to type-only, permanently. This is Arun's own
-- confirmed "Option A" resolution — full detail persists only long enough to guarantee reliable
-- webhook delivery, never indefinitely.

CREATE TABLE IF NOT EXISTS partner_session_insights (
  id                      UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  partner_session_id      UUID        NOT NULL REFERENCES partner_sessions(id) ON DELETE CASCADE,
  partner_account_id      UUID        NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  hume_chat_id            TEXT,

  extraction_status       TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (extraction_status IN ('pending', 'success', 'success_empty', 'failed')),

  action_items            JSONB       DEFAULT NULL,
  glitches                JSONB       DEFAULT NULL,
  psychology_keywords     JSONB       DEFAULT NULL,

  transcript_event_count  INTEGER     DEFAULT NULL,
  attempt_count            INTEGER     NOT NULL DEFAULT 0,
  error_message             TEXT        DEFAULT NULL,
  extracted_at               TIMESTAMPTZ DEFAULT NULL,
  full_detail_purged_at      TIMESTAMPTZ DEFAULT NULL,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_session_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_session_insights_session
  ON partner_session_insights(partner_session_id);

CREATE INDEX IF NOT EXISTS idx_partner_session_insights_account_time
  ON partner_session_insights(partner_account_id, extracted_at DESC);

CREATE INDEX IF NOT EXISTS idx_partner_session_insights_status
  ON partner_session_insights(extraction_status)
  WHERE extraction_status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_partner_session_insights_purge_eligibility
  ON partner_session_insights(extracted_at)
  WHERE full_detail_purged_at IS NULL AND extracted_at IS NOT NULL;

ALTER TABLE partner_session_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on partner_session_insights"
  ON partner_session_insights FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE partner_session_insights IS
  'B2B-09: per-partner-session extraction result (action items, glitches, psychology keywords). Full detail retained 30 days after extracted_at, then purged to type-only (glitches) / NULL (action_items, psychology_keywords) permanently by purge_partner_session_insights_full_detail(). Never the same table as session_action_items (migration 073).';

-- ─── 3. WEBHOOK_DISPATCH_LOG — widen event_type CHECK ──────────────────────────────────────────────
-- Adds this document's own 'session.insights_ready' AND closes B2B-04's still-open 'wallet.low_balance'
-- gap in the same migration.

ALTER TABLE webhook_dispatch_log DROP CONSTRAINT IF EXISTS webhook_dispatch_log_event_type_check;

ALTER TABLE webhook_dispatch_log ADD CONSTRAINT webhook_dispatch_log_event_type_check
  CHECK (event_type IN (
    'usage.voice_minute',
    'usage.llm_generation_call',
    'session.completed',
    'wallet.low_balance',
    'session.insights_ready'
  ));

-- ─── 4. Purge RPC ───────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purge_partner_session_insights_full_detail(p_cutoff TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH purged AS (
    UPDATE partner_session_insights
    SET
      action_items = NULL,
      psychology_keywords = NULL,
      glitches = CASE
        WHEN glitches IS NULL OR jsonb_array_length(glitches) = 0 THEN glitches
        ELSE (
          SELECT jsonb_agg(jsonb_build_object('type', g->>'type'))
          FROM jsonb_array_elements(glitches) AS g
        )
      END,
      full_detail_purged_at = now()
    WHERE full_detail_purged_at IS NULL
      AND extracted_at IS NOT NULL
      AND extracted_at < p_cutoff
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM purged;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_partner_session_insights_full_detail IS
  'B2B-09: called daily by inngest/partner-session-insights-extractor.ts (partnerSessionInsightsPurge, cron 0 3 * * * UTC) with p_cutoff = now() - 30 days. Returns the count of rows purged this run.';

-- ─── 5. Internal glitch dashboard summary RPC ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION glitch_summary_by_type_and_partner()
RETURNS TABLE(
  glitch_type text,
  partner_account_id uuid,
  partner_name text,
  count bigint,
  first_seen timestamptz,
  last_seen timestamptz
) AS $$
  SELECT
    g->>'type' AS glitch_type,
    psi.partner_account_id,
    pa.name AS partner_name,
    count(*) AS count,
    min(psi.extracted_at) AS first_seen,
    max(psi.extracted_at) AS last_seen
  FROM partner_session_insights psi
  CROSS JOIN LATERAL jsonb_array_elements(psi.glitches) AS g
  JOIN partner_accounts pa ON pa.id = psi.partner_account_id
  WHERE psi.glitches IS NOT NULL AND jsonb_array_length(psi.glitches) > 0
  GROUP BY g->>'type', psi.partner_account_id, pa.name
  ORDER BY count DESC;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION glitch_summary_by_type_and_partner IS
  'B2B-09: backs GET /api/admin/glitches/summary — the "this keeps failing" pattern-detection view (Requirement Doc Section 4.A Panel 1).';
