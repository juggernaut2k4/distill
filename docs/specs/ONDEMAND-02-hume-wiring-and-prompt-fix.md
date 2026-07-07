# ONDEMAND-02 — Hume On-Demand Wiring + Session-Brief Prompt Fix — Requirement Document
Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-07

## 1. Purpose

Arun is live-testing "on-demand tab generation" (`LIVE_CONDUCTOR_ONDEMAND_TEST=true`)
— the feature where, instead of pre-generating every topic before a session
starts, the next topic's content is generated live, in the background, the
moment Clio finishes the current one and advances. This is meant to let
sessions start faster and adapt in real time.

Two confirmed bugs block this from working in the only path Arun actually
uses (Hume-native voice):

**Bug 1 (wiring):** The real on-demand generation pipeline
(`handleAdvanceTab` → `generateOnDemandTabWithTimeout` →
`buildOnDemandFallbackTab`, all in `lib/voice/live-conductor-bridge.ts`) is
fully wired into the old ElevenLabs/Custom-LLM bridge route
(`app/api/clio/chat/completions/route.ts`), but Arun's real live sessions run
on the Hume-native voice architecture. In that path, the `advance_tab` tool
handler (`createAdvanceTabToolHandler()` in `lib/content/live-conductor-client.ts`)
is a client-side no-op — it just returns an acknowledgement string. Nothing
server-side ever runs. Without this fix, on-demand mode silently does
nothing in production and Arun cannot test the feature at all.

**Bug 2 (prompt contradiction):** In on-demand mode, a session starts with
only the Overview in `sections` (1 entry). `buildSessionBrief()`
(`lib/clio-context-builder.ts`) unconditionally emits the instruction
"proceed to Section 1" regardless of whether Section 1 exists. When
`sections.length === 1`, this tells Clio to proceed to a section that isn't
there — a literal contradiction in her own instructions, which risks
confusing or destabilizing her live behavior at the start of every on-demand
session.

Failure without this fix: Arun cannot validate the on-demand generation
feature at all in the real product path (Bug 1), and even once wired, Clio's
opening instructions would be self-contradictory and could produce
unpredictable behavior at the start of every on-demand session (Bug 2).

## 2. User Story

As Arun (product owner, running a live Hume-native coaching session in
on-demand test mode),
I want Clio's `advance_tab` tool call to actually trigger real content
generation for the next tab, and I want her opening instructions to never
contradict the actual number of sections available,
So that I can validate the on-demand generation feature works end-to-end in
the real product path, with no silent no-ops and no self-contradictory
prompts.

(Single user type — this is an internal/test-mode fix, not an end-user-facing
feature story.)

## 3. Trigger / Entry Point

**Bug 1:**
- Entry point: Clio (running inside a Hume-native live voice session at
  `app/dashboard/walkthrough/WalkthroughClient.tsx`, rendered for a session
  whose `NEXT_PUBLIC_VOICE_PROVIDER=hume`) calls the `advance_tab` tool
  mid-conversation, exactly as she already does today (the tool call itself
  is unchanged — only what happens when the client receives it changes).
- Gate: only produces different behavior when `LIVE_CONDUCTOR_ONDEMAND_TEST=true`
  server-side. When unset/false, the new route's on-demand branch does
  nothing extra (see Section 9 "Out of Scope"/Section 8).
- User state: an active Hume-native voice session must be in progress
  (`walkthrough_state` row exists for this `userId`, `sessions.live_conductor_content`
  populated for the current session).

**Bug 2:**
- Entry point: any call to `buildSessionBrief()` — currently the only
  production call site is `buildAllClioDocs()` in the same file
  (`lib/clio-context-builder.ts:353`), itself called from
  `app/api/recall/bot/route.ts:244`, `inngest/session-meeting-setup.ts:149`,
  and `app/api/admin/qa-session-context/route.ts:170` (all ElevenLabs/Custom-LLM
  path callers — see Section 12 Dependencies for why the Hume-native path is
  unaffected).
