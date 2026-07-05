-- HUME-NATIVE-01 (Phase A spike) — net-new, additive columns on `sessions` only.
-- Toggle-gated, isolated feature: no existing column is modified or dropped,
-- no existing constraint is touched. Default values guarantee a session row
-- untouched by this feature reads exactly as it did before this migration.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hume_chat_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hume_native_config_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hume_native_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sessions_hume_chat_id
  ON sessions(hume_chat_id) WHERE hume_chat_id IS NOT NULL;
