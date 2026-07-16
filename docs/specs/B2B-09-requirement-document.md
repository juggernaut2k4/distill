# B2B-09 — Session Delivery Extraction Fix + Internal Glitch Dashboard
# Requirement Document
Version: 1.1
Status: APPROVED (reconstructed as-approved; see Reconstruction Verification Notes for one live-code
discrepancy found during reconstruction)
Author: Business Analyst Agent
Date: 2026-07-15/16 (originally written and approved 2026-07-15; reconstructed 2026-07-16)

> **RECONSTRUCTED 2026-07-15/16** — original lost to a concurrent-agent git-stash collision. Rebuilt
> primarily from the shipped, live code (not just prose) — cross-verified against
> `inngest/partner-session-insights-extractor.ts` and `GlitchDashboardClient.tsx` directly. Content
> matches both the historical record and the actual as-built system.

**Source Feature Brief:** `.claude/agents/clio/feature-briefs/B2B-09-session-delivery-glitch-dashboard.md`
(itself reconstructed 2026-07-15, read in full — including its own "ID collision" renumbering note, its
"What Arun Said" quote from `docs/brainstorm-partner-signup-integration.md` Decisions 5–6, its Escalation
section with Options A/B/C, and its closing Approval note documenting the v1.1 `test_mode` correction).

**Companion technical spec (fully intact, never lost):** `architecture.md` §16 — exact schema DDL, route
contracts, function signatures, prompt/schema pair, and purge-job cron. This document's Section 6 and
Section 4.B summarize §16; §16 itself remains the byte-for-byte authoritative source for implementation
detail.

**Structural/format template:** `docs/specs/B2B-06-requirement-document.md` (section order, wireframe
convention, sequence-flow convention, acceptance-test phrasing, Section-11-empty-with-documented-judgment-
calls convention).

**Constraint this document's Escalation section resolves against:** `CORE_OBJECTIVES.md`'s "Non-Negotiable
Data Boundary" — *"Clio computes signal. Clio never becomes the system of record for partner or end-user
data... The sole exception: Clio retains de-identified interaction transcripts, for its own
quality-improvement and prompt-tuning purposes only."*

**Verified directly against the shipped, live code, all read in full:**
- `supabase/migrations/078_b2b09_session_delivery_glitch_dashboard.sql` — exact schema: `partner_sessions.hume_chat_id`,
  the `partner_session_insights` table, `webhook_dispatch_log`'s widened `event_type` CHECK, the
  `purge_partner_session_insights_full_detail` and `glitch_summary_by_type_and_partner` RPCs. Matches
  `architecture.md` §16.1 exactly.
