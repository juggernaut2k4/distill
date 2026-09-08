# Pause and Hide Template-Mode Sessions (Commit to Inline-Only Going Forward) — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-08-01

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Per this project's standing rule that specs must be grounded in real code (see
`docs/specs/B2B-61-requirement-document.md` §0 and `docs/specs/B2B-63-requirement-document.md` §0 for the
pattern), every load-bearing claim in
`.claude/agents/clio/feature-briefs/B2B-64-pause-hide-template-mode-sessions.md` was re-checked directly
against source before writing this document, not taken on faith from the brief:

- **`app/api/partner/v1/sessions/route.ts`, confirmed by direct read (full file, lines 1–430).** The
  route's structured-error convention is exactly `{ error: { code, message } }` at `422` for every
  imperative pre-flight check (`invalid_reseller_id`, `client_id_required`, `invalid_client_id`,
  `content_source_not_found`, `content_source_auth_type_not_supported`,
  `content_source_url_rejected`), versus the *generic* `{ error: 'Validation failed', details }` shape
  used only for Zod's own `safeParse` failure (line 36–38). `isInline` is computed once, at line 62, as
  `Boolean(content_pages)`, and used identically in the request-shape sense the brief describes. This is
  the exact precedent this document's new guard follows (§4, §6).
- **`lib/partner/session-schema.ts`, confirmed by direct read (full file).** `CreateSessionSchema`'s
  `.refine()` (lines 84–95) enforces "exactly one of {inline, reference}" via
  `inline !== reference`, and this refine runs **inside** `CreateSessionSchema.safeParse(body)` —
  i.e. strictly before the route's own imperative code ever executes. This directly resolves the brief's
  Question 2/BA-instruction-8 ordering question: a request supplying **both** `content_pages` and
  `partner_topic_ref`/`content_ref` fails this refine first, returning the pre-existing generic
  `{ error: 'Validation failed', details }` 422 response, before the new guard this document specifies is
  ever reached — confirmed structurally true today, requires no code change to preserve (§7, §9).
- **`lib/partner/live-render.ts`'s `resolveLiveSessionRender()`, confirmed by direct read (lines
  336–430, 473–620, 710+).** The non-inline branch (lines 340–430-ish) is a fully separate code path
  from `resolveInlineSessionRender()` (line 479+) — confirmed `extractSections()`, `TemplateSection`, and
  `selectPartnerTemplate()` (imported from `./custom-templates`, line 6) are called **only** inside the
  non-inline branch; `resolveInlineSessionRender()` builds its own session content via
  `buildInlineSessionContent()` (line 644) and never touches any of those three. The two paths are
  already fully isolated from each other at the render layer — nothing needs to change here, and nothing
  *can* be deleted here without breaking pre-existing sessions (§5).
- **`lib/partner/configurator-sections.ts`, confirmed by direct read (full file).**
  `VISIBLE_SECTIONS = ['integration', 'payment']` (line 27) already excludes `'questionnaire'`, `'topics'`,
  `'content'`, and `'visualization'` from the partner-facing Configurator nav — B2B-23's authoring-screen
  hide is confirmed complete and correctly scoped; this document changes nothing here (Known Constraint,
  confirmed).
- **`app/(with-clerk)/dashboard/configurator/docs/DocsClient.tsx`, confirmed by direct read (full
  file).** Exactly one live-request example shows `partner_topic_ref` as a valid field: the "Start a
  session" quickstart step (lines 143–156), inside a `<pre style={codeBlockStyle}>` block. `codeBlockStyle`
  (line 32–42) already includes `overflowX: 'auto'`, so this specific block is already
  responsive-compliant — no layout fix needed here (§9, responsive note). Searched the entire file for
  every other occurrence of `partner_topic_ref`/`content_ref`: none exist elsewhere in this file (the
  "Content & image auth" section, lines 195–420ish, is entirely about `content_source_id` auth types —
  a different, unrelated concept — and is untouched by this document).
- **`app/(with-clerk)/dashboard/configurator/api/content.ts`, confirmed by direct read (full file).**
  The `sessions_create` endpoint's `requestFields` array (lines 41–52) lists both `partner_topic_ref` and
  `content_ref` as `required: 'No*'`, its `exampleRequestBody` (lines 53–57) uses `partner_topic_ref`, and
  its `responseNotes` (line 60) states "At least one of partner_topic_ref or content_ref is required." —
  confirmed, all three need updating (§4, §7).
