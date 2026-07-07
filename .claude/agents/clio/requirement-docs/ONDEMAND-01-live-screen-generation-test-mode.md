# On-Demand Live Screen Generation Test Mode (ONDEMAND-01) — Requirement Document
Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-07

## 1. Purpose

Today, before a live Clio coaching call starts, the entire set of teaching screens (tabs) for a
live-conductor session is generated up front and written to `sessions.live_conductor_content` /
`walkthrough_state` before the Recall.ai bot joins the call. This is safe and fast for real users,
but it means we cannot observe what happens if content is instead generated live, one screen at a
time, exactly when Clio is ready to teach it — which is a different latency/quality profile
entirely (per-tab generation calls happen mid-call instead of pre-call).

Arun wants a disposable, server-side test-mode toggle that, when enabled, generates only the
Overview screen up front and defers generation of every subsequent tab until the moment Clio's
`advance_tab` tool call signals she is ready to move on. This lets the team observe real
generation latency and content quality in a live setting without touching, risking, or degrading
the default (pre-built) behavior that real users experience today.

Without this feature: the team has no way to validate whether fully-live, on-the-fly generation
is viable as a future default, and any attempt to test it today would require directly modifying
the production content-assembly path — an unacceptable risk to real users mid-call.

## 2. User Story

As Arun (product owner, acting as an internal tester),
I want to flip a server-side env var and have a live coaching call generate each teaching screen
only when Clio is about to teach it, instead of generating everything up front,
So that I can observe live-generation latency and quality without touching the production
pre-built-content path that real users rely on.

As a real user on a live call (toggle OFF — the default, and the only state a real user will ever
experience),
I want the session to work exactly as it does today,
So that this test mode has zero risk or effect on my session.

There is no additional end-user-facing UI in this feature. It is an internal, env-var-gated,
server-side behavior toggle with no dashboard control, no settings page, and no user-visible
indicator.

## 3. Trigger / Entry Point

- **Toggle mechanism**: a new server-side environment variable, read only in
  `app/api/recall/bot/route.ts` (Node/server runtime, never sent to the client, never prefixed
  `NEXT_PUBLIC_`).
- **Exact name**: `LIVE_CONDUCTOR_ONDEMAND_TEST` (boolean-style string, `'true'` = on, anything
  else/unset = off — matches the existing convention used by `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED`
  in `lib/voice/live-conductor-bridge.ts` line 39 and `CLIO_CONTEXT_MODE` in `route.ts` line 237).
- **Where it's read**: inside `POST /api/recall/bot`, in the same code region as the existing
  `hasLiveConductorContent` branch (route.ts lines 274–344), immediately after that block. It only
  has any effect when `hasLiveConductorContent` is already true (i.e., the live-conductor pipeline
  is active for this session) — this toggle is an additional gate layered on top of that existing
  branch, never a replacement for it.
- **What action triggers content assembly**: same as today — a POST to `/api/recall/bot` when a
  user launches a live coaching call (`handleLaunchBot` in `SessionDetailClient.tsx`, which always
  calls `POST /api/sessions/[id]/start` first, then this route).
- **What state the user must be in**: identical to today — authenticated (Clerk), a `sessionId`
  that already has `live_conductor_content` populated with `content_status: 'ready'` and at least
  one tab (i.e., `generateLiveConductorContent` has already run for tab-1-equivalent content, same
  precondition as production today). This toggle does not change when/how that initial generation
  happens — only what gets written to `walkthrough_state` afterward.
- **During the call**: the ongoing trigger for "generate the next screen now" is the existing
  `advance_tab` tool call, handled in `lib/voice/live-conductor-bridge.ts`, `handleAdvanceTab()`
  (lines 305–367). See Section 4 for the exact hook point.

## 4. Screen / Flow Description

There is no new UI screen. This section describes the **content-assembly and delivery flow**
instead, as the brief requires, contrasting toggle-off (today) vs toggle-on (test mode).

### Toggle OFF (default — today's production behavior, unchanged)

