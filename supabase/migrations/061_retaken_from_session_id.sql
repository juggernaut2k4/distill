-- RETAKE-01: link a retake session back to the completed session it retakes
--
-- Adds a nullable self-referencing FK on sessions so a brand-new session row
-- created via POST /api/sessions/[id]/retake can record which completed
-- session it is a retake of. ON DELETE SET NULL: if the original session row
-- is ever deleted, the retake row survives (it is a fully independent,
-- separately billed session) and simply loses the back-link.
--
-- Per the approved requirement doc (docs/specs/RETAKE-01-requirement-document.md,
-- Section 5): downstream systems (deferred-questions carry-forward, learner-profile
-- tracking) are NOT wired to read this column in this ticket -- that is a
-- deliberate scope cut, not an oversight. This migration only adds the column
-- and its index so a future ticket can build on it.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS retaken_from_session_id uuid REFERENCES sessions(id) ON DELETE SET NULL;

COMMENT ON COLUMN sessions.retaken_from_session_id IS
  'When this session was created via POST /api/sessions/[id]/retake, points to the '
  'original completed session it retakes. NULL for all normal sessions. Set once at '
  'insert time and never updated afterward. See RETAKE-01.';

-- Partial index: most rows will have this NULL, so only index the rows that
-- actually carry a back-link, matching the pattern used for other sparse
-- lookup columns in this schema (e.g. walkthrough audit token indexes).
CREATE INDEX IF NOT EXISTS idx_sessions_retaken_from_session_id
  ON sessions (retaken_from_session_id)
  WHERE retaken_from_session_id IS NOT NULL;
