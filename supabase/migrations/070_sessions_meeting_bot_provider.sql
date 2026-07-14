-- ATTENDEE-MIGRATION Gap 3: record which meeting-bot provider actually ran a
-- session, so the post-session quality evaluator (inngest/session-quality-
-- evaluator.ts) and the RTV-03 accuracy evaluator (inngest/rtv03-accuracy-
-- evaluator.ts) know which provider's transcript API to call.
--
-- Written once, at bot-creation time, by whichever call site invoked
-- getMeetingBotProvider().createBot() for this session (inngest/session-
-- meeting-setup.ts and app/api/admin/test-session/route.ts) — using the
-- provider active on that createBot() call rather than the current global
-- default, so a later provider switch never misattributes an
-- already-in-flight or already-completed session.
--
-- NULL means "pre-migration row, created before this column existed."
--
-- CORRECTED 2026-07-13: the original version of this comment assumed every
-- pre-migration row ran on Recall.ai. That's wrong — Attendee was actually
-- the live production provider from 2026-07-04 onward, before this column
-- existed. Do NOT treat NULL as a safe stand-in for 'recall' without first
-- checking created_at against that date. Rows with created_at < 2026-07-04
-- are safely 'recall'. Rows with created_at >= 2026-07-04 and NULL here need
-- explicit backfill investigation (see docs/b2b-pivot-status.md, backfill
-- task) before evaluators can trust which transcript API to call for them.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS meeting_bot_provider TEXT;

COMMENT ON COLUMN sessions.meeting_bot_provider IS
  'Meeting bot provider that ran this session (recall | attendee | agentcall). NULL = pre-migration row. NOTE 2026-07-13: NULL does NOT reliably mean recall -- Attendee was live in production from 2026-07-04, before this column existed. Any row with created_at >= 2026-07-04 and NULL here needs backfill investigation, not a blind recall assumption. See docs/b2b-pivot-status.md task on backfill.';