- **`app/(with-clerk)/dashboard/configurator/api/ApiClient.tsx`, confirmed by direct read (lines
  129–230) — a file the brief did not name, but which this document adds to scope.** This is the
  component that actually **renders** `content.ts`'s `ENDPOINTS` data as tables and code blocks (the
  brief's "API reference field table" is data-only; `ApiClient.tsx` is where it becomes UI). Its
  `requestFields` table (lines 138–162) has **no** `overflowX` scroll wrapper on the `<table>` itself
  (only the `<pre>` example-body blocks, via `codeBlockStyle`, have `overflowX: 'auto'`) — a genuine
  non-responsive gap in the exact table whose row content this document changes (§9).
- **`app/(with-clerk)/dashboard/configurator/api/playground/PlaygroundClient.tsx`, confirmed by direct
  read (full file).** The `sessions_create` case (lines 97–107) is a free-text `<textarea>` whose value is
  `JSON.parse`'d and sent verbatim as the POST body — it has no field-specific inputs and no
  field-allowlisting logic; its only connection to `partner_topic_ref`/`content_ref` is that its
  placeholder text is `JSON.stringify(endpoint.exampleRequestBody, ...)`, i.e. it inherits directly from
  `content.ts`'s `exampleRequestBody`, already in scope to change. Confirmed: no code change is needed in
  this file itself (§4, resolves BA Question 4 below with reasoning, not a new open question).
- **Guard-mechanism precedent, confirmed by direct grep across the repo (not just the one example the
  brief names).** `NEXT_PUBLIC_VOICE_PROVIDER` (B2B-61) is a **client-facing** toggle — read inside
  browser-bundled components (`WalkthroughClient.tsx`, `lib/elevenlabs-pool.ts`) and is retired/legacy per
  `CLAUDE.md`'s "Removed from the approved list" note besides. It is the wrong shape to copy here. The
  repo's actual, current convention for a **server-only** boolean product gate — read only inside a route
  handler or server module, never shipped to the client — is `<FEATURE>_ENABLED`, checked with a strict
  string comparison and a stated default, e.g.:
  - `RTV_MARKER_GENERATION_ENABLED` — `process.env.RTV_MARKER_GENERATION_ENABLED === 'true'` (defaults to
    **disabled** when unset; `inngest/session-content-pipeline.ts` line 53,
    `app/api/hume-native/provision-config/route.ts` line 380).
  - `HUME_NATIVE_PACING_GUIDANCE_ENABLED` — same `=== 'true'` (defaults disabled;
    `lib/voice/hume-native/prompt-template.ts` line 476).
  - `ADMIN_TEST_SESSION_ENABLED` (`lib/admin-access.ts` line 18) and `KB_ENABLED` (`lib/kb-access.ts`
    line 11) use the inverse `!== 'false'` / `=== 'false'` form for gates that default **enabled** unless
    explicitly turned off.
  Since this guard needs to default to **disabled** (Option 2 session-creation is paused starting now),
  the `RTV_MARKER_GENERATION_ENABLED`-style `=== 'true'` form is the correct precedent to follow, not the
  `!== 'false'` form. This directly and confidently resolves BA Question 1 (§4) — no ambiguity, a clean
  existing convention already fits.
- **`BACKLOG.md` and `docs/b2b-pivot-status.md`, checked by direct grep for every occurrence of
  "template" in both files.** No item in either file describes Option-2/template-mode **session-creation**
  behavior as something needing re-triage once this ships. The one genuinely relevant hit is
  `docs/b2b-pivot-status.md`'s B2B-58 changelog note: *"Template mode (the legacy non-inline path)
  confirmed unaffected — it uses an explicit `section_index`, not the shared `advanceOnTransition`
  function."* — this is a **historical confirmation that supports** this document's approach (independent
  prior proof the render path is already isolated); it needs no edit. Separately, `BACKLOG.md`'s
  `CONTENT-01` items (`lib/content/script-generator.ts`, `lib/templates/generator.ts`,
  `inngest/session-content-pipeline.ts`) use "template" to mean a **different, unrelated** concept — B2C-era
  visual/tab template *generation* for session content — confirmed by direct read of `live-render.ts` that
  the Option-2 session-render path imports its template selector from `lib/partner/custom-templates.ts`
  (`selectPartnerTemplate`), a wholly separate module from `lib/templates/generator.ts`. No overlap; this
  resolves BA Question 5 (§11) with zero re-triage needed.

