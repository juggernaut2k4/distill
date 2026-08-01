-- =============================================================================
-- Persist which voice provider actually ran each session (2026-08-01)
--
-- Root cause this fixes: inngest/partner-session-insights-extractor.ts always calls
-- Hume's transcript-fetch API, with no idea whether a given session was actually
-- voiced by Hume or OpenAI Realtime -- every OpenAI session's extraction fails
-- (confirmed live: Hume rejects the OpenAI session id as "not a valid UUID").
--
-- The global system_voice_config toggle (migration 104) tells you what's active
-- RIGHT NOW -- it can change between when a session ran and when its extraction
-- job runs later, so extraction must not re-read the current toggle. Instead, the
-- provider actually used is captured once, per session, at render time (the same
-- moment page.tsx already calls getActiveVoiceProvider()), and extraction reads
-- THAT stored value.
--
-- NULL means Hume -- every session created before this column existed only ever
-- ran on Hume (OpenAI didn't exist as an option yet), so this is byte-identical
-- for all existing rows and requires no backfill.
-- =============================================================================

ALTER TABLE partner_sessions
  ADD COLUMN IF NOT EXISTS voice_provider TEXT NULL
  CHECK (voice_provider IS NULL OR voice_provider IN ('hume', 'openai_realtime'));

COMMENT ON COLUMN partner_sessions.voice_provider IS 'Which voice provider actually ran this session, captured once at render time from the system_voice_config toggle (lib/voice/provider-config.ts''s getActiveVoiceProvider()). NULL means hume -- every pre-existing session. Read by inngest/partner-session-insights-extractor.ts to decide which transcript-fetch path to use; must never be re-derived from the CURRENT global toggle, which can differ from what this session actually used.';
