-- B2B-06: Partner Provisioning (self-serve signup, OAuth2 Client Credentials auth, self-serve
-- outbound-config UI, funding guardrail on POST /api/partner/v1/sessions). See
-- docs/specs/B2B-06-requirement-document.md and architecture.md §18 for full rationale.
-- 079 is the next-free migration number (078 is B2B-09, verified against this directory listing).

-- 1. partner_accounts: one new nullable column, keys a Clerk Organization to a partner account.
-- Nullable because internal-operator-provisioned accounts (v1/v2's recovery path, still preserved)
-- never have a Clerk Organization behind them.
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS clerk_org_id TEXT UNIQUE;

-- 2. partner_sessions.end_reason: extend the existing CHECK constraint (migration 077) with the
-- funding-guardrail's own rejection reason. Same DROP-then-ADD pattern 077 itself used against 075's
-- inline default-named constraint.
ALTER TABLE partner_sessions DROP CONSTRAINT IF EXISTS partner_sessions_end_reason_check;
ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN ('trial_limit_reached', 'trial_exhausted', 'funding_required'));

-- 3. New table: partner_oauth_clients. Mirrors partner_api_keys's proven security shape exactly
-- (Requirement Doc Section 6) — never store a plaintext secret, hash it; keep a safe-to-display
-- identifier; mode test/live split preserved for the same billing-exclusion reason it exists on
-- partner_api_keys. Deliberately NOT an extension of partner_api_keys (client_id is a standalone
-- identifier, not a truncated prefix of a secret like key_prefix is).
CREATE TABLE IF NOT EXISTS partner_oauth_clients (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id    UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,

  mode                  TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('test', 'live')),

  client_id             TEXT NOT NULL,   -- e.g. "clio_client_a1b2c3d4e5f6..." — safe to display indefinitely
  client_secret_hash    TEXT NOT NULL,   -- SHA-256 hex digest of the full secret, never the plaintext
  label                 TEXT,            -- partner-assigned name, e.g. "Production integration"

  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),

  last_used_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_oauth_clients_client_id ON partner_oauth_clients(client_id);
CREATE INDEX IF NOT EXISTS idx_partner_oauth_clients_account ON partner_oauth_clients(partner_account_id);
CREATE INDEX IF NOT EXISTS idx_partner_oauth_clients_status ON partner_oauth_clients(status) WHERE status = 'active';

ALTER TABLE partner_oauth_clients ENABLE ROW LEVEL SECURITY;

-- No token-storage table — access tokens are stateless (Requirement Doc Section 6): verified by
-- signature + expiry, never looked up by value. The two status checks the verification path performs
-- (this table's own `status`, and partner_accounts.status) are reads of already-existing rows the
-- static-key path already reads identically, not a per-issued-token record.
CREATE POLICY "Service role full access on partner_oauth_clients"
  ON partner_oauth_clients FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE partner_oauth_clients IS 'B2B-06: OAuth2 Client Credentials (RFC 6749 §4.4) issuance. The v1/day-one self-serve default credential, per Arun''s direct instruction (docs/brainstorm-partner-signup-integration.md Decision #2) — not an extension of partner_api_keys, which is preserved as a secondary, internal-operator-only path.';
COMMENT ON COLUMN partner_accounts.clerk_org_id IS 'B2B-06: keys a Clerk Organization (self-serve signup) to this row. NULL for internal-operator-provisioned accounts (the v1/v2 recovery path), which never have a Clerk Organization.';

-- 4. partner_sessions: reconcile the auth-credential FK for OAuth2-authenticated sessions.
--
-- CEO review finding (2026-07-15, B2B-06 v3 spec review): POST /api/partner/v1/sessions inserts
-- partner_api_key_id unconditionally on every request (app/api/partner/v1/sessions/route.ts:51), but
-- an OAuth2-authenticated request has no partner_api_keys row at all — lib/partner/auth.ts's OAuth2
-- branch (architecture.md §18.3) resolves a partner_oauth_clients row instead and returns apiKeyId:
-- null. Because partner_api_key_id was NOT NULL (migration 071, line 177), every OAuth2-authenticated
-- session-create call would fail this column's NOT NULL constraint before the test/live dispatch
-- branch is ever reached — session creation, the core partner operation, was uncallable via the
-- mechanism this brief mandates as the v1/day-one default.
--
-- Fix: make partner_api_key_id nullable, add a new nullable partner_oauth_client_id FK alongside it
-- (mirrors the apiKeyId/clientId distinction now on PartnerApiKeyContext, architecture.md §18.3), and
-- require exactly one of the two to be set — a partner_sessions row is always authenticated by
-- exactly one credential mechanism, never both, never neither, matching this table's own
-- one-row-one-cause discipline already established for end_reason above.
ALTER TABLE partner_sessions ALTER COLUMN partner_api_key_id DROP NOT NULL;

ALTER TABLE partner_sessions ADD COLUMN IF NOT EXISTS partner_oauth_client_id UUID
  REFERENCES partner_oauth_clients(id) ON DELETE RESTRICT;

ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_auth_credential_check
  CHECK (num_nonnulls(partner_api_key_id, partner_oauth_client_id) = 1);

CREATE INDEX IF NOT EXISTS idx_partner_sessions_oauth_client ON partner_sessions(partner_oauth_client_id)
  WHERE partner_oauth_client_id IS NOT NULL;

COMMENT ON COLUMN partner_sessions.partner_api_key_id IS 'B2B-06: nullable as of this migration — NULL for OAuth2-authenticated sessions (see partner_oauth_client_id). Exactly one of the two credential FKs is always set (partner_sessions_auth_credential_check).';
COMMENT ON COLUMN partner_sessions.partner_oauth_client_id IS 'B2B-06: set for OAuth2-authenticated sessions only. NULL for static-API-key-authenticated sessions (see partner_api_key_id). ON DELETE RESTRICT mirrors partner_api_key_id''s existing discipline — a session record must never be silently orphaned by credential deletion.';