Nothing in the CEO brief's claims was found to be inaccurate. This document adds one file to scope beyond
what the brief named (`ApiClient.tsx`, the render layer for `content.ts`'s data) and resolves all five of
the brief's open questions below with direct-code-backed reasoning, leaving zero items in Section 11.

---

## 1. Purpose

Clio's partner session API has supported two content-delivery modes since B2B-19: inline mode (Option 1,
`content_pages`) and template/reference mode (Option 2, `partner_topic_ref`/`content_ref`, resolved
server-side against content authored in the Configurator). Arun has given a direct, live instruction to
stop supporting Option 2 for any *new* session, and to commit to inline mode as the sole content-delivery
mode going forward — not a temporary pause "for now," but a stated product commitment, while keeping the
underlying mechanism reversible (a guard, not a deletion) since the render-side code cannot be deleted
anyway (it must keep serving pre-existing sessions).

B2B-23 (shipped 2026-07-18) already hid the four Configurator authoring screens
(Questionnaire/Topics/Content/Visualization) that partners would use to *author* Option-2 content. It did
not touch the session-creation or session-rendering runtime itself — a partner can still call
`POST /api/partner/v1/sessions` with `partner_topic_ref`/`content_ref` today and get a fully working
template-mode session, and the partner-facing Docs/API-reference pages still document it as a live,
currently-available option. This feature closes that remaining gap.

What failure looks like without this: partners keep integrating against a mode Arun has explicitly
decided to stop supporting, creating new template-mode sessions and dependencies on documentation that
tells them it is currently available — directly contradicting the product commitment Arun just stated,
and creating exactly the kind of support/maintenance surface he is trying to eliminate by committing to
one mode.

## 2. User Story

As a partner integrating with Clio's session API,
I want a clear, honest, machine-readable rejection when I try to create a new session using
`partner_topic_ref`/`content_ref`, and documentation that no longer presents that as an available option,
So that I build against the one mode (inline, `content_pages`) that Clio actually supports going forward,
without wasting integration effort on a path that will fail.

As Arun (product owner),
I want new Option-2 session-creation attempts blocked centrally, every partner-facing trace of it removed
from documentation, and the reversal mechanism to be a single guard rather than deleted code,
So that the product commitment to inline-only is real and enforced today, without foreclosing a clean,
low-cost reversal if a specific partner need ever justifies revisiting it.

(No end-user-facing story — this feature has zero effect on any participant inside a live session; it
only affects partner-side session **creation** and partner-facing **documentation**.)

## 3. Trigger / Entry Point

- **Route:** `POST /api/partner/v1/sessions` (`app/api/partner/v1/sessions/route.ts`) — existing route,
  no new route created. Entry point is the existing Zod-parsed request body; the new guard is one
  additional imperative check inside the existing handler.
- **Trigger:** any call to this route whose parsed body has `content_pages` absent AND
  (`partner_topic_ref` OR `content_ref`) present — i.e. any request that validly chose Option 2 under the
  existing `.refine()` "exactly one of" rule.
- **Required state:** identical to every other check in this route — a valid partner API key or OAuth2
  token (`requirePartnerApiKey`), already enforced before any of this document's logic runs. No new auth
  requirement.
