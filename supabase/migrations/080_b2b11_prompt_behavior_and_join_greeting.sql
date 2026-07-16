-- =============================================================================
-- B2B-11 — Prompt Behavior Configurability + Live Join Greeting
-- Requirement Doc: docs/specs/B2B-11-requirement-document.md (v1.1)
-- Feature Brief: .claude/agents/clio/feature-briefs/B2B-11-prompt-behavior-configurability-and-join-greeting.md
--
-- Two independent additions:
--
-- 1. New table `partner_prompt_config` — one row per partner_account_id.
--    Five dual-mode fields stored as JSONB `{mode: 'literal'|'instruction',
--    text: string}` (Section 4.3, Technical Decision 2), plus two plain TEXT
--    instruction-only fields (no literal mode by design). Mirrors
--    partner_theme_config's UNIQUE + upsert + RLS + updated_at-trigger shape
--    exactly (migration 074_b2b03_designer_configurator.sql). A separate
--    table, not new columns on partner_theme_config, because that table is
--    explicitly scoped to Level A visualization, not prompt behavior — see
--    Section 4.2, Technical Decision 1.
--
-- 2. Three new `partner_sessions` columns for the join-greeting mechanism
--    (Section 6.1). `assembled_prompt_snapshot` is the v1.1 CEO-review fix:
--    session_settings.system_prompt fully REPLACES (never merges/appends)
--    the active Hume prompt, so the join-greeting route must resend the full
--    assembled prompt plus the greeting addendum, never the addendum alone
--    (Section 6.1a, Technical Decision 6).
-- =============================================================================

CREATE TABLE IF NOT EXISTS partner_prompt_config (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id              UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,

  -- Dual-mode fields: {mode: 'literal' | 'instruction', text: string}.
  -- NULL = unconfigured — Clio's fixed default rule text applies unmodified
  -- (Section 4.1). CHECK constraints are DB-level defense in depth mirroring
  -- partner_theme_config's own CHECK-per-column style (Section 4.3).
  tone_persona                    JSONB CHECK (tone_persona IS NULL OR tone_persona ->> 'mode' IN ('literal', 'instruction')),
  deferral_phrasing               JSONB CHECK (deferral_phrasing IS NULL OR deferral_phrasing ->> 'mode' IN ('literal', 'instruction')),
  closing_confirmation_question   JSONB CHECK (closing_confirmation_question IS NULL OR closing_confirmation_question ->> 'mode' IN ('literal', 'instruction')),
  goodbye_line                    JSONB CHECK (goodbye_line IS NULL OR goodbye_line ->> 'mode' IN ('literal', 'instruction')),
  join_greeting                   JSONB CHECK (join_greeting IS NULL OR join_greeting ->> 'mode' IN ('literal', 'instruction')),

  -- Instruction-only fields — no literal mode by design (Feature Brief's own
  -- classification: rules 4 and 11 are "instruction-only candidates").
  verification_question_style     TEXT,
  inter_section_recap_style       TEXT,

  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_partner_prompt_config_updated_at
  BEFORE UPDATE ON partner_prompt_config
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_prompt_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_prompt_config"
  ON partner_prompt_config FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE partner_prompt_config IS 'B2B-11: partner-configurable Clio live-session prompt behaviors — five dual-mode (literal/instruction) fields and two instruction-only fields, one row per partner_account_id. A distinct concern from partner_theme_config (visualization Level A) — see Requirement Doc Section 4.2, Technical Decision 1.';
COMMENT ON COLUMN partner_prompt_config.tone_persona IS 'B2B-11: dual-mode override for the opening tone/persona sentence. Rendered via the [TONE GUIDANCE] placeholder, appended immediately after TONE_INSTRUCTION_ANCHOR (Section 4.4/4.5) — never before it, so the 7,000-char Hume voice-styling guardrail stays intact.';
COMMENT ON COLUMN partner_prompt_config.deferral_phrasing IS 'B2B-11: dual-mode override for rule 6 (off-topic/complex-question deferral). Rendered only inside the subordinate === PARTNER-CONFIGURED GUIDANCE === block, never inline in the fixed rule.';
COMMENT ON COLUMN partner_prompt_config.closing_confirmation_question IS 'B2B-11: dual-mode override for rule 8b (closing confirmation question).';
COMMENT ON COLUMN partner_prompt_config.goodbye_line IS 'B2B-11: dual-mode override for rule 8c''s goodbye line text only — the mandatory end_session tool call itself remains fixed and unconfigurable.';
COMMENT ON COLUMN partner_prompt_config.join_greeting IS 'B2B-11: dual-mode text for the live join greeting. NOT assembled into the upfront prompt — delivered live via sendWrapUpNudge() at participant-join time (Section 6). Supports a {firstName} substitution token.';
COMMENT ON COLUMN partner_prompt_config.verification_question_style IS 'B2B-11: instruction-only override for rule 4 (style/frequency of verification questions). No literal mode by design.';
COMMENT ON COLUMN partner_prompt_config.inter_section_recap_style IS 'B2B-11: instruction-only override for rule 11 (style/length of inter-section spoken recaps). No literal mode by design.';

-- Section 6.1 / 6.1a — join-greeting mechanism columns on partner_sessions.
ALTER TABLE partner_sessions
  ADD COLUMN IF NOT EXISTS join_greeting_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS join_greeting_participant_first_name TEXT,
  ADD COLUMN IF NOT EXISTS assembled_prompt_snapshot TEXT;

COMMENT ON COLUMN partner_sessions.join_greeting_pending IS 'B2B-11: set true by handlePartnerSessionEvent()''s participant_events.join_leave branch (app/api/attendee/webhook/route.ts) when a real participant joins. Consumed and cleared by PartnerRenderClient.tsx''s poll effect via GET/PATCH /api/partner/render/join-greeting/[clio_session_ref].';
COMMENT ON COLUMN partner_sessions.join_greeting_participant_first_name IS 'B2B-11: set alongside join_greeting_pending — the joining participant''s first name, used to build the {firstName}-substituted greeting text at poll time. Cleared back to NULL whenever join_greeting_pending is cleared.';
COMMENT ON COLUMN partner_sessions.assembled_prompt_snapshot IS 'B2B-11 (v1.1 CEO-review fix, Technical Decision 6): the full assembled Hume prompt, persisted by resolveLiveSessionRender() (lib/partner/live-render.ts) immediately after assembleHumeNativePrompt() runs, best-effort. Required because Hume''s session_settings.system_prompt message fully REPLACES (never merges/appends) the EVI session''s active prompt — the join-greeting route (app/api/partner/render/join-greeting/[clio_session_ref]/route.ts) must resend this full snapshot plus the greeting addendum, never the addendum alone, or it would silently wipe Clio''s entire active prompt (all 12 fixed rules, tool mechanics, AI-disclosure rule, mandatory end_session requirement, session content) for the remainder of the call.';
