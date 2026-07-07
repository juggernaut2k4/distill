# Feature Brief: ONDEMAND-02 — On-Demand Live Tab Generation for Hume + Session-Brief Prompt Fix
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-07

## What Arun Said
Two confirmed bugs, already root-caused, to be fixed now (not re-investigated):

1. The "generate the next topic live when the current tab finishes" logic
   (`LIVE_CONDUCTOR_ONDEMAND_TEST` mode) is wired only into the old
   Custom-LLM/ElevenLabs bridge route (`app/api/clio/chat/completions/route.ts`),
   which is not used in real production calls. Arun's real live test uses the
   Hume-native voice architecture, whose `advance_tab` tool handler
   (`createAdvanceTabToolHandler()` in `lib/content/live-conductor-client.ts`,
   registered client-side in `app/dashboard/walkthrough/WalkthroughClient.tsx`
   Hume branch) is currently a no-op stub — it acknowledges the call and does
   nothing else. The on-demand generation logic must be made to actually run
   for Hume-native sessions, reusing the existing generation logic rather than
   duplicating it.

2. In on-demand mode, the `sections` array has only 1 entry (the Overview).
   `buildSessionBrief()` in `lib/clio-context-builder.ts` unconditionally tells
   Clio to "proceed to Section 1" even when no Section 1 exists — a literal
   contradiction in Clio's own instructions. Must be scoped to fire only when
   on-demand mode produces a single-entry `sections` array; normal
   multi-section sessions must be completely unaffected.

## The Problem Being Solved
Bug 1: the feature Arun is testing live (topics generating on-demand as the
session progresses) silently does nothing in the real product path. Clio
advances tabs but no new content is ever generated — this defeats the entire
purpose of on-demand test mode for the only path Arun actually uses.

Bug 2: Clio is given a self-contradictory instruction in on-demand mode,
which risks confusing or destabilizing her live behavior on the only section
that exists.

## What Success Looks Like
- With `LIVE_CONDUCTOR_ONDEMAND_TEST=true` and a Hume-native live session:
  when Clio calls `advance_tab`, the real on-demand generation pipeline
  (`generateOnDemandTabWithTimeout` → `buildOnDemandFallbackTab` on failure)
  actually runs server-side, exactly as it already does for the old
  `chat/completions` route — verified by server logs showing
  `[live-conductor-bridge] on-demand: generating tab N live` during a Hume
  session, not just the old route.
- The generation logic itself is not duplicated — both the old route and the
  new Hume path call the same underlying shared function(s) in
  `lib/voice/live-conductor-bridge.ts`.
- With the toggle off, or in any non-on-demand session, there is zero
  behavior change to the Hume `advance_tab` handler or to `buildSessionBrief`
  output — verified by diffing generated session-brief text before/after for
  a normal multi-section session.
- In on-demand mode with a 1-entry `sections` array, `buildSessionBrief()`
  no longer emits "proceed to Section 1" — it says something accurate, e.g.
  that the next section will be prepared live when Clio is ready to advance.

## Known Constraints
- Must stay gated behind `LIVE_CONDUCTOR_ONDEMAND_TEST` server-side env var
  — never `NEXT_PUBLIC_`-prefixed, never exposed to the client (per existing
  convention documented in `live-conductor-bridge.ts` lines 39-51).
- `handleAdvanceTab()` requires server-side context (`supabase` admin client,
  `UserContext`, `LiveConductorContent`) that a client-side tool handler
  cannot construct directly — Bug 1's fix requires a new or extended
  server-side entry point (e.g. API route) that the Hume client's
  `advance_tab` handler calls into. No such route currently exists — grepped
  confirmed only `chat/completions/route.ts` calls into
  `live-conductor-bridge.ts` today.
- `createAdvanceTabToolHandler()` (`lib/content/live-conductor-client.ts`) is
  intentionally client-bundle-safe today (no server-only imports). Any change
  must preserve that — it must call a new/existing API route, not import
  server-only modules directly.
- Bug 2's fix must be scoped ONLY to the on-demand single-section case.
  Normal sessions with multiple real sections must be byte-for-byte
  unaffected in `buildSessionBrief()` output.
- Do not duplicate `generateOnDemandTabWithTimeout` / `buildOnDemandFallbackTab`
  / `handleAdvanceTab` logic — extract/reuse, don't copy.
- No commit/push/deploy — build and verify locally only (`npx tsc --noEmit`
  clean, diff reviewed).

## Questions for BA
1. Exact contract for the new/extended server entry point the Hume client
   calls on `advance_tab`: new dedicated route (e.g.
   `POST /api/live-conductor/advance-tab`) vs. extending the existing
   `POST /api/walkthrough-state/[userId]` route with a new
   `command: 'advance_tab'` branch (that route already handles
   `scroll_to` / `insert_section` commands for this same user-scoped
   walkthrough_state resource). Recommend which pattern to use and why.
2. What does `createAdvanceTabToolHandler()` need as input (userId,
   userContext) to call that route, and where do those values come from in
   `WalkthroughClient.tsx`'s Hume branch at line 808 (is `userContext`
   already available in that scope, or does it need to be fetched)?
3. Exact detection condition and exact replacement copy for Bug 2 in
   `buildSessionBrief()` — must not touch normal multi-section behavior.
   Confirm the precise wording Clio should hear instead of "proceed to
   Section 1" in the single-Overview-only case.
4. Any interaction between the tab-stuck backstop (`NUDGE_AT_TURN`/
   `FORCE_AT_TURN`, currently only referenced in `chat/completions` route's
   caller) and the new Hume-side wiring — is that backstop in scope for this
   fix, or explicitly out of scope (Arun's brief only mentions
   `handleAdvanceTab`'s generation logic, not the backstop)?
