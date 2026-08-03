-- B2B-70/71 hotfix — partner_sessions.meeting_url was created NOT NULL (migration 071, back when the
-- meeting-bot channel was the only delivery channel). The widget channel (migration 108/109) never
-- has a meeting_url at all — there is no meeting platform involved — but the widget-sessions
-- insert (app/api/partner/v1/widget-sessions/route.ts) was never updated to account for this
-- pre-existing constraint. Every real dispatch attempt failed with "null value in column
-- meeting_url... violates not-null constraint" (confirmed live via Vercel runtime logs, 2026-08-03,
-- Arun's first live test of B2B-71). Meeting-bot sessions are completely unaffected — they always
-- supply a real meeting_url, this only relaxes the constraint for the (already existing, but
-- previously broken) case where a row genuinely has none.

ALTER TABLE partner_sessions ALTER COLUMN meeting_url DROP NOT NULL;
