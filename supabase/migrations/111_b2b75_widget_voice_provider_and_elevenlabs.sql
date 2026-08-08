-- =============================================================================
-- B2B-75 — ElevenLabs as a widget-only voice provider
-- Requirement Doc: docs/specs/B2B-75-requirement-document.md
-- Feature Brief: .claude/agents/clio/feature-briefs/B2B-75-elevenlabs-widget-voice-provider.md
--
-- Three changes, one migration:
--
--   1. system_voice_config.widget_provider — a SEPARATE provider setting for the
--      widget channel. This is the whole point of the feature's Decision D2:
--      active_provider is read by BOTH app/(with-clerk)/widget-render/.../page.tsx
--      AND app/(with-clerk)/partner-render/.../page.tsx, so widening its domain to
--      include 'elevenlabs' would route inline/meeting-bot sessions to a provider
--      with no adapter wiring and no prompt on that path. active_provider keeps its
--      existing two-value domain and keeps driving partner-render, completely
--      unchanged. widget_provider is read ONLY by widget-render.
--
--   2. ElevenLabs platform credentials on the same singleton row. The API key is an
--      OUTBOUND credential (Clio replays it to ElevenLabs), so it is stored
--      ENCRYPTED-AND-RETRIEVABLE via lib/partner/crypto.ts's AES-256-GCM
--      encryptOutboundToken() -- never hashed. The agent id is NOT a secret and is
--      stored plaintext.
--
--   3. partner_sessions.voice_provider CHECK widened to accept 'elevenlabs', since
--      widget-render/page.tsx writes this per-session snapshot for the widget channel
--      too (migration 106), and inngest/partner-session-insights-extractor.ts reads it
--      to decide which transcript path to use.
-- =============================================================================

-- ── 1. Widget-scoped provider setting ────────────────────────────────────────
--
-- Deliberately added NULLABLE with NO DEFAULT, then backfilled by COPYING the
-- current active_provider value, then set NOT NULL. A `NOT NULL DEFAULT 'hume'`
-- would silently seed the wrong value: the widget is believed to be running
-- OpenAI Realtime today (the entire widget-v21 prompt work is widget-specific and
-- OpenAI-specific), so a hardcoded default would regress it the moment this
-- deploys. Copying is correct under ANY current value of active_provider, which a
-- literal default can never be.
ALTER TABLE system_voice_config
  ADD COLUMN IF NOT EXISTS widget_provider TEXT NULL;

UPDATE system_voice_config
  SET widget_provider = active_provider
  WHERE widget_provider IS NULL;

ALTER TABLE system_voice_config
  ALTER COLUMN widget_provider SET NOT NULL;

ALTER TABLE system_voice_config
  ADD CONSTRAINT system_voice_config_widget_provider_check
  CHECK (widget_provider IN ('hume', 'openai_realtime', 'elevenlabs'));

-- ── 2. ElevenLabs platform credentials (singleton, platform-level per D1) ────
ALTER TABLE system_voice_config
  ADD COLUMN IF NOT EXISTS elevenlabs_api_key_ciphertext TEXT NULL;

ALTER TABLE system_voice_config
  ADD COLUMN IF NOT EXISTS elevenlabs_agent_id TEXT NULL;

-- Seed Arun's REAL, already-built, Playground-validated Clio agent. Per his direct
-- instruction: "agent details are shared already as well so you can seed it now and
-- i can update it from admin dashboard in future if needed."
--
-- An agent id is a plain identifier, NOT a secret (Known Constraint C5), so it is
-- stored plaintext and committed here in the open exactly like any other non-secret
-- configuration constant. The API key is NOT seeded and never will be -- it stays
-- empty until Arun enters it in the admin card.
--
-- Guarded on IS NULL so re-running this migration can never clobber a value Arun has
-- since changed from the admin dashboard.
UPDATE system_voice_config
  SET elevenlabs_agent_id = 'agent_0701krp1ta48fswrff17ctb0520m'
  WHERE elevenlabs_agent_id IS NULL;

-- ── 3. Per-session provider snapshot: widen to accept the new value ─────────
ALTER TABLE partner_sessions
  DROP CONSTRAINT IF EXISTS partner_sessions_voice_provider_check;

ALTER TABLE partner_sessions
  ADD CONSTRAINT partner_sessions_voice_provider_check
  CHECK (voice_provider IS NULL OR voice_provider IN ('hume', 'openai_realtime', 'elevenlabs'));

-- ── Comments ────────────────────────────────────────────────────────────────
COMMENT ON COLUMN system_voice_config.widget_provider IS 'B2B-75: which voice provider NEW WIDGET-CHANNEL sessions use. Read ONLY by app/(with-clerk)/widget-render/[clio_session_ref]/page.tsx via lib/voice/provider-config.ts''s getWidgetVoiceProvider(). Deliberately separate from active_provider, which is ALSO read by partner-render/[clio_session_ref]/page.tsx and must keep its two-value domain so the inline/meeting-bot channel can never be routed to a provider it has no wiring for (Requirement Doc D2/§6.1). Seeded at migration time by COPYING active_provider, never from a hardcoded default.';
COMMENT ON COLUMN system_voice_config.elevenlabs_api_key_ciphertext IS 'B2B-75: ElevenLabs API key, encrypted at the application layer with lib/partner/crypto.ts''s encryptOutboundToken() (AES-256-GCM, v1:<iv>:<tag>:<data>). An OUTBOUND credential Clio must replay to ElevenLabs when minting a per-session conversation token, therefore encrypted-and-retrievable and NEVER hashed. Decrypted server-side only, inside app/api/elevenlabs-token/route.ts. Never returned by any API response, never logged, never sent to the browser.';
COMMENT ON COLUMN system_voice_config.elevenlabs_agent_id IS 'B2B-75: the id of Arun''s pre-existing, pre-configured, Playground-validated Clio agent in the ElevenLabs dashboard. Seeded by this migration with the real value (agent_0701krp1ta48fswrff17ctb0520m) per Arun''s direct instruction; editable from /dashboard/admin thereafter. NOT a secret -- stored plaintext, returned by GET /api/admin/widget-voice-config and shown normally in the admin UI. One base agent is referenced by every widget session; per-conversation customization uses conversation_config_override, never agent cloning (Known Constraint C2).';
COMMENT ON CONSTRAINT partner_sessions_voice_provider_check ON partner_sessions IS 'B2B-75: widened from (hume, openai_realtime) to include elevenlabs. Widget sessions write this snapshot at render time and inngest/partner-session-insights-extractor.ts reads it to route transcript retrieval; without this the widget render page''s own voice_provider write would fail for ElevenLabs sessions.';
