-- Migration 059: Add hume_wrapup_nudge_pending to walkthrough_state
--
-- HUME-NATIVE-01 — Graceful Session End (Time-Aware Wrap-Up Nudge), per
-- docs/specs/HUME-NATIVE-01-graceful-session-end-requirement-doc.md.
--
-- New, Hume-specific flag. Deliberately NOT a reuse of `pending_transcript`
-- (that field is ElevenLabs-only — reusing it would make the client
-- (mis)treat the nudge as a user transcript to forward via sendUserMessage,
-- the wrong code path for Hume-native sessions).
--
-- Set to true by inngest/session-timer.ts's new Hume-native branch step,
-- ~2 minutes before the session's hard cutoff. Cleared back to false by the
-- client (WalkthroughClient.tsx) via the existing PATCH
-- /api/walkthrough-state/[userId] pattern, once the nudge has been sent (or
-- once a retry has been attempted and given up on).
--
-- Purely additive: no existing column is modified or dropped. A row untouched
-- by this feature (every ElevenLabs session, every Hume Custom-LLM/LIVE-01
-- session) reads exactly as it did before this migration (default false,
-- never written to true).

ALTER TABLE walkthrough_state
  ADD COLUMN IF NOT EXISTS hume_wrapup_nudge_pending BOOLEAN NOT NULL DEFAULT false;
