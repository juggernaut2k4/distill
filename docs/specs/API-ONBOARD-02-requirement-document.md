# API-ONBOARD-02 — Remove GET /sessions/:id and usage.llm_generation_call from partner docs — Requirement Document
Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-09-06

## 1. Purpose
Arun reviewed the shipped Quick Start panel (API-ONBOARD-01) this morning and decided two things
should stop being partner-visible right now: the `GET /api/partner/v1/sessions/:clio_session_ref`
endpoint doc entry, and any documentation of the `usage.llm_generation_call` webhook event type. No
further product reason was given — this is a docs/UI visibility decision only. Without this change,
partners continue to see both in the unified `/dashboard/configurator/api` docs surface (and its
channel-partner-client mirror), which Arun has decided is premature.

## 2. User Story
As a partner developer reading Clio's API docs (`/dashboard/configurator/api`),
I want to see only the endpoints and webhook event types Arun currently wants exposed,
So that I don't build against or ask support about something not yet ready for partner use.

## 3. Trigger / Entry Point
- Route: `/dashboard/configurator/api` (the unified 3-pane docs+playground surface, `ApiClient.tsx`),
  and its channel-partner mirror `/dashboard/channel-partner/clients/[id]/configure/api` (same
  `ApiClient.tsx` component, different `basePath`).
- Triggered by: partner admin loading the page (component render), or clicking through the left nav
  and the Quick Start pane.
- State required: authenticated partner-admin/channel-partner session (existing auth gate,
  unchanged).

## 4. Screen / Flow Description

### State A — Quick Start pane (default view on page load)
Unchanged except one sentence. Currently the last paragraph before the closing "want the full
detail" line reads:

> `GET /sessions/:id` also exists, if you want to check a session's status — it's optional, not a
> required third step.

This entire paragraph (the `<p>` block, `ApiClient.tsx` lines 396–400) is **removed**. Nothing
replaces it — the two-call model ("1. One call out" / "2. One call back") already stands on its own
as "the whole flow," and the following paragraph ("Want the full detail...") reads cleanly
immediately after "That's the whole flow" without it. No new sentence is needed; inserting a
replacement line would itself risk mentioning the removed endpoint.

### State B — Left nav, "Sessions" category
Currently lists (in array order): `POST /sessions` (sessions_create), `GET /sessions/:clio_session_ref`
(sessions_get), `POST /widget-sessions`, `POST /bot-dispatch`, `POST /bot-sessions`.

After this change: `GET /sessions/:clio_session_ref` no longer renders as a nav button. The category
still renders (it has 4 remaining entries), just without that one row. Clicking any other entry is
unaffected.

### State C — Endpoint detail pane for `sessions_get`
No longer reachable from the nav (State B). The underlying data is not deleted (see Section 6/`10`
"Out of Scope" — hide, not delete), so no broken-route/blank-pane condition can occur; there is
simply no UI path to select it in this surface.

### State D — "Usage webhook" doc pane (`WebhookDoc()`)
Currently:
- "Event types" line lists: `usage.voice_minute, usage.llm_generation_call, session.completed, session.insights_ready`
- "Payload fields" table includes a `generation_type` row with note "usage.llm_generation_call only."

After this change:
- "Event types" line lists: `usage.voice_minute, session.completed, session.insights_ready`
- The `generation_type` row is removed from the payload fields table entirely (its note referenced
  only the now-hidden event type — keeping the row would be a field with no documented purpose,
  i.e. exactly the "dangling reference" this spec must avoid).

### State E — `usage` endpoint detail pane, "Query params" table
Currently the `event_type` param's Type column reads:
`"usage.voice_minute" | "usage.llm_generation_call" | "session.completed"`

After this change: `"usage.voice_minute" | "session.completed"`

### State F — Channel-partner client-configure legacy Playground (`PlaygroundClient.tsx`, live route
`/dashboard/channel-partner/clients/[id]/configure/api/playground`)
**No visible or behavioral change.** This route is untouched by this spec — see Section 6 for why.

## 5. Visual Examples

State A (Quick Start pane, after change):
```
┌───────────────────────────────────────────────────────────┐
│ How this works                                             │
│ Before the full endpoint list below, here's the whole      │
│ model in two calls.                                        │
│                                                              │
│ 1. One call out — you start a session                      │
│ Call POST /api/partner/v1/sessions with a meeting URL...   │
│                                                              │
│ 2. One call back — you receive the results                 │
│ When the session ends, Clio sends a session.insights_ready │
│ event to the base URL you set on the Integration page...   │
│ That same base URL also receives other event types...      │
│                                                              │
│ That's the whole flow                                       │  <- "GET /sessions/:id" paragraph
│                                                              │     removed; this heading now
│ Want the full detail, or to try a real request? Pick any   │     leads straight into the next
│ endpoint on the left...                                     │     paragraph.
└───────────────────────────────────────────────────────────┘
```