1. `POST /api/recall/bot` is called for a session with live-conductor content ready.
2. `hasLiveConductorContent` evaluates true (route.ts lines 278–280).
3. The full `tabs` array from `sessions.live_conductor_content.tabs` is mapped into
   `freshSections` and `trainingScripts` (route.ts lines 294–344) — every tab, all at once.
4. `wrapSectionsWithBookends()` wraps all real tabs with Overview (index 0) and Summary
   (index N+1) — full N+2 array (route.ts lines 373–375).
5. The full `sectionsWithOverview` array is written to `walkthrough_state.sections` in Step 3
   (route.ts lines 386–407), **before** the bot joins the call.
6. The bot joins; Clio has the full tab set immediately, `advance_tab` calls in
   `handleAdvanceTab()` simply advance `live_conductor_tab_index` and kick off visual generation
   for a tab whose *content* already exists — no content generation happens mid-call.

### Toggle ON (test mode)

1. `POST /api/recall/bot` is called for the same kind of session.
2. `hasLiveConductorContent` evaluates true, same as today (no change to that check).
3. **New branch**: if `LIVE_CONDUCTOR_ONDEMAND_TEST === 'true'`, instead of mapping every tab from
   `liveConductorContent.tabs`, only the Overview bookend is built via
   `buildOverviewTeachContent()` (unmodified, `lib/templates/session-bookends.ts` line 45) using
   the tab titles as the agenda list (same agenda data `wrapSectionsWithBookends` already computes
   — no new data source). `freshSections` is set to `[overviewSection]` only (a 1-element array,
   not the full N+2). `trainingScripts` is set to `[]`.
4. `walkthrough_state.sections` is written with **only the Overview section** — `current_section_index: 0`,
   `sections_loaded_at` set as today.
5. Bot joins the call. Clio teaches the Overview/agenda exactly as she would today (no change to
   Overview behavior).
6. When Clio finishes the Overview and calls `advance_tab` (the same tool call used in production
   today), `handleAdvanceTab()` in `live-conductor-bridge.ts` detects on-demand test mode is active
   for this session (see Section 6 for how it knows) and, instead of assuming tab N+1's content
   already exists in `content.tabs`, calls the existing content-generation function
   `generateLiveConductorContent()` (or, more precisely, its lower-level building block
   `buildLiveConductorTabs()` in `lib/content/live-conductor-content.ts`, scoped to just the one
   next subtopic — see Section 6) live, in the background, non-blocking — mirroring the existing
   async pattern already used for visual generation (`generateLiveVisualWithTimeout`).
7. Once generated, the new tab's content is appended to the session's in-memory/DB tab list and
   `live_conductor_tab_index` is advanced, exactly as today. Clio's natural conclusion/segue speech
   (already relied upon in production to cover visual-generation latency, per the comment in
   `handleAdvanceTab`) covers this content-generation latency the same way.
8. If generation is slow or fails: the defined fallback in Section 8 applies. The call is never
   dropped, never hangs.
9. This repeats for every `advance_tab` call until the last tab, then `end_session` proceeds
   exactly as today (Summary bookend logic in `wrapSectionsWithBookends` is unaffected since it
   already runs client/bridge-side off whatever tabs exist at session end).

## 5. Visual Examples

Not applicable as UI wireframes — this is a server-side toggle with no screen of its own. In place
of wireframes, the before/after flow diagram below documents the two content-assembly paths.