- Trigger condition for the fix: `sections.length === 1` at call time. No new
  flag, env var, or "on-demand mode" parameter is introduced — the fix
  detects the single-Overview-only condition structurally, which is exactly
  the shape on-demand mode produces and never the shape a normal
  multi-section session produces (see Section 11, Resolved Question 3, for
  why this is safe and sufficient).

## 4. Screen / Flow Description

This is a backend/server-logic fix with no new UI. There is no new screen
state. The only observable behavior changes are:
1. Server log lines appearing during a live Hume session (see Section 7,
   acceptance tests).
2. The text Clio is instructed to say differs by exactly one condition
   (single-section vs. multi-section) — this is prompt text, not UI.

No wireframes apply to this requirement — Section 5 is intentionally empty
of screen diagrams and instead documents the two data/control flows below.

### Flow A — Bug 1: `advance_tab` in a Hume-native on-demand session

1. Clio decides the current tab is done and calls the `advance_tab` tool
   (unchanged — same tool definition, same trigger condition as today).
2. **NEW:** `createAdvanceTabToolHandler()` (client, browser bundle) now
   takes `userId` as a parameter and, when invoked, does a `fetch(...)` POST
   to `/api/walkthrough-state/[userId]` with `{ command: 'advance_tab' }`
   (see Section 6 for the exact contract and Section 11 Resolved Question 1
   for why this route, not a new one).
3. **NEW:** The POST route handler resolves `UserContext` server-side from
   `userId` alone (mirrors the exact query already used in
   `chat/completions/route.ts` — `users` table, columns
   `role, industry, ai_maturity, role_level`), then calls the existing,
   unmodified `handleAdvanceTab()` from `lib/voice/live-conductor-bridge.ts`
   with that context — the same function the old ElevenLabs path already
   calls, not a copy.
4. `handleAdvanceTab()` runs exactly as it does today for the old path: if
   `LIVE_CONDUCTOR_ONDEMAND_TEST=true` and the target tab's article body is
   empty, it kicks off (fire-and-forget) `generateOnDemandTabWithTimeout()`,
   falling back to `buildOnDemandFallbackTab()` on failure/timeout. It
   persists the new tab index to `walkthrough_state` and returns a
   `resultText` describing the transition.
5. The new route returns a JSON response (see Section 6) to the client.
   `createAdvanceTabToolHandler()`'s return value (the string handed back to
   Hume as the tool result) is built from that response.
6. Clio keeps speaking (per the existing tool description's instruction) —
   this is unchanged. The generated (or fallback) content for the new tab
   becomes visible to her via the *next* turn's system-prompt rebuild path
   exactly as it already does for the ElevenLabs path (out of scope for this
   fix — see Section 10).

### Flow B — Bug 2: single-section `buildSessionBrief()` output

1. `buildSessionBrief()` is called with a `sections` array.
2. **Existing behavior (unchanged, `sections.length > 1`):** the OPENING
   SEQUENCE block says `"...then proceed to Section 1."` exactly as today.
3. **NEW behavior (`sections.length === 1`):** the line is replaced with
   accurate text that does not reference a nonexistent Section 1 — see
   Section 6 for the exact replacement copy.
4. All other lines in `buildSessionBrief()`'s output (agenda list,
   behavioural rules 1–11, etc.) are unaffected either way — Rule 10's
   `"the FINAL section (section ${sections.length}/${sections.length})"` is
   already correct for a 1-section array (it evaluates to "section 1/1"),
   so it needs no change.

## 5. Visual Examples

Not applicable — no UI changes. (Wireframes omitted per Section 4.)

## 6. Data Requirements — Exact Contracts

### 6.1 Client → Server: `advance_tab` command

**Chosen approach:** extend the existing
`POST /api/walkthrough-state/[userId]/route.ts` command dispatch with a new
`command: 'advance_tab'` branch, rather than creating a new route. Rationale
in Section 11, Resolved Question 1.

