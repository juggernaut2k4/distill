-- B2B-35 F3 — optional, session-wide description of who the actual end user is (e.g. "a
-- first-year sales associate"), used to parameterize the assembled Hume prompt's audience
-- persona in place of the hardcoded "a senior executive" default. Applies to both Option 1
-- (inline) and Option 2 (reference) sessions.
-- See docs/specs/B2B-35-requirement-document.md §6.8.

ALTER TABLE partner_sessions ADD COLUMN end_user_role text;
