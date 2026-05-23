-- Stores Clio's full session coaching brief in walkthrough_state.
-- Built server-side at bot creation time and sent to ElevenLabs on connect.
ALTER TABLE walkthrough_state
  ADD COLUMN IF NOT EXISTS clio_session_context text DEFAULT NULL;
