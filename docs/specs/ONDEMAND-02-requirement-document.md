# ONDEMAND-02 — Wire on-demand live generation into the Hume path + fix prompt contradiction — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-07

## 1. Purpose

`LIVE_CONDUCTOR_ONDEMAND_TEST` is a disposable, server-side-only test toggle Arun built this week to
test generating the next topic's content live, mid-session, instead of pre-generating everything
upfront. Arun is live-testing it right now using the Hume-native voice architecture (the production
path) and it does not work end-to-end. Two confirmed, root-caused bugs block it:

- **Bug 1 (wiring gap):** the server-side generation logic that actually does the work
  (`handleAdvanceTab()` in `lib/voice/live-conductor-bridge.ts`) is only reachable from the old
  ElevenLabs/Custom-LLM bridge route (`app/api/clio/chat/completions/route.ts`). The Hume path's
  `advance_tab` tool handler is a client-side stub (`createAdvanceTabToolHandler()` in
  `lib/content/live-conductor-client.ts`) that just returns an acknowledgement string and does
  nothing else — no tab advance, no content generation, no visual generation.
- **Bug 2 (prompt contradiction):** in on-demand mode, `buildSessionBrief()` always tells Clio to
  "proceed to Section 1" — but on-demand sessions have no Section 1 (only the Overview tab exists at
  session start; everything else generates live on `advance_tab`). Clio's own instructions send her
  toward a section that does not exist.

Without this fix, Arun cannot validate whether on-demand generation is viable at all — the feature is
unreachable in the only architecture that matters (Hume/production), and even once reachable, Clio's
prompt actively misleads her. Failure mode without this fix: Arun's live test session either does
nothing when he expects Clio to call `advance_tab` and generate live, or Clio behaves erratically
because her own briefing contradicts the actual session shape.

This is a test-mode/dev-tooling fix, not a user-facing feature — there is no end-user-visible screen or
copy change. It exists solely to make an existing engineering test mode functional so Arun can evaluate
it live.

## 2. User Story

As Arun (CEO, running a live Hume-native coaching session with `LIVE_CONDUCTOR_ONDEMAND_TEST=true`),
I want Clio's `advance_tab` tool call to actually trigger server-side on-demand content generation,
and I want her briefing to describe the real (Overview-only, generate-live) session shape,
So that I can evaluate whether live, on-demand topic generation is viable for the production Hume
path, using the exact generation logic (`generateOnDemandTabWithTimeout`, fallback, visual generation)
already built and tested in the ElevenLabs path.

There is no second user type — this fix affects only Arun's own test sessions when the toggle is on.
All other users, and all sessions with the toggle off, are unaffected (see Section 10, Out of Scope,
and Section 7, Acceptance Criteria AC-6/AC-7 for the explicit no-regression guarantee).

## 3. Trigger / Entry Point

- **Route:** New route `app/api/live-conductor/advance-tab/route.ts`, exposed at
  `POST /api/live-conductor/advance-tab`.
- **Triggered by:** the Hume-side `advance_tab` tool handler in
  `app/dashboard/walkthrough/WalkthroughClient.tsx` (line ~808) and the second client-side branch's
  `advance_tab` handler (line ~1002) — both currently `createAdvanceTabToolHandler()` — making an
  HTTP POST to this route when Clio (the model) calls the `advance_tab` tool during a live voice
  session.
- **State required:** none beyond an existing `walkthrough_state` row and `sessions` row for the given
  `userId` (mirrors exactly what `getLiveConductorState()` already requires today for the
  ElevenLabs/custom-LLM path). No Clerk/user auth header is required or checked — this route follows
  the existing, established pattern of `GET /api/walkthrough-state/[userId]` and
  `POST /api/walkthrough-state/[userId]`, both of which are public and keyed only by `userId` in the
  URL/body (see `app/api/walkthrough-state/[userId]/route.ts`, which explicitly documents this as a
  deliberate pattern for the headless Recall.ai bot browser, which cannot hold a Clerk session). This
  is a continuation of that established pattern, not a new security posture.
- **Not** triggered by page load, cron, or webhook. Only by the live voice model's tool call, exactly
  mirroring how `handleAdvanceTab()` is invoked today in `app/api/clio/chat/completions/route.ts` line
  ~470-475 (fire-and-forget, not awaited by the caller).

## 4. Screen / Flow Description

This fix has **no end-user-visible screen**. It is a server-side wiring fix plus a system-prompt text
change. The "flow" is a tool-call round trip during an active voice session:

**State A — Clio decides to advance (toggle ON, Hume path, on-demand session):**
1. Clio (the model, running in Hume EVI, using the Hume-native tools defined at
   `WalkthroughClient.tsx` ~line 724) finishes teaching the current tab and calls the `advance_tab`
   tool (no arguments — same empty schema as today, defined in `LIVE_CONDUCTOR_TOOLS` in
   `lib/voice/live-conductor-bridge.ts` lines 76-90, reused as-is for this route — see Section 6).
