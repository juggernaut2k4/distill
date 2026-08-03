-- B2B-70 v2.0 — reversal of migration 108's container-based content-ownership model
-- docs/specs/B2B-70-requirement-document.md §6.1
--
-- Per Arun's 2026-08-03 same-day amendment: a widget session's content is supplied by the caller on
-- every session-creation call, never pre-registered/stored in a Clio-owned container table. Migration
-- 108 was already applied to production before this rollback was written — this is a real rollback,
-- not a no-op. Zero real (external-reseller) widget-channel sessions exist as of this migration —
-- nothing external depends on partner_sessions.container_id.

DROP TABLE IF EXISTS demo_widget_container_map;
DROP TABLE IF EXISTS partner_widget_containers CASCADE;

ALTER TABLE partner_sessions DROP COLUMN IF EXISTS container_id;

-- delivery_channel ('meeting_bot' | 'widget') and the widened status CHECK (admitting 'widget_active')
-- are KEPT, unchanged — still correct, still needed, orthogonal to the content-ownership reversal.
