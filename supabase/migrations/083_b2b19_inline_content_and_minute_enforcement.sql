-- =============================================================================
-- B2B-19 — Partner-Supplied Inline Content, Transition Markers & Minute Enforcement
-- Requirement Doc: docs/specs/B2B-19-requirement-document.md (v1.1, CEO APPROVED)
-- Feature Brief:   .claude/agents/clio/feature-briefs/B2B-19-inline-content-delivery-transition-and-minute-enforcement.md
--
-- Three additive concerns, all backward-compatible (Option 2 / template-ref
-- sessions and every existing partner_sessions row are completely unaffected):
--
--  1. New table `partner_content_sources` — one row per registered content
--     source. Credentials AES-256-GCM encrypted-and-retrievable (Clio replays
--     them OUTWARD when fetching partner pages, so they are encrypted, NOT
--     hashed — see lib/partner/crypto.ts / Requirement Doc Section 6.1).
--     `presigned_url`/`mtls` are rejected at registration and are deliberately
--     excluded from the auth_type CHECK (never stored).
--
--  2. New additive columns on `partner_sessions` for inline-content mode, the
--     mid-session wrap-up flag, and Attendee-sourced billing provenance
--     (Requirement Doc Section 6.2). All nullable / defaulted.
--
--  3. Extend `partner_sessions_end_reason_check` (migration 077) to admit the
--     two new live-wallet end reasons.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── 1. partner_content_sources ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_content_sources (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),   -- the opaque content_source_id
  partner_account_id      UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,

  auth_type               TEXT NOT NULL
                            CHECK (auth_type IN ('none', 'static_bearer', 'oauth2_client_credentials')),

  label                   TEXT,   -- partner-supplied display label, non-secret

  -- AES-256-GCM ciphertext (format v1:<iv>:<tag>:<data>). Holds the bearer
  -- token (static_bearer) or a JSON blob of {client_id, client_secret}
  -- (oauth2_client_credentials). NULL for none. NEVER hashed — replayed
  -- outward when fetching partner pages.
  credential_ciphertext   TEXT,

  oauth_token_url         TEXT,   -- oauth2 only; non-secret
  oauth_scope             TEXT,   -- oauth2 only; optional
  oauth_audience          TEXT,   -- oauth2 only; optional

  header_name             TEXT DEFAULT 'Authorization',  -- static_bearer only
  header_scheme           TEXT DEFAULT 'Bearer',         -- static_bearer only

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_content_sources_account
  ON partner_content_sources(partner_account_id, created_at DESC);

ALTER TABLE partner_content_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_content_sources"
  ON partner_content_sources FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE partner_content_sources IS 'B2B-19: registered outbound content sources. Credentials AES-256-GCM encrypted-and-retrievable (Clio replays them when fetching partner pages), never hashed. presigned_url/mtls are rejected at registration, hence excluded from the auth_type CHECK.';
COMMENT ON COLUMN partner_content_sources.credential_ciphertext IS 'B2B-19: AES-256-GCM ciphertext (v1:<iv>:<tag>:<data>). static_bearer token, or JSON.stringify({client_id, client_secret}) for oauth2_client_credentials. NULL for none.';

-- ─── 2. partner_sessions additive columns ───────────────────────────────────
ALTER TABLE partner_sessions
  ADD COLUMN IF NOT EXISTS content_source_id          UUID REFERENCES partner_content_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content_pages              JSONB,
  ADD COLUMN IF NOT EXISTS content_to_explain         TEXT,
  ADD COLUMN IF NOT EXISTS content_title              TEXT,
  ADD COLUMN IF NOT EXISTS content_subtitle           TEXT,
  ADD COLUMN IF NOT EXISTS expected_duration_minutes  INTEGER,
  ADD COLUMN IF NOT EXISTS wrap_up_pending            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wrap_up_nudge_text         TEXT,
  ADD COLUMN IF NOT EXISTS billed_duration_source     TEXT,
  ADD COLUMN IF NOT EXISTS attendee_joined_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendee_ended_at          TIMESTAMPTZ;

-- Provenance of the billed minutes (Requirement Doc Section 6.2 + the CEO
-- build-time condition on Req 3.2). 'attendee' = both join/leave timestamps
-- carried by Attendee's own payload; 'attendee_receipt' = derived from
-- webhook-receipt time when Attendee's payload carried no usable timestamp
-- (labelled distinctly so it is never silently conflated with real
-- Attendee-measured timing); 'client_reported'/'wall_clock_fallback' = the
-- pre-B2B-19 fallbacks, now demoted.
ALTER TABLE partner_sessions DROP CONSTRAINT IF EXISTS partner_sessions_billed_duration_source_check;
ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_billed_duration_source_check
  CHECK (billed_duration_source IS NULL OR billed_duration_source IN
    ('attendee', 'attendee_receipt', 'client_reported', 'wall_clock_fallback'));

COMMENT ON COLUMN partner_sessions.content_pages IS 'B2B-19: ordered array of { url, media_type, title, subtitle, transition_trigger, transition_marker }. Pointers + injected marker only — never page bodies (CORE_OBJECTIVES data boundary). Option 1 (inline) only; NULL for Option 2 template-ref sessions.';
COMMENT ON COLUMN partner_sessions.billed_duration_source IS 'B2B-19: provenance of the billed minutes — attendee | attendee_receipt | client_reported | wall_clock_fallback.';
COMMENT ON COLUMN partner_sessions.wrap_up_pending IS 'B2B-19: mid-session paid-wallet enforcement flag (mirrors join_greeting_pending). Set by inngest/partner-live-cutoff.ts, consumed/cleared by the wrap-up-nudge poll route.';

-- ─── 3. extend end_reason CHECK (migration 077) ─────────────────────────────
-- Adds the two live-wallet reasons alongside the existing test-mode reasons.
ALTER TABLE partner_sessions DROP CONSTRAINT IF EXISTS partner_sessions_end_reason_check;
ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN
    ('trial_limit_reached', 'trial_exhausted', 'balance_exhausted', 'balance_limit_reached'));

COMMENT ON COLUMN partner_sessions.end_reason IS 'B2B-08/B2B-19: NULL for an ordinary partner-ended session; trial_limit_reached / trial_exhausted for test-mode cutoff/rejection; balance_exhausted for a pre-dispatch live-wallet rejection (status=failed); balance_limit_reached for a mid-session live-wallet forced cutoff.';
