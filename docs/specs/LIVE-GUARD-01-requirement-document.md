# LIVE-GUARD-01 — Guard Live-Conductor State Reset Behind Feature Flag — Requirement Document
Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-07-06

## 1. Purpose

`app/api/sessions/[id]/start/route.ts` currently resets a set of live-conductor
fields on the `walkthrough_state` table **unconditionally**, every single time
any session is started — regardless of whether the live-conductor feature is
turned on.

This is dead-feature code executing on a live, default (non-live-conductor)
path. It happened to be harmless while `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED`
was off, because nothing downstream currently reads those fields when the
flag is off. But that safety is accidental, not designed: nothing in the
`/start` route today checks the flag before writing. The write was added
2026-07-04 (LIVE-01 bug fix, see lines 122–146 of the route) to fix a real
bug in the live-conductor path, but it was placed in the shared `/start`
route without a flag guard.

**Root cause of the class of bug this prevents:** if
`NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED` is ever flipped back to `true` in the
future without first re-auditing this route, this write reactivates
automatically and silently — with no code change, no review, and no
connection to whoever flips the flag. That is exactly the kind of
silent-takeover failure mode already diagnosed once on the session Overview
screen (a separate, stale feature quietly overriding the correct content).
Guarding this write behind the flag now closes that reoccurrence path
permanently.

**What failure looks like without this fix:** someone re-enables live
conductor for an unrelated reason (e.g. a partial rollout, a test flip, a
future re-launch), and every session start — including for users who should
be on the default script-based path if live conductor is only partially
rolled out to a subset — silently resets `walkthrough_state` live-conductor
columns. This can reintroduce the exact "stale feature silently overrides
correct content" symptom previously debugged, without a single line in
`/start/route.ts` having changed.

## 2. User Story

As a **developer maintaining the session-start route**,
I want the live-conductor state reset to execute only when the live-conductor
feature is actually enabled,
So that flipping the feature flag in the future cannot silently reintroduce
a bug in a code path (`/start`) that nobody would think to check, because
the route's behavior always matches what the flag says it should do.

There is no end-user-facing story here — this is a backend correctness/
safety fix with no UI, no user-visible behavior change under current
configuration (flag is off).

## 3. Trigger / Entry Point

- **Route:** `POST /api/sessions/[id]/start` (unchanged — this fix does not
  add, remove, or rename any route)
- **Trigger:** Called by the Recall.ai bot integration when a bot
  successfully joins a meeting for a session (per existing route comment,
  line 14)
- **Auth:** `requireSessionAuth(request)` — unchanged
- **Preconditions:** unchanged — session must exist and belong to the
  requesting user, curriculum plan (if any) must be approved, user must have
  a positive minutes balance sufficient for the session

This fix touches only the internal logic of the existing handler. It does
not change how or when the route is invoked.

## 4. Screen / Flow Description

Not applicable — this is a non-user-facing backend fix. No screen, no UI
state, no user-visible flow changes in any configuration.

## 5. Visual Examples

Not applicable — no UI involved.

## 6. Data Requirements

**Current behavior (unconditional):**

```ts
await supabase
  .from('walkthrough_state')
  .update({
    live_conductor_tab_index: 0,
    live_conductor_visual: null,
    live_conductor_tab_turn_count: 0,
  })
  .eq('user_id', userId!)
```

This is a write to the `walkthrough_state` table, scoped by `user_id`,
executed on **every** call to `/start`, for **every** session, regardless of
the live-conductor flag.

**Desired behavior (guarded):**

The exact same query, wrapped so it only executes when
`isLiveConductorEnabled()` returns `true`:

```ts
if (isLiveConductorEnabled()) {
  await supabase
    .from('walkthrough_state')
    .update({
      live_conductor_tab_index: 0,
      live_conductor_visual: null,
      live_conductor_tab_turn_count: 0,
    })
    .eq('user_id', userId!)
}
```

No other read or write in the route changes. No new table, column, API
call, or storage location is introduced.

**New import required** (file currently does not import this helper):

```ts
import { isLiveConductorEnabled } from '@/lib/voice/live-conductor-bridge'
```

`isLiveConductorEnabled()` is defined at
`lib/voice/live-conductor-bridge.ts:38`:

```ts
export function isLiveConductorEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED === 'true'
}
```

