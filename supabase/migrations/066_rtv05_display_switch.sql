-- RTV-05 — Live Pre-Fetch + Dual-Trigger Toggle-Gated Display Switch
-- Requirement doc: .claude/agents/clio/requirement-docs/RTV-05-prefetch-and-dual-trigger-display.md
-- Section 6.2 / Section 12.
--
-- Additive only. Nullable, no default, no backfill.
-- NULL means "never computed for this session" (every pre-RTV-05 session, or
-- a session whose first connect through provision-config hasn't happened
-- yet) — every consumer treats NULL identically to false (fail closed).
--
-- Written exactly once, at a session's first connect, by
-- app/api/hume-native/provision-config/route.ts (Section 4.2). Never
-- rewritten on a reconnect for the same session — the persisted value is
-- reused verbatim for the session's entire lifetime, even if a template's
-- approval status in template_library changes mid-session (Section 4.2's
-- race-proofing rationale).

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtv05_display_active boolean;