- **Documentation trigger points** (no user action, but content is now different depending on this
  guard's state — see §9 read/GET clarification): `/dashboard/configurator/docs` (`DocsClient.tsx`) and
  `/dashboard/configurator/api` (`ApiClient.tsx`, fed by `api/content.ts`) render on normal page load for
  any partner-admin with Configurator access — the same population that could already see these pages
  pre-B2B-23 minus the four hidden authoring screens.
- **Not in scope:** `GET /api/partner/v1/sessions/:clio_session_ref` (the status-read route) needs **zero**
  changes — confirmed by direct read of `content.ts`'s documented response shape
  (`{ clio_session_ref, status, created_at, ended_at }`), it never exposes `partner_topic_ref`/
  `content_ref`/any content field today, so there is nothing to hide or change on the read side. Existing
  template-mode sessions' live rendering (`/partner-render/[clio_session_ref]`,
  `resolveLiveSessionRender()`'s non-inline branch) also needs zero changes — see §5.

## 4. Screen / Flow Description

This feature has no new screen. It changes the behavior of one existing API response and the content of
two existing partner-facing documentation pages. Each state is described exactly.

**State A — New Option-2 session-creation request, guard active (default state going forward).**
A partner (or the internal Playground, which calls the same real route) sends
`POST /api/partner/v1/sessions` with a body that is Zod-valid and chooses Option 2
(`partner_topic_ref` or `content_ref` present, `content_pages` absent). The route:
1. Parses the body with `CreateSessionSchema.safeParse()` — succeeds (Option 2 alone is still a
   Zod-valid shape; the schema fields themselves are **not** removed, per the brief's guard-not-deletion
   call — §7).
2. Computes `isInline = Boolean(content_pages)` (existing line, unchanged) — `false` in this state.
3. **New check, immediately after the Zod-success branch and before the existing `reseller_id`
   pre-flight (§6 for exact placement rationale):** if `!isInline` and the guard is disabled
   (`isTemplateModeEnabled()` returns `false`), return immediately:
   ```json
   HTTP 422
   { "error": { "code": "content_reference_not_supported",
       "message": "Creating a session with partner_topic_ref or content_ref is not currently supported. Use inline content (content_pages) instead — see the Docs page for the current integration guide." } }
   ```
4. No `partner_sessions` row is created. No dispatch. No cost incurred. Identical fail-fast posture to
   every other pre-flight check already in this route (`invalid_reseller_id`, `client_id_required`, etc.)
   — this is not a new pattern, it is one more instance of an established one.

**State B — Same request, but the guard is later re-enabled (`TEMPLATE_MODE_SESSIONS_ENABLED=true`).**
The new check's condition is false, execution falls through exactly as it does today — byte-identical
pre-existing Option-2 behavior resumes with a one-line environment-variable flip, no code change, no
redeploy of business logic. This is the reversal path named in the brief's Reversibility section,
confirmed mechanically simple.

**State C — New Option-1 (inline) session-creation request, any guard state.** Completely unaffected.
`isInline` is `true`, the new check's condition (`!isInline && ...`) is `false` regardless of the guard,
so execution proceeds exactly as it does today. Zero behavior change for inline sessions, confirmed by
construction of the check's condition, not just intent.

**State D — Request supplies both `content_pages` and `partner_topic_ref`/`content_ref` (malformed dual
selection).** `CreateSessionSchema`'s existing `.refine()` "exactly one of" rule fails **before** the new
check is ever reached (Zod validation runs inside `safeParse`, strictly before any of the route's
imperative code — confirmed in §0). The response is the pre-existing generic
`{ "error": "Validation failed", "details": {...} }` at 422, unchanged. This resolves the brief's Question
8 ordering concern: the existing structural-validation error always wins over the new guard for this
case, with no code change required to make that true.

**State E — Docs page (`/dashboard/configurator/docs`), guard active.** The "Start a session" quickstart
example (§9 exact text) shows only an inline-mode (`content_pages`) request body — `partner_topic_ref` no
longer appears anywhere on this page.

**State F — API reference page (`/dashboard/configurator/api`), guard active.** The `sessions_create`
endpoint card's "Request fields" table no longer lists `partner_topic_ref`/`content_ref` as rows; its
example request body shows inline mode; its response-notes footnote no longer states that one of
`partner_topic_ref`/`content_ref` is required.

**State G — Playground (`/dashboard/configurator/api/playground`), guard active, no code change.** The
"Request body (JSON)" textarea's placeholder is `JSON.stringify(endpoint.exampleRequestBody)`, which now
shows the inline-mode example automatically (State F's data change flows through unchanged code). If
someone manually types `partner_topic_ref` into the free-text box and clicks Send, the real API call goes
out and comes back with State A's real 422 `content_reference_not_supported` response, rendered in the
existing Response card exactly like any other error — honest, correct, no special-casing needed or
wanted (this is the same principle B2B-07 established: the Playground always calls the real API, never a
mock).

## 5. Visual Examples

No new screens exist. The two existing documentation screens change as text-content edits within their
current, unchanged visual layout (see §9 for the one layout fix). Below is the "before/after" for the two
touched regions, in the same wireframe convention as prior specs, to make the copy change unambiguous for
the developer:

**DocsClient.tsx — "Start a session" step, BEFORE:**
```
┌──────────────────────────────────────────────────────────┐
│ 3. Start a session.                                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │ POST /api/partner/v1/sessions                       │  │
│  │ Authorization: Bearer <token>                        │  │
│  │ Content-Type: application/json                       │  │
│  │                                                       │  │
│  │ { "meeting_url": "https://meet.google.com/abc-defg-hij",│
│  │   "reseller_id": "<your partner_account_id>",         │  │
│  │   "reseller_unique_id": "order-48213",                │  │
│  │   "partner_topic_ref": "onboarding-101" }             │  │
│  │                                                       │  │
│  │ → 201 { clio_session_ref, status: "bot_active", ... }│  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**DocsClient.tsx — "Start a session" step, AFTER:**
```
┌──────────────────────────────────────────────────────────┐
│ 3. Start a session.                                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │ POST /api/partner/v1/sessions                       │  │
│  │ Authorization: Bearer <token>                        │  │
│  │ Content-Type: application/json                       │  │
│  │                                                       │  │
│  │ { "meeting_url": "https://meet.google.com/abc-defg-hij",│
│  │   "reseller_id": "<your partner_account_id>",         │  │
│  │   "reseller_unique_id": "order-48213",                │  │
│  │   "content_source_id": "11111111-1111-1111-1111-111111111111",│
│  │   "content_pages": [                                  │  │
│  │     { "url": "https://content.partner.example.com/1.html",│
│  │       "media_type": "html",                           │  │
│  │       "transition_trigger": "after page one" } ],     │  │
│  │   "end_user_name": "Jordan Lee" }                     │  │
│  │                                                       │  │
│  │ → 201 { clio_session_ref, status: "bot_active", ... }│  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**ApiClient.tsx — `sessions_create` "Request fields" table, BEFORE (relevant rows only):**
```
┌───────────────────┬──────────────┬──────────┬───────────────────────────┐
│ Field              │ Type         │ Required │ Notes                     │
├───────────────────┼──────────────┼──────────┼───────────────────────────┤
│ meeting_url        │ string (URL) │ Yes      │ Must be a valid URL.      │
│ partner_topic_ref  │ string       │ No*      │ 1–512 printable-ASCII.    │
│ content_ref        │ string (UUID)│ No*      │                           │
│ partner_end_user_ref│ string      │ No       │ 1–256 printable-ASCII.    │
│ partner_reference  │ string       │ No       │ Echoed on every webhook.  │
└───────────────────┴──────────────┴──────────┴───────────────────────────┘
* At least one of partner_topic_ref or content_ref is required.
```

**ApiClient.tsx — `sessions_create` "Request fields" table, AFTER (relevant rows only, table now
scroll-wrapped per §9):**
```
┌──────────────────────────────────────────── (scrolls horizontally on narrow screens) ─┐
│ Field                │ Type          │ Required │ Notes                              │
├─────────────────────┼───────────────┼──────────┼─────────────────────────────────────┤
│ meeting_url          │ string (URL)  │ Yes      │ Must be a valid URL.                │
│ content_pages        │ array          │ Yes*     │ Inline content pages — see below.  │
│ content_source_id    │ string (UUID)  │ Yes*     │ Required together with content_pages.│
│ partner_end_user_ref │ string         │ No       │ 1–256 printable-ASCII.              │
│ partner_reference    │ string         │ No       │ Echoed on every webhook.             │
└──────────────────────┴───────────────┴──────────┴─────────────────────────────────────┘
* content_pages and content_source_id must both be present — Clio only supports inline content
  delivery for new sessions.
```

**Playground — sending a request that still contains `partner_topic_ref`, AFTER (no code change,
behavior via the real API):**
```
┌────────────────────────────────────────────────────┐
│ Response                                            │
│ 422                                                 │
│ {                                                   │
│   "error": {                                        │
│     "code": "content_reference_not_supported",      │
│     "message": "Creating a session with              │
│       partner_topic_ref or content_ref is not         │
│       currently supported. Use inline content         │
│       (content_pages) instead — see the Docs page      │
│       for the current integration guide."             │
│   }                                                 │
│ }                                                   │
└────────────────────────────────────────────────────┘
```

## 6. Data Requirements

- **Read:** `process.env.TEMPLATE_MODE_SESSIONS_ENABLED` — no database read, no new table.
- **Write:** none. This feature adds zero new columns, zero new tables, zero new rows. The
  `partner_sessions` table and its existing `partner_topic_ref`/`content_ref` columns are completely
  unchanged (needed to keep serving pre-existing rows, §0/§5).
- **APIs called:** none new. The existing `POST /api/partner/v1/sessions` and
  `GET /api/partner/v1/sessions/:clio_session_ref` routes are the only ones in scope, and the GET route
  is unchanged (§3).
- **Schema (`lib/partner/session-schema.ts`):** `CreateSessionSchema`'s fields
  (`partner_topic_ref`, `content_ref`) and its `.refine()` rules are **not** removed or altered — per
  the brief's explicit instruction (guard, not deletion) and confirmed necessary since the schema must
  still validate the shape of pre-existing/re-enabled requests. This file gains one new export:
  ```ts
  export function isTemplateModeEnabled(): boolean {
    return process.env.TEMPLATE_MODE_SESSIONS_ENABLED === 'true'
  }
  ```
  Co-located here (not a new file) because this is the same module the route already imports
  `CreateSessionSchema`/`DEFAULT_EXPECTED_DURATION_MINUTES` from (`route.ts` line 9) — no new import path
  needed, and the guard lives directly beside the schema it gates, matching this file's own stated
  purpose ("extracted from the route so it is unit-testable").
- **localStorage/sessionStorage:** none. (Playground's `apiKey` state is unrelated and already
  in-memory-only per B2B-07 — untouched.)
- **Environment variable:** `TEMPLATE_MODE_SESSIONS_ENABLED` — new, server-only (no `NEXT_PUBLIC_`
  prefix), added to `.env.local.example` with a placeholder/comment following this repo's existing
  `_ENABLED`-flag documentation convention (see `RTV_MARKER_GENERATION_ENABLED`'s entry for the pattern
  to copy), e.g.:
  ```
  # B2B-64 — Option 2 (partner_topic_ref/content_ref) session-creation guard. Unset or any value other
  # than 'true' = Option 2 session creation is rejected (current default, per Arun's 2026-08-01
  # commitment to inline-only). Set to 'true' to re-enable Option 2 session creation without a code change.
  TEMPLATE_MODE_SESSIONS_ENABLED=false
  ```

## 7. Success Criteria (Acceptance Tests)

✓ Given the guard is unset (default/absent from environment), when a partner sends
`POST /api/partner/v1/sessions` with a Zod-valid body containing `partner_topic_ref` and no
`content_pages`, then the response is `422` with body
`{ "error": { "code": "content_reference_not_supported", "message": "..." } }`, and no
`partner_sessions` row is created (verify via a subsequent count/lookup).

✓ Given the guard is unset, when a partner sends the same shape using `content_ref` instead of
`partner_topic_ref`, then the same `422 content_reference_not_supported` response is returned.

✓ Given the guard is explicitly set to `'true'`, when a partner sends a valid Option-2-only request,
then the pre-existing 2026-07-17-and-earlier behavior resumes byte-for-byte (row created, dispatch
attempted, `201` on success) — proving the guard, not deleted code, is the only thing standing between
current and pre-existing behavior.

✓ Given the guard is unset, when a partner sends a fully valid **inline** (Option 1) request
(`content_pages` + `content_source_id`, no `partner_topic_ref`/`content_ref`), then the request succeeds
exactly as it does today — zero regression to Option 1, confirmed both by the guard condition's
construction (`!isInline && ...`) and by an explicit test.

✓ Given the guard is unset, when a partner sends a request containing **both** `content_pages` and
`partner_topic_ref`, then the response is the pre-existing generic `422 { "error": "Validation failed",
"details": {...} }` (Zod refine failure) — **not** the new `content_reference_not_supported` code —
confirming the existing structural-validation check still wins this case (§4 State D).

✓ Given a `partner_sessions` row already exists from before this change shipped (created with
`partner_topic_ref` set, `content_pages` null), when its live session is rendered via
`resolveLiveSessionRender()` (e.g. a real or simulated `/partner-render/[clio_session_ref]` load), then
it renders exactly as it did before this change — the guard has zero effect on rendering, only on new
`POST` creation.

✓ Given the guard is unset, when `GET /dashboard/configurator/docs` is loaded, then the rendered page
contains no occurrence of the string `partner_topic_ref` or `content_ref` anywhere in its body text.

✓ Given the guard is unset, when `GET /dashboard/configurator/api` is loaded, then the `sessions_create`
endpoint card's "Request fields" table contains no `partner_topic_ref`/`content_ref` rows, its example
request body has no such fields, and its response-notes list no longer states either field is required.

✓ Given the guard is unset, when the Playground's `sessions_create` request-body textarea is left at its
placeholder default and "Send" is clicked (with a valid test API key), then the outgoing request body is
the new inline-mode example (no manual Option-2 typing involved) and succeeds normally — proving the
placeholder update alone is sufficient, no Playground code change was needed.

✓ Given `TEMPLATE_MODE_SESSIONS_ENABLED` is set to any value other than the exact string `'true'`
(e.g. `'TRUE'`, `'1'`, `'yes'`, empty string), then the guard behaves as disabled (Option 2 rejected) —
matching this repo's existing strict-equality convention for this flag family (no truthy-string
leniency), confirmed by an explicit test using a non-`'true'` value.

## 8. Error States

- **Option-2 session-creation request while guard disabled:** covered above — `422`,
  `content_reference_not_supported`, no row created, no dispatch, no cost. This *is* the intended "error
  state" this feature adds; there is no separate failure-within-a-failure to handle.
- **Malformed dual-mode request (`content_pages` + `partner_topic_ref` both present):** pre-existing
  `422` generic Zod-validation-failure response, unchanged (§4 State D, §7).
- **Guard env var malformed/unexpected value:** treated as disabled (fail toward the safer, currently
  more-supported state — Option 1 keeps working, Option 2 requests get an honest rejection instead of
  silently succeeding or silently failing further downstream). No separate error surfaced for this case;
  it is indistinguishable from "unset" by design, matching the existing `_ENABLED`-flag family's
  behavior throughout this repo.
- **Docs/API-reference pages:** no new failure mode — these are static, hand-authored content (no
  network fetch, no AI generation, per this file's own existing doc-comment convention), so there is no
  loading or error state to add; the pages simply render different, already-correct text.
- **Playground:** no new failure mode in the component itself. A real 422 response from the guard is
  rendered through the Playground's existing generic response-handling path (line 264–271 of
  `PlaygroundClient.tsx`, unchanged) — the same path every other error response already uses.

## 9. Edge Cases

- **Existing/already-created template-mode sessions (BA Question 3, resolved — see §0 and below):**
  confirmed to keep rendering unchanged indefinitely via `resolveLiveSessionRender()`'s untouched
  non-inline branch. **Resolution and reasoning, stated explicitly per the brief's request for an
  explicit call rather than silent inheritance:** Arun's own words scope this to sessions "going
  forward" — explicit future/temporal language about new session creation, not a statement about
  existing rows or in-flight calls. Nothing in either of his two statements asks to break, migrate, or
  force-end a currently-scheduled or currently-live Google Meet session, and doing so would be a
  materially larger, riskier, and entirely separate product decision (a live customer call could be
  actively using template-mode rendering at the moment this ships) that would require its own explicit
  instruction, not an inferred extension of "commit to one mode." This document confirms the brief's
  assumption #3 as correct and treats it as settled, not left open for Arun (see §11 for why this does
  not need to be escalated).
