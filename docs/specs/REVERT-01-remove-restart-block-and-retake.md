# REVERT-01 — Remove completed-session restart block; remove RETAKE-01

**From:** CEO (relaying Arun's direct decision)
**Date:** 2026-07-06
**Priority:** P0
**Type:** Reversal / simplification (lightweight note — scope fully specified by Arun, no full BA doc needed)

## Decision

Arun reviewed SESSION-DURATION-01 + RETAKE-01 and decided the combination was
over-engineered. Two things ship in this change:

1. **Keep** the root-cause fix in `computeBilledMinutes()` (`lib/session-billing.ts`) —
   untouched by this change. Still load-bearing: `finalizeHumeNativeBilling()` falls
   back to it when Hume's own duration data isn't ready yet (confirmed on a real call).
2. **Remove** the hard `409 SESSION_ALREADY_COMPLETED` guard added in
   SESSION-DURATION-01 (`app/api/sessions/[id]/start/route.ts`). It was an extra
   safety net layered on top of the real fix, not a product requirement.
3. **Remove RETAKE-01 entirely** — the separate "Retake this session" button, modal,
   and `/api/sessions/[id]/retake` route existed only to work around the block above.
   With the block gone, the normal "Launch AI Coach" flow works directly on a
   completed session, so the separate flow is unnecessary complexity.
   Arun's words: "why complicating by adding retake session... that functionality is
   not needed at all."

## What changes

- `app/api/sessions/[id]/start/route.ts` — delete the completed-session guard block.
  A `completed` session now goes through the exact same start path as a `scheduled`
  session (status flips to `active`, audit token minted, `bot_joined` event written,
  plan-approval + minutes-balance checks unchanged).
- `app/api/sessions/[id]/retake/route.ts` — deleted.
- `app/dashboard/sessions/[id]/SessionDetailClient.tsx` — remove the "Retake this
  session" button, confirmation modal, and its supporting state/handlers.
- `retaken_from_session_id` column — left in place, untouched, unused. No
  down-migration; nullable/empty column is harmless.
- `docs/action-items.json` — `retake-completed-session` entry updated to "removed"
  with reasoning; new entry added documenting the restart-block removal.

## Why (for the record)

The 170-minute overcharge incident's actual root cause was the minute-calculation
scoping bug in `computeBilledMinutes()` — not the ability to restart a session.
The restart block was added defensively on top of the real fix, then RETAKE-01 was
built to route around that same block. Removing the block collapses both problems:
restart works normally, and there's no separate flow to maintain.

## Not in scope

- Any change to `lib/session-billing.ts`, `computeBilledMinutes()`, or
  `finalizeHumeNativeBilling()`.
- Dropping the `retaken_from_session_id` column.
- Commit/push/deploy — stays local pending Arun's decision to ship.

Historical record of the original (now-reversed) work remains at:
- `.claude/agents/clio/feature-briefs/RETAKE-01-feature-brief.md`
- `.claude/agents/clio/feature-briefs/RETAKE-01-requirement-document.md`
- `.claude/agents/clio/feature-briefs/retake-completed-session.md`

These are left in place as-is (not deleted) so "we built this, then reversed it, and
why" isn't lost.
