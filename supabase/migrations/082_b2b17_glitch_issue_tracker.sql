-- B2B-17 — Glitch Log → Internal Issue Tracker (status, closure, RCA)
-- Per docs/specs/B2B-17-requirement-document.md Section 6.
--
-- Additive only. Does NOT modify partner_session_insights, its `glitches` JSONB, the
-- `glitch_summary_by_type_and_partner()` RPC, or `purge_partner_session_insights_full_detail()`
-- (migration 078) — all preserved byte-for-byte. The capture pipeline
-- (inngest/partner-session-insights-extractor.ts) is untouched; glitch_instances is populated
-- purely by a Postgres trigger fanning out the existing JSONB write, plus a one-time backfill.
--
-- Numbering note: 081 (b2b13_plan_tiers_and_topups) is the highest existing migration; 082 is the
-- next free number.
--
-- Internal-only. No partner-facing table, no partner API surface, no partner webhook event.

-- ─── 1. glitch_issues — the durable tracked issue (status + RCA) ────────────────────────────────────
-- Created FIRST because glitch_instances.issue_id references it.

CREATE TABLE IF NOT EXISTS glitch_issues (
  id                  UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  title               TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  root_cause_summary  TEXT        DEFAULT NULL,
  status              TEXT        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'investigating', 'resolved', 'wont_fix')),
  created_by          TEXT        DEFAULT NULL,      -- Clerk user id of creator
  resolved_at         TIMESTAMPTZ DEFAULT NULL,      -- set on → resolved/wont_fix, cleared on reopen
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_glitch_issues_status      ON glitch_issues(status);
CREATE INDEX IF NOT EXISTS idx_glitch_issues_updated_at  ON glitch_issues(updated_at DESC);

-- Reuse the shared updated_at trigger procedure (defined in migration 001).
DROP TRIGGER IF EXISTS trg_glitch_issues_updated_at ON glitch_issues;
CREATE TRIGGER trg_glitch_issues_updated_at
  BEFORE UPDATE ON glitch_issues
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE glitch_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on glitch_issues" ON glitch_issues;
CREATE POLICY "Service role full access on glitch_issues"
  ON glitch_issues FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE glitch_issues IS
  'B2B-17: operator-created tracked issue grouping recurring glitch instances. Carries status lifecycle (open→investigating→resolved/wont_fix, reopen→open) and free-text root_cause_summary. Notes live in glitch_issue_notes; attached instances in glitch_instances.issue_id. Internal-only.';

-- ─── 2. glitch_instances — row-per-glitch, stable identity ─────────────────────────────────────────
-- Durable projection of partner_session_insights.glitches (JSONB array). Gives every glitch instance
-- a real PK so status/RCA can be attached durably. Populated by trigger + backfill below.