- **A brand-new session created *after* this ships, but referencing old, still-registered
  `content_source_id`/Configurator content authored under the old Option-2 flow:** no special case — if
  the new request is Option 1 shaped (`content_pages` present), it is unaffected by this guard
  regardless of what Option-2 content exists in the partner's account; if it is Option 2 shaped, it is
  rejected per §4 State A regardless of whether the referenced topic/content still exists. Existence of
  old authored content is irrelevant to this guard's decision.
- **Partner with zero Option-2 sessions ever created:** unaffected either way — this only changes
  behavior for requests that actively choose Option 2.
- **Mobile vs. desktop:** the two documentation pages already use the Configurator's existing
  responsive shell (`ConfiguratorNavShell`/`ConfiguratorShell`, unchanged by this document). The one
  identified non-responsive gap — `ApiClient.tsx`'s `requestFields` table having no horizontal-scroll
  wrapper — is fixed as part of this same change (§9 sub-section below), scoped to only that one table,
  per the standing responsive rule and its explicit "no wider audit" limit. The `queryParams` and
  `otherResponses` tables in the same file are **not** touched — their row content does not change as
  part of this document, so fixing them would be exactly the wider audit the standing rule says not to
  do here.
- **A partner retries a request that previously succeeded under Option 2 before this shipped, using the
  same `reseller_unique_id` (idempotency key):** the idempotent-replay branch (route lines 226–245) runs
  **before** dispatch but **after** row insertion, and is keyed purely on `(partner_account_id,
  reseller_unique_id)` matching an existing row — it is not reached at all for a *new* Option-2 request
  under this guard, because the new guard's rejection (§4 State A) fires earlier in the function, before
  any insert is attempted. So: a genuine retry of an already-successful pre-existing Option-2 session
  (created before the guard went live) still replays correctly and returns the original session's
  response, unaffected — the guard only blocks *first-time* new Option-2 session creation, exactly as
  intended, not replays of legitimate pre-existing sessions.

