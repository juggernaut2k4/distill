-- TMPL-01: Automated Template Feedback -> LLM Fix -> Re-Review Loop.
--
-- Extends RTV-04's template_library table (065_rtv04_template_library.sql) with
-- a fix-cycle sub-status layered underneath the existing `changes_requested`
-- status only. Does NOT change the 3 existing status values or any RTV-04/
-- RTV-05 behavior — additive only (see requirement doc Section 6/7).
--
-- fix_state is always 'none' when status is 'pending_review' or 'approved'.
-- style_overrides is the runtime style-override payload the renderer reads at
-- render time via inline `style={{ }}` attributes (Section 0) — there is no
-- file-system or deploy path anywhere in this design.

ALTER TABLE template_library
  ADD COLUMN IF NOT EXISTS fix_state           text        NOT NULL DEFAULT 'none', -- 'none' | 'generating' | 'failed'
  ADD COLUMN IF NOT EXISTS style_overrides     jsonb       NOT NULL DEFAULT '{}'::jsonb, -- currently-applied slot values
  ADD COLUMN IF NOT EXISTS fix_changes_summary text,                                -- LLM's own account of what it changed, shown to Arun
  ADD COLUMN IF NOT EXISTS fix_failure_reason  text,                                -- populated only when fix_state = 'failed'
  ADD COLUMN IF NOT EXISTS fix_attempt_count   int         NOT NULL DEFAULT 0,       -- attempts used in the current cycle
  ADD COLUMN IF NOT EXISTS fix_cycle_id        text,                                -- app-generated id, changes on each new cycle/force-retrigger — guards against a stale/slow invocation overwriting a fresher one
  ADD COLUMN IF NOT EXISTS fix_last_activity_at timestamptz;                        -- last time any progress log entry was written; drives "time since last update"

CREATE INDEX IF NOT EXISTS idx_template_library_fix_state ON template_library (fix_state) WHERE fix_state <> 'none';

CREATE TABLE IF NOT EXISTS template_fix_log (
  id               bigserial   PRIMARY KEY,
  template_name    text        NOT NULL REFERENCES template_library(template_name) ON DELETE CASCADE,
  fix_cycle_id     text        NOT NULL,
  attempt_number   int,                       -- null for cycle-level events (feedback_received, nudge actions)
  event_type       text        NOT NULL,      -- 'feedback_received' | 'attempt_started' | 'validation_result' | 'attempt_failed' | 'fix_succeeded' | 'fix_failed_terminal' | 'nudge_status_check' | 'nudge_force_retrigger'
  message          text        NOT NULL,
  actor            text,                      -- set for nudge events only, the authenticated approver's email — never client-supplied
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_template_fix_log_template ON template_fix_log (template_name, created_at);