**Request** (from `createAdvanceTabToolHandler()`):
```
POST /api/walkthrough-state/{userId}
Content-Type: application/json

{ "command": "advance_tab" }
```
No other fields — `userId` is already in the URL path (same pattern as
`scroll_to`/`insert_section`), and the route resolves everything else
(`UserContext`, `content`, `currentTabIndex`, `forced`) server-side from
`userId` alone, mirroring `getLiveConductorState()`'s existing
userId-only resolution pattern.

**Response — success:**
```json
{
  "ok": true,
  "resultText": "Advanced to tab 3 of 5: \"...\". Its visual is generating in the background — keep speaking naturally...",
  "isLastTab": false
}
```
`resultText` is `handleAdvanceTab()`'s existing `resultText` return value,
passed through unmodified.

**Response — already on last tab** (mirrors `handleAdvanceTab`'s existing
behavior, not an error):
```json
{
  "ok": true,
  "resultText": "This is already the last tab — call end_session when ready to finish.",
  "isLastTab": true
}
```

**Response — no active on-demand content available** (toggle off, or no
`live_conductor_content` for this user — i.e. `getLiveConductorState()`
returns `null`):
```json
{ "ok": false, "error": "No live conductor content available for this user" }
```
HTTP 200 (not 4xx/5xx) — this is an expected, non-error condition when the
Hume session isn't running in live-conductor mode at all (e.g. toggle off).
`createAdvanceTabToolHandler()` treats `ok: false` the same as before this
fix: return the existing generic acknowledgement string (see 6.2) so Clio's
conversation flow is never interrupted.

**Response — unexpected server error:**
```json
{ "ok": false, "error": "Internal error advancing tab" }
```
HTTP 500. `createAdvanceTabToolHandler()` catches this the same way it
already catches network/fetch failures — returns the generic acknowledgement
string, never throws into the tool-call protocol.

### 6.2 `createAdvanceTabToolHandler()` — new signature

**Before:**
```ts
export function createAdvanceTabToolHandler(): (params: Record<string, unknown>) => Promise<string> {
  return async () => {
    return 'Acknowledged — advancing to next tab.'
  }
}
```

**After:**
```ts
export function createAdvanceTabToolHandler(
  userId: string
): (params: Record<string, unknown>) => Promise<string> {
  return async () => {
    try {
      const res = await fetch(`/api/walkthrough-state/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'advance_tab' }),
      })
      const data = await res.json() as { ok: boolean; resultText?: string; error?: string }
      if (data.ok && data.resultText) {
        return data.resultText
      }
      return 'Acknowledged — advancing to next tab.'
    } catch {
      return 'Acknowledged — advancing to next tab.'
    }
  }
}
```
Input needed: only `userId` (a `string`). No `userContext` is needed
client-side — confirmed by investigation that no `UserContext`-shaped object
(role/industry/maturity/roleLevel) exists anywhere in
`WalkthroughClient.tsx`'s scope today; the new route resolves it server-side
from `userId` alone, exactly like `chat/completions/route.ts` and
`hume-native/provision-config/route.ts` both already do. This keeps
`live-conductor-client.ts` free of server-only imports, per the CEO brief's
constraint — `fetch()` to a same-origin API route is browser-safe.

### 6.3 Server-side: new `advance_tab` branch in the walkthrough-state POST route

Reads (Supabase, via existing `handleAdvanceTab`/`getLiveConductorState`
functions, unchanged):
- `walkthrough_state`: `live_conductor_tab_index`, `live_conductor_visual`,
  `live_conductor_tab_turn_count`, `session_id`, `user_id`
- `sessions`: `live_conductor_content`, `topic_id`, `session_title`
- `users`: `role`, `industry`, `ai_maturity`, `role_level` (new read, added
  by this fix, in the new route handler only)

Writes (all via existing `handleAdvanceTab()` — unchanged):
- `walkthrough_state.live_conductor_tab_index` (new index)
- `walkthrough_state.live_conductor_visual` (reset to `null`, then later
  updated async by the existing visual-generation chain)
- `walkthrough_state.live_conductor_tab_turn_count` (reset to `0`)
- In-memory only: `content.tabs[newIndex]` mutated with generated/fallback
  content — never persisted to `topic_content_cache` or
  `sessions.live_conductor_content` (unchanged existing behavior).

No new tables, no new columns, no migration required.

### 6.4 `buildSessionBrief()` — exact diff

**Detection condition:** `sections.length === 1` (evaluated once, at the top
of the function body, no new parameter).

**Before** (`lib/clio-context-builder.ts`, current line 116):
```ts
`Briefly walk through the agenda (read the section titles aloud), then proceed to Section 1.`,
```

**After:**
```ts
sections.length === 1
  ? `Briefly walk through the agenda (read the section titles aloud). The next section's material is being prepared — continue naturally; you'll be told when it's ready to begin.`
  : `Briefly walk through the agenda (read the section titles aloud), then proceed to Section 1.`,