- `inngest/partner-session-insights-extractor.ts` — the extraction fast path, 30-minute backstop sweep,
  and daily 03:00 UTC purge job. Confirmed the v1.1 `test_mode` threading fix is present on both call
  sites (`extractInsightsForPartnerSession()`'s own `partner_sessions.test_mode` select, and
  `markInsightsExtractionFailed()`'s `partner_sessions!inner(test_mode)` FK embed).
- `app/dashboard/admin/glitches/GlitchDashboardClient.tsx` and `page.tsx` — read directly for the actual
  screen/acceptance-criteria description below (not re-derived from prose).
- `app/api/webhooks/hume/route.ts` — confirmed the `partner_sessions` fallback lookup by `hume_chat_id`
  exists immediately after the existing `sessions` lookup's `if (!session)` block, emitting
  `clio/partner-session.ended` on a match.
- `lib/partner/webhooks.ts` — confirmed `BillableEventType`/`WebhookPayload` extension, `recordInsightsReadyEvent()`,
  and the `attemptDispatch()` `'session.insights_ready'` branch that reconstructs the payload live from
  `partner_session_insights` rather than replaying a stored copy. Confirmed `testMode` (not a hardcoded
  `false`) flows into the stored/outbound `test_mode` field.
- `app/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` — confirmed the `onConnect` handler
  fires a best-effort `fetch('/api/partner/render/session-chat-id', ...)` with `{ clio_session_ref,
  hume_chat_id: sessionId }`, matching architecture.md §16.3's documented client change.
- `app/api/partner/v1/sessions/route.ts` (spot check) — unaffected by this brief; B2B-06's later funding
  guardrail lands in the same file, not this one.

**Companion artifact, unchanged by this reconstruction:** `architecture.md` §16 (all subsections).
**Migration, applied:** `supabase/migrations/078_b2b09_session_delivery_glitch_dashboard.sql` (078 —
confirmed the next-free number ahead of B2B-06's `079`, per that document's own numbering note).

---

## Reconstruction Verification Notes

Two things follow directly from reading the live code rather than trusting prose, both worth stating
plainly rather than glossing over:

1. **The core fix and the dashboard's data-access layer are real and match the approved design.** The
   schema (migration `078`), the extraction pipeline (`inngest/partner-session-insights-extractor.ts`),
   the `chat_ended` webhook fallback (`app/api/webhooks/hume/route.ts`), the outbound webhook contract
   (`lib/partner/webhooks.ts`), and the dashboard's UI component (`GlitchDashboardClient.tsx`) all exist,
   all match `architecture.md` §16 closely (the extractor file carries additional inline comments beyond
   the architecture doc's own code block, but no behavioral divergence), and the v1.1 `test_mode`
   correction is genuinely present, not just described.

2. **Three route files this design depends on are referenced by shipped client/UI code but do not exist
   in the working tree**, confirmed by direct `find`/`git show --stat` against commit `2d3b3d0` itself
   (not just the working tree — the commit that shipped this brief never included them):
   - `app/api/partner/render/session-chat-id/route.ts` — the capture endpoint `PartnerRenderClient.tsx`'s
     `onConnect` handler calls (architecture.md §16.3). Its absence means `hume_chat_id` is never actually
     persisted to `partner_sessions` client-side, and the `fetch(...).catch(...)` in `PartnerRenderClient.tsx`
     swallows the resulting 404 silently — the exact "failing by omission" failure mode this brief's own
     root-cause section (Feature Brief, "The Problem Being Solved" #1) was written to close. Without this
     route, `app/api/webhooks/hume/route.ts`'s new `partner_sessions` fallback lookup (which *is* present
     and correct) has no `hume_chat_id` to match against for any session dispatched after this brief
     shipped, so extraction still does not run end-to-end for a live partner session today.
   - `app/api/admin/glitches/summary/route.ts` and `app/api/admin/glitches/route.ts` — the two endpoints
     `GlitchDashboardClient.tsx` fetches on mount (architecture.md §16.2/§16.8). Their absence means both
     dashboard panels render their existing, correctly-built error state (`"Couldn't load glitch data. Try
     refreshing the page."`) rather than data, in any environment today.

   The underlying SQL those routes would call (`glitch_summary_by_type_and_partner()`,
   `partner_session_insights` reads) is present and correct in migration `078` — only the three thin
   Next.js route handlers that would call it are missing. This is not a design gap in this document; it
   is an implementation gap between what was approved/committed-as-message and what commit `2d3b3d0`
   actually contains. Flagged here rather than silently reconstructing acceptance criteria as if they
   currently pass. Section 7 marks the affected acceptance tests accordingly rather than omitting them —
   they describe the approved, intended behavior; each is annotated with its current live status.

This document otherwise describes the fully-approved design exactly as it was specified and approved on
2026-07-15, per the reconstruction task's own instruction to describe the system "at the level of detail
that matches what's actually implemented" — implemented here means the schema, extraction pipeline,
webhook contract, and dashboard UI, which are all real; it does not mean papering over the three missing
route files.

---

## 1. Purpose

Two distinct, both-real, both-blocking problems, exactly as the CEO Feature Brief states them:

1. **The extraction pipeline partners are told exists has never once run for a partner session.** Every
   partner session ends, Hume fires `chat_ended`, and — prior to this brief — the webhook handler looked
   the chat up only in the legacy `sessions` table, found nothing (because partner sessions never wrote
   there), and silently dropped it. No transcript extraction, no action items, no glitches, no psychology
   signal had ever been produced for a single partner-dispatched session since the partner flow first
   shipped. Nothing failed loudly; it failed by omission, which is why nobody caught it.
2. **Clio had no way to see its own quality problems at scale.** Even once extraction produces glitches
   per session, there was no view aggregating them — no way to notice a glitch type spiking for one
   partner, or platform-wide, without reading individual session transcripts one at a time.

**What failure looks like without this document:** partners are told (implicitly, by the existence of the
feature) that Clio delivers action items, glitches, and psychology signal per session, and that promise
silently does not hold for any of them; and Clio's own team has no way to notice a systemic quality
problem until a partner escalates it externally first.

## 2. User Story

**Story 1 — Clio's own backend (the `chat_ended` webhook handler)**
As the code that receives Hume's `chat_ended` webhook,
I want to resolve the chat against `partner_sessions` when it isn't a legacy `sessions` row,
So that a partner session's transcript extraction actually starts, instead of being silently dropped.

**Story 2 — A partner's own backend system, receiving Clio's webhooks**
As a partner's own server consuming Clio's `session.insights_ready` webhook,
I want full-detail action items and glitches (not keyword fragments), with psychology delivered as
keywords only,
So that I can act on concrete next-step text and root-cause descriptions, while nothing sensitive about a
user's inferred mental state is ever transmitted as identifiable free text.

**Story 3 — Arun / a future Clio ops/eng staffer**
As the person responsible for Clio's own product quality,
I want a single internal screen showing every captured glitch, aggregated by type and by partner, sortable
and filterable,
So that I can notice a recurring failure pattern and fix its root cause without reading session
transcripts one at a time.

**Story 4 — Clio's own data-governance posture**
As the system responsible for honoring `CORE_OBJECTIVES.md`'s Non-Negotiable Data Boundary,
I want full-detail session content to exist only long enough to guarantee reliable webhook delivery, then
be permanently reduced to non-identifying, aggregate-only signal,
So that Clio never becomes an indefinite system of record for partner/end-user session content, even while
still delivering the reliability guarantee every other webhook event type already has.

## 3. Trigger / Entry Point

- **Chat-id capture (client-side, best-effort)**: fires inside `PartnerRenderClient.tsx`'s Hume `onConnect`
  callback, the instant a partner session's live voice connection is established. No user action; purely
  a side effect of connecting. Calls `POST /api/partner/render/session-chat-id` — **route file confirmed
  absent from the shipped commit; see Reconstruction Verification Notes above.**
- **Extraction — fast path**: `clio/partner-session.ended` Inngest event, emitted by
  `app/api/webhooks/hume/route.ts`'s `chat_ended` handler the moment it resolves a `hume_chat_id` against
  `partner_sessions` (its existing `sessions`-table lookup came back empty first). No user-facing trigger.
- **Extraction — backstop sweep**: cron, every 30 minutes (`inngest/partner-session-insights-extractor.ts`,
  `partnerSessionInsightsBackstopSweep`), scanning `partner_sessions` for completed sessions older than 30
  minutes with a `hume_chat_id` but no terminal `partner_session_insights` row.
- **Purge job**: cron, daily at 03:00 UTC (`partnerSessionInsightsPurge`), calling the
  `purge_partner_session_insights_full_detail` RPC with a 30-day cutoff.
- **Outbound webhook**: `session.insights_ready` event, queued into `webhook_dispatch_log` by
  `recordInsightsReadyEvent()` immediately after extraction reaches a terminal state (`success`,
  `success_empty`, or a third-and-final `failed`), delivered via the existing retry-with-backoff dispatcher
  every other partner event type already uses.
- **Internal glitch dashboard**: `GET /dashboard/admin/glitches`, page load, Clerk-authenticated (any
  signed-in user — the same boundary `/dashboard/admin/clients` already established, not a new auth
  pattern, not partner-facing).

## 4. Screen / Flow Description

### 4.A `/dashboard/admin/glitches` — the internal glitch dashboard

**Layout**: `page.tsx` is byte-for-byte the same shape as `app/dashboard/admin/clients/page.tsx` — a
server component that calls `currentUser()` (Clerk), redirects to `/sign-in` if absent, fetches the
current user's row from `users` (best-effort — the page still renders if this lookup returns nothing,
falling back to the Clerk email), and wraps `GlitchDashboardClient` in the existing `<DashboardShell>`.
No new auth pattern, no new page-level wrapper.

`GlitchDashboardClient.tsx` renders a single centered column (`max-w-6xl`), header row with a "Back to
Dashboard" link, an `AlertTriangle` icon + "Glitch Dashboard" title, and one line of subhead copy: *"Every
glitch captured across every partner and every session — grouped so recurring patterns surface
immediately."* Below that, two always-visible stacked panels (no tab switch, both load independently):

**Panel 1 — "Glitch Patterns" (aggregate summary)**

Fetches `GET /api/admin/glitches/summary` once on mount. A single table, one row per distinct (glitch
type × partner) combination, columns: **Type**, **Partner**, **Count**, **First seen**, **Last seen** —
each column header is a clickable sort control (`ArrowUpDown` icon, purple `#7C3AED` when active). Default
sort: **Count**, descending. Clicking an already-active column reverses direction; clicking a different
column switches to it, ascending. This panel is never filtered — it always shows every partner's every
glitch type.

```
┌───────────────────────────────────────────────────────────┐
│  ← Back to Dashboard                                       │
│                                                              │
│  ⚠ Glitch Dashboard                                         │
│  Every glitch captured across every partner and every       │
│  session — grouped so recurring patterns surface            │
│  immediately.                                                │
│                                                              │
│  Glitch Patterns                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Type ⇅   Partner ⇅   Count ⇅   First seen ⇅  Last seen⇅│  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ Misunderstanding  Acme Co   14   Jul 1, 2026  Jul 15…  │  │
│  │ Repetition         Acme Co    6   Jul 3, 2026  Jul 14… │  │
│  │ Derailment      Pluralsight   3   Jul 9, 2026  Jul 12… │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

**Panel 2 — "All Glitches" (drill-down)**

Fetches `GET /api/admin/glitches`, re-fetching whenever either filter changes. Two filter dropdowns above
the table:
- **Partner** — `"All partners"` plus one option per distinct partner that has at least one glitch,
  derived client-side from Panel 1's own already-loaded summary data (no separate partner-list fetch).
- **Type** — `"All types"` plus the five fixed glitch types (`misunderstanding`, `repetition`,
  `confusion_about_clio`, `derailment`, `other`), each rendered with its human-readable label
  (`Misunderstanding`, `Repetition`, `Confusion about Clio`, `Derailment`, `Other`).

Table columns: **Partner**, **Session** (first 8 characters of `partner_session_id` + `…`, monospace),
**Type**, **Description**, **Extracted at**. Sorted by `extracted_at` descending server-side (no
client-side sort control on this panel — only Panel 1 is sortable). One row per individual glitch (a
session with 3 glitches produces 3 rows).

```
┌───────────────────────────────────────────────────────────┐
│  All Glitches                                                │
│  Partner: [All partners ▾]   Type: [All types ▾]             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │Partner  Session   Type            Description  Extracted│ │
│  ├──────────────────────────────────────────────────────┤  │
│  │Acme Co  a1b2c3d4… Misunderstanding "User asked  Jul 15…│ │
│  │                                     about pricing        │
│  │                                     tiers, assistant     │
│  │                                     answered a           │
│  │                                     different            │
│  │                                     question entirely."  │
│  │Acme Co  9f8e7d6c… Repetition        — purged (30-day    │
│  │                                     retention window     │
│  │                                     elapsed)      Jun 10…│
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

The **Description** cell renders either the glitch's real `description` text, or — once
`full_detail_purged_at` is set for that row (30+ days after `extracted_at`) — the fixed italic string
`"— purged (30-day retention window elapsed)"` in muted `#475569`. This is the dashboard's own visible
acknowledgment of the bounded-retention design (Section 9); the aggregate row in Panel 1 above is
unaffected by purge (type/partner/date survive purge indefinitely — only the per-glitch `description` text
is ever removed).

**Screen state — loading (either panel independently)**: centered single-line `"Loading…"` inside the
table body.

**Screen state — error (either panel independently)**: centered single-line `"Couldn't load glitch data.
Try refreshing the page."` in red `#EF4444`. **This is the panels' current live state in any environment
today** — see Reconstruction Verification Notes; the two backing route files do not exist in the shipped
commit, so both panels render this state on every load until they are added.

**Screen state — empty (either panel independently, once the routes exist and return zero rows)**:
centered single-line `"No glitches recorded yet."`

### 4.B API Contracts

#### 4.B.1 `POST /api/partner/render/session-chat-id` (no auth — opaque `clio_session_ref` only)

Mirrors `POST /api/hume-native/session-chat-id`'s existing pattern exactly (same best-effort,
never-blocks-the-caller shape).