2. The Hume adapter dispatches this call to the handler registered at `WalkthroughClient.tsx` line
   808 (`tools.advance_tab`).
3. That handler (after this fix — see Section 6 for exact code) makes
   `POST /api/live-conductor/advance-tab` with `{ userId }` in the JSON body.
4. The new route resolves session/content/tab-index/user-context server-side (mirroring
   `getLiveConductorState()`), calls the existing `handleAdvanceTab()` unmodified, and returns
   `{ resultText, isLastTab }` (see Section 6 response shape).
5. The client handler returns `resultText` as the tool result string to the Hume adapter, which
   Clio receives as the tool call's return value and continues speaking from.
6. Server-side, `handleAdvanceTab()` has already (as it does today for the old path): persisted the
   new `live_conductor_tab_index` to `walkthrough_state`; if the on-demand toggle is on and the new
   tab's article is empty, kicked off `generateOnDemandTabWithTimeout()` fire-and-forget; kicked off
   `generateLiveVisualWithTimeout()` fire-and-forget for the new tab's visual.
7. `WalkthroughClient.tsx`'s existing poll loop (`isLiveConductorEnabledClient()` block, line
   ~1296, calling `applyLiveConductorPoll`) picks up the new `live_conductor_tab_index` and
   `live_conductor_visual` on its next poll tick, exactly as it does today for the ElevenLabs path.
   **No changes to the poll loop.**

**State B — toggle OFF or normal multi-section session:**
Identical to today's behavior, byte-for-byte. See Section 6 for exactly why (the route is only ever
called when the toggle is on; the client-side handler that decides whether to call the new route is
gated on a value the route itself also independently re-checks).

There is no new UI, no new screen state, no new visible copy for the end user. The only "visual" change
is the wording inside Clio's system prompt (Section 6, Bug 2 fix) — invisible to anyone but Clio and
whoever reads server logs.

## 5. Visual Examples

Not applicable — no UI changes. This is a backend/prompt-only fix. Per Section 4, there is no new
screen, dialog, button, or visible state for a wireframe to document.

## 6. Data Requirements — Exact Code-Level Plan

### 6.1 New route: `app/api/live-conductor/advance-tab/route.ts`

**Path:** `POST /api/live-conductor/advance-tab`
**Auth:** none (public, userId-keyed — matches `/api/walkthrough-state/[userId]` precedent; see
Section 3).

**Request body (JSON):**
```json
{ "userId": "string (required)" }
```
Validated inline (no Zod dependency needed for a single required string field, consistent with how
`app/api/walkthrough-state/[userId]/route.ts`'s POST handler validates its body today — check the
existing POST handler's validation style before writing this; if it uses a plain `typeof` check, mirror
that exactly for consistency). If `userId` is missing or not a string: return
`400 { error: 'userId is required' }`.

**Response body (JSON), success:**
```json
{
  "resultText": "string — the exact tool-result text to hand back to the model, unchanged from handleAdvanceTab()'s output",
  "isLastTab": "boolean"
}
```
HTTP 200.

**Response body, no-op cases (all HTTP 200, never an error — a tool call that can't advance is not a
server error):**
- Toggle off (`LIVE_CONDUCTOR_ONDEMAND_TEST` is not `'true'`) — see below, this is intentionally
  **not** a no-op condition for the route itself; the route still runs `handleAdvanceTab()` because
  `handleAdvanceTab()` already internally no-ops its on-demand-specific block when the toggle is off
  (see `isOnDemandTestModeActive()` check at `live-conductor-bridge.ts` line 474) while still
  performing the ordinary tab-advance + visual-generation behavior it always has. This route is a thin
  transport for `handleAdvanceTab()`, not a second toggle-check layer — see the "route-always-runs"
  decision in Section 11, Resolved Q2.
- No live-conductor content available for this session (mirrors `getLiveConductorState()` returning
  `null` today): return
  `{ "resultText": "No active live-conductor session for this user.", "isLastTab": true }`, HTTP 200.
- Already on the last tab: `handleAdvanceTab()` already returns this case natively
  (`'This is already the last tab — call end_session when ready to finish.'`) — pass it through
  unchanged.

**Response body, error cases:**
- Missing/invalid `userId`: `400 { "error": "userId is required" }`.
- Any unexpected server error (Supabase failure, thrown exception): `500 { "error": "internal error" }`,
  with the real error logged server-side via `console.error('[live-conductor-advance-tab] ...', err)` —
  never leak the raw error message to the client response body (matches the codebase-wide rule:
  "never log, print, or expose secrets in error messages," and matches the pattern in
  `app/api/clio/chat/completions/route.ts`'s catch blocks, which log full detail server-side but keep
  client-facing responses generic).