```

Exact wording rationale: mirrors the tone and phrasing already established
in `ONDEMAND_HOLDING_INSTRUCTION` (`live-conductor-bridge.ts` line 413-415:
"continue your closing thought... do not go silent and do not tell the user
you are waiting") so Clio's voice stays consistent between this line and the
holding instruction she may receive moments later during the same
transition. Confirmed correct per CEO brief's "What Success Looks Like":
"it says something accurate, e.g. that the next section will be prepared
live when Clio is ready to advance."

All other lines in `buildSessionBrief()`'s output array are unchanged.

## 7. Success Criteria (Acceptance Tests)

**Bug 1:**
1. ✓ Given `LIVE_CONDUCTOR_ONDEMAND_TEST=true` and an active Hume-native
   session with `sessions.live_conductor_content` populated, when Clio calls
   `advance_tab` and the target tab's article is empty, then server logs show
   `[live-conductor-bridge] on-demand: generating tab N live` (the existing
   log line, unchanged) — verified via a real or scripted Hume session
   locally.
2. ✓ Given the same setup, when `generateOnDemandTabWithTimeout` fails after
   all retries, then `content.tabs[newIndex]` is set via
   `buildOnDemandFallbackTab()` and the fallback placeholder text is used —
   verified by forcing a failure (e.g. temporarily invalid `ANTHROPIC_API_KEY`
   in a local test) and observing the fallback log line
   `[live-conductor-bridge] on-demand generation failed for tab, using placeholder fallback: ...`.
3. ✓ Given `LIVE_CONDUCTOR_ONDEMAND_TEST` unset or `false`, when Clio calls
   `advance_tab` in a Hume-native session, then `isOnDemandTestModeActive()`
   returns `false` and the on-demand branch inside `handleAdvanceTab()` does
   not execute — `newTab` is set exactly to `content.tabs[newIndex]` as it is
   today, byte-for-byte identical to pre-fix behavior.
4. ✓ Given the new `/api/walkthrough-state/[userId]` `advance_tab` command is
   called for a `userId` with no active live-conductor session (
   `getLiveConductorState` returns `null`), then the response is
   `{ ok: false, error: "..." }` with HTTP 200, and
   `createAdvanceTabToolHandler()` returns the fallback acknowledgement
   string without throwing.
5. ✓ Given the same `advance_tab` tool call, when it reaches the last tab
   (`isLastTab: true` from `handleAdvanceTab`), then the response's
   `resultText` is `"This is already the last tab — call end_session when
   ready to finish."` exactly, unchanged from today's behavior for the old
   path.
6. ✓ Given a normal (non-Hume, non-on-demand) production session using
   `chat/completions/route.ts`, when `advance_tab` fires there, then nothing
   about that route's behavior changes — `handleAdvanceTab`,
   `generateOnDemandTabWithTimeout`, and `buildOnDemandFallbackTab` are
   called from exactly one shared implementation, imported (not copy-pasted)
   into the new route — verified via `npx tsc --noEmit` and a diff review
   showing zero changes to `chat/completions/route.ts` or
   `live-conductor-bridge.ts`.