It is a synchronous, side-effect-free read of a single environment variable
— it cannot throw, cannot be `undefined`-returning (it always evaluates a
`===` comparison, which always yields a boolean), and requires no
initialization. This is the same helper already used server-side in
`app/api/clio/chat/completions/route.ts:300`, so this fix introduces no new
pattern.

## 7. Success Criteria (Acceptance Tests)

✓ Given `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED` is unset or `"false"`, when a
session is started via `POST /api/sessions/[id]/start`, then the
`walkthrough_state` row for that user is not written to by this route at
all (no update call is issued for the live-conductor columns).

✓ Given `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED=true`, when a session is started,
then `walkthrough_state.live_conductor_tab_index`, `live_conductor_visual`,
and `live_conductor_tab_turn_count` are reset to `0`, `null`, `0`
respectively for that `user_id` — identical to today's behavior.

✓ Given the flag is off, when a session is started, then every other
behavior of the route (auth check, plan-approval check, minutes-balance
checks, `sessions` table update, `writeAuditEvent` call, `mintAuditToken`
call, Inngest `clio/session.started` emission, response shape) is completely
unchanged.

✓ Given the fix is applied, when `npx tsc --noEmit` is run, then it passes
with zero new errors.

✓ Given the fix is applied, when reviewing the diff, then no file other than
`app/api/sessions/[id]/start/route.ts` has been modified.

## 8. Error States

- **If `isLiveConductorEnabled()` itself throws:** Not a realistic failure
  mode — the function is a pure synchronous string comparison against
  `process.env`, which cannot throw in Node/Next.js runtime. No try/catch is
  required around this check. (See Section 11 resolution below — this was
  the one point flagged as needing explicit confirmation, resolved by
  reading the function body directly.)
- **If the Supabase update inside the guard fails** (e.g. transient DB
  error): behavior is unchanged from today — the existing code has no error
  handling around this `await supabase...update(...)` call today (no
  try/catch, no `.catch()`), and this fix does not add or remove any error
  handling. This fix only adds the flag condition around the existing call;
  it does not change how failures from that call are handled.

## 9. Edge Cases

- **Sessions/users that already have live-conductor state written from
  before this fix ships** (e.g. `live_conductor_tab_index` already non-zero
  from a prior test with the flag on): left completely alone. This is
  explicitly not a data migration. No backfill, cleanup, or reset of
  existing `walkthrough_state` rows is in scope. Those rows simply stop
  being touched by `/start` unless/until the flag is turned back on for that
  environment.
- **Flag flipped mid-rollout (on for some users, off for others):** out of
  scope for this fix — `isLiveConductorEnabled()` is a single global
  environment variable, not per-user. This fix does not change that; it
  only ensures the existing global flag is actually respected at this call
  site, matching how it's already respected at the other existing call site
  (`chat/completions/route.ts`).
- **Concurrent session starts for the same user:** no change in behavior —
  this fix does not alter concurrency handling, locking, or ordering of the
  update; it only gates whether the update fires at all.

## 10. Out of Scope

- No UI changes of any kind.
- No changes to any file other than `app/api/sessions/[id]/start/route.ts`.
- No removal of the live-conductor feature or its code (`live-conductor-bridge.ts`,
  `live-conductor-client.ts`, `WalkthroughClient.tsx` live-conductor branches,
  etc.) — all of that remains exactly as-is.
- No changes to how `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED` is set, read
  elsewhere, or toggled (env config, Vercel dashboard, etc.).
- No data migration or backfill of existing `walkthrough_state` rows.
- No changes to the `sessions` table update, audit event write, audit token
  minting, or Inngest event emission in the same route — all of that is
  left untouched and unguarded, exactly as it is today.
- No changes to error handling around the Supabase update call — the fix
  only adds the flag condition, it does not add new try/catch or logging.

## 11. Open Questions

None. The one candidate ambiguity — whether `isLiveConductorEnabled()` could
throw or return `undefined`, which would need a fallback — was resolved by
reading the function directly at `lib/voice/live-conductor-bridge.ts:38`: it
is a single synchronous `process.env.X === 'true'` comparison, which always
returns a boolean and cannot throw. No fallback or defensive wrapping is
needed.

## 12. Dependencies

- `lib/voice/live-conductor-bridge.ts` must continue to export
  `isLiveConductorEnabled` with its current signature (`(): boolean`, no
  arguments) — no change requested or required to that file.
- No database migration required.
- No new environment variable required — `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED`
  already exists and is already read elsewhere in the codebase.
