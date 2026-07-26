-- B2B-36 F4 — parameterized participant name (required at the API layer for every new session
-- going forward) and optional industry, extending B2B-35's end_user_role mechanism
-- (docs/specs/B2B-35-requirement-document.md §6.7-6.8). Both nullable at the DB level so this
-- migration and any pre-existing row (the demo's own `claude-ai` row currently has no name) do not
-- break — non-nullability is enforced at the Zod/API layer only (§6.2 below), same precedent as
-- every other field on these tables.
-- See docs/specs/B2B-36-requirement-document.md.

ALTER TABLE partner_sessions ADD COLUMN end_user_name text;
ALTER TABLE partner_sessions ADD COLUMN end_user_industry text;
ALTER TABLE demo_meeting_urls ADD COLUMN end_user_name text;