**Bug 2:**
7. ✓ Given `sections.length === 1` (on-demand mode's Overview-only case),
   when `buildSessionBrief()` runs, then the returned string does NOT
   contain the substring `"proceed to Section 1"`.
8. ✓ Given `sections.length === 1`, when `buildSessionBrief()` runs, then the
   returned string DOES contain replacement text indicating the next
   section is being prepared live (see Section 6.4 exact copy).
9. ✓ Given `sections.length > 1` (any normal multi-section session, e.g. 5
   sections), when `buildSessionBrief()` runs before vs. after this fix with
   identical input, then the output strings are byte-for-byte identical —
   verified by a unit test asserting deep string equality on a fixed
   multi-section fixture.
10. ✓ Given `sections.length === 1`, when `buildSessionBrief()` runs, then
    Behavioural Rule 10's text (`"the FINAL section (section 1/1)"`)
    correctly evaluates using `sections.length`, confirming no other part of
    the function silently breaks for the single-section case.

## 8. Error States

**Bug 1:**
- Network/fetch failure from client to the new route: caught in
  `createAdvanceTabToolHandler()`'s `try/catch` — returns the same generic
  `'Acknowledged — advancing to next tab.'` string used today. Clio's
  conversation is never interrupted by a failed advance-tab network call.
- `getLiveConductorState()` returns `null` (toggle off, no content, or
  content not yet generated): route returns `{ ok: false, error: "..." }`
  with HTTP 200 (expected condition, not a server error) — see Section 6.1.
- Unexpected exception inside the route handler (e.g. Supabase query
  throws): caught, logged via `console.error`, returns
  `{ ok: false, error: "Internal error advancing tab" }` with HTTP 500 —
  client falls back to the generic acknowledgement string as above.
- `generateOnDemandTabWithTimeout` failing after all retries: existing,
  unchanged behavior — falls back to `buildOnDemandFallbackTab()`, never
  surfaces as an error to the client since generation is fire-and-forget
  (the tool-call response already returned before generation resolves).

**Bug 2:**
- `sections` is an empty array (`length === 0`): out of scope for this fix
  — this is a pre-existing edge case (a session with zero sections) not
  introduced or worsened by this change. `sections.length === 1` check
  simply does not match, so the array falls through to the
  `sections.length > 1` branch's `"proceed to Section 1"` text, which is
  arguably still wrong for a 0-section session but that is a pre-existing
  condition explicitly not in scope per the CEO brief (which only describes
  the 1-section on-demand case). No change in behavior for this edge case
  versus today.

## 9. Edge Cases

- **Rapid double-fire of `advance_tab` for the same transition (Bug 1):**
  already handled by the existing `onDemandTabGenerationInFlight` Set guard
  inside `handleAdvanceTab()`, keyed by `${userId}:${newIndex}` — unaffected
  by this fix since the guard lives inside the shared, unmodified function.
- **Two different Hume sessions for two different users hitting `advance_tab`
  concurrently:** already isolated by `userId`-keyed guards and DB rows in
  the shared function — unaffected by this fix.
- **`advance_tab` called when Hume-native mode is on but
  `LIVE_CONDUCTOR_ONDEMAND_TEST` is off:** the new route still calls
  `handleAdvanceTab()` (this is not itself gated on the on-demand toggle —
  only the on-demand generation branch *inside* `handleAdvanceTab` is). The
  tab still advances and the pre-generated tab content (if any) is used, or
  `getLiveConductorState` returns `null` if there's no live-conductor content
  at all for this session (see error states above). This matches existing
  behavior for the old ElevenLabs path today — no new edge case introduced.
- **Session using Hume-native mode with `live_conductor_content` entirely
  absent (i.e. this session was built for `hume-native/provision-config`'s
  `sections`/`training_scripts` pipeline, not the live-conductor pipeline):**
  `getLiveConductorState` returns `null`, route returns `{ ok: false }`,
  client falls back gracefully — see error states. This is the expected,
  common case for any Hume-native session NOT running in on-demand test
  mode, and is explicitly required to be a no-op per the CEO brief's "Must
  stay gated" constraint.
- **`sections.length === 1` for a reason OTHER than on-demand mode** (e.g. a
  future unrelated feature that legitimately has exactly one section): the
  fix's replacement text ("the next section's material is being prepared
  live") would be inaccurate in that hypothetical. This is judged acceptable
  because (a) no such caller exists in the codebase today — confirmed by
  reading all `buildSessionBrief`/`buildAllClioDocs` call sites (Section 12
  Dependencies), and (b) the CEO brief explicitly scoped this fix to fire
  "only when on-demand mode produces a single-entry sections array," and a
  structural `length === 1` check is the only signal available at this call
  site without threading a new parameter through 3+ unrelated call sites —
  judged the smaller, safer change (see Resolved Question 3 reasoning below).

## 10. Out of Scope

- The tab-stuck backstop (`NUDGE_AT_TURN`/`FORCE_AT_TURN`,
  currently only referenced/used inside `chat/completions/route.ts`'s
  caller logic) is explicitly OUT OF SCOPE for this fix. The new Hume-side
  `advance_tab` route does not implement a forced-advance backstop — Hume's
  own LLM self-paces per `HUME_NATIVE_PROMPT_TEMPLATE`'s behavioral rules
  (rule 5: "Use your own judgment on timing"), and no equivalent backstop
  mechanism exists in the Hume-native path today. Building one is a
  separate, future feature if Arun observes Clio getting stuck on a tab
  during live Hume testing. (Resolves CEO Open Question 4 — explicitly out
  of scope, not silently ignored.)
- No changes to `handleAdvanceTab()`, `generateOnDemandTabWithTimeout()`,
  `buildOnDemandFallbackTab()`, or any other function inside
  `live-conductor-bridge.ts` — these are called into, not modified.
- No changes to `chat/completions/route.ts` — the old ElevenLabs path
  continues to work exactly as it does today, unmodified.
- No changes to how the *content itself* becomes visible to Clio mid-call
  (i.e. how `buildLiveConductorSystemPrompt` picks up the newly-generated
  tab for the Hume-native path specifically) — that plumbing (via
  `hume-native/provision-config`'s upfront prompt assembly, which does not
  currently re-read `live_conductor_content` mid-call) is a separate,
  pre-existing architectural question not raised in the CEO brief and not
  addressed here. This fix's scope is strictly: make the generation *fire*
  server-side when `advance_tab` is called from Hume. Whether/how Hume's own
  LLM discovers newly-generated tab content mid-session (versus relying on
  the upfront `SESSION CONTENT` block) is unchanged by this fix and is not
  claimed to be solved by it.
- No new database columns, tables, or migrations.
- No commit, push, or deploy — build and verify locally only per the CEO
  brief's explicit constraint.
- Bug 2's fix does not touch `buildTopicContext()`, `buildSessionScript()`,
  or any other function in `clio-context-builder.ts`.
- No changes to the Hume-native prompt template
  (`lib/voice/hume-native/prompt-template.ts`) — confirmed via investigation
  that `buildSessionBrief()` is not called anywhere in the Hume-native
  provisioning path (`hume-native/provision-config/route.ts` uses
  `buildTopicContext`/`buildSessionScript` directly, not
  `buildAllClioDocs`/`buildSessionBrief`). Bug 2's fix applies to
  `buildSessionBrief()`'s only production callers (the ElevenLabs/Custom-LLM
  path), which is also where on-demand test mode's single-Overview-only
  `sections` array is actually constructed and consumed today.