**Route implementation (full logic, in order):**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getLiveConductorState, handleAdvanceTab } from '@/lib/voice/live-conductor-bridge'
import type { UserContext } from '@/lib/content/session-content-generator'

export async function POST(request: NextRequest) {
  let userId: string | undefined
  try {
    const body = await request.json()
    userId = typeof body?.userId === 'string' ? body.userId : undefined
  } catch {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  try {
    const supabase = createSupabaseAdminClient()

    const { data: userRow } = await supabase
      .from('users')
      .select('role, industry, ai_maturity, role_level')
      .eq('id', userId)
      .single()

    const userContext: UserContext = {
      role: (userRow as { role?: string } | null)?.role ?? 'executive',
      industry: (userRow as { industry?: string } | null)?.industry ?? 'business',
      maturity: (userRow as { ai_maturity?: string } | null)?.ai_maturity ?? 'beginner',
      roleLevel: (userRow as { role_level?: string } | null)?.role_level ?? 'c-suite',
    }

    const liveState = await getLiveConductorState(userId, supabase, userContext)
    if (!liveState) {
      return NextResponse.json(
        { resultText: 'No active live-conductor session for this user.', isLastTab: true },
        { status: 200 }
      )
    }

    const { resultText, isLastTab } = await handleAdvanceTab(
      userId,
      liveState.content,
      liveState.tabIndex,
      userContext,
      supabase
    )

    return NextResponse.json({ resultText, isLastTab }, { status: 200 })
  } catch (err) {
    console.error('[live-conductor-advance-tab] Failed:', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
```

This resolves `userId` → `userContext` → `content`/`currentTabIndex` exactly as
`app/api/clio/chat/completions/route.ts` (lines 300-358) already does for the ElevenLabs path, then
calls the existing, unmodified `handleAdvanceTab()` — **zero duplication** of
`generateOnDemandTabWithTimeout`, `buildOnDemandFallbackTab`, or the visual-generation chain. All of
that logic stays exactly where it is in `lib/voice/live-conductor-bridge.ts` and is reused by
reference.

**Note on `forced` parameter:** the route never passes `forced: true` — see Section 11, Resolved Q4.

### 6.2 Client-side handler change — `lib/content/live-conductor-client.ts`

`createAdvanceTabToolHandler()` is modified in place (not replaced by a second handler — see Section
11, Resolved Q2 for why). New implementation:

```ts
export function createAdvanceTabToolHandler(
  userId: string
): (params: Record<string, unknown>) => Promise<string> {
  return async () => {
    try {
      const res = await fetch('/api/live-conductor/advance-tab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (!res.ok) {
        console.error('[live-conductor-client] advance-tab route returned', res.status)
        return 'Acknowledged — advancing to next tab.'
      }
      const data = (await res.json()) as { resultText?: string }
      return data.resultText ?? 'Acknowledged — advancing to next tab.'
    } catch (err) {
      console.error('[live-conductor-client] advance-tab request failed:', err)
      return 'Acknowledged — advancing to next tab.'
    }
  }
}
```

**Signature change:** `createAdvanceTabToolHandler()` → `createAdvanceTabToolHandler(userId: string)`.
`userId` is already in scope as a prop/variable at both call sites in `WalkthroughClient.tsx` (it is
used throughout the surrounding code — e.g. line 754 `/api/walkthrough-state/${userId}`), so this is a
same-file, no-new-plumbing change.

**Fallback behavior on network/route failure:** returns the exact same acknowledgement string the stub
returned before this fix (`'Acknowledged — advancing to next tab.'`). This is deliberate — if the new
route is unreachable for any reason, Clio still receives a valid tool result and the session does not
crash; the tab simply doesn't advance server-side that turn (same failure mode as today, since today
nothing ever advances server-side on this path).

### 6.3 Impact on the two call sites in `WalkthroughClient.tsx`

**Call site 1 — Hume branch, line ~808:**
```ts
// Before:
advance_tab: createAdvanceTabToolHandler(),
// After:
advance_tab: createAdvanceTabToolHandler(userId),
```
This is the ONLY change at this call site. `userId` is already in scope (confirmed: used at line 754,
within the same `tools:` block, same closure). No other line in the Hume branch changes.

**Call site 2 — second client-side branch, line ~1002:**
```ts
// Before:
advance_tab: createAdvanceTabToolHandler(),
// After:
advance_tab: createAdvanceTabToolHandler(userId),
```
Identical one-line change. `userId` is already in scope at this call site too (confirmed: used at line
934, within the same `clientTools:` block).

**Confirmed impact on both call sites:** both now call the real server-side route instead of a no-op
stub, for **every** session (not just on-demand ones) — because, per Section 11 Resolved Q2, the route
itself is the single point that decides what `handleAdvanceTab()` does based on the toggle, not the
client. This is safe and required reading below.

**Why this does not regress normal (non-on-demand, non-live-conductor) sessions:** `advance_tab` is
only ever present as a callable tool in the model's tool list when `isLiveConductorEnabled()` is true
AND the model is in the live-conductor branch of that session (see `LIVE_CONDUCTOR_TOOLS` usage in
`chat/completions/route.ts` line 341/354, and the equivalent Hume-side tool registration). In a normal
multi-section (non-live-conductor) session, the model is never given `advance_tab` as an available tool
at all — it uses `show_visual` instead. So `createAdvanceTabToolHandler` is registered in the handler
map (as it is today, unconditionally, per the existing "no-op tool if never called" comment at line
802-807) but is **never invoked** by the model in a normal session, exactly as today. Confirmed
unchanged: normal sessions never reach this code path.

**Why this does not regress old-path (ElevenLabs/Custom-LLM route) live-conductor sessions with the
toggle off:** those sessions use `app/api/clio/chat/completions/route.ts`'s existing direct in-process
call to `handleAdvanceTab()` (line 472) — untouched by this fix. The new route and the client-handler
change in Sections 6.1/6.2 only affect the **Hume-native path's own separate `advance_tab` tool
registration** at `WalkthroughClient.tsx` lines 724-810 and 843-1003. These are two independent code
paths today (Hume uses Hume EVI's native tool-calling; the other branch uses ElevenLabs' `clientTools`)
— fixing the Hume path's stub does not touch the ElevenLabs path's already-working direct call.

### 6.4 Bug 2 fix — `lib/clio-context-builder.ts`, `buildSessionBrief()`

**New parameter, added to `BuildDocsInput`/`buildSessionBrief`'s destructured input type:**

```ts
// In BuildDocsInput interface (line ~71-83), add:
isOnDemandSingleSection?: boolean   // ONDEMAND-02: true only for live-conductor on-demand sessions
                                     // (Overview-only at session start; remaining tabs generated live
                                     // on advance_tab). Explicit boolean, set by the caller — never
                                     // inferred from sections.length or title matching inside this
                                     // function. Defaults to false/undefined for every existing caller.
```

**Confirmed: no other single-section scenario exists today.** Verified by reading
`buildAllClioDocs()`/`buildSessionBrief()`'s only other callers — normal sessions always have Overview +
N content sections + Summary (never exactly 1 section), and the live-conductor path
(`live-conductor-content.ts`) is the only code that ever constructs a `sections`-equivalent array of
length 1 (the on-demand mode's `tabs` array, which starts with only the Overview tab present). This
confirms the CEO brief's Question 3 concern — "confirm none does before ruling out length-sniffing" —
is resolved: an explicit boolean is used regardless, per the CEO brief's stated preference, but there
was in fact no ambiguity risk from length-sniffing to begin with. The explicit-parameter approach is
adopted anyway because it is strictly more correct and self-documenting, and matches the CEO brief's
explicit preference.

**Function signature change:**
```ts
export function buildSessionBrief(
  input: Omit<BuildDocsInput, 'topicContextDocs' | 'trainingScripts'>
): string {
  const {
    sessionTitle, sessionIndex, sections, skippedTopics = [],
    userRole, userIndustry, sessionDurationMins,
    isOnDemandSingleSection = false,   // NEW
  } = input
  ...
```

**Exact text change (line 116):**

Before:
```ts
`Briefly walk through the agenda (read the section titles aloud), then proceed to Section 1.`,
```

After (conditional on the new parameter):
```ts
isOnDemandSingleSection
  ? `Briefly walk through the agenda (read the section titles aloud), then begin teaching this tab's content directly — there is only one section prepared at the start; each additional topic is generated live, one at a time, only when you call advance_tab.`
  : `Briefly walk through the agenda (read the section titles aloud), then proceed to Section 1.`,
```

This line sits inside the `.filter((l) => l !== '')` array already in `buildSessionBrief` (line
100-132) — the ternary replaces the single static string at that array position; every other line in
the array (agenda lines, behavioural rules 1-11, opening sequence lines 113-115 and 117-118) is
**completely unchanged**. When `isOnDemandSingleSection` is false or omitted (every existing caller
today), the output is byte-for-byte identical to today's output — confirmed by inspection, since the
ternary's false-branch is the exact original string.

**Caller change required:** `buildAllClioDocs()` (line 349-376) must pass `isOnDemandSingleSection`
through to its internal `buildSessionBrief()` call (line 353-361) — add it to the object literal there,
sourced from `input.isOnDemandSingleSection` (also added to `BuildDocsInput`, see above). Whoever
constructs the live-conductor on-demand session's `BuildDocsInput` (in the recall/bot route's
ONDEMAND-01 block, `app/api/recall/bot/route.ts` ~line 356-369, which already has
`onDemandTestModeActive` as a local boolean) must set `isOnDemandSingleSection: onDemandTestModeActive`
when constructing that input. This is a small additive change to an object literal already being built
in that block — not a new code path.

**Confirmation this does not affect `buildSessionScript()`'s "SECTION 1/1" labeling:** per the CEO
brief, `buildSessionScript()` already correctly labels the sole on-demand section `SECTION 1/1` (line
228, `--- SECTION ${i + 1}/${totalSections}: ...`, where `totalSections = sections.length = 1` in
on-demand mode) — this is accurate as-is and requires **no change**. Only `buildSessionBrief()`'s
"proceed to Section 1" line (which implies a *second*, distinct section exists) was wrong. Confirmed by
reading both functions side by side: `buildSessionScript` never claims more sections exist than
`sections.length`; only the brief's fixed opening-sequence string did.

## 7. Success Criteria (Acceptance Tests)

✓ **AC-1 (happy path, toggle ON, Hume):** Given a live Hume-native session with
`LIVE_CONDUCTOR_ONDEMAND_TEST=true` and live-conductor content available for the user, when Clio
finishes teaching the Overview tab and calls `advance_tab`, then `POST /api/live-conductor/advance-tab`
is called with the session's `userId`, returns HTTP 200 with a non-empty `resultText`, and within one
poll cycle (`WalkthroughClient`'s existing poll interval) `live_conductor_tab_index` in
`walkthrough_state` has incremented by 1.

✓ **AC-2 (on-demand generation actually fires):** Given the same setup as AC-1, when the new tab's
article content is empty (not yet generated), then `generateOnDemandTabWithTimeout()` is invoked
server-side (visible via the existing `[live-conductor-bridge] on-demand: generating tab N live` log
line) and, within `LIVE_CONDUCTOR_VISUAL_MAX_ATTEMPTS × LIVE_CONDUCTOR_VISUAL_ATTEMPT_TIMEOUT_MS`, the
in-memory tab content is populated (or falls back to the deterministic placeholder per
`buildOnDemandFallbackTab` if generation fails after all retries — either outcome is a pass, since both
are documented, intended behavior).

✓ **AC-3 (visual generation fires):** Given AC-1, then `generateLiveVisualWithTimeout()` is invoked for
the new tab and `walkthrough_state.live_conductor_visual` is updated (to either a generated visual or
`null` on failure) within the same window as AC-2.

✓ **AC-4 (prompt no longer contradicts itself):** Given an on-demand session's `buildSessionBrief()`
output (inspectable via server logs or a direct unit-level call), then the opening-sequence text
contains the new on-demand wording ("begin teaching this tab's content directly... generated live, one
at a time") and does NOT contain the string "proceed to Section 1".

✓ **AC-5 (last tab, toggle ON):** Given a session already on its last available tab, when `advance_tab`
is called, then the route returns `{ resultText: "This is already the last tab — call end_session when
ready to finish.", isLastTab: true }` and `live_conductor_tab_index` does not change.

✓ **AC-6 (zero regression, toggle OFF, Hume normal session):** Given `LIVE_CONDUCTOR_ONDEMAND_TEST` is
unset or not `'true'`, and `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED` is off (a completely normal
multi-section session), when the session runs end-to-end (Overview → N sections → Summary via
`show_visual` calls), then no call to `/api/live-conductor/advance-tab` occurs (the model is never
given `advance_tab` as an available tool in this mode — see Section 6.3), and the session's behavior,
timing, and prompt text are byte-for-byte identical to pre-fix behavior.

✓ **AC-7 (zero regression, old ElevenLabs/Custom-LLM path):** Given a live-conductor session running
through `app/api/clio/chat/completions/route.ts` (not the Hume path), when `advance_tab` is called by
the model, then behavior is unchanged from today — `handleAdvanceTab()` is still called directly
in-process at line 472, not via the new HTTP route, and this code path is not modified by this fix.

✓ **AC-8 (network/route failure is non-fatal):** Given the new route is unreachable (simulated by e.g.
temporarily renaming the route file or forcing a 500), when Clio calls `advance_tab` on the Hume path,
then the client handler catches the failure, returns the fallback acknowledgement string, and the
voice session continues without crashing or disconnecting.

✓ **AC-9 (missing userId):** Given a malformed request to the new route with no `userId` field, when
`POST /api/live-conductor/advance-tab` is called, then it returns HTTP 400 with
`{ "error": "userId is required" }`.

✓ **AC-10 (no live-conductor content):** Given a `userId` with no live-conductor content available
(e.g. an old-path session, or generation not yet complete), when the route is called, then it returns
HTTP 200 with `{ resultText: "No active live-conductor session for this user.", isLastTab: true }` —
not an error.

## 8. Error States

- **Route unreachable / network failure:** client handler (Section 6.2) catches, logs
  `[live-conductor-client] advance-tab request failed`, returns fallback acknowledgement string. Session
  continues; tab simply does not advance server-side that turn (Clio may re-attempt `advance_tab` on a
  later turn if she still believes she hasn't advanced — acceptable, matches pre-fix behavior exactly).
- **Route returns non-200:** client handler logs the status code, returns fallback acknowledgement
  string (same as network failure — no special-casing per status code needed for a test-mode fix).
- **`userId` missing from client request:** returns 400; this should never happen in practice since
  `userId` is always in scope at both call sites (see Section 6.3), but is handled defensively.
- **Supabase read failure inside the route:** caught by the route's outer try/catch, logged via
  `console.error('[live-conductor-advance-tab] Failed:', err)` (full detail server-side only, never in
  the response body), returns 500 with a generic error body.
- **`handleAdvanceTab()` itself throws:** already has its own internal error handling for the
  visual-generation and on-demand-generation chains (fire-and-forget `.catch()` blocks, per the existing
  code at lines 553-559 and 594-599) — these never propagate to the route's outer try/catch. Only a
  failure in the synchronous part of `handleAdvanceTab` (the `walkthrough_state` update at line
  571-574) could throw up to the route, which is caught by the route's outer try/catch and returns 500.
- **On-demand content generation itself times out/fails after all retries:** already handled by existing
  code — falls back to `buildOnDemandFallbackTab()`. No new error handling needed; this fix does not
  touch that logic.
- **Slow response from the route:** the route does not await the fire-and-forget generation chains
  (matches `handleAdvanceTab`'s existing fire-and-forget design) — the route itself returns as soon as
  `handleAdvanceTab`'s synchronous portion (the tab-index persist) completes, which is a single fast
  Supabase update. No loading state is needed because this is a tool-call round trip inside an active
  voice session, not a UI action — Clio's own "keep speaking naturally" framing (already present in
  `resultText`, unchanged by this fix) is what covers the generation latency, exactly as it does today
  for the ElevenLabs path.

## 9. Edge Cases

- **Rapid double-call of `advance_tab`** (Clio calls it twice before the first request resolves): already
  guarded by the existing `onDemandTabGenerationInFlight` Set inside `handleAdvanceTab()`, keyed by
  `${userId}:${targetTabIndex}` — unaffected by this fix, since the route calls `handleAdvanceTab()`
  exactly once per HTTP request and the guard lives inside that shared function.
- **Two different users' on-demand sessions running concurrently:** each request carries its own
  `userId`; no shared mutable state between users beyond the existing per-user in-flight guards already
  in `live-conductor-bridge.ts`. No new cross-user risk introduced.
- **Toggle flipped mid-session** (env var changed between two `advance_tab` calls in the same live
  session): `isOnDemandTestModeActive()` is read fresh on every call inside `handleAdvanceTab()` (no
  module-level caching, per the existing code comment at line 49) — so a mid-session toggle flip is
  already handled correctly by existing code, and the new route doesn't change this since it calls
  `handleAdvanceTab()` fresh each time too.
- **Session has live-conductor content but the toggle is off:** the route still runs (Section 6.1) and
  still performs the ordinary (non-on-demand) tab-advance + visual-generation via `handleAdvanceTab()`
  — this is correct and intended, since `handleAdvanceTab()` always does the base tab-advance regardless
  of the on-demand toggle; only the on-demand *content generation* sub-block inside it is toggle-gated.
  This mirrors exactly what the old ElevenLabs path does today.
- **Mobile vs. desktop:** not applicable — no UI surface for this fix.
- **First-time vs. returning user:** not applicable — behavior is identical regardless of user history;
  the route resolves state fresh from `walkthrough_state`/`sessions` on every call, same as
  `getLiveConductorState()` does today.
- **User skips optional steps:** not applicable — no onboarding/step flow involved in this fix.

## 10. Out of Scope

- The `forced` (server-backstop, `FORCE_AT_TURN`) case for the Hume path — explicitly out of scope for
  this fix. See Section 11, Resolved Q4, for the full reasoning. The Hume path's own tab-stuck backstop
  (if one is later needed) is a separate, future concern.
- Any change to the ElevenLabs/Custom-LLM route's (`app/api/clio/chat/completions/route.ts`) existing
  direct call to `handleAdvanceTab()` — untouched.
- Any change to `handleAdvanceTab()`, `generateOnDemandTabWithTimeout()`, `buildOnDemandFallbackTab()`,
  or the visual-generation chain themselves — all reused exactly as-is, zero logic duplication or
  modification.
- Any change to `WalkthroughClient.tsx`'s poll loop (`applyLiveConductorPoll`, `isLiveConductorEnabledClient`
  block at line ~1296) — already correctly consumes `live_conductor_tab_index`/`live_conductor_visual`
  and requires no changes.
- Any change to `buildSessionScript()` or the "SECTION 1/1" labeling — already correct, per Section 6.4.
- Any change to normal (non-live-conductor, non-on-demand) session behavior, prompt text, or timing —
  explicitly required to be byte-for-byte unchanged (see AC-6).
- Committing, pushing, or deploying this change — per the CEO brief's explicit constraint, Arun is
  testing live and will decide when to ship. This requirement document authorizes writing the code only;
  it does not authorize a commit/push/deploy action.
- Removing `LIVE_CONDUCTOR_ONDEMAND_TEST` or any other disposable test-mode toggle — these remain
  exactly as they are; this fix only makes the existing toggle reachable from the Hume path.
- Any new npm package — none is needed; the new route uses only `next/server`, the existing
  `createSupabaseAdminClient`, and existing exports from `live-conductor-bridge.ts`.

## 11. Open Questions

None. All 5 questions from the CEO brief are resolved below.

**Resolved Q1 (exact contract for the new route):** See Section 6.1 in full —
`POST /api/live-conductor/advance-tab`, no auth (matches the established `walkthrough-state/[userId]`
public/userId-keyed pattern), request body `{ userId: string }`, response
`{ resultText: string, isLastTab: boolean }` on success, `400`/`500` with `{ error: string }` on
failure. The route resolves `userContext` from the `users` table and `content`/`currentTabIndex` via
`getLiveConductorState()` — the exact same two steps `chat/completions/route.ts` already performs
today (lines 305-318) — so the client only ever needs to pass `userId`.

**Resolved Q2 (modify in place vs. second handler; route-always-called vs. client-detects-mode):**
`createAdvanceTabToolHandler()` is modified in place (Section 6.2), not replaced by a second handler.
The route is **always called** by the client handler — the client does not attempt to detect on-demand
mode itself. The route internally decides what to do by calling `handleAdvanceTab()`, which already
contains 100% of the toggle-awareness logic (`isOnDemandTestModeActive()`, checked fresh on every
call). This is the cleanest option because:
  - It requires the client to know nothing about the toggle at all — no client-visible flag, no
    `NEXT_PUBLIC_`-prefixed leak of a variable explicitly required to stay server-side-only (see the
    CEO brief's Known Constraints: "never `NEXT_PUBLIC_`-prefixed, never exposed to the client").
  - It keeps `handleAdvanceTab()` as the single source of truth for on-demand behavior — zero logic
    duplicated or re-implemented at the route or client layer.
  - It automatically covers **both** call sites (line 808 and line 1002) with the identical one-line
    change (`createAdvanceTabToolHandler()` → `createAdvanceTabToolHandler(userId)`), since both are
    the same function.
  - "Old path completely untouched" is satisfied because `advance_tab` is only ever offered as a tool
    to the model when the live-conductor branch is active in the first place (see Section 6.3) — a
    normal session's tool handler map still contains this function, unchanged in shape, but the model
    never invokes it, exactly as today.

**Resolved Q3 (exact wording + detection condition for `buildSessionBrief()`):** See Section 6.4 in
full. New explicit boolean parameter `isOnDemandSingleSection` on `BuildDocsInput`/`buildSessionBrief`'s
input, default `false`. Exact replacement wording:
`"Briefly walk through the agenda (read the section titles aloud), then begin teaching this tab's
content directly — there is only one section prepared at the start; each additional topic is generated
live, one at a time, only when you call advance_tab."`
Confirmed (Section 6.4): no other code path today constructs a single-section `sections` array, so
there was no real false-positive risk from length-sniffing — but the explicit parameter is used anyway
per the CEO brief's stated preference, since it is self-documenting and removes any future risk if a
second single-section scenario is ever introduced.

**Resolved Q4 (forced/FORCE_AT_TURN case — in scope or out?):** **Out of scope for this fix**,
explicitly. Reasoning: `FORCE_AT_TURN`/`NUDGE_AT_TURN` is a tab-stuck backstop that today only exists
inside `app/api/clio/chat/completions/route.ts` (lines 320-343), driven by
`live_conductor_tab_turn_count`, which is incremented inside `getLiveConductorState()` itself (line
251-260) on every call. The Hume path does not currently call `getLiveConductorState()` at all outside
of what this fix adds — and this fix does not add a per-turn polling loop that would let a Hume-side
consumer detect "stuck on this tab for N turns" the way the chat-completions route's per-message-turn
architecture does natively. Building a Hume-side equivalent of the turn-counting backstop is a
non-trivial, separate feature (it would need its own decision about what "a turn" means in Hume's
tool-calling model, which does not stream per-message the way the custom-LLM SSE route does) and is
explicitly deferred. If Arun's live test reveals Clio getting stuck on a tab in the Hume path, that is a
new, separate bug/feature to scope — not a silent expansion of this fix's surface area, per the
standing rule against scope creep and the CEO brief's request to state this explicitly.

**Resolved Q5 (test plan — manual verification, toggle on / regression, toggle off):** See Section 12
below for Arun's exact click/say/observe steps.

## 12. Dependencies

- `handleAdvanceTab()`, `getLiveConductorState()`, `LIVE_CONDUCTOR_TOOLS`, `isOnDemandTestModeActive()`
  — all already exist in `lib/voice/live-conductor-bridge.ts`, unmodified by this fix, must continue to
  exist exactly as today.
- `createSupabaseAdminClient()` — already exists in `lib/supabase.ts`.
- `UserContext` type — already exists in `lib/content/session-content-generator.ts`.
- A `users` row, `sessions` row, and `walkthrough_state` row for the test `userId`, with
  `live_conductor_content` populated on the `sessions` row (i.e. Layer-1 on-demand session content
  generation must have already run for this user's session — this is a pre-existing dependency of the
  ONDEMAND-01 toggle itself, not new to this fix).
- `LIVE_CONDUCTOR_ONDEMAND_TEST=true` and `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED=true` set in the
  environment Arun is testing in (both pre-existing toggles, not introduced by this fix).
- No database migration required — no schema change.
- No new npm package required.

---

## Manual Verification Plan (Section 7 detail — for Arun to execute live)

### Test 1 — Toggle ON, Hume live session (the actual fix)

1. Confirm environment: `LIVE_CONDUCTOR_ONDEMAND_TEST=true` and
   `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED=true` are set for the environment you're testing in (dev or
   preview — wherever this code is deployed for your test, per the "no deploy without your say-so"
   constraint).
2. Start a live Hume-native coaching session for a test user whose session already has
   `live_conductor_content` generated (Overview tab present, remaining tabs' article bodies empty per
   the on-demand design).
3. Let Clio deliver the Overview tab's content as normal.
4. **Watch for:** Clio should NOT say anything implying "Section 1" exists as a separate, already-known
   section — she should talk as though the next topic is being prepared, not pre-written. This directly
   confirms the Bug 2 fix (Section 6.4).
5. When Clio finishes the Overview and calls `advance_tab` (you'll hear her naturally conclude and
   transition — she's instructed to keep talking through the gap), **check server logs** for:
   - `[live-conductor-bridge] on-demand: generating tab 2 live` (or similar) — confirms the new route
     reached `handleAdvanceTab()` and on-demand generation kicked off. This is the direct confirmation
     of the Bug 1 fix.
   - No errors logged from `[live-conductor-advance-tab]`.
6. **Observe the screen** (if you have visual output wired to this session): the visual should update
   to the new tab within roughly the generation window (up to
   `LIVE_CONDUCTOR_VISUAL_MAX_ATTEMPTS × LIVE_CONDUCTOR_VISUAL_ATTEMPT_TIMEOUT_MS`, currently the same
   budget as visual generation today).
7. **Confirm Clio's spoken content changes** — she should transition into genuinely new material for
   the second topic, not repeat the Overview or go silent/confused.
8. Optional: query `walkthrough_state` for this `user_id` and confirm `live_conductor_tab_index`
   incremented from `0` to `1` after the call.

**Pass condition:** all of the above observed with no errors, no silence, no "Section 1" confusion in
Clio's speech, and the log line confirming on-demand generation fired.

### Test 2 — Regression check, toggle OFF, normal multi-section session

1. Confirm environment: `LIVE_CONDUCTOR_ONDEMAND_TEST` is unset (or explicitly not `'true'`), and run
   either (a) a normal session with `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED` also off (the standard
   production path today), or (b) if you want to isolate just the ONDEMAND-02 change, a live-conductor
   session with the toggle off but `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED` on.
2. Run a full session start to finish (Overview → N sections → Summary via the normal `show_visual`
   flow).
3. **Confirm:** Clio's spoken agenda instruction still says "then proceed to Section 1" (for a normal
   multi-section session) — i.e., the Bug 2 fix did not alter normal-session prompt text at all.
4. **Confirm:** no request to `/api/live-conductor/advance-tab` appears in server logs or network
   traffic during this session — the `advance_tab` tool is never in the model's available tool list for
   a normal session, so it should never be called.
5. **Confirm:** session timing, screen transitions, and Clio's spoken delivery feel identical to a
   pre-fix session you've run before — no new latency, no new pauses, no behavior change.

**Pass condition:** the session runs exactly as it did before this fix, with zero references to the new
route in logs and zero change in Clio's prompt text or behavior.

---

*Requirement Document version: 1.0 | Feature: ONDEMAND-02 | Status: DRAFT — pending CEO approval*
