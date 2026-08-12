-- B2B-78 (docs/specs/B2B-78-requirement-document.md §6.5) — RPCs backing
-- inngest/bot-dispatch-reservation-cleanup.ts. Mirrors purge_partner_session_trace_logs' own
-- RETURNING-into-CTE-count pattern (migration 099).

CREATE OR REPLACE FUNCTION expire_bot_dispatch_reservations(p_cutoff TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE bot_dispatch_reservations
    SET status = 'expired'
    WHERE status = 'reserved' AND expires_at < p_cutoff
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION expire_bot_dispatch_reservations IS
  'B2B-78: called every 5 minutes by inngest/bot-dispatch-reservation-cleanup.ts
  (botDispatchReservationCleanup) with p_cutoff = now(). Marks abandoned reservations expired —
  never deletes, kept for diagnostic visibility.';

CREATE OR REPLACE FUNCTION purge_bot_dispatch_reservations(p_cutoff TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM bot_dispatch_reservations WHERE created_at < p_cutoff RETURNING id
  )
  SELECT count(*) INTO v_count FROM deleted;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_bot_dispatch_reservations IS
  'B2B-78: called daily by inngest/bot-dispatch-reservation-cleanup.ts (botDispatchReservationPurge,
  cron 0 3 * * * UTC) with p_cutoff = now() - 60 days. Full row DELETE, pure storage hygiene —
  mirrors purge_partner_session_trace_logs'' own 60-day precedent.';
