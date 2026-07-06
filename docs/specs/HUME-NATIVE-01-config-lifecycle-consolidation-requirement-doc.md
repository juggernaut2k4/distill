# Hume Config Lifecycle Consolidation — Requirement Document
Version: 1.0
Status: DRAFT — pending CEO review
Author: Business Analyst Agent
Date: 2026-07-05
Source: `docs/specs/HUME-NATIVE-01-config-lifecycle-consolidation-feature-brief.md` (all 6 questions
resolved below) + baseline `docs/specs/HUME-NATIVE-01-phase-c-nightly-cleanup-requirement-doc.md`
(already approved, already built — not re-specified here, only extended/consolidated around) +
direct read of `inngest/hume-native-nightly-cleanup.ts`, `supabase/migrations/058_hume_native_config_archive.sql`,
`lib/voice/hume-native/config-provisioner.ts`, `app/api/debug/hume-chat/route.ts` at spec-writing time.

---

## 1. Purpose

Two gaps exist in the Hume Config lifecycle today, both discovered during today's live incident
investigation:

1. **No durable, permanent way to answer "what were the exact Config details and full transcript
   for session X."** The only tool that can currently answer this is
   `app/api/debug/hume-chat/route.ts` — a file its own code comment says to delete once debugging
   is done. It only works via a **live** call to Hume's REST API, which means the answer is
   unavailable the moment Hume 401s (wrong sandbox/env credentials — the exact failure hit today)
   or the Config has already been deleted by the nightly cleanup job (`inngest/hume-native-nightly-cleanup.ts`,
   already shipped and running nightly). Meanwhile, a fully durable, non-Hume-dependent copy of
   this exact data (`config_snapshot`, `transcript_events`) already exists in
   `hume_native_config_archives` for any session the nightly job has processed — but nothing reads
   from it. Without this feature: every time Arun or an engineer needs to inspect a past session's
   Config/transcript, they are dependent on live Hume API access working, which today it did not.

2. **`builtin_tools` in `config-provisioner.ts` silently drops `web_search`.** Every per-session
   cloned Config hardcodes `builtin_tools: [{ name: 'hang_up' }]` (line 178-180), even though the
   base production config (`4e0c7e15-bb03-40b2-aded-21813f19fc8d`) has both `hang_up` and
   `web_search` enabled (confirmed via live fetch earlier this session). Every native-mode session
   today silently loses `web_search` capability relative to the base config it was cloned from.
   Without this fix: native-mode sessions can never use web search, with no error or signal that
   anything is missing — a silent capability regression baked into every session.

This document specifies both fixes as one consolidated pass: a small, contained `builtin_tools`
correction, and a permanent query capability that replaces the debug endpoint's config/transcript
lookup responsibility with a proper, durable-first, live-fallback internal function.

## 2. User Story

As Arun (or a future engineer investigating a Hume-native session),
I want to ask "what were this session's exact Config details and full transcript" and get a
reliable answer regardless of whether Hume still has the Config or the archive job has already run,
So that I can diagnose voice/config issues without depending on live Hume API access working at the
moment I ask.

As the system provisioning a new Hume-native session,
I want the per-session cloned Config's `builtin_tools` to match whatever the base config actually
has enabled,
So that native-mode sessions never silently lose a builtin capability (like `web_search`) that the
base config provides.

There is no end-user-facing screen, UI, or interaction for this feature. Per Arun's explicit "you
need not show me but if I ask I need the answers" — this is a backend/queryable capability only.

## 3. Trigger / Entry Point

This feature has two independent pieces, each with its own entry point:

### 3.1 `builtin_tools` fix
- Not a route or UI trigger. Activates automatically every time
  `provisionNativeConfig()` (`lib/voice/hume-native/config-provisioner.ts`) runs — i.e. every time a
  new Hume-native session is provisioned, exactly as today, no new trigger.

### 3.2 Config/transcript read capability
- **New library function** (the reusable, callable-from-anywhere primary surface — Section 4
  Question 1 resolution below): `getHumeSessionDetails(sessionId: string)`, exported from a new file
  `lib/voice/hume-native/session-details.ts`.