```
TOGGLE OFF (production, unchanged)
──────────────────────────────────
POST /api/recall/bot
   │
   ├─ hasLiveConductorContent? ──yes──> map ALL tabs → freshSections (N tabs)
   │                                    wrapSectionsWithBookends → [Overview, T1..TN, Summary]
   │                                    write ALL sections to walkthrough_state
   │
   └─ bot joins call ── Clio has full tab set from turn 1
                         advance_tab → index++ only (content already exists)


TOGGLE ON (test mode)
──────────────────────
POST /api/recall/bot
   │
   ├─ hasLiveConductorContent? ──yes──┐
   │                                  ├─ LIVE_CONDUCTOR_ONDEMAND_TEST=true?
   │                                  │     yes → build ONLY Overview via
   │                                  │           buildOverviewTeachContent()
   │                                  │           write [Overview] to walkthrough_state
   │                                  │     no  → (existing full-tab path, unchanged)
   │
   └─ bot joins call ── Clio teaches Overview only
                         │
                         advance_tab (tab 1→2) ──> handleAdvanceTab() detects on-demand mode
                                                     │
                                                     ├─ generate tab 2 content live (async,
                                                     │   non-blocking, retry loop — mirrors
                                                     │   existing generateLiveVisualWithTimeout
                                                     │   pattern)
                                                     │
                                                     ├─ success → append tab, advance index,
                                                     │            Clio teaches new content
                                                     │
                                                     └─ slow/fail → fallback flow (Section 8),
                                                                    call never hangs/drops
                         (repeats per advance_tab until last tab → end_session, unchanged)
```

## 6. Data Requirements

### Read
- `sessions.live_conductor_content` (existing column) — read as today for `hasLiveConductorContent`
  detection and (toggle-on) as the source of the ordered subtopic list (titles/slugs) used to
  drive on-demand generation order, so tab order is identical to what would have been pre-built.
- `process.env.LIVE_CONDUCTOR_ONDEMAND_TEST` — new server-side env var, read in
  `app/api/recall/bot/route.ts` only.
- `walkthrough_state` (existing table/row) — read for `live_conductor_tab_index`,
  `live_conductor_tab_turn_count` exactly as today in `getLiveConductorState()`.

### Written
- `walkthrough_state.sections` — toggle-on: written with a 1-element array (Overview only) at
  session start instead of the full N+2 array. Same column, same write call
  (`supabase.from('walkthrough_state').upsert(...)` in route.ts Step 3), only the payload differs.
- `walkthrough_state.live_conductor_tab_index`, `live_conductor_visual`,
  `live_conductor_tab_turn_count` — written exactly as today by `handleAdvanceTab()`, no schema
  change.
- **New, in-memory only, NOT a new DB column**: on-demand-generated tab content is held in the
  same in-memory `LiveConductorContent`/`LiveConductorTab[]` shape already used by
  `getLiveConductorState()` / `handleAdvanceTab()` for the duration of the call. See Section 11,
  Resolved Question 5 for the full persistence decision — summary: **ephemeral, no new-row writes
  to `topic_content_cache` or `sessions.live_conductor_content`** while the toggle is on.
- No new tables, no new columns, no migration required.

### APIs called
- `generateLiveConductorContent()` / `buildLiveConductorTabs()` (`lib/content/live-conductor-content.ts`)
  → internally calls `generateContentArticles()` (`lib/content/session-content-generator.ts`) →
  Anthropic Messages API (`@anthropic-ai/sdk`, model `claude-sonnet-4-6`), the same call already
  made pre-call in production. No new external vendor, no new SDK.

### localStorage/sessionStorage
None. This feature is entirely server-side; no client-side storage involved.

## 7. Success Criteria (Acceptance Tests)

This feature has no independent browser-testable UI flow — QA cannot click through a screen for
this feature. Acceptance tests below are verified via environment variable behavior, server logs,
and DB row state, per the brief's explicit instruction. Each test states exactly what a QA agent
can check and how.

✓ Given `LIVE_CONDUCTOR_ONDEMAND_TEST` is unset (or any value other than `'true'`), when a live
  session with `live_conductor_content` ready is launched via `POST /api/recall/bot`, then
  `walkthrough_state.sections` is written with the full N+2 array (Overview + all N tabs +
  Summary) — identical row shape and length to a production launch today. Verify via
  `execute_sql` / admin query on `walkthrough_state.sections` length immediately after the POST
  returns 200.

✓ Given `LIVE_CONDUCTOR_ONDEMAND_TEST=true`, when the same session is launched, then
  `walkthrough_state.sections` is written with exactly 1 element (`type: 'SessionOverview'`) and
  `current_section_index: 0`. Verify via the same query, asserting `sections.length === 1` and
  `sections[0].type === 'SessionOverview'`.