## 11. Open Questions

All 4 of the CEO's open questions are answered below with engineering
reasoning — none are left open.

**Q1 — Exact contract for the new server entry point.**
**Resolved: extend the existing `POST /api/walkthrough-state/[userId]`
route with a new `command: 'advance_tab'` branch**, not a new dedicated
route. Reasoning: the route already dispatches on a `command` union type
(`ScrollToCommand | InsertSectionCommand`) for this exact same
user-scoped `walkthrough_state` resource, and `show_visual`'s handler in
`WalkthroughClient.tsx` (lines 754-758) already calls this same route with a
different command in the identical Hume-branch scope — same file, same
pattern, same resource, same auth model (public, userId-keyed, no Zod schema
beyond the command literal, matching every other command in this route). A
new dedicated route would duplicate the `userId`-keyed lookup/auth pattern
for zero benefit. Exact contract specified in Section 6.1/6.3.

**Q2 — What `createAdvanceTabToolHandler()` needs as input, and where it
comes from in `WalkthroughClient.tsx`.**
**Resolved: only `userId: string`.** Investigation confirmed (a) `userId` is
a direct prop of the `WalkthroughClient` component (line 403) and is already
in scope and used repeatedly inside the exact same Hume-branch closure that
registers `advance_tab` (e.g. line 754's `show_visual` handler, in the same
`tools: {...}` object, uses `userId` directly), so no plumbing changes are
needed to make it available; (b) no `UserContext`-shaped object
(role/industry/maturity/roleLevel) exists anywhere in this component's scope
today — confirmed by a full-file search finding zero matches for those field
names — so it is not "already available" and must not be fetched
client-side. The new server route resolves `UserContext` itself from
`userId`, exactly mirroring the established pattern in both
`chat/completions/route.ts` (lines 305-316: `users` table query by `id`) and
`hume-native/provision-config/route.ts` (which also only ever receives
`userId` and resolves everything else server-side, by design, per that
route's own doc comment). This is the smallest, most consistent change and
keeps `live-conductor-client.ts` free of server-only imports.

**Q3 — Exact detection condition and replacement copy for Bug 2.**
**Resolved: `sections.length === 1`, checked inline at the point the
"proceed to Section 1" line is built — no new parameter, no new flag.**
Reasoning: investigated every production call site of `buildSessionBrief()`
(via its only caller, `buildAllClioDocs()` at `clio-context-builder.ts:353`,
itself called from `app/api/recall/bot/route.ts:244`,
`inngest/session-meeting-setup.ts:149`, and
`app/api/admin/qa-session-context/route.ts:170`). None of these callers pass
any "on-demand mode" signal today, and none construct a single-entry
`sections` array for any reason other than the on-demand-mode Overview-only
case described in the CEO brief. A structural `sections.length === 1` check
is therefore both necessary and sufficient to isolate exactly the scenario
described, without threading a new boolean through three unrelated call
sites (the smallest, safest change, consistent with the CEO brief's
"Prefer the smallest, safest change" instruction). Exact replacement copy
specified in Section 6.4, chosen to match the tone of the existing
`ONDEMAND_HOLDING_INSTRUCTION` string Clio may receive moments later in the
same transition.

**Q4 — Tab-stuck backstop interaction.**
**Resolved: explicitly out of scope for this fix.** The backstop
(`NUDGE_AT_TURN`/`FORCE_AT_TURN`) is used only inside
`chat/completions/route.ts`'s own request-handling loop (confirmed: not
imported or used anywhere else in the codebase); Hume's own LLM self-paces
per its prompt template with no equivalent mechanism today. Building a
Hume-side backstop is a separate future feature, not implied or required by
the CEO brief's stated success criteria (which mention only
`handleAdvanceTab`'s generation logic). Documented in Section 10 as
explicitly out of scope.