CREATE TABLE IF NOT EXISTS glitch_instances (
  id                     UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  partner_session_id     UUID        NOT NULL REFERENCES partner_sessions(id) ON DELETE CASCADE,
  partner_account_id     UUID        NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  glitch_type            TEXT        NOT NULL CHECK (glitch_type IN
                           ('misunderstanding', 'repetition', 'confusion_about_clio', 'derailment', 'other')),
  description            TEXT        DEFAULT NULL,   -- NULL once purged (or if source was type-only)
  ordinal                INTEGER     NOT NULL,       -- 0-based position within the session's glitches array
  extracted_at           TIMESTAMPTZ NOT NULL,
  full_detail_purged_at  TIMESTAMPTZ DEFAULT NULL,
  issue_id               UUID        DEFAULT NULL REFERENCES glitch_issues(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_session_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_glitch_instances_issue        ON glitch_instances(issue_id);
CREATE INDEX IF NOT EXISTS idx_glitch_instances_account      ON glitch_instances(partner_account_id);
CREATE INDEX IF NOT EXISTS idx_glitch_instances_type         ON glitch_instances(glitch_type);
CREATE INDEX IF NOT EXISTS idx_glitch_instances_extracted_at ON glitch_instances(extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_glitch_instances_purge_eligibility
  ON glitch_instances(extracted_at)
  WHERE full_detail_purged_at IS NULL;

ALTER TABLE glitch_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on glitch_instances" ON glitch_instances;
CREATE POLICY "Service role full access on glitch_instances"
  ON glitch_instances FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE glitch_instances IS
  'B2B-17: stable row-per-glitch projection of partner_session_insights.glitches. Populated by the fanout_glitch_instances() trigger on capture (never on purge) plus a one-time backfill. issue_id links to a tracked glitch_issue (nullable = untriaged). Internal-only.';

-- ─── 3. glitch_issue_notes — append-only investigation log ─────────────────────────────────────────
-- Insert-only (no update/delete route) → immutable investigation trail.

CREATE TABLE IF NOT EXISTS glitch_issue_notes (
  id                    UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  issue_id              UUID        NOT NULL REFERENCES glitch_issues(id) ON DELETE CASCADE,
  body                  TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  author_clerk_user_id  TEXT        DEFAULT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_glitch_issue_notes_issue
  ON glitch_issue_notes(issue_id, created_at DESC);

ALTER TABLE glitch_issue_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on glitch_issue_notes" ON glitch_issue_notes;
CREATE POLICY "Service role full access on glitch_issue_notes"
  ON glitch_issue_notes FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE glitch_issue_notes IS
  'B2B-17: append-only, timestamped investigation notes on a glitch_issue. Insert-only by design (no update/delete route) so the RCA trail is immutable. Internal-only.';

-- ─── 4. Fan-out trigger — capture-only, never purge (the no-regression crux) ───────────────────────
-- AFTER INSERT OR UPDATE OF glitches ON partner_session_insights. The guard fires ONLY on the
-- first-population transition (NULL→array). The extractor writes glitches exactly once (NULL→array;
-- its idempotency guard makes success/success_empty terminal, so it is never re-written), and the
-- daily purge rewrites glitches array→type-only (non-null→non-null) — which the OLD.glitches IS NOT
-- NULL check EXCLUDES. So this trigger fires on capture and NEVER on purge; glitch_instances
-- descriptions are never touched by the JSONB purge. See Requirement Doc Section 6.1.
--
-- Note: the OLD-column guard is done in the function body (not the trigger WHEN clause) because a
-- combined INSERT-OR-UPDATE trigger may not reference OLD in its WHEN clause.

CREATE OR REPLACE FUNCTION fanout_glitch_instances()
RETURNS TRIGGER AS $$
BEGIN
  -- Only when glitches is a non-empty array (success_empty writes [] → zero rows).
  IF NEW.glitches IS NULL OR jsonb_array_length(NEW.glitches) = 0 THEN
    RETURN NULL;
  END IF;

  -- Load-bearing guard: exclude the purge rewrite (array→type-only). Fire only on first population.
  IF TG_OP = 'UPDATE' AND OLD.glitches IS NOT NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO glitch_instances (
    partner_session_id, partner_account_id, glitch_type, description, ordinal, extracted_at
  )
  SELECT
    NEW.partner_session_id,
    NEW.partner_account_id,
    g.value->>'type',
    g.value->>'description',
    (g.ordinality - 1)::int,
    COALESCE(NEW.extracted_at, now())          -- extracted_at is set in the same update as glitches
  FROM jsonb_array_elements(NEW.glitches) WITH ORDINALITY AS g(value, ordinality)
  ON CONFLICT (partner_session_id, ordinal) DO NOTHING;   -- idempotent

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fanout_glitch_instances ON partner_session_insights;
CREATE TRIGGER trg_fanout_glitch_instances
  AFTER INSERT OR UPDATE OF glitches ON partner_session_insights
  FOR EACH ROW
  EXECUTE FUNCTION fanout_glitch_instances();

-- ─── 5. One-time backfill — fan out every existing row's glitches ──────────────────────────────────
-- Carries full_detail_purged_at from the parent so already-purged rows land with description = NULL
-- and a set full_detail_purged_at (preserving the existing purge-notice semantics).
-- COALESCE on extracted_at is defensive against a NOT NULL violation aborting the migration; rows
-- with non-empty glitches always have extracted_at set (written in the same update).

INSERT INTO glitch_instances (
  partner_session_id, partner_account_id, glitch_type, description, ordinal, extracted_at, full_detail_purged_at
)
SELECT
  psi.partner_session_id,
  psi.partner_account_id,
  g.value->>'type',
  g.value->>'description',
  (g.ordinality - 1)::int,
  COALESCE(psi.extracted_at, psi.created_at, now()),
  psi.full_detail_purged_at
FROM partner_session_insights psi,
     LATERAL jsonb_array_elements(psi.glitches) WITH ORDINALITY AS g(value, ordinality)
WHERE psi.glitches IS NOT NULL AND jsonb_array_length(psi.glitches) > 0
ON CONFLICT (partner_session_id, ordinal) DO NOTHING;

-- ─── 6. Purge reconciliation RPC — glitch_instances on the same 30-day clock ───────────────────────
-- Companion to purge_partner_session_insights_full_detail() (migration 078, unchanged). The JSONB
-- stays the bounded-retention copy; this purges glitch_instances descriptions on the same clock.
--
-- ⚠️  TODO: pending Arun's Q1 decision (see docs/specs/B2B-17-requirement-document.md Section 6.4).
-- The exemption for actively-tracked (open/investigating) issues is a POLICY CHANGE to the 30-day
-- Non-Negotiable Data Boundary that Arun personally approved (Option A). Until he ratifies Q1, the
-- SAFE DEFAULT below leaves the exemption OFF — i.e. the purge is ABSOLUTE (Q1 option c), which is the
-- currently-approved behavior and retains no description past 30 days regardless of tracking.
--
-- The full exemption predicate is written and present, gated behind ONE boolean constant. Flipping
--   v_exempt_tracked_issues := FALSE  →  TRUE
-- is the ENTIRE behavioral switch once Arun answers "yes, exempt while actively tracked":
--   * TRUE  (recommended answer): instances on an OPEN/INVESTIGATING issue keep their description past
--            30 days; closed-issue and untracked instances still purge on the normal clock.
--   * FALSE (option c / current default): every instance older than the cutoff is purged, regardless
--            of issue_id/status.
-- No schema or UI change either way — only this one line.

CREATE OR REPLACE FUNCTION purge_glitch_instances_full_detail(p_cutoff TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
  v_exempt_tracked_issues BOOLEAN := FALSE;   -- ◀◀◀ Q1 one-line flip. FALSE = safe default (absolute purge).
BEGIN
  WITH purged AS (
    UPDATE glitch_instances gi
    SET description = NULL, full_detail_purged_at = now()
    WHERE gi.full_detail_purged_at IS NULL
      AND gi.extracted_at < p_cutoff
      AND (
        NOT v_exempt_tracked_issues                       -- exemption OFF → purge everything past cutoff
        OR gi.issue_id IS NULL                            -- untracked → purge on the normal clock
        OR EXISTS (SELECT 1 FROM glitch_issues i          -- closed issue → evidence re-ages-out
                   WHERE i.id = gi.issue_id
                     AND i.status IN ('resolved', 'wont_fix'))
        -- EXEMPT (only reached when v_exempt_tracked_issues = TRUE): instances attached to an OPEN or
        -- INVESTIGATING issue match none of the above and are therefore NOT purged — they keep their
        -- description past 30 days. This is the escalated Q1 exemption.
      )
    RETURNING gi.id
  )
  SELECT count(*) INTO v_count FROM purged;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_glitch_instances_full_detail IS
  'B2B-17: called daily by inngest/glitch-instances-purge.ts (glitchInstancesPurge, cron 0 3 * * * UTC) with p_cutoff = now() - 30 days. Nulls glitch_instances.description on the same clock as the JSONB purge. The open/investigating exemption is gated behind v_exempt_tracked_issues (default FALSE = absolute purge) pending Arun''s Q1 ratification — see Requirement Doc Section 6.4 / Section 11 Q1.';
