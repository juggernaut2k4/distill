-- Migration 052: Add audit_token to walkthrough_state
--
-- SECURITY FIX (CEO review, AUTOGEN-01 Part D) — /api/sessions/audit-event
-- previously accepted a bare `userId` with no proof of ownership, letting any
-- caller who knew/guessed a userId write fabricated billing events (fake
-- gap_start/gap_end pairs to zero out billed minutes, or cancel the 30s gap
-- watchdog on a dead session).
--
-- Fix: a per-session, unguessable, cryptographically random token is minted in
-- POST /api/sessions/[id]/start (when the session actually begins) and stored
-- here, keyed by user_id (matching the existing user_id-keyed shape of this
-- table). WalkthroughClient.tsx picks it up from its initial server-rendered
-- walkthrough_state read (no extra round trip needed) and must present it on
-- every write to /api/sessions/audit-event. The token is cleared whenever the
-- session tears down (DELETE /api/recall/bot and forceEndSession), so a stale
-- token from a previous session can never be replayed against a new one.

ALTER TABLE walkthrough_state ADD COLUMN IF NOT EXISTS audit_token TEXT;