## 12. Dependencies

- `lib/voice/live-conductor-bridge.ts` — `handleAdvanceTab()`,
  `getLiveConductorState()`, `isOnDemandTestModeActive()` must already exist
  and work correctly for the old ElevenLabs path (they do — this is existing,
  shipped code being reused, not built).
- `lib/content/live-conductor-content.ts` — `LiveConductorContent` /
  `LiveConductorTab` types, already defined and stable.
- `sessions.live_conductor_content` and `walkthrough_state.live_conductor_tab_index` /
  `live_conductor_visual` / `live_conductor_tab_turn_count` columns must
  already exist (they do, per migration `054_live_conductor_state.sql`
  referenced in `live-conductor-client.ts`'s doc comment — no new migration
  needed).
- `users` table with `role`, `industry`, `ai_maturity`, `role_level` columns
  — already exists and is already queried this exact way by
  `chat/completions/route.ts`.
- `LIVE_CONDUCTOR_ONDEMAND_TEST` env var — already defined and read by
  `isOnDemandTestModeActive()`; this fix does not add or change the toggle,
  only makes the Hume path respect it the same way the ElevenLabs path
  already does.
- No dependency on any other in-flight ONDEMAND-* or LIVE-* work — this is a
  self-contained wiring + prompt-text fix.

