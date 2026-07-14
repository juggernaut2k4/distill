-- B2B-02 — Partner API & Multi-Tenant Architecture (required baseline)
-- See docs/specs/B2B-02-requirement-document.md Section 6 for full rationale.
--
-- This migration is deliberately independent of the F-01 (ledger storage model)
-- decision — everything here is needed regardless of which way F-01 resolves.
-- The F-01-dependent aggregating ledger (Resolution A) lives in migration 072,
-- kept as a separate, optional file so B2B-04 can apply it later without
-- reopening this one (see architecture.md "F-01 Handling" section).
--
-- Deliberately does NOT touch the existing `users` / `sessions` tables. Those
-- remain the live schema for the reused Hume/Attendee meeting-bot runtime
-- (see CORE_OBJECTIVES.md "Infrastructure ... reused because it is genuinely
-- infrastructure"). Partner-initiated sessions get their own table
-- (`partner_sessions`) rather than forcing a Clerk-user_id-shaped row into
-- `sessions` — see architecture.md "Why partner_sessions is a new table, not
-- a reuse of `sessions`" for the full reasoning and the integration gap this
-- deliberately leaves open for B2B-03.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── PARTNER_ACCOUNTS ─────────────────────────────────────────────────────────
-- One row per top-level partner (Pluralsight, Capgemini). Per CORE_OBJECTIVES.md
-- §"Non-Negotiable Data Boundary" and the CEO brief's sub-tenant instruction,
-- there is deliberately NO sub-tenant table here — a partner's downstream
-- clients (e.g. Capgemini → Hartford) are entirely opaque to Clio. See
-- `partner_reference` columns below for the one narrow passthrough exception.

CREATE TABLE IF NOT EXISTS partner_accounts (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                        TEXT NOT NULL,

  -- Informational only — both archetypes use the identical API surface
  -- (CORE_OBJECTIVES.md: "one flexible API ... not two tiers"). Nothing in
  -- this schema or any endpoint branches on this column; it exists purely
  -- for the future admin page (B2B-04) to display/filter by.
  archetype                   TEXT NOT NULL DEFAULT 'unspecified'
                                CHECK (archetype IN ('platform', 'no_platform', 'unspecified')),

  status                      TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'suspended')),

  -- Objective 1 opt-in toggle. OFF (default) = Clio has no mechanism to
  -- recall anything about a user across sessions for this partner — see the
  -- falsifiable test in CORE_OBJECTIVES.md Objective 1.
  profile_sync_enabled        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Outbound direction (Clio -> partner): "just a settings field (base URL +
  -- auth token)" per brainstorm doc §7.5 point 4. One base URL; Clio calls
  -- fixed, well-known suffixes under it (see architecture.md API Route Map):
  --   {base_url}/content        (push + pull)
  --   {base_url}/profile        (push + pull, only called if profile_sync_enabled)
  --   {base_url}/webhooks/usage (signed webhook POST)
  outbound_base_url           TEXT,

  -- Bearer token the PARTNER supplied to Clio, used as `Authorization: Bearer
  -- <token>` on every Clio -> partner call. Encrypted at rest at the
  -- application layer before insert (never store plaintext); this column
  -- holds ciphertext only. Never logged — mirrors the existing
  -- `redactAuditTokenFromUrl` discipline in lib/session-billing.ts.
  outbound_auth_token_ciphertext TEXT,

  -- Clio-GENERATED signing secret (shown once in the future partner
  -- Configurator UI, like Stripe's `whsec_...`), used to HMAC-SHA256-sign
  -- every outbound webhook body so the partner can verify authenticity —
  -- same discipline as `stripe.webhooks.constructEvent` per CLAUDE.md.
  -- Distinct from outbound_auth_token_ciphertext: that authenticates Clio
  -- *as a caller* to the partner; this proves *integrity* of what Clio sent.
  outbound_signing_secret     TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_partner_accounts_updated_at
  BEFORE UPDATE ON partner_accounts
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_accounts ENABLE ROW LEVEL SECURITY;

-- No end-user-facing RLS policy — this table is never read by an
-- individual-user-scoped Clerk session (Clerk under the pivot is scoped to
-- partner-admin humans, see partner_admin_users below, which is what the
-- future Configurator UI reads through instead of this table directly).
CREATE POLICY "Service role full access on partner_accounts"
  ON partner_accounts FOR ALL
  USING (auth.role() = 'service_role');

-- ─── PARTNER_ADMIN_USERS ──────────────────────────────────────────────────────
-- Minimal bridge table: which Clerk-authenticated human(s) administer which
-- partner_account. This is NOT a redesign of Clerk's scope (Clerk itself is
-- unchanged, out of this brief's concern per CLAUDE.md/B2B-01) — it is the
-- minimum join needed for the key-rotation UX (Section 6/7 below) to know
-- which partner account a logged-in Clerk admin is allowed to issue/revoke
-- API keys for. The Configurator UI (B2B-03) will read/write this table
-- through Clerk-authenticated routes only, never through a partner API key.

CREATE TABLE IF NOT EXISTS partner_admin_users (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id       TEXT NOT NULL,
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  role                TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin', 'member')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clerk_user_id, partner_account_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_admin_users_clerk_user
  ON partner_admin_users(clerk_user_id);

ALTER TABLE partner_admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view own partner-admin memberships"
  ON partner_admin_users FOR SELECT
  USING (auth.uid()::text = clerk_user_id);

CREATE POLICY "Service role full access on partner_admin_users"
  ON partner_admin_users FOR ALL
  USING (auth.role() = 'service_role');

-- ─── PARTNER_API_KEYS ─────────────────────────────────────────────────────────
-- Inbound direction (partner -> Clio) trust boundary. Distinct, second auth
-- system from Clerk (see architecture.md "Two Auth Systems"). Never stores a
-- plaintext key — only a lookup prefix (safe to display, e.g. in a "key
-- ending in ...a1b2" UI) and a SHA-256 hash of the full key.

CREATE TABLE IF NOT EXISTS partner_api_keys (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,

  -- 'test' keys (clio_test_sk_...) behave identically to 'live' keys
  -- (clio_live_sk_...) except: (a) session-initiation calls made with a test
  -- key MUST set a `test_mode: true` flag on the resulting partner_sessions
  -- row (see below) so no real meeting-bot minute/LLM-call is ever billed or
  -- emitted to usage_events, and (b) test-mode usage webhooks are dispatched
  -- with the same signature but partners are expected to ignore them for
  -- billing purposes. This lets a partner integrate and smoke-test before
  -- their first real billable event, mirroring Stripe's test/live key
  -- separation (Q1 in the Feature Brief's "Questions for BA" — judgment
  -- call: include now, low marginal cost alongside key issuance itself).
  mode                TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('test', 'live')),

  key_prefix          TEXT NOT NULL,   -- e.g. "clio_live_sk_a1b2c3d4" (first 20 chars, safe to display)
  key_hash            TEXT NOT NULL,   -- SHA-256 hex digest of the full key, never the plaintext
  label               TEXT,            -- partner-assigned name, e.g. "Production integration"

  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),

  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_api_keys_hash ON partner_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_partner_api_keys_account ON partner_api_keys(partner_account_id);
CREATE INDEX IF NOT EXISTS idx_partner_api_keys_status ON partner_api_keys(status) WHERE status = 'active';

ALTER TABLE partner_api_keys ENABLE ROW LEVEL SECURITY;

-- No row is ever read via a Supabase client authenticated as the partner
-- (partner API keys authenticate at Clio's own API layer via key_hash
-- lookup using the service-role client — see architecture.md "Inbound Auth
-- Middleware"). Only Clerk-authenticated partner-admins (via
-- partner_admin_users) and the service role touch this table.
CREATE POLICY "Service role full access on partner_api_keys"
  ON partner_api_keys FOR ALL
  USING (auth.role() = 'service_role');

-- ─── PARTNER_SESSIONS ─────────────────────────────────────────────────────────
-- The session-initiation contract's own record. Deliberately NOT the same
-- table as the legacy `sessions` (see file header + architecture.md for the
-- full reasoning) — `clio_session_ref` below is the "opaque session
-- reference" used throughout the content/profile/usage contracts (Feature
-- Brief "Questions for BA" #4).

CREATE TABLE IF NOT EXISTS partner_sessions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(), -- == clio_session_ref
  partner_account_id    UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  partner_api_key_id    UUID NOT NULL REFERENCES partner_api_keys(id) ON DELETE RESTRICT,

  test_mode             BOOLEAN NOT NULL DEFAULT FALSE, -- mirrors the key's mode at creation time

  -- Opaque references, none interpreted or resolved to a real identity by
  -- Clio. See architecture.md "Opaque Reference Shapes" for the exact format
  -- of each.
  partner_end_user_ref  TEXT,   -- partner-supplied; required only if profile pull is attempted
  partner_topic_ref     TEXT,   -- partner-supplied; their own topic/content identifier
  content_ref           TEXT,   -- Clio-minted, only present if content was Clio-generated (Designer path)
  partner_reference      TEXT,   -- optional opaque sub-tenant/correlation passthrough, never interpreted

  meeting_url           TEXT NOT NULL, -- partner-supplied Google Meet URL, already created on their side

  status                TEXT NOT NULL DEFAULT 'requested'
                          CHECK (status IN ('requested', 'bot_dispatch_failed', 'bot_active', 'completed', 'failed')),

  -- Never returned to the partner in any API response (meeting-bot vendor
  -- must stay abstracted per the Feature Brief's V-02 constraint).
  provider_bot_id       TEXT,
  provider_name         TEXT, -- 'recall' | 'attendee' | 'agentcall' — internal diagnostics only, never exposed

  error_message          TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_partner_sessions_account ON partner_sessions(partner_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_sessions_status ON partner_sessions(status);

CREATE TRIGGER update_partner_sessions_updated_at
  BEFORE UPDATE ON partner_sessions
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on partner_sessions"
  ON partner_sessions FOR ALL
  USING (auth.role() = 'service_role');

-- ─── WEBHOOK_DISPATCH_LOG ─────────────────────────────────────────────────────
-- F-01-INDEPENDENT. Required regardless of how F-01 (ledger storage model)
-- resolves — this is reliability/idempotency/audit infrastructure for the
-- signed webhook mechanism itself, not "the ledger" in the billing sense.
--
-- Scope boundary, enforced by what this table is allowed to hold: `payload`
-- here is restricted to usage/billing-event webhook bodies ONLY (numbers +
-- opaque references — see architecture.md's exact JSON shape). The
-- content-push and profile-push/pull calls (Sections 3-4 of "What Success
-- Looks Like" in the Feature Brief) are synchronous, ephemeral Clio->partner
-- HTTP calls that are NEVER logged to this or any table — logging their
-- bodies here would itself violate the zero-Clio-persistence-of-content
-- rule. See architecture.md "What Must Never Be Logged."

CREATE TABLE IF NOT EXISTS webhook_dispatch_log (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id    UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,

  event_type            TEXT NOT NULL
                          CHECK (event_type IN ('usage.voice_minute', 'usage.llm_generation_call', 'session.completed')),

  clio_session_ref      UUID REFERENCES partner_sessions(id) ON DELETE SET NULL,
  partner_reference       TEXT, -- opaque passthrough, echoed verbatim from the originating session/event

  -- The exact JSON body sent (usage numbers + opaque refs only — see check
  -- above). Kept for dispute resolution / redelivery, same rationale as
  -- minutes_ledger.metadata.
  payload               JSONB NOT NULL,
  payload_hash          TEXT NOT NULL, -- SHA-256 of the canonicalized payload, for idempotent redelivery checks
  signature             TEXT NOT NULL, -- the HMAC-SHA256 signature actually sent (Clio-Signature header value)

  delivery_status        TEXT NOT NULL DEFAULT 'pending'
                          CHECK (delivery_status IN ('pending', 'delivered', 'failed', 'exhausted')),
  http_status_code       INTEGER,
  retry_count             INTEGER NOT NULL DEFAULT 0,
  next_retry_at           TIMESTAMPTZ,
  delivered_at            TIMESTAMPTZ,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_dispatch_log_account_time
  ON webhook_dispatch_log(partner_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_dispatch_log_pending_retry
  ON webhook_dispatch_log(next_retry_at) WHERE delivery_status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_dispatch_log_idempotency
  ON webhook_dispatch_log(partner_account_id, event_type, clio_session_ref, payload_hash);

-- Append-only enforcement, mirrors minutes_ledger's pattern exactly.
ALTER TABLE webhook_dispatch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on webhook_dispatch_log"
  ON webhook_dispatch_log FOR ALL
  USING (auth.role() = 'service_role');

-- No UPDATE policy for any non-service role, no DELETE policy for any role —
-- immutable except for the service-role-only status/retry fields updated by
-- the dispatch worker (see architecture.md "Webhook Delivery Worker").

COMMENT ON TABLE partner_accounts IS 'B2B-02: one row per top-level partner. No sub-tenant table by design — see partner_reference passthrough columns instead.';
COMMENT ON TABLE partner_sessions IS 'B2B-02: session-initiation contract record. Intentionally separate from legacy `sessions` table — see migration file header.';
COMMENT ON TABLE webhook_dispatch_log IS 'B2B-02: F-01-independent webhook reliability/audit log. Payload restricted to usage/billing events only, never content or profile bodies.';