- **New thin internal API route wrapping it:** `app/api/internal/hume-native/session-details/route.ts`,
  `GET /api/internal/hume-native/session-details?sessionId=<uuid>`. Not linked from any UI. Callable
  directly (curl, or by Arun asking the assistant to call it) for on-request querying.
- **State required to call it:** none (no auth session/login state) — this is an internal
  diagnostic route, not user-facing. See Section 9 (Edge Cases) for the access-control decision.
- **`app/api/debug/hume-chat/route.ts`:** the `configId`/`configId&diff=1` lookup paths are removed
  from this file (superseded — see Section 3.3). The file is not deleted outright; see Section 3.3
  for exact disposition.

### 3.3 Disposition of `app/api/debug/hume-chat/route.ts` — resolved (brief's Question 5)

**Decision: option (b) — kept, narrowed, relabeled. Not deleted outright.**

Reasoning: the file currently serves two genuinely distinct capabilities that must not be
conflated:
1. **Config-by-id fetch + diff-against-base** (the `configId` and `configId&diff=1` query params,
   lines 64-90 of the current file). This capability is what today's brief is about — it overlaps
   exactly with "give me the full Config details for a session," and is fully superseded by
   `getHumeSessionDetails()` (Section 4 below), which is a strict superset (it also handles
   transcript, archive-first lookup, and session-id-based lookup rather than requiring a raw config
   id). **This logic is removed from the debug file.**
2. **Live chat/event inspection unrelated to config archival** (the `chat_id` param, the
   `recent_chats` listing when no `chat_id` is given, and the bare `config=1` base-config-fetch
   param, lines 92-127). These are live, ad-hoc, unarchived diagnostic views — e.g. "list the 5 most
   recent Hume chats" or "show me the base production config's live current state" — that have
   nothing to do with archived session data and are explicitly out of this brief's scope (the brief
   only asks about session Config + transcript archival/read, not live chat-listing tooling). These
   paths **stay**, since removing genuinely-still-useful live-diagnostic capability was never asked
   for and isn't what "consolidation" means here.

**Resulting file:** `app/api/debug/hume-chat/route.ts` keeps only the `chat_id`, `config=1`, and
no-param (`recent_chats`) branches. Its `explicitConfigId`/`diff` branch (lines 64-90) is deleted.
Its file-level comment is rewritten from "Temporary debug endpoint... DELETE THIS FILE after
debugging is complete" to accurately describe its narrowed, intentional, permanent scope: a small
internal live-diagnostic utility for chat-event/base-config inspection, explicitly not for archived
session lookups (which now live at `getHumeSessionDetails()` / `/api/internal/hume-native/session-details`).
No file continues to carry a "delete me" label while doing production-relevant work — per the
brief's explicit non-negotiable constraint.

This is an explicit, approved deletion of the `explicitConfigId`/`diff` code block only (not the
whole file) — called out here per CLAUDE.md's requirement that any code removal be explicitly
flagged and approved in the spec, not silently dropped.

## 4. Screen / Flow Description

No UI screens (backend-only feature, confirmed no UI requirement — see Section 10, Out of Scope).
This section documents the exact function contract and flow instead, since that is this feature's
equivalent of a "screen."

### 4.1 Query surface shape — resolved (brief's Question 1)

**Both (a) and (b), per the brief's own recommendation — a thin route wrapping a lib function.**
The lib function is the primary, reusable surface (callable from anywhere in the codebase —
scripts, other server code, or directly by an agent on Arun's behalf without going through HTTP at
all); the route exists only so the capability is reachable on-request without needing a script
execution environment.

**Exact function signature and location:**

```ts
// lib/voice/hume-native/session-details.ts

export interface HumeSessionDetailsResult {
  sessionId: string
  source: 'archive' | 'live'
  configSnapshot: Record<string, unknown>
  transcriptEvents: unknown[]
  humeConfigId: string
  humeChatId: string
  archivedAt: string | null   // ISO timestamp if source === 'archive', else null
}

export type HumeSessionDetailsError =
  | { code: 'session_not_found'; message: string }
  | { code: 'not_eligible_no_hume_ids'; message: string }
  | { code: 'live_fetch_failed'; message: string; humeStatus?: number }
  | { code: 'live_fetch_config_deleted'; message: string }

/**
 * Returns the full Config details and transcript for a given session, sourced
 * from the durable archive if available, falling back to a live Hume API call
 * otherwise. Throws HumeSessionDetailsLookupError (wrapping one of the codes
 * above) on failure — callers (including the route wrapper) must catch and
 * translate to their own response shape.
 */
export async function getHumeSessionDetails(
  sessionId: string
): Promise<HumeSessionDetailsResult>
```

