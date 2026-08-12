-- B2B-78 (docs/specs/B2B-78-requirement-document.md §6.3/§6.4) — schema for the new two-stage
-- production pipeline: bot-dispatch (a passcode-authenticated reservation stage) + bot-sessions
-- (the existing widget-sessions shape, claiming that reservation). Four new tables plus one
-- additive column on the existing partner_api_keys table.

-- ─── BOT_CATALOG_AGENTS (layer 2 of D20's three-layer bot_id indirection) ─────────────────────
-- Clio-curated, admin-managed catalog of available voices, grouped by language. Never
-- sales-partner-writable — only an admin-run seed/migration ever inserts a row here.
CREATE TABLE IF NOT EXISTS bot_catalog_agents (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_name          TEXT NOT NULL UNIQUE,   -- e.g. 'clio_english'
  language              TEXT NOT NULL,          -- e.g. 'English' — display grouping only
  -- No DB-level FK: ELEVENLABS_VOICE_OPTIONS (lib/voice/elevenlabs-agents.ts) is a TypeScript
  -- array, not a table — elevenlabs_voice_key is matched at the application layer against that
  -- array's own `voice` field by getElevenLabsAgentIdForVoice(). Plain TEXT rather than a CHECK
  -- enumerating known keys, so adding a new voice never needs its own migration — correctness is
  -- guaranteed by construction since only an admin-managed seed ever writes this column.
  elevenlabs_voice_key  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bot_catalog_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on bot_catalog_agents"
  ON bot_catalog_agents FOR ALL
  USING (auth.role() = 'service_role');

INSERT INTO bot_catalog_agents (catalog_name, language, elevenlabs_voice_key) VALUES
  ('clio_english', 'English', 'catherine_us_english'),
  ('clio_hindi', 'Hindi', 'anjura_hindi'),
  ('clio_tamil', 'Tamil', 'vani_tamil')
ON CONFLICT (catalog_name) DO NOTHING;

-- ─── BOT_ALIAS_MAPPINGS (layer 3 — per-sales-partner alias) ───────────────────────────────────
-- A sales-partner's own chosen name for a catalog agent they've enabled. Resolution at
-- bot-sessions request time is always scoped to the authenticated sales-partner's own
-- partner_account_id, so two different sales-partners can independently reuse the same alias
-- string with no collision.
CREATE TABLE IF NOT EXISTS bot_alias_mappings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id    UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  bot_catalog_agent_id  UUID NOT NULL REFERENCES bot_catalog_agents(id),
  alias                 TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_account_id, alias)
);

ALTER TABLE bot_alias_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on bot_alias_mappings"
  ON bot_alias_mappings FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX idx_bot_alias_mappings_account ON bot_alias_mappings(partner_account_id);

-- ─── DISPATCH_PASSCODES ────────────────────────────────────────────────────────────────────────
-- Mirrors demo_passcodes' proven shape (migration 100) exactly. One active passcode per
-- sales-partner/client pairing at a time — regenerating revokes the old one rather than deleting
-- it (soft-invalidation, matching this codebase's general convention).
CREATE TABLE IF NOT EXISTS dispatch_passcodes (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id       UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE, -- sales-partner
  client_id                UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE, -- the client
  passcode_hash            TEXT NOT NULL,
  passcode_prefix          TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at               TIMESTAMPTZ,
  created_by_clerk_user_id TEXT
);

ALTER TABLE dispatch_passcodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on dispatch_passcodes"
  ON dispatch_passcodes FOR ALL
  USING (auth.role() = 'service_role');

CREATE UNIQUE INDEX idx_dispatch_passcodes_active_per_pairing
  ON dispatch_passcodes(partner_account_id, client_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX idx_dispatch_passcodes_hash ON dispatch_passcodes(passcode_hash);

-- ─── BOT_DISPATCH_RESERVATIONS ─────────────────────────────────────────────────────────────────
-- The new reservation row bot-dispatch creates. Its own id IS the session_id returned to the
-- caller, and becomes partner_sessions.id unchanged (not regenerated) at the moment bot-sessions
-- successfully claims it — see B2B-78 §6.2.
--
-- Per B2B-77's PII rule (C4), end_user_name here is the one approved exception — identical
-- treatment to its handling on partner_sessions. No other end_user-identifying field is ever
-- written to this table.
CREATE TABLE IF NOT EXISTS bot_dispatch_reservations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(), -- == session_id
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id), -- sales-partner
  client_id           UUID NOT NULL REFERENCES partner_accounts(id), -- resolved from the passcode
  end_user_name       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'reserved'
                        CHECK (status IN ('reserved', 'claimed', 'expired')),
  expires_at          TIMESTAMPTZ NOT NULL,  -- created_at + 15 minutes, per §6.5
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at          TIMESTAMPTZ
);

ALTER TABLE bot_dispatch_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on bot_dispatch_reservations"
  ON bot_dispatch_reservations FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX idx_bot_dispatch_reservations_expiry ON bot_dispatch_reservations(status, expires_at)
  WHERE status = 'reserved';

-- ─── PARTNER_API_KEYS — one additive column ────────────────────────────────────────────────────
-- NULL (the default) preserves every existing key's current behavior unchanged — a whole-account
-- key, exactly as every direct-partner key already is today. A non-NULL value is the new
-- sales-partner-self-service per-client key: partner_account_id stays the sales-partner's own
-- account (so wallet/billing resolution still rolls up correctly to the sales-partner), while
-- scoped_client_id narrows which client_id body value that key may be used with —
-- requirePartnerApiKey enforces the match (403 client_scope_mismatch on mismatch).
ALTER TABLE partner_api_keys ADD COLUMN IF NOT EXISTS scoped_client_id UUID REFERENCES partner_accounts(id);
