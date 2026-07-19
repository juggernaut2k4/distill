-- B2B-27 — Card-on-File Required for Trial/Test-Mode Access
-- See docs/specs/B2B-27-requirement-document.md and the CEO Feature Brief
-- (.claude/agents/clio/feature-briefs/B2B-27-card-on-file-required-for-trial-access.md).
--
-- Additive only, mirrors migration 079's own DROP-then-ADD pattern against 077's
-- end_reason CHECK constraint. No new column, no new table: the enforcement signal
-- (partner_wallets.stripe_default_payment_method_id) already exists (migration 075).

ALTER TABLE partner_sessions DROP CONSTRAINT IF EXISTS partner_sessions_end_reason_check;
ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN (
    'trial_limit_reached', 'trial_exhausted', 'funding_required', 'card_required'
  ));

COMMENT ON COLUMN partner_sessions.end_reason IS
  'B2B-08/B2B-06/B2B-27: NULL for an ordinary partner-ended session; trial_limit_reached for a mid-session forced cutoff; trial_exhausted for a pre-dispatch test-mode rejection when the trial+test-block allowance is used up; funding_required for a pre-dispatch live-mode rejection with no card on file; card_required for a pre-dispatch test-mode rejection with no card on file (checked before the trial-minutes computation, B2B-27).';