**Route wrapper contract:**

```
GET /api/internal/hume-native/session-details?sessionId=<uuid>

200 → HumeSessionDetailsResult (JSON)
400 → { error: string }   (missing/malformed sessionId)
404 → { error: string }   (session_not_found, not_eligible_no_hume_ids)
502 → { error: string, humeStatus?: number }   (live_fetch_failed, live_fetch_config_deleted)
```

### 4.2 Archived-first, live-fallback logic — resolved (brief's Question 2)

Exact algorithm inside `getHumeSessionDetails(sessionId)`:

1. Query `sessions` for the row matching `id = sessionId`, selecting
   `hume_native_config_id, hume_chat_id, hume_config_archived_at`.
   - If no row found → throw `{ code: 'session_not_found', message: 'No session with id <sessionId>' }`.
2. If `hume_native_config_id IS NULL` or `hume_chat_id IS NULL` → throw
   `{ code: 'not_eligible_no_hume_ids', message: 'Session <id> has no Hume config/chat id — native mode was never provisioned or never connected' }`.
   (Same eligibility precondition already established by the nightly job's own eligibility query,
   reused here for consistency — not reinvented.)
3. **If `hume_config_archived_at` is non-null** (the session has already been processed by the
   nightly job): query `hume_native_config_archives` for the row matching `session_id = sessionId`,
   selecting `config_snapshot, transcript_events, hume_config_id, hume_chat_id, archived_at`,
   ordered `archived_at DESC` limit 1 (in case a harmless duplicate archive row exists per the
   nightly job's own documented retry behavior — Section 8 of the baseline spec — always return the
   most recent one).
   - Return `{ sessionId, source: 'archive', configSnapshot, transcriptEvents, humeConfigId, humeChatId, archivedAt }`.
   - If, unexpectedly, no archive row is found despite `hume_config_archived_at` being set (should
     never happen given the nightly job's code-level insert-before-marking order, but defensively
     handled): fall through to step 4 (live fallback) rather than erroring, since the live Config may
     still exist.
