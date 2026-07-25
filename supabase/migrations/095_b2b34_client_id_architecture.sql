-- B2B-34 Piece 2 — reseller/client architecture: client_id threading + the webhook partner_reference fix
-- (closed in application code, lib/partner/webhooks.ts — see docs/specs/B2B-34-requirement-document.md
-- Part B §6.3) + the auto-provisioned "self" client mechanism.

ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS is_self_client BOOLEAN NOT NULL DEFAULT FALSE;

-- end_client_id: naming resolution in Part B §6.1 — deliberately NOT `client_id`, to avoid a code-level
-- grep/identifier collision with the pre-existing, unrelated `partner_oauth_clients.client_id` (migration
-- 079, B2B-06's OAuth2 Client Credentials identifier). Nullable everywhere: NULL for every
-- account_kind='partner'-authenticated session (client_id does not apply to direct partners, Part B §6.1),
-- always set for account_kind='channel_partner'-authenticated sessions (enforced at the API layer, not a
-- DB NOT NULL, so this column never blocks any other write path).
ALTER TABLE partner_sessions ADD COLUMN IF NOT EXISTS end_client_id UUID
  REFERENCES partner_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_partner_sessions_end_client_id
  ON partner_sessions(end_client_id) WHERE end_client_id IS NOT NULL;

ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS end_client_id UUID
  REFERENCES partner_accounts(id) ON DELETE SET NULL;

ALTER TABLE partner_session_insights ADD COLUMN IF NOT EXISTS end_client_id UUID
  REFERENCES partner_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN partner_accounts.is_self_client IS
  'B2B-34 Piece 2: true for the single auto-provisioned client row every channel_partner-kind reseller account gets at creation time, letting the reseller test/dispatch on their own behalf without first registering a real end-customer. Always account_kind=partner, owning_channel_partner_id set to the reseller. Never billed differently, never a peer to a real client beyond this flag.';
COMMENT ON COLUMN partner_sessions.end_client_id IS
  'B2B-34 Piece 2: the reseller''s end-customer this session is for. Required (enforced in application code, app/api/partner/v1/sessions/route.ts) for account_kind=channel_partner-authenticated sessions; NULL for account_kind=partner (direct-partner)-authenticated sessions, which this concept does not apply to. Deliberately named end_client_id, not client_id, to avoid colliding with the unrelated partner_oauth_clients.client_id (B2B-06). Wire/API field is still called client_id (docs/specs/B2B-34-requirement-document.md Part B §6.1).';
COMMENT ON COLUMN usage_events.end_client_id IS
  'B2B-34 Piece 2: resolved from partner_sessions.end_client_id at write time when clio_session_ref is set (lib/partner/webhooks.ts recordBillableEvent()). Powers Part E''s per-client usage breakdown. NULL wherever the originating session had no end_client_id.';
COMMENT ON COLUMN partner_session_insights.end_client_id IS
  'B2B-34 Piece 2: resolved from partner_sessions.end_client_id when this row is first upserted (inngest/partner-session-insights-extractor.ts). Threaded into the session.insights_ready webhook payload (lib/partner/webhooks.ts).';

-- Backfill: every existing live channel_partner account gets its self-client now (new accounts get one
-- automatically going forward via createOrClaimPartnerAccount(), Part B §6.2). Confirmed 6 live rows,
-- 2026-07-23 (docs/specs/B2B-34-requirement-document.md Part B §6.1).
INSERT INTO partner_accounts (name, archetype, status, account_kind, owning_channel_partner_id, is_self_client)
SELECT 'Self (direct sessions)', 'unspecified', 'active', 'partner', cp.id, TRUE
FROM partner_accounts cp
WHERE cp.account_kind = 'channel_partner'
  AND NOT EXISTS (
    SELECT 1 FROM partner_accounts existing_self
    WHERE existing_self.owning_channel_partner_id = cp.id AND existing_self.is_self_client = TRUE
  );