✓ Given the toggle is ON and the call is in progress, when Clio's `advance_tab` tool call fires
  for the first time (leaving the Overview), then a log line matching
  `[live-conductor-bridge] on-demand: generating tab N live` (or equivalent, see Section 9 dev
  note) appears in server logs within the same request cycle, and no row is written to
  `topic_content_cache` or `sessions.live_conductor_content` as a result of this generation
  (verify via `get_advisors`/`execute_sql` row-count-before vs row-count-after check on both
  tables scoped to this `session_id`).

✓ Given the toggle is ON and on-demand generation for the next tab succeeds within the retry
  budget (mirroring `generateLiveVisualWithTimeout`'s existing ~40s worst case), when generation
  completes, then `walkthrough_state.live_conductor_tab_index` advances and the voice
  session/call is not dropped (verify via Recall.ai bot status / call duration continuing past
  the generation window, and absence of any `4xx`/`5xx`/disconnect log line tied to this request).

✓ Given the toggle is ON and on-demand generation for the next tab fails or exceeds the full retry
  budget, when this happens mid-call, then the fallback behavior defined in Section 8 fires (a
  specific log line + Clio continues speaking using existing topic-background context, never a
  dropped call), and the call continues to `end_session` normally. Verify via server logs showing
  the fallback path log line and the call's `end_session` / `endCallOnServer` firing at the
  expected end of the session, not prematurely.

✓ Given the toggle is ON and the participant reaches the last tab, when Clio calls `end_session`,
  then session end behaves identically to today — no toggle-specific difference in the
  Summary/end-of-call path (verify via existing end-session log lines and `walkthrough_state`
  final state, same as a production toggle-off session).

✓ Given the toggle is flipped from `true` to unset/`false` between two separate session launches
  (not mid-call — see Section 9 edge case), when the second session is launched, then it uses the
  full-tab-set (toggle-off) path with no residual on-demand state — verify no in-memory or DB
  state persists between separate `POST /api/recall/bot` invocations (each call re-reads
  `process.env` fresh; no module-level caching of the toggle value beyond a single request).

## 8. Error States

**This section is safety-critical: the brief requires an explicit, non-"TBD" fallback for slow or
failing on-demand generation while a real user is on a live call.**

### On-demand tab-content generation is slow (exceeds per-attempt timeout)
- Mirrors the existing, already-shipped pattern in `generateLiveVisualWithTimeout`
  (`lib/content/live-conductor-visual.ts` lines 165–202): each generation attempt races against a
  per-attempt timeout (reuse `LIVE_CONDUCTOR_VISUAL_ATTEMPT_TIMEOUT_MS`, currently ~4s, from
  `lib/content/live-conductor-prompt.ts` — same constant, not a new one, so ops behavior stays
  consistent across both visual and content on-demand generation), retried up to the existing
  `LIVE_CONDUCTOR_VISUAL_MAX_ATTEMPTS` (currently used for visuals; reuse the same constant/value
  for content-generation attempts in this test mode rather than inventing a second timeout budget).
- While generation is in flight, the call is **never blocked**: `handleAdvanceTab()` already
  returns its `resultText` to the model immediately (fire-and-forget generation, exactly as
  visuals work today) — Clio's natural conclusion/segue speech for the tab she just finished
  covers this latency, same mechanism already in production for visuals.
- **Holding behavior**: the `resultText` returned to the model on advance (already contains
  language like "keep speaking naturally... until it's ready") is extended, for the on-demand
  test-mode path only, to explicitly instruct: "The next topic's material is still being
  prepared — continue your closing thought on the previous topic for a few more seconds; do not
  go silent and do not tell the user you are waiting." This reuses the existing prompt-instruction
  mechanism (no new UI holding screen, no new audio cue — consistent with how visual-generation
  latency is already handled today).

### On-demand generation fails after all retries (returns null/throws)
- **Fallback (defined, not TBD)**: fall back to a **generic, deterministic, no-LLM placeholder
  tab** built from data already known at zero latency risk — the subtopic title (already present
  in `live_conductor_content.tabs[].subtopic_title`, since even in on-demand mode the ordered list
  of subtopic titles was already known from Layer 1 planning, only Layer 2's rich `ContentArticle`
  body is deferred). The placeholder tab's content is: `"We're covering: <subtopic_title>. Let's
  talk through what this means for a <role> in <industry>."` — a single deterministic sentence,
  identical in spirit to `buildFallbackBackground()`'s existing non-LLM fallback pattern in
  `live-conductor-content.ts` lines 143–154 — so Clio has *something* concrete to teach from
  rather than dead air or a crash. This placeholder is never persisted anywhere (ephemeral, same
  as Section 11 Q5 decision) and is clearly logged as a fallback firing
  (`console.error('[live-conductor-bridge] on-demand generation failed for tab, using placeholder fallback: ...')`)
  so QA/ops can see it happened.
- The call **continues** — `live_conductor_tab_index` still advances, `advance_tab` still returns
  a valid `resultText`, and Clio proceeds to "teach" the placeholder content and can still call
  `advance_tab` again normally afterward. The session is never terminated by a generation failure.
- This mirrors the existing precedent of `generateLiveVisualWithTimeout` returning `null` on total
  failure, where the caller's existing behavior is "text-only, Clio keeps talking normally" — the
  same philosophy applied here to on-demand *content* rather than *visuals*.

### Anthropic API key is a placeholder / mocked
- Reuses the existing mock guard already in `live-conductor-content.ts` (lines 41–46,
  `generateTopicBackground`'s mock branch, and the equivalent mock path inside
  `generateContentArticles`) — on-demand generation in test mode calls the exact same generation
  function, so it automatically inherits the existing mock-content behavior with zero additional
  code. No new mock needed.

### Toggle is on but `hasLiveConductorContent` is false (no live-conductor content at all)
- No change from today: the toggle only has any effect nested inside the existing
  `hasLiveConductorContent` block. If that's false, the toggle is a no-op and the pre-existing
  (non-live-conductor) path in `route.ts` runs completely unaffected.

## 9. Edge Cases

- **Toggle flipped mid-session (env var changed while a call is already in progress)**: not
  possible in the sense the brief worries about — `process.env` is read once per `POST
  /api/recall/bot` request (at session *launch*, not per-turn), and `handleAdvanceTab()` re-checks
  the same env var per advance-tab call within that session's lifetime. If ops changes the env var
  mid-call (requires a redeploy/restart in this stack), in-flight serverless function instances
  may retain the old value until the platform cycles instances — this is an accepted, documented
  limitation identical to how every other env-var toggle in this codebase behaves
  (`NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED`, `CLIO_CONTEXT_MODE`, etc. share this same characteristic).
  No new risk introduced by this feature specifically.
- **`advance_tab` fires twice rapidly (double-fire from the model) while on-demand generation for
  the previous advance is still in flight**: reuse the existing in-memory guard pattern
  (`tab1GenerationInFlight` Set, `live-conductor-bridge.ts` line 120) — extend the same
  concurrency-guard approach keyed by `userId` + target tab index so a second rapid `advance_tab`
  for the same transition does not kick off a duplicate generation call. If the model calls
  `advance_tab` twice for two genuinely different tabs before the first's generation resolves, both
  proceed independently (rare in practice given the model must speak the returned `resultText`
  between calls) — worst case is two generation calls in flight, both non-blocking, no crash.
- **Last tab reached in on-demand mode**: `handleAdvanceTab()` already returns `isLastTab: true`
  and a "this is already the last tab" message without attempting any generation (lines 313–316) —
  this existing check runs before any on-demand branch would fire, so there is no
  generate-past-the-end case to handle.
- **Session ends (`end_session` called) before the next tab's on-demand generation resolves**: the
  in-flight generation promise is fire-and-forget and un-awaited by the request/response cycle
  (same pattern as today's visual generation) — if the call ends first, the generation either
  completes and writes to in-memory state that is simply never read again (harmless no-op), or is
  abandoned by the serverless function tearing down. Neither case throws, blocks session end, or
  writes to a persistent table (per the ephemeral decision in Section 11 Q5), so there is nothing
  to clean up.
- **Toggle ON for a curriculum session that has zero live-conductor tabs (edge of the
  `hasLiveConductorContent` guard)**: falls through to the existing `isCurriculumSession &&
  freshSections.length === 0` guard (route.ts lines 349–362), returning the same
  `CONTENT_NOT_READY` 400 error as today — untouched, since the on-demand branch only ever
  executes after `hasLiveConductorContent` is confirmed true.
- **Mobile vs desktop**: not applicable — no UI surface for this feature; the call experience
  (voice-only + Recall.ai bot view) is identical regardless of the participant's device.
- **User skips optional steps**: not applicable — no onboarding/optional-step interaction exists
  in this feature.
- **Slow network / API timeout on the Anthropic call itself** (as opposed to slow model
  reasoning): already covered by the retry-with-timeout mechanism in Section 8; a network-level
  hang is treated identically to a slow generation and eventually falls back to the placeholder.

## 10. Out of Scope

- No dashboard UI, admin panel, or visible toggle control for `LIVE_CONDUCTOR_ONDEMAND_TEST` —
  it is set only via deployment environment configuration (e.g., Vercel env vars), never surfaced
  in-app.
- No change to `NEXT_PUBLIC_REALTIME_VISUAL_TEST` or the legacy client-side fallback path it
  controls — confirmed unrelated and untouched (see Section 12).
- No change to `buildOverviewTeachContent()` itself — reused exactly as-is.
- No change to the toggle-off content-assembly path in `route.ts` — the existing full-tab-set
  branch is not modified, only extended with an additional conditional branch nested inside the
  existing `hasLiveConductorContent` block.
- No persistence of on-demand-generated content to `topic_content_cache` or
  `sessions.live_conductor_content` (see Section 11, Q5) — this is explicitly out of scope for
  this test mode; a future feature could add opt-in persistence if the test validates the
  approach, but that is not part of ONDEMAND-01.
- No changes to the Summary bookend, `end_session` handling, or any post-call flow (KB writes,
  billing/audit events) — all unaffected and unmodified.
- No load-testing or concurrency-at-scale guarantees — this is explicitly a single-tester,
  disposable validation tool, not a production-hardened concurrent-user feature.
- No new automated E2E/Playwright test suite — this feature is not independently browser-testable
  (see Section 7); QA verification is log/DB-based only, as explicitly scoped by the brief.

## 11. Open Questions

None. All 5 questions from the Feature Brief are resolved below.

**Q1 (env var + branch point) — RESOLVED.** New var: `LIVE_CONDUCTOR_ONDEMAND_TEST` (string
`'true'` = on), server-side only, read in `app/api/recall/bot/route.ts` immediately after the
existing `hasLiveConductorContent` block (after line 344, before the "Guard: refuse to launch"
check at line 349). When true AND `hasLiveConductorContent` is true, `freshSections` is
overridden to a 1-element Overview-only array (built via `buildOverviewTeachContent()`) instead of
the full tab-mapped array computed at lines 294–323; `trainingScripts` is set to `[]`. When false
(default) or `hasLiveConductorContent` is false, code at lines 274–344 executes completely
unchanged.

**Q2 (trigger mechanism + reused function) — RESOLVED.** Confirmed by reading
`lib/voice/live-conductor-bridge.ts`: the hook point is `handleAdvanceTab()` (lines 305–367),
called both from the model's genuine `advance_tab` tool call and from the server-forced
`FORCE_AT_TURN` backstop. The real, existing per-tab content-generation function to reuse is
`generateLiveConductorContent()` (or its constituent `buildLiveConductorTabs()`, which itself
calls `generateContentArticles()` from `lib/content/session-content-generator.ts`) in
`lib/content/live-conductor-content.ts` — confirmed by reading the file directly; this is a real
exported function, not invented. `handleAdvanceTab()` gains a new on-demand-mode branch:
instead of assuming `content.tabs[newIndex]` already has a populated `ContentArticle`, it checks
whether that tab's article body is present; if not (on-demand mode), it calls
`buildLiveConductorTabs()` scoped to just that one subtopic title, mirroring the existing
fire-and-forget async pattern already used for `generateLiveVisualWithTimeout` immediately below
it (lines 338–354).

**Q3 (failure/slowness fallback) — RESOLVED.** Fully specified as a concrete flow in Section 8
above: per-attempt timeout + retry loop reusing existing `LIVE_CONDUCTOR_VISUAL_ATTEMPT_TIMEOUT_MS`
/ `LIVE_CONDUCTOR_VISUAL_MAX_ATTEMPTS` constants; non-blocking fire-and-forget generation covered
by Clio's natural transition speech (extended with an explicit "keep talking, don't go silent"
instruction for the on-demand case); on total failure, a deterministic non-LLM placeholder tab
(subtopic title + generic framing sentence, same philosophy as the existing
`buildFallbackBackground()` non-LLM fallback) is used so Clio always has something to teach and
the call is never dropped, never hangs, and never crashes.

**Q4 (zero-impact-when-off verification plan) — RESOLVED.** See Section 12 below for the full
QA-handoff checklist of exact grep/read commands and code paths.

**Q5 (persist vs ephemeral) — RESOLVED, confirming the brief's ephemeral recommendation.**
On-demand-generated tab content during this test mode is **ephemeral — no writes to
`topic_content_cache` or `sessions.live_conductor_content`**. Justification: (a) this is
explicitly a disposable validation tool per Arun's brief, not a feature intended to produce
reusable output; (b) writing test-mode content into the same cache rows real users' pre-built
pipeline reads from risks exactly the kind of silent cross-contamination the standing rule in
`feedback_no_impact_existing_no_delete.md` warns against — even a `_test`-suffixed key adds
surface area (schema questions, cleanup-job questions, cache-invalidation questions) for a feature
whose entire purpose is to be thrown away after observation; (c) nothing in Arun's stated success
criteria requires reuse — he wants to observe latency/quality live, not build a reusable cache
warm-up path. If a future feature wants to promote on-demand generation into a real product
behavior, that would be a separate, deliberately-scoped feature with its own persistence design —
not a side effect of this test toggle.

## 12. Dependencies

- `sessions.live_conductor_content` must already be populated (`content_status: 'ready'`, at least
  one tab) for the target session — same precondition as production today. This feature does not
  change how that initial content is produced.
- `LIVE_CONDUCTOR_VISUAL_ATTEMPT_TIMEOUT_MS` and `LIVE_CONDUCTOR_VISUAL_MAX_ATTEMPTS` constants
  (`lib/content/live-conductor-prompt.ts`) must continue to exist as currently defined — reused,
  not duplicated.
- `generateLiveConductorContent()` / `buildLiveConductorTabs()` / `generateContentArticles()` must
  remain callable with a single-subtopic-title scope (confirm during implementation that
  `buildLiveConductorTabs()`'s `subtopicTitles: string[]` parameter accepts a 1-element array
  cleanly — expected yes, since it already loops per-title internally via
  `generateContentArticles`).
- `buildOverviewTeachContent()` (`lib/templates/session-bookends.ts`) — used unmodified.
- No new npm packages, no new environment secrets, no DB migration required.

---

## Zero-Impact-When-Off Verification Plan (QA Handoff Checklist)

This is the explicit checklist BA is handing to QA/dev to prove the toggle-off path is
byte-for-byte identical to today's production behavior. This feature is **not independently
browser-testable as a UI flow** — there is no screen to click through. QA can verify only:
(a) env var behavior, (b) server log lines, (c) DB row state, (d) that a live call is not
dropped/hung. All items below are checkable via grep/read (static) or `execute_sql`/log inspection
(runtime) — no browser automation applies here.

### Static code checks (grep/read — prove the off-path is untouched)

1. `grep -n "LIVE_CONDUCTOR_ONDEMAND_TEST" app/api/recall/bot/route.ts` — must show the new check
   appears ONLY after line 344 (after the existing `hasLiveConductorContent` block closes), never
   inside or before it. If the grep shows the var referenced anywhere inside lines 274–344, the
   implementation has violated the "zero impact on existing branch" requirement — reject.
2. `git diff` (or equivalent PR diff) on `app/api/recall/bot/route.ts` — confirm lines 1–344 have
   **zero line changes**; all new code is strictly additive, inserted after line 344 and before
   line 349 (the existing content-not-ready guard).
3. `grep -n "LIVE_CONDUCTOR_ONDEMAND_TEST" lib/voice/live-conductor-bridge.ts` — confirm the new
   on-demand branch inside `handleAdvanceTab()` is an `if` guard around new code only, and that
   the existing `generateLiveVisualWithTimeout` call (lines 338–354) and its surrounding lines are
   unchanged when the flag is off.
4. `grep -rn "NEXT_PUBLIC_REALTIME_VISUAL_TEST" app/dashboard/walkthrough/WalkthroughClient.tsx`
   — confirm this still only appears at the previously-identified lines (~52, 732, 787, 976) and
   that no new reference to `LIVE_CONDUCTOR_ONDEMAND_TEST` has been added to this file — this
   confirms the new toggle was correctly kept server-side only and never leaked into the legacy
   client-side toggle's file, per the brief's explicit instruction not to reuse/extend it.
5. `grep -n "buildOverviewTeachContent\|wrapSectionsWithBookends" lib/templates/session-bookends.ts`
   — diff this file against its pre-change version; must show **zero changes** (brief requires
   `buildOverviewTeachContent()` untouched).
6. Confirm no new columns/migrations: `ls supabase/migrations/ | tail -5` before/after — no new
   migration file should be added for this feature (Section 12 — no DB schema change required).

### Runtime checks (toggle OFF — must match today's production behavior exactly)

7. With `LIVE_CONDUCTOR_ONDEMAND_TEST` unset in the environment, launch a live-conductor session
   via `POST /api/recall/bot` (use an existing test user/session with `live_conductor_content`
   ready). Query `walkthrough_state.sections` for that user immediately after: assert
   `sections.length === tabs.length + 2` (Overview + all real tabs + Summary) — identical shape to
   a pre-feature production launch.
8. Compare server logs for this request against a pre-feature baseline log for the same kind of
   session (same log lines: `"CONTENT-POP-01: mapped N live-conductor tabs..."`,
   `"pre-bot walkthrough_state upsert..."`) — no new or missing log lines in the toggle-off path.
9. Let the call proceed through at least 2 `advance_tab` calls with the toggle off; confirm no new
   log lines referencing "on-demand" or the new env var appear — the existing
   `generateLiveVisualWithTimeout` visual-generation log lines are the only generation-related logs
   present, exactly as today.

### Runtime checks (toggle ON — confirm test-mode behavior and confirm it never touches real data)

10. With `LIVE_CONDUCTOR_ONDEMAND_TEST=true`, repeat step 7: assert `sections.length === 1` and
    `sections[0].type === 'SessionOverview'`.
11. During the call, on each `advance_tab`, confirm via `execute_sql` that no new row appears in
    `topic_content_cache` and that `sessions.live_conductor_content` for this `session_id` is
    unchanged (same `generated_at` timestamp as before the call started) — proving ephemeral
    persistence (Section 11, Q5) held in practice, not just in code intent.
12. Confirm the call completes end-to-end (Overview → all tabs → `end_session`) without the
    Recall.ai bot disconnecting or the voice session erroring, including at least one
    intentionally-slow or forced-failure run (e.g., temporarily point `ANTHROPIC_API_KEY` at an
    invalid value for this one test call) to confirm the Section 8 placeholder-fallback path
    fires and the call still completes normally.

If all 12 checks pass, the toggle is verified zero-impact when off and behaves per spec when on.