**Request:**
```json
{ "clio_session_ref": "<uuid>", "hume_chat_id": "<string>" }
```

**Response — 200 (success or best-effort failure — both return 200, never blocks the connect flow):**
```json
{ "ok": true }
```
or
```json
{ "ok": false }
```
Validation failure (malformed body) or a Supabase write error both fall through to `{ "ok": false }`,
`200` — this route never returns a non-200 status, matching the "best-effort — never blocks connect flow"
comment in its own architecture.md-documented source. **Status: route file confirmed absent from the
shipped commit** (Reconstruction Verification Notes) — the client already calls this exact contract; only
the server-side handler is missing.

#### 4.B.2 `app/api/webhooks/hume/route.ts` — `chat_ended`, `partner_sessions` fallback (existing route, one addition, confirmed present and correct)

Inserted immediately after the existing `sessions`-table lookup's `if (!session) { ... }` block. On a
`partner_sessions` match by `hume_chat_id`: emits `clio/partner-session.ended` to Inngest with
`{ partnerSessionId }`, returns `{ "received": true }`. On no match in either table: logs a warning,
still returns `{ "received": true }` (never a webhook-retry-triggering error for an unresolvable chat_id —
matches the existing route's own no-error-on-unresolvable-webhook convention). No `writeAuditEvent()` call
on the partner branch — that function requires a Clerk `userId` and a `sessions(id)` FK, neither of which
a `partner_sessions` row has.

#### 4.B.3 Extraction (internal — `extractInsightsForPartnerSession(partnerSessionId)`, no external contract)

Confirmed present in `inngest/partner-session-insights-extractor.ts`, matching `architecture.md` §16.4:
1. Reads `partner_sessions.hume_chat_id`/`.test_mode`/`.partner_account_id` for the given session; throws
   (triggering Inngest's own step retry) if no `hume_chat_id` is set.
2. Idempotency guard against `partner_session_insights` — short-circuits if the row is already
   `success`/`success_empty`, or `failed` with `attempt_count >= 3`.
3. Live-fetches the full Hume transcript via `fetchAllTranscriptEvents()` (newly exported from
   `lib/voice/hume-native/session-details.ts`, no other call site affected) — **never** from a pre-archived
   Hume Config, since `hume_native_config_archives.session_id` is hard-FK'd to `sessions(id)`, confirmed
   structurally incompatible with partner sessions.
4. If the transcript has zero message lines: writes `extraction_status = 'success_empty'` with all three
   fields empty — no Anthropic call made.
5. Otherwise: one Anthropic call (`claude-sonnet-4-6`), a dedicated system prompt and Zod schema
   (`PartnerInsightsExtractionSchema`) genuinely separate from the legacy sessions-table extractor's own
   prompt/schema — editing the shared one would change the live Claude call for every existing Hume-native
   session too. Produces all three outputs from one call: `action_items` (full text), `glitches` (full
   text + one of five fixed types), `psychology_keywords` (1–4 word lowercase/hyphenated keywords only,
   never full sentences, never a verbatim user quote — enforced by prompt instruction, not a runtime
   truncation check).
6. Writes the result to `partner_session_insights`, sets `extracted_at`, and calls
   `recordInsightsReadyEvent()` with the session's real `test_mode` value (v1.1 fix, confirmed present on
   this call site).
7. On any thrown error: `markInsightsExtractionFailed()` increments `attempt_count`; on the attempt that
   reaches `>= 3`, fires `recordInsightsReadyEvent()` with `extractionStatus: 'failed'` exactly once
   (never re-fired on every retry below that threshold) — also confirmed threading `test_mode` correctly
   via a `partner_sessions!inner(test_mode)` FK embed (the v1.1 fix's second call site).

Mock behavior when `ANTHROPIC_API_KEY` is a placeholder: returns fixed `[MOCK]`-prefixed content for all
three fields rather than failing, matching this codebase's standing mock-stub convention.

#### 4.B.4 `session.insights_ready` outbound webhook (confirmed present in `lib/partner/webhooks.ts`)

**Reference payload stored in `webhook_dispatch_log` (never the full-detail content — see Section 6):**
```json
{
  "event_id": "<uuid>",
  "event_type": "session.insights_ready",
  "clio_session_ref": "<partner_session_id>",
  "partner_reference": null,
  "occurred_at": "<iso>",
  "dispatched_at": "<iso>",
  "test_mode": true,
  "extraction_status": "success"
}
```
`test_mode` is the session's real value, threaded through from `partner_sessions.test_mode` on both the
success and failure call sites (v1.1 — confirmed present, closing the CEO-review-caught bug where every
insights webhook previously reported `test_mode: false` regardless of the session's actual mode).

**Payload actually delivered to the partner** (reconstructed live at each delivery attempt inside
`attemptDispatch()`'s `'session.insights_ready'` branch — never the stored reference payload's own,
narrower shape):
```json
{
  "event_id": "<uuid>",
  "event_type": "session.insights_ready",
  "clio_session_ref": "<partner_session_id>",
  "partner_reference": null,
  "occurred_at": "<iso>",
  "dispatched_at": "<iso>",
  "test_mode": true,
  "extraction_status": "success",
  "action_items": [{ "text": "Review the AI vendor shortlist discussed before the next call." }],
  "glitches": [{ "type": "misunderstanding", "description": "User asked about pricing tiers; assistant answered a different question entirely." }],
  "psychology_keywords": ["hesitant", "time-pressured"]
}
```
Signed with the account's real `outbound_signing_secret` via the existing, unmodified
`buildSignatureHeader()`. Delivered via the same retry-with-backoff mechanism `usage.voice_minute`,
`usage.llm_generation_call`, `session.completed`, and `wallet.low_balance` already use — `attemptDispatch()`
gains exactly one event-type-specific branch; every other event type's dispatch path is byte-for-byte
unchanged.

**If extraction is still `pending` or the session has been purged (30+ days old) at delivery-attempt
time**: `action_items`/`psychology_keywords` are `null`; `glitches` contains only `{ "type": ... }` entries
(no `description` key at all — the purge RPC physically removes the key from every array element, not just
blanks it).

#### 4.B.5 `GET /api/admin/glitches/summary` (Clerk-authenticated, any signed-in user)

**Response — 200:**
```json
{
  "summary": [
    { "glitch_type": "misunderstanding", "partner_account_id": "<uuid>", "partner_name": "Acme Co",
      "count": 14, "first_seen": "2026-07-01T...", "last_seen": "2026-07-15T..." }
  ]
}
```
Backed by the `glitch_summary_by_type_and_partner()` SQL function (confirmed present, migration `078`) —
one call, no application-level aggregation. **Route handler confirmed absent** (Reconstruction
Verification Notes); the SQL function it would call exists and is correct.

#### 4.B.6 `GET /api/admin/glitches?partner_account_id=&type=` (Clerk-authenticated, any signed-in user)

**Response — 200:**
```json
{
  "glitches": [
    { "partner_session_id": "<uuid>", "partner_account_id": "<uuid>", "partner_name": "Acme Co",
      "glitch_type": "misunderstanding", "description": "User asked about pricing tiers...",
      "full_detail_purged": false, "extracted_at": "2026-07-15T..." }
  ]
}
```
Backed by a `partner_session_insights` query (`.not('glitches', 'is', null)`, optional
`partner_account_id`/`type` filters), with the per-row JSONB `glitches` array unnested and filtered in
application code after the fetch (deliberate — arrays are small, typically 0–3 glitches per session, so a
second SQL function is not warranted purely for row-level filtering). `full_detail_purged` is derived
directly from whether `full_detail_purged_at IS NOT NULL` on the parent row; `description` is `null` once
purged (the purge RPC removes the key entirely — `?? null` is a sufficient, correct guard, no separate
purge-aware branch needed). **Route handler confirmed absent** (Reconstruction Verification Notes).

## 5. Visual Examples

Wireframes for `/dashboard/admin/glitches`'s two panels are given inline in Section 4.A above, transcribed
directly from `GlitchDashboardClient.tsx`'s actual JSX rather than invented separately.

### Sequence flows

**5.1 — Extraction, fast path (intended end-to-end flow)**
```
Partner session connects (PartnerRenderClient.tsx) → Hume onConnect(sessionId) fires
  → fetch POST /api/partner/render/session-chat-id { clio_session_ref, hume_chat_id: sessionId }
    [route file absent in shipped commit — this call currently 404s, caught by .catch(), never blocks connect]
  → (intended) UPDATE partner_sessions SET hume_chat_id = sessionId WHERE id = clio_session_ref

Session ends → Hume fires chat_ended webhook → POST /api/webhooks/hume
  → existing sessions-table lookup by hume_chat_id → not found
  → NEW: partner_sessions lookup by hume_chat_id
    [today: no row has hume_chat_id set, because 4.B.1 never ran — this lookup finds nothing for any
     session dispatched after this brief shipped, until 4.B.1's route is added]
  → (intended, once 4.B.1 exists) match found → emit clio/partner-session.ended { partnerSessionId }
    → inngest/partner-session-insights-extractor.ts → extractInsightsForPartnerSession()
    → partner_session_insights row updated, extracted_at set
    → recordInsightsReadyEvent() → webhook_dispatch_log row queued
    → existing dispatcher delivers session.insights_ready to the partner's outbound_base_url
```

**5.2 — Purge (confirmed running correctly today, independent of the gap above)**
```
Daily 03:00 UTC → partnerSessionInsightsPurge
  → purge_partner_session_insights_full_detail(cutoff = now() - 30 days)
  → for every partner_session_insights row with extracted_at < cutoff and full_detail_purged_at IS NULL:
      action_items = NULL, psychology_keywords = NULL,
      glitches = [{ type: g.type } for g in glitches]  (description key removed entirely)
      full_detail_purged_at = now()
  → returns count purged
```
This job is fully functional today regardless of the extraction gap — it operates correctly on whatever
rows do exist, and will begin purging real extracted rows the moment 4.B.1/4.B.2's flow starts producing
them.

**5.3 — Internal dashboard load (intended; currently short-circuits to the error state)**
```
Clerk-signed-in user → GET /dashboard/admin/glitches → page.tsx gate → GlitchDashboardClient mounts
  → GET /api/admin/glitches/summary  [route absent → fetch fails → Panel 1 renders error state]
  → GET /api/admin/glitches           [route absent → fetch fails → Panel 2 renders error state]
```

## 6. Data Requirements

Full schema DDL, exact route/function signatures live in `architecture.md` §16.1–§16.9 and migration
`078`. Summarized, confirmed against the live migration file:

**Modified table:** `partner_sessions` — one additive nullable column, `hume_chat_id TEXT`, indexed
(partial index, `WHERE hume_chat_id IS NOT NULL`).

**Modified table:** `webhook_dispatch_log` — `event_type` CHECK constraint widened to add
`'session.insights_ready'` (this brief) and `'wallet.low_balance'` (closing a separate, pre-existing
B2B-04 gap in the same migration, per the migration file's own comment — not otherwise in scope here).

**New table, `partner_session_insights`:** parallel in *shape* to the legacy `session_action_items`
(migration `073`) but deliberately not a reuse of it — keyed to `partner_sessions(id)`, not `sessions(id)`;
carries `partner_account_id` directly (no extra join needed for the dashboard); adds
`psychology_keywords` and `full_detail_purged_at`, neither of which the legacy table has an equivalent of.
Columns: `id`, `partner_session_id` (FK, `ON DELETE CASCADE`, `UNIQUE`), `partner_account_id` (FK, `ON
DELETE CASCADE`), `hume_chat_id`, `extraction_status` (`pending|success|success_empty|failed`),
`action_items`/`glitches`/`psychology_keywords` (JSONB, full detail while `full_detail_purged_at IS NULL`),
`transcript_event_count`, `attempt_count`, `error_message`, `extracted_at`, `full_detail_purged_at`,
`created_at`. RLS: service-role-only (matches every other partner-facing table's own policy).

**Never the same table, never modified:** `session_action_items`, `extractActionItemsForSession()`,
`getHumeSessionDetails()`, `hume_native_config_archives` — all continue serving Clio's own direct
(non-partner) sessions exactly as they did before this brief, per the Feature Brief's explicit Known
Constraint.

**Read from the database:** `partner_sessions` (`hume_chat_id`, `test_mode`, `partner_account_id` — by the
extractor); `partner_session_insights` (idempotency guard reads; both admin-glitches queries; the
`attemptDispatch()` live-reconstruction read); `partner_accounts` (`outbound_signing_secret`, by
`recordInsightsReadyEvent()`).

**Written to the database:** `partner_sessions.hume_chat_id` (intended, via 4.B.1 — currently not
happening, see Reconstruction Verification Notes); `partner_session_insights` (one upsert-then-update per
extraction attempt, one purge-update per eligible row daily); `webhook_dispatch_log` (one insert per
terminal extraction outcome).

**Never stored anywhere, by design:** the full-detail `session.insights_ready` webhook payload sent to a
partner is never itself written to `webhook_dispatch_log` — only the narrower reference payload (Section
4.B.4) is stored there; the full-detail content is reconstructed live from `partner_session_insights` at
each delivery attempt. This is a direct, deliberate consequence of the Escalation's Option A (below): the
one durable store of full-detail content is `partner_session_insights` itself, subject to the 30-day purge
— never duplicated into a second table with its own, separate retention lifecycle.

**localStorage/sessionStorage:** none.

## 7. Data-Governance Escalation (first-class section, per the reconstruction instruction)

**The tension.** Reliable webhook delivery for `session.insights_ready` needs to work the same way every
other partner event type already does: retry-with-backoff against a durably stored payload until delivery
succeeds. But the payload here is full-detail action items and glitches — genuine session content, not an
opaque usage number — and `CORE_OBJECTIVES.md`'s Non-Negotiable Data Boundary ("Clio computes signal. Clio
never becomes the system of record for partner or end-user data") plus B2B-02's own `webhook_dispatch_log`
design ("NEVER logged to this or any table" for session content) both restrict exactly this. Building
reliable retry delivery as specified meant revising the practical meaning of a data-governance statement
Arun had personally approved two days earlier — for enterprise partners where that promise gets tested by
a real security review. Not a call the CEO/BA chain resolves unilaterally; escalated to Arun directly.

**Option A — Bounded retention (recommended, and the option built).** A new table
(`partner_session_insights`) holds full-detail action items, glitches, and psychology keywords for a fixed
30-day window after extraction, after which a daily purge job permanently reduces glitches to type-only and
nulls out action items and psychology keywords entirely. Webhook retries and the internal dashboard both
read from this table during the window; after purge, the dashboard retains aggregate/type-level signal for
pattern detection, but the full-detail text is gone. Satisfies reliable delivery without making Clio an
indefinite system of record.

**Option B — Fully ephemeral, no retry.** Never persist full-detail content at all; attempt delivery once,
live, and drop it if the partner endpoint doesn't accept it. Cleanest against the Data Boundary, but breaks
the reliability guarantee every other webhook event type already has — any partner endpoint downtime at
the moment of delivery means permanent, silent data loss with no recovery path. Not chosen.

**Option C — Persist indefinitely.** Simplest to build, most reliable for delivery — and a direct,
unambiguous violation of the Data Boundary's "never becomes the system of record" principle for exactly
the kind of content it was written to restrict. Not chosen.

**Arun's answer: Option A.** Bounded retention, 30-day purge window on full-detail fields, glitch
type/partner/date retained longer at reduced granularity for the dashboard's aggregate view (Panel 1 is
never affected by purge — only Panel 2's per-glitch `description` text is). Nothing else in this brief's
scope — the extraction mechanism, the webhook payload shape, the dashboard design — changed shape under
any of the three options; only the retention mechanism turned on this answer. This resolution is fully
reflected in migration `078`'s schema (`full_detail_purged_at`) and the purge RPC, both confirmed present
and correct.

## 8. Success Criteria (Acceptance Tests)

Each test is annotated with its confirmed current live status, per the Reconstruction Verification Notes.

✓ Given a partner session's Hume voice connection establishes, when the client's `onConnect` handler
fires, then a `POST /api/partner/render/session-chat-id` request is sent with the correct
`clio_session_ref`/`hume_chat_id` pair. **Confirmed TRUE** (client code present and correct).

✗ Given that same request reaches the server, when it is processed, then `partner_sessions.hume_chat_id`
is updated for the matching row. **Currently FALSE** — the route file does not exist in the shipped
commit; the request 404s and is silently caught client-side.

✓ Given `partner_sessions.hume_chat_id` IS set for a session (a state reachable only once the above route
exists, or via direct backfill), when Hume's `chat_ended` webhook is delivered and the legacy
`sessions`-table lookup finds nothing, then the new `partner_sessions` fallback lookup matches on
`hume_chat_id` and emits `clio/partner-session.ended`. **Confirmed TRUE** (webhook handler code present and
correct, directly verified).

✓ Given `clio/partner-session.ended` fires for a session with at least one transcript message, when
`extractInsightsForPartnerSession()` runs, then exactly one Anthropic call is made and `action_items`
(full text), `glitches` (full text + type), and `psychology_keywords` (keywords only, never full
sentences) are all written to `partner_session_insights` in a single update. **Confirmed TRUE** (extractor
code present, prompt enforces the keyword-only psychology constraint by instruction).

✓ Given a session with zero transcript messages, when extraction runs, then `extraction_status` is set to
`success_empty` with all three fields empty, and no Anthropic call is made. **Confirmed TRUE.**

✓ Given extraction reaches a terminal state, when `recordInsightsReadyEvent()` is called, then the
`test_mode` value written matches the session's real `partner_sessions.test_mode`, never a hardcoded
`false` — on both the success path and the failure-after-3-attempts path. **Confirmed TRUE** (the v1.1
fix; both call sites directly verified).

✗ Given a `session.insights_ready` webhook is due for delivery, when `attemptDispatch()` runs, then the
outbound payload includes the live, current `action_items`/`glitches`/`psychology_keywords` from
`partner_session_insights`, correctly signed. **Mechanically TRUE in the dispatcher code**, but **currently
unreachable in practice** for any post-ship session, since no session accumulates a `hume_chat_id` without
the missing capture route (chain: 4.B.1 missing → no `hume_chat_id` → `chat_ended` fallback never matches →
extraction never triggers → nothing to dispatch).

✓ Given a `partner_session_insights` row's `extracted_at` is more than 30 days in the past and
`full_detail_purged_at IS NULL`, when the daily purge job runs, then `action_items` and
`psychology_keywords` become `NULL`, every element of `glitches` retains only its `type` key (the
`description` key is removed entirely, not blanked), and `full_detail_purged_at` is set. **Confirmed TRUE**
(purge RPC present, logic directly verified against migration `078`).

✓ Given a row that has already been purged, when the same purge job runs again, then that row is not
re-processed (the `WHERE full_detail_purged_at IS NULL` clause excludes it) — purge is idempotent per row.
**Confirmed TRUE.**

✗ Given a Clerk-signed-in user loads `/dashboard/admin/glitches`, when the page mounts, then Panel 1 shows
one row per (glitch type × partner) sorted by count descending, and Panel 2 shows one row per individual
glitch. **Currently FALSE** — both backing route files (`/api/admin/glitches/summary`, `/api/admin/
glitches`) are absent; both panels render their error state instead.

✓ Given either dashboard panel's fetch fails (true for both, today), when the component renders, then it
shows `"Couldn't load glitch data. Try refreshing the page."` rather than a blank panel or an unhandled
exception. **Confirmed TRUE** — this is the dashboard's actual, correctly-functioning current behavior.

✓ Given a glitch row whose parent `partner_session_insights.full_detail_purged_at IS NOT NULL`, when Panel
2 would otherwise render, then the Description cell shows `"— purged (30-day retention window elapsed)"`
instead of attempting to render a `null` description. **Confirmed TRUE in the component code** (untestable
end-to-end today only because Panel 2 cannot currently load any rows at all).

✓ Given the legacy sessions-table extractor (`extractActionItemsForSession()`, `session_action_items`),
when this brief's code ships, then its behavior, schema, and prompt are byte-for-byte unchanged — verified
by direct read, no shared code paths modified. **Confirmed TRUE.**

## 9. Error States

| Failure | User/partner-visible behavior | Clio-side behavior |
|---|---|---|
| `POST /api/partner/render/session-chat-id` — route absent (current state) | None — client-side `.catch()` swallows it silently, connect flow unaffected | No `hume_chat_id` ever persisted; downstream extraction never triggers for that session |
| `chat_ended` webhook — chat_id matches neither `sessions` nor `partner_sessions` | N/A (Hume-to-Clio call) | Logged warning, `{ "received": true }` returned — never triggers Hume's own webhook retry for an unresolvable id |
| Extraction — `HUME_API_KEY` missing/placeholder | N/A | Thrown error, step retried up to 3 times by Inngest, then `markInsightsExtractionFailed()` |
| Extraction — Anthropic response fails schema validation | N/A | Thrown error → Inngest retry → on 3rd failure, `extraction_status='failed'`, one `session.insights_ready` webhook fired with `extraction_status: 'failed'` |
| Extraction — `ANTHROPIC_API_KEY` missing/placeholder | N/A | Mock `[MOCK]`-prefixed content written instead of failing — matches this codebase's standing mock-stub convention, never blocks the pipeline |
| `session.insights_ready` delivery — partner's `outbound_base_url` unreachable | N/A (partner-side) | Existing retry-with-backoff dispatcher handles it identically to every other event type — no special-casing for this event type's failure path |
| `GET /api/admin/glitches/summary` or `/api/admin/glitches` — route absent (current state) | Dashboard panel shows `"Couldn't load glitch data. Try refreshing the page."` | No server-side error to log — the request never reaches a handler |
| Purge RPC — transient DB error | N/A (silent to any user) | `step.run` throws, Inngest retries the daily job up to 3 times per its own `retries: 3` config; a row simply isn't purged that day if all 3 fail, re-attempted the next day since it still matches the eligibility `WHERE` clause |

## 10. Edge Cases

- **A session ends before `hume_chat_id` was ever captured** (true for every partner session today, given
  the missing capture route): the `chat_ended` fallback lookup finds no match in either table; the session
  is logged as unresolvable and never retried automatically — there is no separate "retry chat_id capture"
  mechanism; once the capture route is added, this only self-heals going forward, not retroactively for
  sessions that already ended without ever calling it.
- **A session has a `hume_chat_id` but zero transcript messages** (e.g., connection established then
  immediately dropped): handled explicitly — `success_empty`, no Anthropic call, still fires
  `session.insights_ready` with `extraction_status: 'success_empty'` so a partner's integration can
  distinguish "we tried and there was nothing" from "we never tried."
  a `test`-mode session behaves identically to a `live`-mode one for extraction purposes — extraction is
  not gated by `test_mode` at all, only the outbound webhook's own `test_mode` field reflects it, so a
  partner integration can filter test-mode insights out on their own side if desired.
- **The 30-minute backstop sweep and the fast path both fire for the same session** (a race, e.g. the
  webhook is delayed past 30 minutes): the idempotency guard in
  `runInsightsIdempotencyGuard()` prevents a duplicate Anthropic call — whichever path runs first inserts
  the `pending` row; the second path's guard check sees `pending` (not yet terminal) and proceeds, but the
  underlying `UNIQUE (partner_session_id)` constraint and the terminal-status short-circuit together
  prevent a double-charge in practice for the common case where the first attempt completes before the
  second begins.
- **A glitch row is purged while the internal dashboard's Panel 2 is open with a stale fetch already
  rendered**: no live-refresh mechanism exists — the purge is reflected only on the next page load /
  filter-change re-fetch, matching every other Configurator/admin screen's own no-live-refresh convention
  in this codebase.
- **A partner's `outbound_base_url` is unset entirely**: `session.insights_ready` dispatch is
  `skipped_no_endpoint`, identical to every other event type's own existing behavior for an unconfigured
  partner — not a new failure mode this brief introduces.

## 11. Out of Scope

- **A partner-session equivalent of the nightly Hume Config archive job.** Partner extraction always
  live-fetches from Hume directly (`hume_native_config_archives.session_id` is hard-FK'd to `sessions(id)`,
  confirmed structurally incompatible) — no archive-first path exists or is built for partner sessions.
- **Any change to the existing `sessions`-table extractor, `session_action_items`, or
  `hume_native_config_archives`.** Confirmed unmodified by direct read.
- **AI-assisted glitch clustering.** The dashboard is deliberately a v1 sortable/filterable table plus one
  aggregate summary — not automated pattern clustering. A justified v2, not a v1 requirement; no precedent
  exists yet in this codebase for this kind of internal-analytics screen to build clustering against.
- **The Attendee webhook signature bypass.** Found separately during this brief's own root-cause research,
  tracked as its own backlog item, not pulled in here even though it touches the same `app/api/webhooks/*`
  surface area.
- **The payment-guardrail gap** (dispatching a real, billable bot before a funding check). Already scoped
  into B2B-06, not duplicated here.
- **A Configurator-facing or partner-facing UI for viewing glitches.** The dashboard built here is strictly
  internal (`/dashboard/admin/glitches`, Clerk-gated, any signed-in user) — no partner ever sees this
  screen or an equivalent of it; partners receive glitches only via the `session.insights_ready` webhook.
- **Adding the three missing route files.** Documenting their absence is this reconstruction's job, per
  its own explicit instruction not to invent unearned acceptance criteria; building them is a follow-up
  implementation task, not a scope change to this already-approved design.

## 12. Open Questions

None. The one genuine open question in this brief's lifecycle — the data-governance tension in Section 7
— was resolved directly by Arun (Option A) before this document was approved for build. No question here
was left for a developer to guess at.

## 13. Dependencies

- **B2B-02** (done) — `partner_sessions`, `partner_accounts`, `webhook_dispatch_log`'s existing
  retry-with-backoff dispatcher (`lib/partner/webhooks.ts`'s `attemptDispatch()`/`fetchDueDispatches()`),
  `buildSignatureHeader()` (`lib/partner/webhook-signature.ts`) — this document extends the dispatcher with
  one event-type branch and reuses signing unmodified.
- **The existing Hume-native extraction pipeline** (`inngest/hume-action-item-extractor.ts`,
  `lib/voice/hume-native/session-details.ts`) — this document reuses `formatTranscriptLines()` verbatim and
  widens `fetchAllTranscriptEvents()`'s export visibility (one-line change, no call-site impact), while
  deliberately not reusing or editing the shared prompt/schema/extraction function, per Section 4.B.3.
- **`app/api/webhooks/hume/route.ts`'s existing `chat_ended` handler** — this document adds one fallback
  branch after its existing `sessions`-lookup miss path; the pre-existing legacy path is untouched.
- **`CORE_OBJECTIVES.md`'s Non-Negotiable Data Boundary** (approved as part of B2B-01, two days before this
  brief) — the constraint Section 7's escalation resolves against; this document's Option A design is the
  concrete mechanism that keeps this brief compliant with that boundary.
- **What remains before this brief is fully live end-to-end**: the three route files named in the
  Reconstruction Verification Notes and Section 9 (`/api/partner/render/session-chat-id`,
  `/api/admin/glitches/summary`, `/api/admin/glitches`). Everything else this document describes —
  schema, extraction pipeline, webhook contract, purge job, dashboard UI — is built, correct, and already
  running in production.
