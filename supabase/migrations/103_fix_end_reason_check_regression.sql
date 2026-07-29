-- Fix: migration 087 (B2B-27) regressed the partner_sessions_end_reason_check CHECK constraint.
-- It DROP-then-ADD'd the constraint based on migration 079's value set
-- ('trial_limit_reached', 'trial_exhausted', 'funding_required') plus its own new 'card_required',
-- without accounting for migration 083's earlier additions ('balance_exhausted',
-- 'balance_limit_reached') — silently dropping both live-wallet reasons from the allowed set.
--
-- Practical impact, found live 2026-07-29: inngest/partner-live-cutoff.ts's mark-session-completed
-- step still writes end_reason: 'balance_limit_reached' on every forced live-wallet-exhausted
-- cutoff. Since that step never checked the update()'s returned error, every one of those writes
-- has been silently rejected by this CHECK constraint since migration 087 shipped — the bot is
-- correctly told to leave, but the session's completion record (status, ended_at, wrap_up_pending,
-- billed_duration_source) never gets written.
--
-- Fix: union every migration's values into one constraint — 077/079/083/087's five pre-existing
-- values plus migration 102's new 'all_participants_left' (B2B-50, applied the same night as this
-- fix; that migration's own comment deliberately deferred restoring 'balance_exhausted'/
-- 'balance_limit_reached' to this fast-follow rather than folding it in, to keep the two changes
-- independently reviewable). This migration is the authoritative final state for this constraint —
-- no value from any prior migration is removed going forward.

ALTER TABLE partner_sessions DROP CONSTRAINT IF EXISTS partner_sessions_end_reason_check;
ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN (
    'trial_limit_reached',
    'trial_exhausted',
    'funding_required',
    'card_required',
    'balance_exhausted',
    'balance_limit_reached',
    'all_participants_left'
  ));

COMMENT ON COLUMN partner_sessions.end_reason IS
  'NULL for an ordinary partner-ended session; trial_limit_reached for a mid-session test-mode forced cutoff; trial_exhausted for a pre-dispatch test-mode rejection when the trial+test-block allowance is used up; funding_required for a pre-dispatch live-mode rejection with no card on file; card_required for a pre-dispatch test-mode rejection with no card on file (B2B-27); balance_exhausted for a pre-dispatch live-wallet rejection (status=failed); balance_limit_reached for a mid-session live-wallet forced cutoff; all_participants_left for a session force-ended by the B2B-50 participants-empty debounce. Fixed 2026-07-29 after migration 087 silently dropped balance_exhausted/balance_limit_reached.';
