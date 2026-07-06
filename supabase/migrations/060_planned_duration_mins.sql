-- SESSION-DURATION-01: split "planned length" from "actual billed minutes"
--
-- sessions.duration_mins currently does two jobs: it is written once at
-- scheduling time to mean "planned length," and it is overwritten by every
-- end/force-end path to mean "actual minutes billed." This destroys the
-- original plan the first time a session is force-ended.
--
-- This migration adds a new, immutable column, planned_duration_mins, set
-- once at insert time by app/api/plan/approve/route.ts (and the admin/test
-- session helper) and never written to again by any billing/end path.
--
-- Simplification confirmed by Arun (2026-07-05), superseding the "best-effort
-- backfill" option originally discussed in the requirement doc's Section 9:
-- historical rows are NOT backfilled. planned_duration_mins is left NULL for
-- every existing row, since we cannot honestly distinguish "never
-- force-ended" (duration_mins still correct) from "force-ended at least once"
-- (duration_mins now holds a billed value, not the plan) purely from the
-- current schema. Only sessions created after this migration ships will have
-- planned_duration_mins populated, at insert time, by application code.
--
-- duration_mins keeps its exact current definition (nullable, DEFAULT 0) and
-- is not touched by this migration. It is repurposed in meaning only, per
-- Arun's explicit "no column deletion" constraint.

ALTER TABLE sessions
  ADD COLUMN planned_duration_mins INTEGER;

COMMENT ON COLUMN sessions.planned_duration_mins IS
  'Immutable snapshot of the planned session length in minutes, set once at row-insert time '
  '(app/api/plan/approve/route.ts, app/api/admin/test-session/route.ts). Never overwritten after '
  'insert by any billing/end path. NULL for historical rows created before this migration -- no '
  'backfill was attempted, per Arun''s 2026-07-05 decision, since duration_mins may already have '
  'been overwritten by a billing event on some of those rows and there is no reliable way to tell '
  'which ones. See SESSION-DURATION-01.';

COMMENT ON COLUMN sessions.duration_mins IS
  'Actual minutes billed for this session, written by the billing/end paths '
  '(app/api/sessions/[id]/end/route.ts, lib/session-billing.ts forceEndSession()). '
  'Defaults to the planned value at insert time and is only overwritten once a real '
  'billing event (normal end or force-end) occurs. For the "planned length" display '
  'pre-session, read planned_duration_mins instead -- see SESSION-DURATION-01.';