4. **If `hume_config_archived_at` is null** (not yet archived — e.g. a session from earlier today
   before tonight's nightly run): fetch live from Hume, reusing the exact same fetch pattern already
   proven in `config-provisioner.ts`'s `getExistingConfig()` / the debug endpoint's `fetchConfig()`
   (`GET https://api.hume.ai/v0/evi/configs/{hume_native_config_id}` with the `X-Hume-Api-Key`
   header from `process.env.HUME_API_KEY`), plus the transcript pagination loop already proven in
   the nightly job (`GET https://api.hume.ai/v0/evi/chats/{hume_chat_id}/events`, paginating via
   `page_size`/`page_number`/`total_pages` until exhausted).
   - If the Config fetch returns 404 → throw
     `{ code: 'live_fetch_config_deleted', message: 'Config <id> not found on Hume and no archive exists for session <id> — data is unavailable' }`.
   - If the Config fetch returns any other non-2xx (e.g. 401, matching today's exact incident) →
     throw `{ code: 'live_fetch_failed', message: '...', humeStatus: <status> }`. The error message
     never includes the API key itself (never logged, per the non-negotiable secrets rule).
   - If the transcript fetch fails at any page → same `live_fetch_failed` error code, message
     indicates it was the transcript step that failed.
   - On success: return `{ sessionId, source: 'live', configSnapshot, transcriptEvents, humeConfigId: hume_native_config_id, humeChatId: hume_chat_id, archivedAt: null }`.

This function performs **read-only** operations in both branches — it never writes to
`hume_native_config_archives`, never sets `hume_config_archived_at`, and never calls `DELETE` on any
Hume Config. It has zero interaction with the nightly job's write path; it only reads what the
nightly job (archive branch) or Hume itself (live branch) already has.

## 5. Visual Examples

Not applicable — no UI. Per the Requirement Document template, this is explicitly noted rather than
fabricating a wireframe for a feature with no screen.

## 6. Data Requirements

### 6.1 Reads
- `sessions` table: `id, hume_native_config_id, hume_chat_id, hume_config_archived_at` (all columns
  already exist — migrations 056 and 058, both already applied; no new migration needed for this
  spec).
- `hume_native_config_archives` table: `session_id, config_snapshot, transcript_events,
  hume_config_id, hume_chat_id, archived_at` (already exists — migration 058, already applied).
- Live Hume API (fallback only): `GET /v0/evi/configs/{configId}`, `GET /v0/evi/chats/{chatId}/events`
  (both already-proven call shapes, reused verbatim from `config-provisioner.ts` and
  `hume-native-nightly-cleanup.ts`; no new Hume endpoints introduced).

### 6.2 Writes
- None. This is a pure read capability. No new table, no new column, no migration required.

### 6.3 `builtin_tools` fix — exact data change

In `lib/voice/hume-native/config-provisioner.ts`, the `body.builtin_tools` field (currently lines
178-180, hardcoded `[{ name: 'hang_up' }]`) is changed to be dynamically reconstructed from
`baseConfig.builtin_tools` (already fetched and available in-scope from `getExistingConfig()` at
line 134 — no new API call needed), rather than hardcoding both `hang_up` and `web_search` as a
second static literal.

**Resolved (brief's Question 4): dynamic reconstruction, not a second hardcoded literal.**
This matches the brief's own recommendation and is the correct fit with the file's documented
"explicit-reconstruction, not blind spread" design rationale for exactly the reason the brief
itself identifies: `voice` and `language_model` are fixed-shape objects where GET and POST use
genuinely different key names (a hardcoded reconstruction is the only correct fix, and a change to
either would be a breaking schema change requiring a code update anyway). `builtin_tools`, by
contrast, is a **list of independently-togglable, same-shaped entries** — GET's response shape for
each builtin tool entry (`{ name }`, optionally `fallback_content`) already matches POST's
`posted_builtin_tool` shape (`{ name, fallback_content? }`) exactly, per the file's own existing
comment (line 47-49: "shape `{ name, fallback_content? }`"). There is no GET/POST asymmetry to guard
against here — the asymmetry that justified hardcoding `voice`/`language_model` simply doesn't exist
for `builtin_tools`. Hardcoding a second literal (`[{ name: 'hang_up' }, { name: 'web_search' }]`)
would silently drift again the next time the base config's enabled builtin tools change (exactly
the bug being fixed today) — dynamic reconstruction is the only fix that is actually durable.

**Exact code change:**

```ts
// Before (config-provisioner.ts, current lines 178-180):
builtin_tools: [
  { name: 'hang_up' },
],

// After:
builtin_tools: Array.isArray(baseConfig.builtin_tools)
  ? (baseConfig.builtin_tools as Array<{ name: string; fallback_content?: string }>).map(
      (tool) => ({
        name: tool.name,
        ...(tool.fallback_content ? { fallback_content: tool.fallback_content } : {}),
      })
    )
  : [{ name: 'hang_up' }],  // defensive fallback if base config ever returns builtin_tools
                             // as something other than an array (e.g. undefined) — never
                             // silently produces an empty tools list; hang_up is the one
                             // builtin tool this app has always required (Config's own hang_up
                             // capability), matching today's pre-fix baseline as the safe floor.
```

The destructured `_baseBuiltinTools` (current line 153, used to strip `builtin_tools` out of
`inheritedFields` so the spread can never reintroduce it) stays exactly as-is — it is still needed
so the spread doesn't double-apply the raw GET shape; only the literal at lines 178-180 changes to
reference `baseConfig.builtin_tools` (captured before destructuring, already in scope) instead of a
hardcoded array.

The module-level doc comment (lines 44-50) is updated to describe the new dynamic-reconstruction
behavior for `builtin_tools`, replacing the now-inaccurate "Fixed here by explicitly reconstructing
both fields... and `builtin_tools` as `{ name: 'hang_up' }`" sentence.

## 7. Success Criteria (Acceptance Tests)

1. ✓ Given a session with `hume_config_archived_at` set (already processed by the nightly job),
   when `getHumeSessionDetails(sessionId)` is called, then it returns `source: 'archive'` with
   `configSnapshot` and `transcriptEvents` read directly from `hume_native_config_archives`, with
   zero live Hume API calls made.
2. ✓ Given a session with `hume_config_archived_at` NULL but valid `hume_native_config_id` and
   `hume_chat_id` (e.g. a session from earlier today, before tonight's nightly run), when
   `getHumeSessionDetails(sessionId)` is called, then it fetches live from Hume (Config + paginated
   transcript), returns `source: 'live'`, and does not touch `hume_native_config_archives` at all
   (no write).
3. ✓ Given a session with `hume_native_config_id` or `hume_chat_id` NULL (native mode never
   provisioned/connected), when `getHumeSessionDetails(sessionId)` is called, then it throws
   `{ code: 'not_eligible_no_hume_ids' }` without attempting any Hume API call.
4. ✓ Given a nonexistent `sessionId`, when `getHumeSessionDetails(sessionId)` is called, then it
   throws `{ code: 'session_not_found' }`.
5. ✓ Given a session not yet archived, whose live Config fetch returns 401 (wrong sandbox/env
   credentials — reproducing today's exact incident), when `getHumeSessionDetails(sessionId)` is
   called, then it throws `{ code: 'live_fetch_failed', humeStatus: 401 }` with a message that
   contains no API key value.
6. ✓ Given a session not yet archived, whose live Config fetch returns 404 (Config already deleted
   outside the nightly job's own tracking), when `getHumeSessionDetails(sessionId)` is called, then
   it throws `{ code: 'live_fetch_config_deleted' }`.
7. ✓ Given `GET /api/internal/hume-native/session-details?sessionId=<archived-session-id>`, when
   called, then it returns HTTP 200 with the same shape `getHumeSessionDetails` returns.
8. ✓ Given `GET /api/internal/hume-native/session-details` with no `sessionId` query param, when
   called, then it returns HTTP 400 with an error message, and never calls `getHumeSessionDetails`.
9. ✓ Given a fresh test session provisioned via `provisionNativeConfig()` after the `builtin_tools`
   fix, when its Config is fetched (via `getHumeSessionDetails` live path or a direct Hume fetch),
   then its `builtin_tools` array contains both `{ name: 'hang_up' }` and `{ name: 'web_search' }`,
   matching the base config's current actual state.
10. ✓ Given `app/api/debug/hume-chat/route.ts` after this change, when called with
    `?configId=<id>` or `?configId=<id>&diff=1`, then it no longer recognizes those params (removed
    branch) — falls through to the no-`chat_id` `recent_chats` behavior instead, since
    `explicitConfigId` handling no longer exists in this file. When called with `?chat_id=<id>` or
    `?config=1` or no params, it behaves exactly as before (unchanged, still-scoped-in behavior).

## 8. Error States

- **Live fallback 401 (today's exact incident):** surfaced as `live_fetch_failed` with
  `humeStatus: 401`, never masked as a generic 500, so the caller immediately knows it's a
  credentials/environment problem, not a missing-data problem.
- **Live fallback 404 on Config fetch:** surfaced distinctly as `live_fetch_config_deleted` (not
  conflated with 401/500 `live_fetch_failed`) since it means "the data is genuinely gone, not a
  transient/credentials issue" — mirrors the same fetch-vs-delete 404 distinction already
  established in the nightly job's own Edge Cases section (fetch-time 404 = real data loss).
- **Live fallback transcript pagination failure mid-loop:** treated the same as a Config fetch
  failure (`live_fetch_failed`) — a partial transcript is never returned as if it were complete;
  either the full transcript is returned or an error is thrown, never a silently-truncated result.
- **Route-level errors:** the route wrapper catches every `HumeSessionDetailsError` thrown by the
  lib function and maps it to the HTTP status defined in Section 4.1's contract table; any
  unexpected/unclassified thrown error (a bug, not one of the four defined codes) is caught and
  returns HTTP 500 with a generic message — the route must never crash uncaught.
- **`HUME_API_KEY` missing/placeholder at live-fallback time:** the function checks this before
  attempting any live fetch and throws `live_fetch_failed` with a message stating the key is not
  configured (distinguishable from an actual Hume-side 401, but same error code/handling path from
  the caller's perspective — this is a configuration problem, not data unavailability, but both
  correctly resolve to "cannot complete the live fallback right now").

## 9. Edge Cases

- **Access control on the internal route:** this route has no user-facing auth check (matching the
  existing `app/api/debug/hume-chat/route.ts`'s own precedent — that file also has no auth gate
  today) since it lives under `/api/internal/` specifically to signal "not for browser/end-user
  traffic, callable by trusted server-side/operator context only," the same convention this brief's
  "not linked from any UI" instruction implies. No new access-control mechanism is introduced or
  required by this spec; if stricter access control is wanted later, that is a separate, explicitly
  scoped decision, not invented here.
- **Session archived twice (harmless duplicate archive row, per the baseline spec's documented
  retry behavior):** handled by ordering `archived_at DESC LIMIT 1` in the archive-branch query
  (Section 4.2, step 3) — always returns the most recent, most complete archive attempt.
- **A session whose nightly-job archive attempt is mid-flight right now** (archived_at not yet set,
  Hume Config not yet deleted): correctly falls to the live branch and succeeds normally — there is
  no race condition here since the nightly job only sets `hume_config_archived_at` after both the
  archive insert and the delete attempt complete; until then this function correctly treats the
  session as "not yet archived, use live" and the live Config still exists to be fetched.
- **A session whose nightly job already deleted the Hume Config but the archive insert failed**
  (per the baseline spec's own documented behavior, this state cannot persist — `hume_config_archived_at`
  is only set if the archive insert succeeded, and the baseline spec's archive-before-delete
  ordering guarantees delete never runs before a successful archive insert): not reachable given the
  baseline job's guarantees; not specifically handled here since it would indicate a bug in the
  already-approved baseline job, out of this spec's scope to re-verify.
- **`builtin_tools` fix: base config's `builtin_tools` becomes an empty array in the future** (all
  builtin tools disabled on the base config): the dynamic reconstruction correctly produces an empty
  `builtin_tools: []` for new sessions, matching the base config's actual state — this is the
  intended behavior of "match base config exactly," not an edge case requiring special handling.
- **`builtin_tools` fix: base config's `builtin_tools` field is missing entirely (`undefined`) from
  the GET response** (should not happen given today's confirmed live state, but defensively
  handled): falls to the `[{ name: 'hang_up' }]` defensive fallback (Section 6.3) rather than
  producing `undefined` or crashing.

## 10. Out of Scope

- **Any new user-facing UI.** Per Arun's explicit "you need not show me but if I ask I need the
  answers" — this is backend/queryable only. No dashboard, no admin page, nothing rendered to any
  browser.
- **Changing the nightly job's cadence, eligibility window, or archive/delete step logic.** The
  baseline spec (`HUME-NATIVE-01-phase-c-nightly-cleanup-requirement-doc.md`) and its already-built
  implementation (`inngest/hume-native-nightly-cleanup.ts`, including its DST-aware
  `TZ=America/Chicago 0 0 * * *` cron correction) are untouched by this spec. This spec's read
  function only ever reads from tables the nightly job already writes to — it adds no new write
  path, no new eligibility criteria, no schedule change.
- **A general/on-demand deletion capability beyond the nightly job.** Resolved (brief's Question 3):
  **the nightly job's existing "archive then delete, ended >1hr ago" coverage is sufficient as the
  sole deletion mechanism.** Reasoning: Arun's phrasing ("the application must delete configs once
  their useful life is over") is already fully satisfied by the nightly job, which deletes every
  eligible Config exactly once its session has been over for more than an hour and its data safely
  archived — there is no described scenario in the brief or feature brief where a Config needs to be
  deleted sooner than that window, or where an operator needs to manually force-delete a specific
  session's Config out-of-cycle. No on-demand deletion function or route is added by this spec. If a
  future concrete need for on-demand deletion emerges (e.g. a compliance/right-to-be-forgotten
  request naming a specific session), that is a new, separately-scoped feature — not invented here
  speculatively.
- **Any change to `sessions.hume_native_config_id` / `hume_chat_id` write paths** (set at
  provisioning/connect time) — this spec's new read function only reads them, never writes.
- **Any change to the base production Config (`4e0c7e15-bb03-40b2-aded-21813f19fc8d`)** beyond
  reading it (already how `config-provisioner.ts` uses it today — no new write, no new mutation).
- **The `chat_id` / `recent_chats` / `config=1` diagnostic paths remaining in
  `app/api/debug/hume-chat/route.ts`** — unchanged, out of scope, per Section 3.3.
- **A new migration or schema change.** Both `hume_native_config_archives` and
  `sessions.hume_config_archived_at` already exist (migration 058, already applied) — this spec adds
  no new table or column.

## 11. Open Questions

None. All 6 questions from the feature brief are resolved concretely above:

1. **Query surface shape** — resolved in Section 4.1: both a lib function
   (`lib/voice/hume-native/session-details.ts`, `getHumeSessionDetails(sessionId)`) and a thin route
   wrapping it (`app/api/internal/hume-native/session-details/route.ts`), per the brief's own
   recommended option (c), with the exact function signature, error-code union, and route contract
   fully specified.
2. **Archived-first, live-fallback logic** — resolved in Section 4.2: checks
   `sessions.hume_config_archived_at`, reads from `hume_native_config_archives` if set, falls back
   to a live Hume fetch (reusing the exact proven fetch/pagination pattern from
   `config-provisioner.ts` and the nightly job) if not, with a fully defined error contract for every
   failure mode (401, 404-at-fetch, missing key).
3. **Deletion coverage sufficiency** — resolved in Section 10 (Out of Scope): the nightly job's
   existing coverage is confirmed sufficient as the sole deletion mechanism; no additional on-demand
   deletion capability is added.
4. **`builtin_tools` fix scope** — resolved in Section 6.3: dynamic reconstruction from the base
   config's actual `builtin_tools` field (not a second hardcoded literal), with the exact before/
   after code and the reasoning for why this differs from the `voice`/`language_model` fixed-literal
   pattern (no GET/POST shape asymmetry exists for `builtin_tools`, so dynamic reconstruction is safe
   and more durable).
5. **Disposition of `app/api/debug/hume-chat/route.ts`** — resolved in Section 3.3: option (b),
   kept and narrowed. The `configId`/`configId&diff=1` branch is explicitly deleted (superseded by
   `getHumeSessionDetails`); the `chat_id`/`config=1`/`recent_chats` branches stay, unmodified in
   behavior; the file's misleading "DELETE THIS FILE" debug-framing comment is rewritten to
   accurately describe its narrowed, permanent, intentional scope.
6. **Testing/verification approach** — resolved in Section 7 (Acceptance Tests) and Section 12
   (Dependencies): QA Gate 3 for this feature means calling `getHumeSessionDetails()` directly (or
   via the route) against one real already-archived session (any session in
   `hume_native_config_archives` today satisfies this — query the table directly to pick one) and
   one real not-yet-archived session (any Hume-native session from today, before tonight's
   `TZ=America/Chicago 0 0 * * *` nightly run, whose `hume_config_archived_at` is still NULL),
   confirming both return correct non-mock data via their respective source paths, plus provisioning
   one fresh test session after the `builtin_tools` fix ships and confirming its live Config's
   `builtin_tools` array includes `web_search`.

## 12. Dependencies

- **`hume_native_config_archives` table and `sessions.hume_config_archived_at` column** — already
  exist (migration 058, already applied, already running nightly). This spec adds no new schema; it
  only reads what's already there.
- **`sessions.hume_native_config_id`, `hume_chat_id`** — already exist (migration 056, already
  applied, already populated by the existing provisioning path).
- **`HUME_API_KEY` env var** — already exists, already used identically by
  `config-provisioner.ts`, `hume-native-nightly-cleanup.ts`, and `app/api/debug/hume-chat/route.ts`.
  No new secret needed.
- **The nightly cleanup job (`inngest/hume-native-nightly-cleanup.ts`)** — must continue running as-is
  (untouched by this spec) for the archive branch of `getHumeSessionDetails` to ever have data to
  read; this spec is purely a downstream consumer of that already-approved, already-built job's
  output.
- **`config-provisioner.ts`'s `getExistingConfig()` fetch pattern and the nightly job's transcript
  pagination loop** — both already-proven, already-working code patterns reused (not duplicated) by
  `getHumeSessionDetails`'s live-fallback branch. The BA recommends extracting the shared "fetch one
  page of transcript events" logic into a small shared helper (e.g. co-located in
  `lib/voice/hume-native/session-details.ts` itself, or a new `lib/voice/hume-native/hume-api-client.ts`
  if the developer judges the pagination loop substantial enough to warrant its own module) rather
  than copy-pasting the loop a third time — this is a technical (not product) implementation-detail
  choice, left to the developer's judgment per CLAUDE.md's technical-decision autonomy, since either
  structure satisfies every acceptance test above identically.

---

## Self-Review Checklist

- Could a developer build this with zero follow-up questions? Yes — exact function signature, exact
  error-code union, exact route contract and status-code mapping, exact `builtin_tools` before/after
  code diff, and exact disposition of the debug file (which lines are removed vs. kept) are all
  specified above with no "TBD" left for a product decision.
- No "standard"/"typical" UI language used — there is no UI in this feature.
- No "similar to X" shorthand — every function, table read, and code change is written out in full.
- Section 11 is empty.
- Non-negotiable constraints carried forward and verified: base production config is only ever read
  (never written) by any code path in this spec; archive-before-delete ordering in the nightly job
  is entirely untouched (this spec adds no delete path at all); per-session failure isolation is
  N/A here since this is a single-session read function, not a batch job, but its error contract
  ensures one session's failure (e.g. a 401) never throws an unclassified/uncaught error; the one
  explicit code deletion (the debug file's `configId`/`diff` branch) is called out plainly in
  Section 3.3 and Section 11, not silently dropped; secrets only from `process.env.HUME_API_KEY`,
  never logged or included in any error message/response body.

---

## Build-Time Caution (added at CEO review, 2026-07-05)

A separate, unrelated bug fix is being made **in parallel, at the same time as this spec's review**,
to `config-provisioner.ts`: GET/POST shape mismatches in `turn_detection`, `interruption`, `nudges`,
and `timeouts.max_duration` — beyond the `builtin_tools` gap this spec covers. That parallel fix may
change line numbers, the shape of `getExistingConfig()`'s return value, or the surrounding
destructuring (e.g. the `_baseBuiltinTools` extraction at current line 153) referenced in Section
6.3 above.

**Before implementing Section 6.3 literally, the developer must re-read the current state of
`config-provisioner.ts` and re-verify:**
- The exact line numbers for the `builtin_tools` literal (cited above as lines 178-180) still match.
- `baseConfig.builtin_tools` is still captured in-scope before destructuring, exactly as described.
- No structural change to `getExistingConfig()` invalidates the "already fetched, no new API call
  needed" assumption in Section 6.3.

This is a heads-up, not a blocker — the fix's logic (dynamic reconstruction from
`baseConfig.builtin_tools`) is independent of whatever the parallel fix does to other config fields,
and should not conflict at a design level. But the exact diff must be re-verified against the file's
state at implementation time, not applied blindly against the line numbers as written above.

---

## CEO Approval

**Status: APPROVED**
Date: 2026-07-05
Reviewed by: CEO Agent (on behalf of Arun)

Confirmed:
- Requirement doc matches the feature brief's scope exactly — nothing invented, nothing dropped.
- Section 11 (Open Questions) is genuinely empty; all 6 brief questions resolved with concrete,
  non-hand-waved decisions.
- Archive-first/live-fallback logic is correctly ordered (archive table checked before any live Hume
  call is made) and introduces no unnecessary Hume API calls.
- Nightly job's cron schedule, eligibility logic, and archive-before-delete ordering are confirmed
  untouched — this spec is purely additive/downstream.
- Debug file disposition is concrete and unambiguous (exact lines removed vs. kept, exact comment
  rewrite specified).
- Build-time caution appended above regarding the parallel `config-provisioner.ts` fix in progress —
  developer must re-verify line references and `getExistingConfig()` shape against the file's actual
  state at implementation time. This does not block approval.

Cleared to proceed to development.

## Approval

- [x] CEO Agent review
- [x] CEO Agent approval (required before any developer agent writes code, per CLAUDE.md's
      governance model — no exceptions)