State B (left nav, "Sessions" category, after change):
```
┌ SESSIONS ──────────────┐
│ POST sessions           │
│ POST widget-sessions    │   <- GET :clio_session_ref row gone
│ POST bot-dispatch       │
│ POST bot-sessions       │
└──────────────────────────┘
```

State D (Usage webhook pane, after change):
```
┌───────────────────────────────────────────────────────────┐
│ POST                                                        │
│ {your outbound_base_url}/webhooks/usage                    │
│                                                              │
│ Event types                                                 │
│ usage.voice_minute, session.completed, session.insights_ready│
│                                                              │
│ Payload fields                                               │
│ ┌────────────────┬──────────────────────────────┐          │
│ │ event_id        │ Always present.                │          │
│ │ event_type      │ Always present.                │          │
│ │ clio_session_ref│ Always present.                │          │
│ │ partner_reference│ Echoed from your session-...  │          │
│ │ quantity        │ usage.* events only.            │          │
│ │ unit            │ "minutes" | "calls" — usage.*  │          │
│ │ occurred_at     │ Always present.                 │          │  <- generation_type row removed
│ │ dispatched_at   │ Always present.                 │          │
│ │ test_mode       │ true for any session created... │          │
│ │ extraction_status│ session.insights_ready only... │          │
│ │ ...             │ ...                              │          │
│ └────────────────┴──────────────────────────────┘          │
└───────────────────────────────────────────────────────────┘
```

State E (`usage` endpoint, Query params table, after change):
```
┌ Query params ─────────────────────────────────────────────┐
│ Param       Type                                    Default│
│ from        ISO 8601 string                          30d ago│
│ to          ISO 8601 string                          now    │
│ event_type  "usage.voice_minute" | "session.completed" (all)│  <- llm_generation_call removed
│ cursor      opaque base64 string               (first page) │
└───────────────────────────────────────────────────────────┘
```

## 6. Data Requirements
- No database reads/writes are added, removed, or changed by this spec. This is purely static
  TSX/TS content served from the page bundle.
- No API calls are added, removed, or changed. The real `GET /api/partner/v1/sessions/:clio_session_ref`
  route (`app/api/partner/v1/sessions/[clio_session_ref]/route.ts`) keeps functioning exactly as
  today — a partner who already knows the URL (or reads the OpenAPI/other channel, if any) can still
  call it and get a 200. Only its **doc entry and playground affordance in the new unified surface**
  disappear.
- The real webhook dispatch of `usage.llm_generation_call` events (`lib/partner/webhooks.ts`,
  `lib/partner/content-generation.ts`) is unchanged — partners who already have a webhook receiver
  still get these events exactly as today. Only its **documentation** in `WebhookDoc()`/`content.ts`
  disappears.
- The existing partner-facing **Usage log dashboard tab** (`app/(with-clerk)/dashboard/configurator/usage/UsageLogClient.tsx`,
  backed by `lib/partner/usage-log.ts`) continues to show real `usage.llm_generation_call` rows to
  partners exactly as today. This is explicitly **out of scope** — see Section 10. It is a live data
  report, not "documentation of the event type" in the sense the CEO brief means (partner-facing API
  reference content), and touching it would be scope creep beyond the two items named in the brief.

## 7. Success Criteria (Acceptance Tests)

✓ Given the `/dashboard/configurator/api` page loaded to the Quick Start pane, when read top to
  bottom, then no text mentions `GET /sessions/:id`, `sessions_get`, or "check a session's status",
  and the "That's the whole flow" heading is immediately followed by the "Want the full detail..."
  paragraph with no orphaned/incomplete sentence between them.

✓ Given the `/dashboard/configurator/api` page's left nav, when the "Sessions" category is expanded,
  then it shows exactly 4 entries (`POST sessions`, `POST widget-sessions`, `POST bot-dispatch`,
  `POST bot-sessions`) and no `GET` entry.

✓ Given the `/dashboard/channel-partner/clients/[id]/configure/api` mirror of the same page, when
  the "Sessions" category is expanded, then it also shows exactly 4 entries (this page reuses
  `ApiClient.tsx`/`ENDPOINTS`, so the fix applies there too).

✓ Given the "Usage webhook" doc pane, when read, then the Event types line lists exactly
  `usage.voice_minute, session.completed, session.insights_ready` and the Payload fields table has
  no `generation_type` row.

✓ Given the `usage` endpoint's detail pane, when the Query params table is read, then the
  `event_type` param's Type column shows exactly `"usage.voice_minute" | "session.completed"`.

