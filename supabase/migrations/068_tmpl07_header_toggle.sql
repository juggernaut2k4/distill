-- TMPL-07: Per-Template Title/Subtitle Review Toggle.
--
-- Extends RTV-04's template_library table (065_rtv04_template_library.sql) with
-- a per-template boolean toggle that lets Arun turn a title/subtitle header on
-- or off for 7 specific templates whose renderer today omits (or partially
-- omits) that header, and review the rendered result live in the existing
-- admin Template Library tool. Additive only — no existing column, status
-- value, or RTV-04/RTV-05/TMPL-01 behavior changes (requirement doc Section 6).
--
-- Also relaxes template_fix_log.fix_cycle_id (added NOT NULL by migration 067)
-- to nullable, since this feature's audit rows (event_type = 'header_toggled')
-- are not part of any TMPL-01 fix cycle and have no fix_cycle_id to record.
-- Backward-compatible: every existing row already has a non-null value.

ALTER TABLE template_library
  ADD COLUMN IF NOT EXISTS header_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE template_fix_log
  ALTER COLUMN fix_cycle_id DROP NOT NULL;
