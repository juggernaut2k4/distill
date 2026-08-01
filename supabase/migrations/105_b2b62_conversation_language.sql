-- =============================================================================
-- B2B-62 — Multi-language live sessions (English content, spoken in another language)
--
-- Adds one nullable column to partner_sessions: the language Clio should CONDUCT the
-- conversation in, independent of the (always-English) source content supplied via
-- content_ref/content_pages. NULL (the default for every existing row and every new
-- session that omits it) means English — byte-identical to today's behavior, no prompt
-- change, no eligibility-gating change (see lib/voice/hume-native/prompt-template.ts's
-- buildLanguageInstruction() and PartnerRenderClient.tsx's conversationLanguage gating).
--
-- Free-text, not an enum: Claude/gpt-realtime both already understand plain-language
-- names ("french", "Spanish", "mandarin") without a fixed vocabulary to maintain here.
-- =============================================================================

ALTER TABLE partner_sessions
  ADD COLUMN IF NOT EXISTS conversation_language TEXT NULL;

COMMENT ON COLUMN partner_sessions.conversation_language IS 'B2B-62: language Clio conducts this session in (e.g. "french"). NULL means English — the default for every existing and future unspecified session. Source content (content_ref/content_pages) always stays English regardless of this field; the model translates/explains it live. Also gates lib/content/transition-markers.ts''s two-stage transcript-watch cue off (falls back to the advance_tab tool call alone) for any non-English session, since matchesSpokenPhrase/wordTokens are ASCII-only and cannot correctly match accented-language transcripts.';