✓ Given a partner who already knows the real GET route URL, when they call
  `GET /api/partner/v1/sessions/:clio_session_ref` with a valid API key, then they still receive the
  identical 200/401/403/404 behavior as before this change (route file untouched).

✓ Given a partner with a configured webhook receiver, when a session actually incurs an LLM
  generation call, then `lib/partner/webhooks.ts` still dispatches a `usage.llm_generation_call`
  event to their `outbound_base_url` exactly as before this change (dispatch code untouched).

✓ Given the partner-facing Usage log dashboard tab (`/dashboard/configurator/usage`), when a partner
  has `usage.llm_generation_call` events in their history, then those rows still display exactly as
  before this change (this file is untouched).

✓ Given the legacy `PlaygroundClient.tsx` surface at
  `/dashboard/channel-partner/clients/[id]/configure/api/playground` (a separate, still-live route
  that defaults its selection to `sessions_get` and reads the same `ENDPOINTS` array), when loaded,
  then it renders with no crash and behaves identically to before this change — because the
  `sessions_get` object is **hidden from the new `ApiClient.tsx` nav only**, not deleted from
  `ENDPOINTS`, so `ENDPOINTS.find((e) => e.id === 'sessions_get')` in `PlaygroundClient.tsx` still
  resolves.

✓ Given the full repo, when `npx tsc --noEmit` is run, then it exits 0 with no new errors.

