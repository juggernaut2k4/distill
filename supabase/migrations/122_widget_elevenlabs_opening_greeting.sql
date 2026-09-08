-- =============================================================================
-- Widget ElevenLabs channel — configurable opening greeting (first_message fix)
-- Requirement: widget ElevenLabs sessions greet the participant by name via prompt
-- rule 1a ("Greet {name}"), but ElevenLabs speaks its own static, un-personalized
-- `first_message` as the literal opening line BEFORE the model ever acts on that
-- rule — so the name greeting was pre-empted and never landed. Fix overrides
-- `overrides.agent.firstMessage` too (computed server-side, name substituted in),
-- alongside the existing `agent.prompt.prompt` override.
--
-- NOT filed under the "B2B-80" id: that id is already assigned, migrated
-- (116_b2b80_sales_partner_leads.sql), and committed to a completely different,
-- explicitly-deferred feature ("Sales-Partner Acquisition: Retire Self-Serve, Add
-- Contact-Us Lead Capture" — .claude/agents/clio/feature-briefs/B2B-80-sales-partner-invite-only-contact-us-lead-capture.md).
-- The build task that produced this migration referenced a Feature Brief path
-- ("B2B-80-widget-elevenlabs-name-greeting-first-message-conflict.md") that does
-- not exist anywhere in this repo — see this build's own report for the full
-- discrepancy. This migration is filed under a plain descriptive name instead of
-- reusing (or renumbering into) the taken B2B-80 id, to avoid confusing this
-- change with that unrelated, already-shipped one.
--
-- Adds exactly one new column, following partner_prompt_config's own established
-- per-field pattern (migration 080_b2b11_prompt_behavior_and_join_greeting.sql):
-- a JSONB dual-mode {mode, text} field, NULL = unconfigured (Clio's own default
-- literal applies — see DEFAULT_OPENING_GREETING in lib/partner/prompt-config.ts).
--
-- Added here (not left code-only) because lib/partner/prompt-config.ts's
-- upsertPromptConfig() always writes ALL columns on every upsert call, regardless
-- of which fields the patch actually touches — without this column existing in
-- the live table, every partner_prompt_config upsert (not just opening-greeting
-- writes) would start failing once this build's prompt-config.ts change lands.
-- =============================================================================

ALTER TABLE partner_prompt_config
  ADD COLUMN IF NOT EXISTS opening_greeting JSONB
    CHECK (opening_greeting IS NULL OR opening_greeting ->> 'mode' IN ('literal', 'instruction'));

COMMENT ON COLUMN partner_prompt_config.opening_greeting IS 'Widget ElevenLabs channel: dual-mode text sent verbatim (after {firstName}/{assistantName} substitution) as overrides.agent.firstMessage on Conversation.startSession(...) (lib/voice/elevenlabs-adapter.ts), computed server-side via assembleWidgetElevenLabsFirstMessage() (lib/voice/widget-elevenlabs-prompt-rules.ts). NULL = unconfigured — DEFAULT_OPENING_GREETING (lib/partner/prompt-config.ts) applies. Distinct from join_greeting: this is ElevenLabs'' own platform-spoken first_message field, delivered before the model ever takes a turn and never interpreted by the LLM, not a mid-call system-prompt injection.';