**Responsive/mobile fix in scope (standing rule, §9 above):** wrap `ApiClient.tsx`'s `requestFields`
`<table>` (lines ~141–160 in the current file) in a `<div style={{ overflowX: 'auto' }}>` container —
matching the existing `overflowX: 'auto'` convention already used on this same file's `<pre>` blocks via
`codeBlockStyle` (confirmed present, §0) — so the four-column table cannot force horizontal page scroll on
a narrow viewport once its content shrinks from 5 fields to fewer/different fields. This is the only
layout change in this document; `DocsClient.tsx` needs no layout change (§0).

## 10. Out of Scope

- Removing `CreateSessionSchema`'s `partner_topic_ref`/`content_ref` fields or its `.refine()` logic —
  explicitly a guard, not a deletion, per the brief's Reversibility reasoning (§0, §6).
- Removing or altering `resolveLiveSessionRender()`'s non-inline branch, `extractSections()`,
  `TemplateSection`, `TemplateRenderer`, or `selectPartnerTemplate()` — must keep serving pre-existing
  sessions indefinitely (§5, §9).
- Any change to inline-mode (Option 1) request handling, validation, billing, or rendering — zero touch,
  confirmed by construction of the new guard's condition (§4 State C).
- Any change to `lib/partner/configurator-sections.ts`'s `VISIBLE_SECTIONS` — B2B-23's authoring-screen
  hide is already correct and complete (§0).
