-- Migration 006: Add pending_speech to walkthrough_state
-- Used by the WalkthroughClient to play TTS audio through the bot's headless browser.
-- The webhook sets this field; the client plays it and clears it.

ALTER TABLE walkthrough_state ADD COLUMN IF NOT EXISTS pending_speech TEXT;
