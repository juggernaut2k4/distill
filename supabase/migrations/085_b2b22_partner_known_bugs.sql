-- B2B-22 — Partner-Facing "Known Bugs" Screen (per-bug visibility toggle, status + ETA, partner comments)
-- See docs/specs/B2B-22-requirement-document.md Section 6 for full rationale.
--
-- Layers a per-(issue, partner) visibility record on top of B2B-17's glitch_issues/glitch_instances
-- tracker (migration 082). Additive only — glitch_issues, glitch_instances, glitch_issue_notes, the
-- status lifecycle, and the /api/admin/glitches/** route family are all untouched by this migration.
-- Consumes B2B-21's internal_admin_users (migration 084) for `toggled_by`.
--
-- Numbering note: 084 (b2b21_internal_admin_identity) is the highest existing migration; 085 is the
-- next free number.

-- ─── GLITCH_ISSUE_PARTNER_VISIBILITY ────────────────────────────────────────────
-- The per-(issue, partner_account) visibility record. Never a boolean on glitch_issues itself — a
-- single tracked issue can span glitch_instances from multiple partners, so visibility must be scoped
-- per pair or toggling for one partner would leak to another.

CREATE TABLE IF NOT EXISTS glitch_issue_partner_visibility (
  id                           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  issue_id                     UUID        NOT NULL REFERENCES glitch_issues(id) ON DELETE CASCADE,
  partner_account_id           UUID        NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  is_visible                   BOOLEAN     NOT NULL DEFAULT FALSE,
  eta                          DATE        DEFAULT NULL,
  partner_facing_description   TEXT        DEFAULT NULL
                                  CHECK (partner_facing_description IS NULL
                                    OR char_length(partner_facing_description) BETWEEN 1 AND 2000),
  toggled_by                   UUID        REFERENCES internal_admin_users(id),
  toggled_at                   TIMESTAMPTZ DEFAULT NULL,
  first_visible_at             TIMESTAMPTZ DEFAULT NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (issue_id, partner_account_id),
  -- Defense in depth alongside route-level validation (§6.1): a row can never be saved
  -- is_visible = true with a blank partner-facing description.
  CHECK (NOT is_visible OR (partner_facing_description IS NOT NULL AND char_length(partner_facing_description) > 0))
);

-- The exact shape the partner-facing read path filters on.
CREATE INDEX IF NOT EXISTS idx_glitch_issue_partner_visibility_partner
  ON glitch_issue_partner_visibility(partner_account_id, is_visible);

CREATE INDEX IF NOT EXISTS idx_glitch_issue_partner_visibility_issue
  ON glitch_issue_partner_visibility(issue_id);

DROP TRIGGER IF EXISTS trg_glitch_issue_partner_visibility_updated_at ON glitch_issue_partner_visibility;
CREATE TRIGGER trg_glitch_issue_partner_visibility_updated_at
  BEFORE UPDATE ON glitch_issue_partner_visibility
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE glitch_issue_partner_visibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on glitch_issue_partner_visibility" ON glitch_issue_partner_visibility;
CREATE POLICY "Service role full access on glitch_issue_partner_visibility"
  ON glitch_issue_partner_visibility FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE glitch_issue_partner_visibility IS
  'B2B-22: per-(issue, partner) visibility record gating the partner-facing Known Bugs screen. is_visible is the toggle itself (default OFF). first_visible_at is set once, the first time is_visible is ever flipped true for this pair, and is NEVER cleared or overwritten thereafter (including later toggle-off) — the durable marker the hybrid partner-scope read rule (Requirement Doc §6.3) depends on. Never a boolean on glitch_issues itself, since one issue can span instances from multiple partners. Internal-write-only via /api/admin/glitches/issues/[id]/partner-visibility.';

-- ─── GLITCH_ISSUE_PARTNER_COMMENTS ──────────────────────────────────────────────
-- Append-only, partner-authored comment/evidence record. Mirrors glitch_issue_notes's immutable,
-- insert-only posture exactly (no update/delete route by design).

CREATE TABLE IF NOT EXISTS glitch_issue_partner_comments (
  id                              UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  issue_id                        UUID        NOT NULL,
  partner_account_id               UUID        NOT NULL,
  body                             TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  author_partner_admin_user_id    UUID        REFERENCES partner_admin_users(id),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Composite FK, not two independent FKs — structurally impossible for a comment to exist without a
  -- visibility record for that exact (issue, partner) pair ever having been created (§6.1).
  FOREIGN KEY (issue_id, partner_account_id)
    REFERENCES glitch_issue_partner_visibility(issue_id, partner_account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_glitch_issue_partner_comments_thread
  ON glitch_issue_partner_comments(issue_id, partner_account_id, created_at DESC);

ALTER TABLE glitch_issue_partner_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on glitch_issue_partner_comments" ON glitch_issue_partner_comments;
CREATE POLICY "Service role full access on glitch_issue_partner_comments"
  ON glitch_issue_partner_comments FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE glitch_issue_partner_comments IS
  'B2B-22: append-only, partner-authored comment/evidence on a visible bug. Insert-only by design (no update/delete route), mirroring glitch_issue_notes. Not deleted or hidden when is_visible later flips false — comments persist and reappear intact if toggled visible again. Composite FK to glitch_issue_partner_visibility(issue_id, partner_account_id) makes it structurally impossible to comment on a pair that was never made visible.';