---

## Files Changed

1. **`lib/content/live-conductor-client.ts`**
   — `createAdvanceTabToolHandler()` signature changes from
   `(): (params) => Promise<string>` to `(userId: string): (params) => Promise<string>`.
   Body changes from a static return to a `fetch()` call against
   `/api/walkthrough-state/[userId]` with graceful fallback. See Section 6.2
   for full before/after.

2. **`app/dashboard/walkthrough/WalkthroughClient.tsx`**
   — Line 808: `advance_tab: createAdvanceTabToolHandler(),` becomes
   `advance_tab: createAdvanceTabToolHandler(userId),`. No other change in
   this file — `userId` is already in scope (component prop, line 403).

3. **`app/api/walkthrough-state/[userId]/route.ts`**
   — New `AdvanceTabCommand` type added to the `SectionCommand` union (or a
   parallel type, since `advance_tab` is not itself a `TemplateSection`
   command like the existing two — see below). New `if (body.command ===
   'advance_tab')` branch added to the `POST` handler, after the existing
   `insert_section` branch and before the final `return NextResponse.json({
   error: 'Unknown command' }, ...)` fallback. This branch:
   - Imports `getLiveConductorState`, `handleAdvanceTab` from
     `@/lib/voice/live-conductor-bridge` and `createSupabaseAdminClient`
     (already imported in this file).
   - Resolves `UserContext` from the `users` table by `params.userId`
     (mirrors `chat/completions/route.ts` lines 305-316 exactly).
   - Calls `getLiveConductorState(userId, supabase, userContext)`; if `null`,
     returns `{ ok: false, error: '...' }` (HTTP 200).
   - Calls `handleAdvanceTab(userId, liveState.content, liveState.tabIndex,
     userContext, supabase)` (no `forced` arg — this is always a voluntary,
     model-initiated call from this entry point, matching the backstop being
     out of scope per Q4).
   - Returns `{ ok: true, resultText, isLastTab }` on success.

   Note on typing: `SectionCommand` is currently a union of
   `ScrollToCommand | InsertSectionCommand`, both of which carry
   `TemplateSection`-related fields. The new `advance_tab` command has no
   body fields beyond `command` itself — add it as a third union member:
   ```ts
   type AdvanceTabCommand = { command: 'advance_tab' }
   type SectionCommand = ScrollToCommand | InsertSectionCommand | AdvanceTabCommand
   ```

4. **`lib/clio-context-builder.ts`**
   — `buildSessionBrief()`, current line 116, gains a conditional (see
   Section 6.4 for exact before/after). No signature change — no new
   parameter is added to `buildSessionBrief()` or `BuildDocsInput`.

No other files are touched. No changes to `lib/voice/live-conductor-bridge.ts`
itself, `app/api/clio/chat/completions/route.ts`, database migrations, or
any test fixtures beyond what the developer adds for Section 7's acceptance
tests.

---

## Developer Implementation Notes

- Implement Bug 2 first — it's a pure, isolated function change with no
  server/client wiring, and is safe to unit test in isolation before
  touching the route/client wiring for Bug 1.
- For Bug 1, verify `npx tsc --noEmit` is clean after both the route and
  client-side signature change — `createAdvanceTabToolHandler`'s call site
  at `WalkthroughClient.tsx:808` MUST be updated in the same change or the
  build will fail to typecheck (function now requires an argument).
- Do not add a `forced` parameter to the new route's request contract — the
  backstop is explicitly out of scope (Q4). If `handleAdvanceTab` is ever
  called with a 6th `forced: true` argument from this new route in the
  future, that would be new, separate scope requiring its own spec.
- Verify byte-for-byte `buildSessionBrief()` output stability for
  multi-section sessions with a unit test (Section 7, test 9) — this is the
  single most important regression guard for Bug 2, since the CEO brief's
  primary safety constraint is "normal sessions... byte-for-byte
  unaffected."
