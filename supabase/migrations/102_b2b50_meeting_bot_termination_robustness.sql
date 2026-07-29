-- B2B-50 — Meeting-Bot Termination Robustness
-- See docs/specs/B2B-50-requirement-document.md §6.4-6.7 and the CEO Feature Brief
-- (.claude/agents/clio/feature-briefs/B2B-50-meeting-bot-termination-robustness.md).

ALTER TABLE partner_sessions
  ADD COLUMN IF NOT EXISTS active_participant_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN partner_sessions.active_participant_count IS
  'B2B-50: running count of non-bot participants believed currently present in the meeting, maintained
   from Attendee''s participant_events.join_leave webhook (app/api/attendee/webhook/route.ts). Only
   ever a signal to ARM the participants-empty debounce (inngest/partner-participants-empty-debounce.ts)
   once it has been incremented at least once by a confirmed participant_joined event for this
   session — never trusted to end a session that has never observed a join event, since Attendee may
   not fire a join event for participants already present in the meeting before the bot joins (an
   unconfirmed vendor behavior). Floors at 0, never negative.';

-- B2B-50 §6.5 — atomic increment/decrement RPCs, avoiding a read-then-write race between concurrent
-- webhook deliveries for the same session. Both return the updated row in one round trip.

CREATE OR REPLACE FUNCTION increment_active_participant_count(p_session_id UUID)
RETURNS partner_sessions AS $$
  UPDATE partner_sessions
  SET active_participant_count = active_participant_count + 1
  WHERE id = p_session_id
  RETURNING *;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION decrement_active_participant_count(p_session_id UUID)
RETURNS partner_sessions AS $$
  UPDATE partner_sessions
  SET active_participant_count = GREATEST(0, active_participant_count - 1)
  WHERE id = p_session_id
  RETURNING *;
$$ LANGUAGE sql;

-- B2B-50 §6.7 — end_reason gains one new admitted value: 'all_participants_left', for a session ended
-- by the new participants-empty debounce mechanism. Follows the established DROP-then-ADD pattern
-- from migrations 077/079/083/087. Deliberately does NOT re-admit 'balance_exhausted'/
-- 'balance_limit_reached' — restoring those is the fix for a separate, out-of-scope finding
-- (§0.1 Finding B of the requirement doc), tracked as its own fast-follow, not folded in here.
ALTER TABLE partner_sessions DROP CONSTRAINT IF EXISTS partner_sessions_end_reason_check;
ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN (
    'trial_limit_reached', 'trial_exhausted', 'funding_required', 'card_required', 'all_participants_left'
  ));
