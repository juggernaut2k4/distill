-- Add pending_transcript column to walkthrough_state.
-- Written by the Recall.ai webhook when a participant speaks.
-- Polled by WalkthroughClient, which sends the text to the ElevenLabs
-- agent via sendUserMessage() and then clears this column.
ALTER TABLE walkthrough_state ADD COLUMN IF NOT EXISTS pending_transcript TEXT;
