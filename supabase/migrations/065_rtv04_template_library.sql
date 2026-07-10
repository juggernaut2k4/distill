-- RTV-04: Visualization Template Library & Human-Approval Workflow.
--
-- Creates the review record for all 27 visualization template types (25
-- already-live + 2 new: Heatmap, Overlay). Seeding this table changes NO
-- currently-rendered screen — show_visual, selectTemplate()'s call sites, and
-- every existing template renderer are untouched (see requirement doc Section 7,
-- last acceptance test). This migration only creates the table; row seeding is
-- done separately by scripts/seed-template-library.ts (idempotent, safe to
-- re-run, never overwrites a human review decision).

CREATE TABLE IF NOT EXISTS template_library (
  template_name   text        PRIMARY KEY,             -- must exactly match a TemplateName value
  display_name    text        NOT NULL,
  provenance      text        NOT NULL DEFAULT 'existing', -- 'existing' | 'new' — RTV-04 rollout only
  status          text        NOT NULL DEFAULT 'pending_review', -- pending_review | approved | changes_requested
  sample_data     jsonb       NOT NULL,                 -- frozen sample content shown for approval
  container_spec  jsonb       NOT NULL,                 -- container list + char budgets + fixed dimensions
  review_notes    text,
  reviewed_by     text,                                  -- set server-side only, never client-supplied
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_template_library_status ON template_library (status);