✓ Given the full repo, when `npm run build` is run, then it exits 0 with no new errors or ESLint
  failures (per Arun's explicit instruction not to repeat the API-ONBOARD-01 tsc-only mistake).

## 8. Error States
Not applicable — this is static reference content with no user input, network call, or loading
state introduced or removed. No new error states are created. Existing error states elsewhere
(playground request failures, auth failures) are untouched.

## 9. Edge Cases
- **Partner with an old bookmark/deep link to the dead-redirected `/dashboard/configurator/api/playground`
  route**: unaffected — that route already 302-redirects to `/dashboard/configurator/api` (unrelated
  pre-existing behavior, not touched by this spec).
- **Channel-partner-client legacy Playground route** (`/dashboard/channel-partner/clients/[id]/configure/api/playground`,
  which is live, not redirected, and defaults to `sessions_get`): explicitly covered above — must
  keep working unchanged, which is the reason this spec hides rather than deletes the `sessions_get`
  entry.
- **Mobile / narrow viewport**: the docs grid already collapses to a single column below 860px
  (`ApiClient.tsx`'s existing `@media (max-width: 860px)` rule). Removing one nav button and
  shortening two text blocks does not change this behavior; no new responsive work is triggered
  because this change only removes content from an already-responsive screen (per the repo's
  standing responsive policy, a change that only removes/shortens content on an already-compliant
  screen does not require a new audit).
- **Empty "Sessions" category**: does not occur — 4 entries remain after removing 1 of 5.

## 10. Out of Scope
- The real `GET /api/partner/v1/sessions/:clio_session_ref` route
  (`app/api/partner/v1/sessions/[clio_session_ref]/route.ts`) — behavior unchanged, not edited.
- `lib/partner/webhooks.ts` and `lib/partner/content-generation.ts` — dispatch/billing logic for
  `usage.llm_generation_call`, unchanged, not edited.
- `lib/partner/usage-log.ts` and `app/(with-clerk)/dashboard/configurator/usage/UsageLogClient.tsx`
  (the Usage log dashboard tab) — real usage reporting, not "docs," explicitly not touched.
- `app/api/partner/v1/usage/route.ts` — the real usage query API, unchanged, not edited. It still
  accepts `event_type=usage.llm_generation_call` as a filter value exactly as before; only the
  *documented* list of accepted values in the docs UI is narrowed.
- `PlaygroundClient.tsx` and its two page wrappers — not edited at all. The hide-not-delete choice
  for the `sessions_get` `ENDPOINTS` entry (Section 6/12) is specifically what keeps this file
  working without any change to it.
- `PlaygroundEndpointId` type in `content.ts` — `'sessions_get'` stays in this union; removing it
  would break `PlaygroundClient.tsx`'s `useState<PlaygroundEndpointId>('sessions_get')` and its
  `endpoint.id === 'sessions_get'` checks.
- Any other endpoint or webhook event type — nothing else in the docs surface changes.
- Restyling, re-ordering, or otherwise touching any part of `ApiClient.tsx` beyond the exact removals
  listed in Section 4.

## 11. Open Questions
None.

## 12. Dependencies
- None. This is a self-contained content/UI edit against already-shipped files (API-ONBOARD-01,
  merged and live).

---

## Decision: Hide vs. Delete (per CEO brief's explicit instruction to ground this in grep results)

**`sessions_get` (the `GET /sessions/:id` endpoint doc entry): HIDE, not delete.**
Grep confirms another live, non-redirected route —
`app/(with-clerk)/dashboard/channel-partner/clients/[id]/configure/api/playground/page.tsx` →
`PlaygroundClient.tsx` — depends on the `sessions_get` entry existing in the `ENDPOINTS` array:
`PlaygroundClient.tsx` defaults `useState<PlaygroundEndpointId>('sessions_get')` and calls
`ENDPOINTS.find((e) => e.id === selectedId)!` (non-null assertion) on initial render. Deleting the
`sessions_get` object from `ENDPOINTS` would make that `.find()` return `undefined` and crash this
live route on load. This repo's existing "hide, don't delete" governance pattern
(`lib/partner/configurator-sections.ts`'s `VISIBLE_SECTIONS`) is the right shape for this problem,
adapted to endpoint-doc granularity: add a `partnerVisible?: boolean` field to the `EndpointDoc`
interface (default true if omitted; not set on any entry except `sessions_get`, which gets
`partnerVisible: false`). `ApiClient.tsx`'s nav-building `ENDPOINTS.filter((e) => e.category ===
category)` (line 206) becomes `ENDPOINTS.filter((e) => e.category === category && e.partnerVisible
!== false)`. `PlaygroundClient.tsx` is not touched and keeps reading the full, unfiltered
`ENDPOINTS` array, so its behavior is 100% unchanged. The `sessions_get` object itself, its `id`
in `PlaygroundEndpointId`, and the real route file are all left exactly as they are today.

**`usage.llm_generation_call` doc mentions: DELETE (straightforward removal), not hide.**
Grep confirms these are plain string literals in three places inside `content.ts`
(the `usage` endpoint's `event_type` queryParam `type` string, `WEBHOOK_DOC.eventTypes`, and
`WEBHOOK_DOC.payloadFields`'s `generation_type` row) and are rendered only by `content.ts` →
`ApiClient.tsx`'s `WebhookDoc()`/`EndpointDocView()`. No other file (including `PlaygroundClient.tsx`,
which never references `WEBHOOK_DOC`) reads these specific strings. There is no data-shape reason to
keep a hidden placeholder — removing the three string occurrences leaves no dangling reference
anywhere in the codebase. (The separate, independent `IN_SCOPE_EVENT_TYPES` constant in
`lib/partner/usage-log.ts` that powers the real Usage log tab is untouched — it does not import from
or depend on `content.ts` in any way.)

## Files Changed
1. `app/(with-clerk)/dashboard/configurator/api/content.ts`
   - Add `partnerVisible?: boolean` to the `EndpointDoc` interface.
   - Set `partnerVisible: false` on the `sessions_get` entry (object otherwise unchanged — keep it in
     `ENDPOINTS`, keep `'sessions_get'` in `PlaygroundEndpointId`).
   - In the `usage` entry's `queryParams`, change the `event_type` param's `type` string from
     `'"usage.voice_minute" | "usage.llm_generation_call" | "session.completed"'` to
     `'"usage.voice_minute" | "session.completed"'`.
   - In `WEBHOOK_DOC.eventTypes`, remove `'usage.llm_generation_call'` from the array.
   - In `WEBHOOK_DOC.payloadFields`, remove the `{ field: 'generation_type', notes: 'usage.llm_generation_call only.' }` row.
2. `app/(with-clerk)/dashboard/configurator/api/ApiClient.tsx`
   - Nav-building filter (currently `ENDPOINTS.filter((e) => e.category === category)`, line 206):
     also exclude `e.partnerVisible === false`.
   - `QuickStartDoc()`: remove the paragraph (lines ~396–400) that reads `GET /sessions/:id` also
     exists... — delete the entire `<p>` block, no replacement text.

No other files require edits. `PlaygroundClient.tsx`, both of its page wrappers, the real GET route,
`lib/partner/webhooks.ts`, `lib/partner/content-generation.ts`, `lib/partner/usage-log.ts`, and
`UsageLogClient.tsx` are all explicitly untouched (Section 10).

## Verification Steps for the Developer
1. `npx tsc --noEmit` — must exit 0.
2. `npm run build` — must exit 0 (do not rely on tsc alone; ESLint runs as part of `next build` and
   catches things tsc doesn't).
3. Manually walk `/dashboard/configurator/api`: confirm Quick Start pane, Sessions nav category,
   Usage webhook pane, and `usage` endpoint's query params table all match Section 5's "after"
   wireframes.
4. Manually walk `/dashboard/channel-partner/clients/[id]/configure/api/playground` (needs an
   existing channel-partner client fixture) and confirm it still loads with `sessions_get` selected
   by default, no console error, no crash.
5. Grep the two changed files after editing to confirm zero remaining occurrences of `GET /sessions/:id`-as-a-third-step
   language and zero remaining occurrences of the string `llm_generation_call`.
