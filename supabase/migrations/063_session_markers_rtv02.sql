-- RTV-02 — marker-generation content-authoring pipeline.
--
-- Additive only: two new nullable columns on `sessions`, no default, no
-- backfill, no change to any existing column. Existing rows read as NULL,
-- which every consumer (RTV-03/RTV-05, the admin inspection endpoint) treats
-- as "no markers / not RTV-eligible" — the safe default.
--
-- session_markers: full marker set JSON for the session (version, generator,
--   generated_at, source, rtv_eligible, rtv_ineligible_reason, topics[]).
--   NULL <=> markers never generated (toggle RTV_MARKER_GENERATION_ENABLED
--   was OFF at authoring time, or this session predates the feature).
-- rtv_eligible: true = every non-bookend topic has >=1 golden word (ready for
--   RTV-03/05). false = hard-stop fired, LLM judgment failed, or the
--   provision-config self-heal path deferred (reason recorded inside the
--   session_markers JSON, or absent for the self-heal deferral). NULL = not
--   generated.
--
-- See .claude/agents/clio/requirement-docs/RTV-02-marker-generation-pipeline.md
-- Section 6 / Section 12 for the full data contract.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_markers jsonb;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtv_eligible boolean;
