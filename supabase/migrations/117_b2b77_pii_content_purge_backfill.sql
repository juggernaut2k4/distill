-- B2B-77 (docs/specs/B2B-77-requirement-document.md §6.4/§9) — one-time backfill for the
-- "no leftovers" purge extension applied in inngest/partner-session-insights-extractor.ts.
--
-- QA fix, 2026-08-11/12: confirmed live in production, during B2B-77/78/79 QA, that this
-- remediation had never actually shipped despite the requirement document being CEO-approved and
-- explicitly marking it "required, not optional." partner_sessions.end_user_role/end_user_industry
-- were being written at session creation and never nulled by any purge job on either code path
-- (success or permanent-failure), and meeting-bot sessions received no purge at all — not even the
-- content purge widget sessions already got. The application-code fix (extending the purge, and
-- dropping the widget-only guard per Arun's own 2026-08-11 reversal of his prior instruction — see
-- that spec section for the full recorded history) only affects sessions whose insights extraction
-- runs AFTER this deploy. This migration is the retroactive half: it sweeps every session whose
-- extraction already completed under the old, narrower purge.
--
-- Scope, precisely: only sessions where partner_session_insights.extraction_status indicates
-- extraction has already run to a terminal state ('success', 'success_empty', 'failed') — an
-- in-flight or not-yet-attempted extraction is left alone; the (now-fixed) Inngest job will purge
-- it correctly on its own next run, per the standing "no PII may persist past its own session"
-- rule.

-- Part 1 — end_user_role / end_user_industry / conversation_language, BOTH delivery channels.
-- (end_user_name is untouched — the one approved exception, unchanged by this brief.)
WITH extracted AS (
  SELECT DISTINCT partner_session_id
  FROM partner_session_insights
  WHERE extraction_status IN ('success', 'success_empty', 'failed')
)
UPDATE partner_sessions ps
SET end_user_role = NULL,
    end_user_industry = NULL,
    conversation_language = NULL
FROM extracted
WHERE ps.id = extracted.partner_session_id
  AND (ps.end_user_role IS NOT NULL OR ps.end_user_industry IS NOT NULL OR ps.conversation_language IS NOT NULL);

-- Part 2 — content_pages / content_to_explain / content_title / content_subtitle /
-- assembled_prompt_snapshot, extended to meeting-bot sessions specifically (widget sessions were
-- already covered by the pre-existing, narrower purge and so are already clean here in the
-- overwhelming majority of cases — this UPDATE is a harmless no-op re-null for any that aren't).
WITH extracted AS (
  SELECT DISTINCT partner_session_id
  FROM partner_session_insights
  WHERE extraction_status IN ('success', 'success_empty', 'failed')
)
UPDATE partner_sessions ps
SET content_pages = NULL,
    content_to_explain = NULL,
    content_title = NULL,
    content_subtitle = NULL,
    assembled_prompt_snapshot = NULL
FROM extracted
WHERE ps.id = extracted.partner_session_id
  AND (ps.content_pages IS NOT NULL OR ps.content_to_explain IS NOT NULL OR ps.content_title IS NOT NULL
       OR ps.content_subtitle IS NOT NULL OR ps.assembled_prompt_snapshot IS NOT NULL);
