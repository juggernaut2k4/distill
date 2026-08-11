-- 2026-08-10 — per-session ElevenLabs agent selection for the widget channel.
--
-- Per Arun's direct instruction: three separate ElevenLabs agents, each configured with its own
-- voice (Catherine — US English, Anjura — Hindi, Vani — Tamil), selectable at session-creation time
-- instead of the single system-wide default in system_voice_config. Nullable, no default — a null
-- value means "use the system-wide default agent," preserving every existing session's and every
-- other voice provider's behavior unchanged.
alter table partner_sessions add column if not exists elevenlabs_agent_id text;