- Any change to the four hidden Configurator authoring screens
  (Questionnaire/Topics/Content/Visualization) themselves, or their underlying routes/components/DB
  tables — out of scope for this document exactly as it was for B2B-23 (governance: hide, never delete).
- Any change to `GET /api/partner/v1/sessions/:clio_session_ref` — already confirmed to need zero
  changes (§3).
- Any change to `PlaygroundClient.tsx`'s code — confirmed unnecessary; only `content.ts`'s data changes
  (§0, §4 State G).
- A wider responsive audit of `ApiClient.tsx`, `DocsClient.tsx`, or any other Configurator page beyond
  the one specific table identified in §9 — the standing rule explicitly caps this to sections actually
  touched by this change.
- Force-ending, migrating, or otherwise altering any already-created template-mode `partner_sessions`
  row — resolved as explicitly out of scope, with reasoning, in §9.
- Any change to `BACKLOG.md`/`docs/b2b-pivot-status.md` beyond adding this document's own Live Status
  entry when it ships — no stray item needed re-triaging (§0).
- Any new admin-facing UI to toggle `TEMPLATE_MODE_SESSIONS_ENABLED` — this is a plain server
  environment variable, changed only via a deploy-time env update, exactly like
  `RTV_MARKER_GENERATION_ENABLED` and `HUME_NATIVE_PACING_GUIDANCE_ENABLED` today. (If Arun later wants
  an admin-UI toggle for this the way B2B-61 Part B built one for the voice provider, that is a distinct,
  separate follow-on feature brief, not part of this document.)

