-- =============================================================================
-- B2B-61 — System Voice Provider Config (Part B: persisted admin toggle)
-- Requirement Doc: docs/specs/B2B-61-requirement-document.md
-- Feature Brief: .claude/agents/clio/feature-briefs/B2B-61-openai-realtime-voice-adapter-and-admin-toggle.md
--
-- The FIRST global (non-partner_account_id-scoped) config table in this
-- codebase (confirmed by grep of every existing migration — see Requirement
-- Doc §0). Single row, fixed id, controls which live-voice provider new
-- partner sessions use platform-wide. Read server-side by
-- app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx at session
-- render time (via a new getActiveVoiceProvider() helper — see §6 below);
-- written only via PATCH /api/admin/voice-config (requireSuperAdmin-gated).
-- =============================================================================

CREATE TABLE IF NOT EXISTS system_voice_config (
  id                UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  active_provider   TEXT NOT NULL DEFAULT 'hume' CHECK (active_provider IN ('hume', 'openai_realtime')),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Singleton enforcement at the DB level, not just by application convention:
-- the only permitted primary key value is the fixed constant above, so a
-- second row can never be inserted regardless of what application code does.
ALTER TABLE system_voice_config
  ADD CONSTRAINT system_voice_config_singleton_id
  CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE TRIGGER update_system_voice_config_updated_at
  BEFORE UPDATE ON system_voice_config
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE system_voice_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on system_voice_config"
  ON system_voice_config FOR ALL
  USING (auth.role() = 'service_role');

-- Seed the single row so GET never has to special-case "no row yet."
INSERT INTO system_voice_config (id, active_provider)
VALUES ('00000000-0000-0000-0000-000000000001', 'hume')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE system_voice_config IS 'B2B-61: the first GLOBAL (non-partner-scoped) config table in this codebase — a single row controlling which live-voice provider new partner sessions use platform-wide. Not partner_account_id-scoped by design (Requirement Doc §0, §6). Written only via PATCH /api/admin/voice-config (requireSuperAdmin-gated).';
COMMENT ON COLUMN system_voice_config.active_provider IS 'B2B-61: hume (default, current sole live provider) or openai_realtime. The openai_realtime value is additionally gated at the API layer by OPENAI_REALTIME_ADAPTER_AVAILABLE (lib/voice/provider-availability.ts) until Part A''s adapter ships — the CHECK constraint alone intentionally allows it so the schema does not need a future migration when that flag flips.';
