-- B2B-34 Piece 1 — replaces psychology_keywords with the settled learner_insight shape (CEO-approved,
-- unchanged in this migration — see docs/specs/B2B-34-requirement-document.md Part C §6.3).
-- Confirmed zero live rows depend on the old column: partner_session_insights total row count = 0
-- (query below, run against project nqxlpcshouboplhnuvrh, 2026-07-23) — clean swap, no backfill needed.
--   SELECT count(*) FROM partner_session_insights;  -- => 0
-- Also confirmed (per the extractor file's own doc comment, read in full) psychology_keywords has never
-- been sent over the wire to any real partner webhook — it was always reconstructed live by
-- attemptDispatch() at delivery time from whatever the column currently holds, so there is no historical
-- delivered-payload record depending on the old shape either.

ALTER TABLE partner_session_insights DROP COLUMN IF EXISTS psychology_keywords;
ALTER TABLE partner_session_insights ADD COLUMN IF NOT EXISTS learner_insight JSONB DEFAULT NULL;

COMMENT ON COLUMN partner_session_insights.learner_insight IS
  'B2B-34 Piece 1 (replaces psychology_keywords, 2026-07-23): {summary, topics_of_interest[], engagement_style, suggested_next_topics[]} — an actionable read on what this learner cares about, replacing generic tone keywords. NULL when the source transcript had zero content (success_empty). Powers the demo /demo/{slug} Performance tab and, for opted-in partners, the session.insights_ready webhook. See docs/specs/B2B-34-requirement-document.md Part C.';

-- Purge RPC updated to purge learner_insight instead of psychology_keywords (CEO brief Q3, confirmed:
-- yes, the RPC's column list needs updating).
CREATE OR REPLACE FUNCTION purge_partner_session_insights_full_detail(p_cutoff TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH purged AS (
    UPDATE partner_session_insights
    SET
      action_items = NULL,
      learner_insight = NULL,
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
