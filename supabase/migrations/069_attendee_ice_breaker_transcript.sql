-- ATTENDEE-MIGRATION Gap 2: dedicated participant-transcript capture for Attendee.
--
-- Recall's webhook writes live participant speech into pending_transcript, which
-- WalkthroughClient polls to reset its silence-escalation clock ("either side
-- spoke"). Attendee's webhook deliberately does NOT write participant speech into
-- pending_transcript (see comment in app/api/attendee/webhook/route.ts) because
-- that field was historically also used to forward text to the voice agent, and
-- a future re-wiring of that forwarding path could cause Clio to respond twice
-- to the same utterance. That design decision is preserved as-is (product-owner
-- flagged as needing a follow-up decision — see migration comment below).
--
-- However, the ice-breaker response feature (distill/session.ice-breaker.response)
-- needs SOME record of what the participant last said, captured independently of
-- pending_transcript, so Attendee sessions can reach feature parity with Recall
-- for ice-breaker signal extraction. This column is that dedicated, isolated
-- capture point — it is never polled by WalkthroughClient and never forwarded to
-- the voice agent, so it carries none of the double-response risk noted above.
ALTER TABLE walkthrough_state ADD COLUMN IF NOT EXISTS last_participant_transcript TEXT;

COMMENT ON COLUMN walkthrough_state.last_participant_transcript IS
  'Last participant speech captured by the Attendee webhook (transcript.update), used only for ice-breaker response signal extraction at call end. Not polled by the client and not forwarded to the voice agent — separate from pending_transcript by design.';
