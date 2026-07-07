# Feature Brief: ONDEMAND-02 — Wire on-demand live generation into the Hume path + fix prompt contradiction

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 (blocks Arun's active live test of `LIVE_CONDUCTOR_ONDEMAND_TEST`)
Date: 2026-07-07

## What Arun Said

Arun is live-testing the "generate the next topic live when the current one finishes" feature
(`LIVE_CONDUCTOR_ONDEMAND_TEST`, built earlier this week) and it is not working end-to-end in his
real test — which uses the Hume-native voice architecture. Two confirmed, root-caused bugs are
blocking it, and both need fixing together, now.

## The Problem Being Solved

**Bug 1 — wiring gap.** The on-demand generation logic (`handleAdvanceTab()` in
`lib/voice/live-conductor-bridge.ts`) is only reachable from the old ElevenLabs/Custom-LLM bridge
route (`app/api/clio/chat/completions/route.ts`). Arun's real live test uses the Hume-native
architecture. In that path, the `advance_tab` tool the model calls is wired (in
`app/dashboard/walkthrough/WalkthroughClient.tsx`, both the Hume branch at ~line 808 and the other
client-side branch at ~line 1002) to `createAdvanceTabToolHandler()` in
`lib/content/live-conductor-client.ts:77-85` — a client-side stub that returns the string
`'Acknowledged — advancing to next tab.'` and does nothing else. No tab index advance, no on-demand
generation, no visual generation is ever triggered. `handleAdvanceTab()` requires server-only
dependencies (Supabase admin client, Anthropic calls) that cannot run in browser code, so this is a
missing server route, not a client-side fix.

**Bug 2 — prompt self-contradiction.** In on-demand mode, `sections = [overviewSection]` (only the
Overview — one entry). `buildSessionBrief()` in `lib/clio-context-builder.ts` (line 116) always
emits: `"Briefly walk through the agenda... then proceed to Section 1."` There is no "Section 1" in
on-demand mode — `buildSessionScript()` itself labels the sole section "SECTION 1/1" (the Overview).
Even if Bug 1 is fixed, Clio's own instructions tell her to proceed to a section that, per her own
prompt, doesn't exist — so she has no coherent reason to call `advance_tab`.

## What Success Looks Like

- In a Hume-native live session with `LIVE_CONDUCTOR_ONDEMAND_TEST=true`, when Clio calls
  `advance_tab`, the exact same server-side generation logic already built in
  `handleAdvanceTab()` (tab index advance, on-demand content generation with timeout/retry,
  fallback placeholder, live visual generation) actually runs — reached via a new thin server route
  the Hume client-side handler calls, rather than by moving `handleAdvanceTab`'s logic into the
  browser bundle.
- `WalkthroughClient.tsx`'s existing poll loop (`liveConductorRef` / `applyLiveConductorPoll`,
  already wired at ~line 1296) picks up the resulting tab index and visual exactly as it does today
  for the old-route path — no changes needed there.
- In on-demand mode, `buildSessionBrief()` produces accurate instructions that describe the actual
  session shape (Overview only, next topic generated live on `advance_tab`) instead of referencing a
  nonexistent "Section 1."
- **Zero impact when `LIVE_CONDUCTOR_ONDEMAND_TEST` is off or unset.** Normal (non-on-demand)
  sessions, and the old ElevenLabs/Custom-LLM route's existing behavior, must be byte-for-byte
  unchanged.

## Known Constraints

- Standing rule (Arun, 2026-07-03): never regress topic selection / LLM topic generation / session
  generation; flag any needed change to existing code explicitly; never delete code without
  explicit yes.
- Standing rule (Arun, 2026-07-03): all dev, even small fixes, needs a spec + CEO approval before
  code — no exceptions.
- Must reuse `handleAdvanceTab()`'s actual generation logic (`generateOnDemandTabWithTimeout`,
  `buildOnDemandFallbackTab`, the visual-generation fire-and-forget chain) — do not duplicate this
  logic in a second implementation.
- Must remain gated behind `process.env.LIVE_CONDUCTOR_ONDEMAND_TEST === 'true'` exactly as today —
  read fresh server-side, never `NEXT_PUBLIC_`-prefixed, never exposed to the client.
- Bug 2's fix must be scoped ONLY to the on-demand single-section case. Multi-section (normal) prompt
  text must be completely unchanged.
- No new npm packages. Approved stack only (Next.js API routes, existing Supabase/Anthropic clients).
- Do not commit, push, or deploy. Arun is testing live and will decide when to ship.

## Questions for BA

1. What is the exact contract (route path, method, request/response shape, auth) for the new server
   route that the Hume-side `advance_tab` client handler will call to trigger `handleAdvanceTab()`?
   How does it resolve `userId`, `content` (LiveConductorContent), `currentTabIndex`, and
   `userContext` server-side (mirroring how `getLiveConductorState` already resolves session/content
   today) so the client only needs to pass `userId`?
2. Should `createAdvanceTabToolHandler()` in `lib/content/live-conductor-client.ts` be modified in
   place (gated internally on `LIVE_CONDUCTOR_ONDEMAND_TEST`-equivalent client awareness, e.g. by
   always calling the new route and letting the route itself no-op when the toggle is off), or should
   a second, ONDEMAND-specific handler be introduced and swapped in only at the two Hume/legacy call
   sites when a client-visible flag indicates on-demand mode is active? Resolve which keeps the
   "old path completely untouched" constraint cleanest — note `createAdvanceTabToolHandler()` is used
   by BOTH the Hume branch (line ~808) and the second client-side branch (line ~1002) in
   `WalkthroughClient.tsx`, so whatever approach is chosen must not regress the second call site
   either.
3. Exact wording for the corrected on-demand-mode agenda instruction in `buildSessionBrief()`
   (replacing "then proceed to Section 1"), and the precise, minimal detection condition for
   "this is on-demand single-section mode" inside that function (a new explicit boolean parameter is
   preferred over sniffing `sections.length === 1` + title-string matching, to avoid false positives
   for any other single-section scenario that might exist — confirm none does before ruling this out).
4. Does the new route need to handle the `forced` (server-backstop, `FORCE_AT_TURN`) case at all for
   the Hume path in this pass, or is that explicitly out of scope for this fix (Hume's tab-stuck
   backstop, if any, may be a separate concern) — state this explicitly as in-scope or out-of-scope.
5. Confirm test plan: what specific manual verification (with the toggle on, in a live or simulated
   Hume session) and what specific regression check (toggle off, normal multi-section session)
   constitutes "done" for this fix, given Arun does the live QA himself.

Zero ambiguity tolerated — Section 11 (Open Questions) of the resulting requirement document must be
fully resolved before any code is written.