## 11. Open Questions

None. All five questions the CEO brief raised are resolved above with direct-code-backed reasoning:

1. **Guard implementation form** — resolved: server-only `TEMPLATE_MODE_SESSIONS_ENABLED` env var,
   `=== 'true'` check, exported as `isTemplateModeEnabled()` from `lib/partner/session-schema.ts` (§0, §6).
2. **Exact error code/message/status** — resolved: `422`, `{ error: { code:
   'content_reference_not_supported', message: '...' } }` (§4 State A, §6, §7).
3. **Existing template-mode sessions keep rendering unchanged** — resolved and confirmed correct, with
   explicit reasoning for why this is a settled decision rather than a genuine open product question
   needing Arun's sign-off (§9). If Arun disagrees with this reasoning after reading it, that is a
   reversal of a stated, reasoned position — easy to flag and revisit — not an unresolved ambiguity
   blocking this spec today.
4. **Playground UI** — resolved: no code change needed; the free-text request body already inherits the
   corrected example from `content.ts`, and a manually-typed Option-2 field correctly receives the real
   guard's honest rejection through existing, unchanged error-handling code (§0, §4 State G).
5. **`BACKLOG.md`/`docs/b2b-pivot-status.md` stray references** — resolved: none found needing
   re-triage; the one relevant existing reference (B2B-58's changelog note) already supports this
   document's approach and needs no edit (§0).

## 12. Dependencies

- **B2B-19** (inline content delivery) — must exist for Option 1 to be a real, complete alternative;
  confirmed already fully built and shipped (`23a66df`, per `docs/b2b-pivot-status.md`).
- **B2B-23** (Configurator authoring-screen hide) — must exist and stay as-is; confirmed already shipped
  and correctly scoped (§0).
- **No new migration, no new table, no new column** — this document requires no Supabase schema change.
- **`.env.local.example`** must be updated with the new `TEMPLATE_MODE_SESSIONS_ENABLED` placeholder/
  comment (§6) as part of this change, per `CLAUDE.md`'s standing rule that every env var is documented
  there.
- **Test file:** following this repo's existing naming convention (`partner-inline-session-schema.test.ts`
  for B2B-19's own schema tests), the new guard's unit tests belong in a new
  `tests/unit/b2b64-template-mode-guard.test.ts`, covering the acceptance criteria in §7 directly against
  `isTemplateModeEnabled()` and the route's new branch.
- **No dependency on B2B-63** (concurrent, live transcript capture) beyond non-contradiction, already
  confirmed by the CEO brief and independently unaffected by anything in this document — B2B-63 already
  scopes itself to inline-mode-only, which this document's outcome is fully consistent with.

---

Once approved by the CEO Agent, this spec is ready for Dev with zero open questions.
