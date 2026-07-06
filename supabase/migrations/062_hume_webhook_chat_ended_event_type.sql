-- HUME-GROUND-TRUTH-01 — adds 'hume_webhook_chat_ended' as a valid
-- session_billing_audit_log.event_type value.
--
-- Confirmed by direct inspection of 051_session_billing_audit_log.sql
-- (lines 16-24): event_type is a plain TEXT column with an unnamed inline
-- CHECK constraint, which Postgres auto-names using its standard
-- `{table}_{column}_check` convention since no CONSTRAINT name was given in
-- the original CREATE TABLE. That yields
-- `session_billing_audit_log_event_type_check`, which is what this
-- migration drops and recreates. If this name is ever wrong (e.g. an
-- intervening migration renamed it), this statement fails outright with a
-- clear Postgres error rather than silently doing nothing.
--
-- Required before any 'hume_webhook_chat_ended' row can be inserted by
-- app/api/webhooks/hume/route.ts. Until this migration is applied, that
-- insert fails (non-fatal, logged via writeAuditEvent()'s existing
-- convention, webhook endpoint still returns 200 to Hume), and
-- finalizeHumeNativeBilling()'s new fast-path simply never finds a row to
-- use — every session continues on the existing polling/fallback sequence
-- exactly as it does today. See docs/specs/HUME-GROUND-TRUTH-01-requirement-doc.md
-- Section 6 / Section 12.

ALTER TABLE session_billing_audit_log DROP CONSTRAINT session_billing_audit_log_event_type_check;

ALTER TABLE session_billing_audit_log ADD CONSTRAINT session_billing_audit_log_event_type_check
  CHECK (event_type IN (
    'bot_joined',
    'voice_connect_attempt',
    'speak_verified',
    'gap_start',
    'gap_end',
    'disconnected',
    'hume_webhook_chat_ended'
  ));
