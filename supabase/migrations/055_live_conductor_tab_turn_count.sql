-- LIVE-01 follow-up: server-forced tab advance backstop.
--
-- The live-conductor path has no pre-scripted [NAV:tab_id] markers (unlike the
-- old script-generator/WalkthroughClient path) — its only tab-advance trigger
-- is the model voluntarily calling `advance_tab`. Confirmed in production that
-- the model can get stuck on a tab indefinitely once past the intro (2026-07-04).
--
-- live_conductor_tab_turn_count: counts conversational turns spent on the
-- CURRENT tab (incremented every getLiveConductorState call, reset to 0 by
-- handleAdvanceTab). Used by lib/voice/live-conductor-bridge.ts to:
--   - turn >= 5: inject a stronger "wrap up now" nudge into the system prompt
--   - turn >= 8: bypass the model and force the advance server-side, mirroring
--     the old NAV-marker system's deterministic (non-LLM-discretionary) trigger
--
-- Additive-only. Default 0. Never read/written unless NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED=true.
ALTER TABLE walkthrough_state
  ADD COLUMN IF NOT EXISTS live_conductor_tab_turn_count INTEGER DEFAULT 0;
