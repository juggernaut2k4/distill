-- B2B-76 §1.4 (item 4) — records which transcript source actually produced a given ElevenLabs
-- extraction's messageLines: 'elevenlabs_native' (the new native post-call fetch,
-- lib/voice/elevenlabs-native-transcript.ts) or 'redis_live_capture' (the existing, proven B2B-63
-- live-capture path, used as the fallback). NULL for every non-ElevenLabs session (Hume/OpenAI
-- Realtime each have exactly one transcript source — no "which one" question to answer).
--
-- Additive only. Per docs/specs/B2B-76... (see .claude/agents/clio/feature-briefs/
-- B2B-76-elevenlabs-reliability-followups.md §1.4) — the post-call availability delay for
-- ElevenLabs' native transcript endpoint could not be verified in any doc source; this column exists
-- so that question gets answered empirically from real production `transcript_source` values instead
-- of staying a guess forever.

ALTER TABLE partner_session_insights
  ADD COLUMN IF NOT EXISTS transcript_source TEXT DEFAULT NULL
    CHECK (transcript_source IS NULL OR transcript_source IN ('elevenlabs_native', 'redis_live_capture'));

COMMENT ON COLUMN partner_session_insights.transcript_source IS
  'B2B-76 §1.4: which transcript source actually produced this extraction''s input, for ElevenLabs sessions only. NULL for every other provider.';
