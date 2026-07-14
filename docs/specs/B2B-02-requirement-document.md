# B2B-02 — Partner API & Multi-Tenant Architecture
# Requirement Document

Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-13

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-02-partner-api-multi-tenant-architecture.md`
Authoritative source material (all read in full): `CORE_OBJECTIVES.md` v2.0 (wins on any phrasing
conflict, per the Feature Brief's own instruction), `docs/brainstorm-b2b-platform-pivot.md`
(§1.2, §1.3, §2 Q2–Q4, §7.1, §7.3, §7.5 specifically), `docs/b2b-pivot-status.md`
Companion artifacts produced alongside this document: `architecture.md` (repo root — full API route
map, sequence flows, and reasoning), `supabase/migrations/071_b2b02_partner_accounts_and_api_keys.sql`,
`supabase/migrations/072_b2b02_usage_events_resolution_a.sql`

---

## Template Adaptation Note

This brief is a partner-facing API and multi-tenant data architecture, not a screen-by-screen UI
feature — the Feature Brief explicitly excludes all UI (Designer/Configurator, admin dashboard,
partner dashboard) from this spec's scope. The standard 12-section template is built primarily for UI
features. Sections are kept in standard order/numbering for consistency with every other spec in
`docs/specs/` (matching B2B-01's own precedent for a non-UI document), adapted as follows:

- **Section 4 (Screen/Flow Description)** is reframed as **API Contract / Call-Flow Description** —
  the "screens" are API request/response cycles and sequence flows, each described with the same
  exactness the template demands of UI (exact field names, types, required/optional, exact status
  codes) rather than exact button labels.
- **Section 5 (Visual Examples)** is reframed as **sequence/flow diagrams** (text-based, matching the
  wireframe convention's spirit) for each of the five mechanisms this brief delivers, plus one literal
  UI wireframe for the single placeholder screen this brief does introduce (Section 5.6 — the
  `/partner-render/[clio_session_ref]` stub route).
- All other sections apply directly, not diminished by the adaptation.

For the full architectural reasoning, sequence diagrams, and exact JSON contracts, this document
defers to `architecture.md` rather than duplicating it — this document states requirements and
acceptance criteria; `architecture.md` states the design that satisfies them. Where the two could ever
drift, `architecture.md` is the implementation-detail source of truth and this document is the
requirements source of truth; a developer should read both together.

---

## 1. Purpose

Today Clio has exactly one auth model — a Clerk JWT per individual end user — and zero concept of a
"partner" as a trust boundary. There is no mechanism for an external system to trigger a Clio session,
no mechanism for Clio to push generated content to a system it doesn't control and pull it back at
render time, and no usage-metering or webhook infrastructure of any kind. Every other pivot brief
depends on this one: B2B-03 (Designer/Configurator) needs a partner account to attach configuration to;
B2B-04 (Billing/metering) needs an event stream to bill against; B2B-05 (Domain/white-label infra)
needs a tenant identity for Host-header routing to resolve against. None of that exists yet.

**Failure without this document:** each downstream Feature Brief's CEO/BA/Developer chain would have to
independently invent a partner identity model, an auth pattern, and a usage-event shape — with no
shared reference, producing incompatible schemas that surface as integration conflicts only once B2B-03
through B2B-05 are already underway. This document is also where `architecture.md` — referenced by name
in `CLAUDE.md` as not yet existing — is created for the first time under the pivoted model, so every
later brief has one settled place to extend rather than each re-deriving the base schema.

## 2. User Story

This is infrastructure with no individual end-user-facing reader. Its "users" are partner engineering
teams integrating with Clio's API, and the Clerk-authenticated partner-admin humans managing that
integration's credentials.

**Story 1 — Partner backend engineer (Platform Partner, e.g. Pluralsight)**
As the engineer integrating Pluralsight's "Explain this with AI" button,
I want one authenticated API call that takes a topic reference and a meeting URL and returns a joinable
AI session,
So that I don't need to understand or care which meeting-bot vendor or voice provider is behind Clio.

**Story 2 — Partner backend engineer (No-Platform Partner, e.g. Capgemini)**
As the engineer wiring Capgemini's Designer-built portal to Clio,
I want to implement one small, clearly-specified API surface on our own infrastructure (content
storage, profile storage, a usage webhook receiver),
So that Clio can push/pull our data without Clio ever becoming a second system of record we have to
keep in sync.

**Story 3 — Partner-admin human (Clerk-authenticated, e.g. Capgemini's integration lead)**
As a partner admin logging into Clio's own UI,
I want to generate, label, and revoke API keys for my own partner account, separately from any
individual login,
So that a compromised key can be rotated without taking down our whole integration, and so that no
individual person's departure ever breaks our API access.

**Story 4 — Clio's own billing/dashboard system (internal, consumed by B2B-04)**
As the future B2B-04 admin page and partner dashboard,
I want every billable event exposed via a stable, documented API read path the instant it happens,
So that I can build a UI on top of it without needing my own Feature Brief to also define the
underlying event contract.

**Story 5 — A downstream sub-tenant's employee (e.g. Hartford, via Capgemini)**
As an end user who has never heard of Clio,
I want the product to work exactly as Capgemini's own, with zero visible seam,
So that nothing in the experience — branding, login, errors — ever reveals a third-party AI vendor is
involved.

## 3. Trigger / Entry Point

This brief has no single entry point — it defines several independent trigger points, each documented
exactly (full request/response contracts in `architecture.md` Section 3):

- **Session initiation**: `POST /api/partner/v1/sessions`, triggered by a partner's own UI (a button
  click on their end) calling Clio's API. Authenticated by a partner API key. State required: the
  calling key must be `status = 'active'` on a `partner_accounts` row with `status = 'active'`.
- **Session status check**: `GET /api/partner/v1/sessions/:clio_session_ref`, same auth.
- **Usage read**: `GET /api/partner/v1/usage`, same auth.
- **API key issuance/revocation**: `POST` / `DELETE /api/admin/partner-keys[/:id]`, triggered by a
  Clerk-authenticated partner-admin human via Clio's own UI (or directly via API, per Objective 6 — the
  future Configurator UI is a client of this, not the only path). State required: an active Clerk
  session whose `clerk_user_id` has a row in `partner_admin_users` for the target `partner_account_id`.
- **Outbound content/profile push-pull**: not partner-triggered — triggered internally by Clio's own
  backend (content push: on Designer approval, built in B2B-03; content/profile pull: at session render
  time, built in this brief's render-URL contract). No externally-reachable route; these are outbound
  HTTP calls Clio's server makes.
- **Usage webhook dispatch**: triggered internally whenever a billable event is recorded (voice-minute,
  LLM-generation call) — an Inngest function (`webhook-dispatcher`, new in this brief), not a
  user-facing trigger.

## 4. API Contract / Call-Flow Description

Every field below is exact — types, required/optional, and validation — per the "do NOT say 'a form'"
discipline the standard template demands, applied to JSON bodies instead of form fields. Full sequence
diagrams are in Section 5; the byte-exact schemas below are what a developer implements against.

### 4.1 `POST /api/partner/v1/sessions`

**Headers:** `Authorization: Bearer <api_key>` (required), `Content-Type: application/json` (required)

**Request body (Zod schema, informally):**
```
meeting_url          string, required, must be a valid URL, no further format validation
                      (Clio does not verify it's a real Google Meet link at request time —
                      failure surfaces at bot-dispatch time instead, see error states)
partner_topic_ref    string, optional, 1-512 chars, printable ASCII
content_ref          string, optional, must be a valid UUID if present (Clio-minted refs are UUIDs)
partner_end_user_ref string, optional, 1-256 chars, printable ASCII
partner_reference    string, optional, 1-256 chars, printable ASCII (opaque sub-tenant/correlation tag)
```
At least one of `partner_topic_ref` or `content_ref` is required — the endpoint returns `422` if both
are absent (there must be something for the session to be about).

**Response — 201 Created:**
```
{ "clio_session_ref": "uuid", "status": "bot_active" | "bot_dispatch_failed", "render_url": "https://.../partner-render/{clio_session_ref}", "error": "string, only present if status is bot_dispatch_failed" }
```

**Response — 401 Unauthorized:** key missing, malformed, unrecognized, or `status != 'active'`.
**Response — 403 Forbidden:** key valid but `partner_accounts.status = 'suspended'`.
**Response — 422 Unprocessable Entity:** body fails validation (exact field-level errors returned).
**Response — 429 Too Many Requests:** rate limit exceeded, `Retry-After` header set.

### 4.2 `GET /api/partner/v1/sessions/:clio_session_ref`

**Response — 200:** `{ "clio_session_ref", "status", "created_at", "ended_at" }` — never includes
`provider_bot_id`, `provider_name`, `meeting_url`, or any opaque reference the caller didn't already
supply.
**Response — 404:** ref doesn't exist, or exists but belongs to a different `partner_account_id` than
the authenticating key (these two cases are deliberately indistinguishable in the response, to avoid
leaking existence of another partner's session ref via a 403-vs-404 timing/status difference).

### 4.3 `GET /api/partner/v1/usage`

**Query params:** `from` (ISO8601 date, optional, defaults to 30 days ago), `to` (ISO8601 date,
optional, defaults to now), `event_type` (optional, one of the values in Section 7.3 of
`architecture.md`, defaults to all).
**Response — 200:** `{ "events": [ {event shape from architecture.md §7.3, plus delivery_status} ], "next_cursor": "string | null" }` — paginated, cursor-based, page size 100.

### 4.4 `POST /api/admin/partner-keys` (Clerk-authenticated)

**Request body:** `{ "partner_account_id": "uuid", "mode": "test" | "live", "label": "string, optional" }`
**Response — 201:** `{ "id": "uuid", "key": "clio_live_sk_...", "key_prefix": "clio_live_sk_a1b2c3d4", "mode", "label" }` — **the full `key` value is returned exactly once, in this response only.** It is never retrievable again (matches `key_hash`-only storage). The UI (B2B-03) is responsible for making this a one-time-copy affordance; that UI is out of this brief's scope, but the API contract producing the value is in scope and must behave this way regardless of which brief builds the UI around it.
**Response — 403:** caller's Clerk user has no `partner_admin_users` row for the requested `partner_account_id`.

### 4.5 `DELETE /api/admin/partner-keys/:id` (Clerk-authenticated)

**Response — 200:** `{ "id": "uuid", "status": "revoked", "revoked_at": "ISO8601" }`
**Response — 404:** key doesn't exist or doesn't belong to a partner account the caller administers.
**Response — 409:** key already revoked (idempotent-friendly: returns the existing revoked state rather than erroring twice).

### 4.6 `/partner-render/[clio_session_ref]` (placeholder route, this brief; real implementation is B2B-03)

Per `CLAUDE.md`'s autonomy rule for undefined UX content: this route is registered and returns a
minimal static page (no partner content, no branding decisions made) stating the session reference is
valid and a real experience is not yet implemented. It exists so `createBot()` has a real, resolvable
URL to hand the meeting-bot's headless browser today, and so this brief's acceptance criteria (Section
7) can verify end-to-end that a real join happens — not so an end user or partner ever sees it in
production before B2B-03 ships. See Section 5.6 for the literal wireframe.

## 5. Visual Examples (Sequence Flows)

Per the Template Adaptation Note, these are text-based sequence flows, one per mechanism, plus one
literal wireframe for the single stub screen this brief introduces. Full versions with exact headers
and retry/backoff detail are in `architecture.md` Sections 4, 6, 7 — these are the acceptance-testable
summaries.

### 5.1 Session initiation
```
Partner UI → POST /api/partner/v1/sessions (API key) → Clio validates key
  → mints clio_session_ref → calls getMeetingBotProvider().createBot()
  → 201 { clio_session_ref, status, render_url } → Partner UI shows "Clio is joining..."
```

### 5.2 Content push (Designer approval, B2B-03-triggered; contract owned here)
```
[B2B-03 approval action] → POST {outbound_base_url}/content (partner token)
  → partner stores it → 2xx → Clio discards the payload from memory, nothing written to any Clio table
```

### 5.3 Content pull (render time)
```
/partner-render/[ref] loads → GET {outbound_base_url}/content?content_ref=... (partner token)
  → 200 { payload } → rendered directly, never persisted
  OR → 404 → render layer shows "content unavailable" state (B2B-03's concern to design; this
       brief only guarantees the 404 is a clean, distinguishable response, not a crash)
```

### 5.4 Profile pull (session start, toggle-gated)
```
IF partner_accounts.profile_sync_enabled = true AND partner_end_user_ref present:
  GET {outbound_base_url}/profile?partner_end_user_ref=...
    → 200 { profile } → passed into Hume's system prompt (B2B-03/render-layer concern)
    → 404 → no profile yet, Hume explains generically (Objective 2's documented fallback)
IF profile_sync_enabled = false:
  this call never executes — not skipped-with-a-flag, the code path does not run at all
```

### 5.5 Usage webhook dispatch
```
Billable event → INSERT webhook_dispatch_log (status=pending, signed)
  → Inngest webhook-dispatcher picks it up → POST {outbound_base_url}/webhooks/usage
    (Clio-Signature header) → 2xx → status=delivered
                             → non-2xx/timeout → retry per backoff schedule → status=exhausted after 5 attempts
```

### 5.6 `/partner-render/[clio_session_ref]` placeholder — literal wireframe
```
┌─────────────────────────────────────────┐
│  Clio                                    │
│                                          │
│  Session ref: 3f9a1c22-...               │
│  This session is valid. The rendering    │
│  experience for this session is not yet  │
│  implemented.                            │
│                                          │
└─────────────────────────────────────────┘
```
Plain black-on-white static text, no Clio marketing chrome, no partner branding (none is configured
yet — that's B2B-05). This is intentionally the minimum possible screen, per `CLAUDE.md`'s rule that an
undefined-content screen must not have AI-generated or invented content populated into it.

## 6. Data Requirements

Full schema with column-level rationale is in `supabase/migrations/071_b2b02_partner_accounts_and_api_keys.sql` and `072_b2b02_usage_events_resolution_a.sql`; full API route map is in `architecture.md` Section 3. Summarized:

**Read from the database:**
- `partner_api_keys.key_hash` — every `/api/partner/v1/*` request, to authenticate.
- `partner_accounts.status`, `.profile_sync_enabled`, `.outbound_base_url`, `.outbound_auth_token_ciphertext`, `.outbound_signing_secret` — read at session-initiation and at every outbound call.
- `partner_admin_users` — every `/api/admin/partner-keys*` request, to authorize.
- `partner_sessions` — status-check reads, and by the render-URL stub to validate the ref exists.

**Written to the database:**
- `partner_sessions` — one row per `POST /api/partner/v1/sessions` call.
- `partner_api_keys` — one row per key issuance; `status`/`revoked_at` updated on revocation; `last_used_at` updated (best-effort, not synchronous-blocking) on each authenticated call.
- `webhook_dispatch_log` — one row per billable event, updated by the dispatch worker.
- `usage_events` — one row per billable event, **only if F-01 resolves to Resolution A** (migration 072).

**APIs called:**
- Outbound: partner's `{outbound_base_url}/content`, `/profile`, `/webhooks/usage` (Section 4 of `architecture.md`).
- Internal: `getMeetingBotProvider().createBot()` / `.deleteBot()` (existing, unmodified interface).

**Never written anywhere:** content payloads, profile payloads, any end-user-identifying field beyond the opaque `partner_end_user_ref` string the partner itself supplied (which Clio never attempts to resolve to a real name/email — see `architecture.md` Section 6's "zero Clio-side persistence" note).

**localStorage/sessionStorage:** none — this brief has no browser-side state; the one placeholder page (4.6) is fully server-rendered static content.

### F-01 Handling (ledger storage model)
Per the Feature Brief's explicit instruction, this document does not resolve F-01. `architecture.md`
Section 8 documents both branches (Resolution A: `usage_events` aggregating table, migration 072;
Resolution B: zero additional storage, live round-trip or `webhook_dispatch_log`-derived read) concretely
enough for B2B-04 to pick either without reopening this spec. **Finding, stated explicitly per the
Feature Brief's escalation trigger**: the partner-facing API contract (Sections 4.1–4.3 above, and the
webhook payload shape in `architecture.md` §7.3) is identical under either resolution — the fork is
confined to the internal SQL `GET /api/partner/v1/usage` runs. This does not meet the Feature Brief's
stated escalation bar ("the partner-facing API contract itself... forks") — **not escalated**.

## 7. Success Criteria (Acceptance Tests)

✓ Given a partner account with one active `live` key, when the partner calls `POST
/api/partner/v1/sessions` with a valid `meeting_url` and `partner_topic_ref`, then the response is
`201` with a `clio_session_ref` (valid UUID), and a `partner_sessions` row exists with matching
`partner_account_id` and `status = 'bot_active'` (mock meeting-bot mode acceptable in dev/test per
existing `[MOCK ATTENDEE]` convention).

✓ Given the same request but with an unrecognized or revoked API key, when the partner calls `POST
/api/partner/v1/sessions`, then the response is `401` and no `partner_sessions` row is created.

✓ Given a partner account with `profile_sync_enabled = false`, when a session is initiated with a
`partner_end_user_ref` present, then no HTTP call to `{outbound_base_url}/profile` is made at any point
in that session's lifecycle (verifiable via a network-call assertion in the render-time code path, not
just documentation) — this is the literal falsifiable test from `CORE_OBJECTIVES.md` Objective 1
applied at the API-mechanism level.

✓ Given a partner account with `profile_sync_enabled = true` and a `partner_end_user_ref` that has no
prior profile on the partner's side, when the render layer pulls the profile, then a `404` from the
partner's endpoint is treated as a valid, non-error outcome (no retry, no 5xx surfaced to the partner,
session proceeds).

✓ Given a billable `usage.voice_minute` event, when it is recorded, then a `webhook_dispatch_log` row is
created with a valid HMAC-SHA256 signature over the exact payload, and — if the partner's
`/webhooks/usage` endpoint returns `200` — `delivery_status` transitions to `delivered` within one
dispatch cycle; if it returns `500` five consecutive times, `delivery_status` reaches `exhausted` and
the event remains readable via `GET /api/partner/v1/usage` regardless.

✓ Given a webhook payload that was tampered with in transit (body modified after signing), when a
partner (or a test harness acting as one) recomputes the HMAC using the shared `outbound_signing_secret`
and compares it to the `Clio-Signature` header, then the signatures do not match — proving the
signature genuinely covers the body rather than being a constant/placeholder.

✓ Given a webhook delivery attempt whose `t=` timestamp is older than 5 minutes relative to receipt
time, when the partner's verification logic checks it (per the documented pattern in `architecture.md`
§7.2), then it is rejected as a potential replay — this is a partner-side implementation requirement
this spec documents, not a Clio-side enforcement, since Clio cannot control the partner's clock/logic;
Clio's own obligation is limited to including an accurate `t=` value.

✓ Given a Clerk-authenticated partner-admin with no `partner_admin_users` row for a given
`partner_account_id`, when they call `POST /api/admin/partner-keys` targeting that account, then the
response is `403` and no key is created.

✓ Given a partner account with two active `live` keys (rotation in progress), when a request arrives
authenticated with either key, then both succeed identically — proving rotation is zero-downtime, not
just documented as such.

✓ Given a session initiated with an optional `partner_reference` value (e.g. `"hartford"`), when the
resulting usage webhook fires, then the payload's `partner_reference` field contains that exact string,
unmodified — and given a session initiated **without** `partner_reference`, the field is `null` in the
webhook payload, never omitted or defaulted to an empty string (so partner-side JSON parsing can rely on
the field always being present, exactly one of a string or `null`).

## 8. Error States

| Failure | User-visible (partner-side) behavior | Clio-side behavior |
|---|---|---|
| Invalid/missing API key | `401`, JSON error envelope `{ "error": { "code": "invalid_api_key", "message": "...", "request_id": "..." } }` | No DB write of any kind |
| Revoked API key | `401`, same envelope, `code: "revoked_api_key"` | `last_used_at` not updated |
| Suspended partner account | `403`, `code: "account_suspended"` | Logged to application logs (not a DB table) for internal follow-up |
| Malformed/invalid request body | `422`, field-level errors from Zod | No DB write |
| `meeting_url` unreachable / not a real Meet link | `201` with `status: "bot_dispatch_failed"` and `error` field populated from the vendor's error message (redacted of any vendor-identifying string per Section 11 of `architecture.md`) | `partner_sessions` row persists in `bot_dispatch_failed` state, queryable |
| Meeting-bot vendor API fully down | Same as above — `bot_dispatch_failed`, not a `5xx` to the partner (the partner's own call succeeded; the downstream dispatch is what failed, and that distinction is preserved in the response) | Internal alerting is out of this brief's scope (no monitoring/paging system defined here) |
| Partner's `outbound_base_url` unreachable (content/profile pull) | N/A — this is Clio calling the partner, not the reverse | Render layer receives a failed pull; per Section 5.3, treated as equivalent to a `404` (content/profile unavailable), not a hard error — exact render-time UX is B2B-03's concern |
| Partner's `/webhooks/usage` unreachable | N/A | Retried per the 5-attempt backoff schedule (Section 7.2 of `architecture.md`), then `exhausted`; underlying event remains queryable via the read API regardless of delivery outcome — billing (once B2B-04 exists) is never blind to an event just because delivery failed |
| Rate limit exceeded | `429`, `Retry-After` header | No DB write for the rejected request itself |
| Partner-admin lacks permission on key management routes | `403` | No DB write |

**Loading/slow-network state:** `POST /api/partner/v1/sessions` is not designed to be near-instant —
`createBot()` involves a real external vendor call. This brief does not impose a specific timeout beyond
noting the endpoint should return promptly with `bot_dispatch_failed` rather than hang indefinitely if
the vendor API stalls (exact timeout value is a technical implementation detail, not specified here to
avoid a number that would need updating every time vendor latency characteristics change — implementers
should apply a reasonable timeout, e.g. in the 15–30s range, consistent with existing vendor-call
timeout conventions elsewhere in this codebase).

## 9. Edge Cases

- **Platform Partner vs. No-Platform Partner**: identical API surface for both (Objective 6 / "one
  flexible API"); the only observable difference is which optional fields a given partner's integration
  chooses to populate (e.g. Pluralsight likely never sets `content_ref` since it always supplies
  `partner_topic_ref` for its own existing content; Capgemini's Designer-generated sessions likely
  always set `content_ref`). No code branches on partner archetype.
- **First-ever session for a brand-new partner account**: works identically to the 1000th — no
  onboarding-order dependency exists between "partner account created" and "first session initiated"
  beyond having at least one active API key, which this brief's key-issuance endpoint provides
  immediately at account-setup time.
  the partner's outbound config (`outbound_base_url`/token) is unset. Any resulting content/profile pull
  attempt fails cleanly (treated as unavailable, Section 5.3/5.4) rather than crashing — a partner can
  legitimately test session-initiation and bot-join before wiring up their own content storage.
- **Test-mode key used for a real session**: `partner_sessions.test_mode = true` for the entire session
  lifecycle; no `usage_events` row is ever created for it (if F-01 Resolution A applies) and any usage
  webhook fired is marked such that a partner's own billing logic can filter it out — Clio does not
  block test-mode sessions from actually joining a real meeting (a partner may want to test end-to-end
  including the live bot join), it only guarantees test-mode usage is excluded from every billing
  aggregate.
- **Sub-tenant usage with no `partner_reference` supplied**: fully supported (Section 9 of
  `architecture.md`) — the field is optional precisely because most partners (Platform Partners
  especially) have no sub-tenant concept at all.
- **Key rotation mid-session**: a `clio_session_ref` created under a since-revoked key remains valid for
  status checks and continues its lifecycle (`GET`/webhook delivery are keyed to `partner_account_id` and
  `clio_session_ref`, not to the specific key that created them) — revoking a key does not retroactively
  invalidate sessions it already created.
- **Duplicate webhook delivery**: the idempotency index on `webhook_dispatch_log` (`partner_account_id,
  event_type, clio_session_ref, payload_hash`) prevents two identical events from ever being queued
  twice from Clio's side; partners are still expected to handle at-least-once delivery semantics on
  their own end (documented, not enforced by Clio — standard webhook consumer practice).
- **Mobile vs. desktop**: not applicable — this brief has no rendered UI beyond the one static
  placeholder page (5.6), which has no layout-sensitive content.
- **Partner skips optional fields entirely** (`partner_topic_ref` only, no `content_ref`, no
  `partner_end_user_ref`, no `partner_reference`): fully valid minimal request — session initiates,
  profile pull never attempted (no ref to pull with), content pull attempted using
  `partner_topic_ref` only.

## 10. Out of Scope

Explicitly excluded, per the Feature Brief's own scope boundaries plus this document's own findings:

- Designer/Configurator UI, the 3-level (app/template/component) visualization property system — B2B-03.
- Specific burn rates, credit-pool math, enterprise tier pricing, the admin-dashboard UI at
  `/dashboard/admin/clients` — B2B-04. This brief defines the usage-event/webhook mechanism B2B-04 will
  price and render; it sets no numbers and builds no screens.
- Subdomain/custom-domain provisioning, Vercel Domains API integration, Host-header tenant-resolution
  middleware — B2B-05. This brief defines the partner/auth/tenant model B2B-05's routing keys off; it
  does not build the routing.
- **The real `/partner-render/[clio_session_ref]` experience** — only a placeholder stub is built here
  (Section 4.6). Pulling and rendering actual content, driving Hume against it, and any white-label
  styling is B2B-03's scope, named as a direct dependency in `architecture.md` Section 5.
- **Topic-list submission** (a partner sending Clio its full topic list to drive the existing
  bridging/delta engine, Objective 4). Named in the brainstorm doc but not in the Feature Brief's "What
  Success Looks Like" list — this document deliberately does not invent an endpoint contract for it
  without grounding against the existing topic-delta/bridging implementation, which this brief did not
  audit. Flagged as likely B2B-03 or a dedicated follow-up scope, not silently included or silently
  dropped.
- **Reconciling the legacy `sessions`/`users` B2C-shaped schema** with the new `partner_sessions` model
  — named explicitly as a gap in `architecture.md` Section 5, not solved here.
- Actual call-site instrumentation wiring real voice-minute/LLM-generation events into the webhook
  mechanism (Section 6's "Written to the database" notes the integration point but does not modify the
  existing minutes-ledger/generation call sites) — those call sites belong to whichever brief builds the
  B2B-03 generation pipeline and the render-time minute-tracking.
- Any monitoring/alerting/paging system for `bot_dispatch_failed` or `exhausted` webhook states beyond
  making them queryable via the API.
- F-01's actual resolution (explicitly deferred, both branches spec'd — Section 6).

## 11. Open Questions

None.

All items the Feature Brief flagged as "Questions for BA" (API versioning/test-live separation, rate
limiting, key rotation/revocation UX, exact opaque-reference shape, F-01 handling) were resolved as
judgment calls within this document and `architecture.md` (Sections 4.4/`partner_api_keys.mode`,
`architecture.md` §10, §10, §6/architecture.md throughout, and Section 6/`architecture.md` §8
respectively). The one genuine architectural finding this document surfaced beyond what the Feature
Brief anticipated — the `partner_sessions`-vs-legacy-`sessions` gap (`architecture.md` Section 5) — is
resolved as an explicit, named scoping decision with a placeholder implementation (Section 4.6), not
left as a blocking question, per the Feature Brief's own pattern for how B2B-05's routing dependency is
handled.

## 12. Dependencies

- **B2B-01** (Core Objectives rewrite) — done, this document is written against `CORE_OBJECTIVES.md`
  v2.0 as primary source.
- **Existing infrastructure reused as-is, unmodified by this brief**: `lib/meeting-bot/provider.ts` /
  `getMeetingBotProvider()`, `lib/meeting-bot/attendee.ts` + `recall.ts` (verified their `userId` param
  is opaque passthrough, safe to repurpose), the Stripe (`lib/stripe.ts`) and Clerk
  (`app/api/webhooks/clerk/route.ts`) webhook signature-verification patterns (precedent for this
  brief's own HMAC design), `middleware.ts` (extended, not replaced, to add the new
  `/api/admin/partner-keys*` routes to its protected set).
- **Must exist before B2B-02 can be built**: nothing beyond what's already present — no external vendor
  approval, no new npm package (all primitives — `crypto` for HMAC/hashing — are Node built-ins,
  already implicitly available, not a new dependency).
- **What B2B-02 unblocks**: B2B-03 (needs `partner_accounts`/`partner_sessions`/the content-pull
  contract to attach the Designer and render layer to), B2B-04 (needs `webhook_dispatch_log` +
  either F-01 branch + the `/api/partner/v1/usage` read path), B2B-05 (needs `partner_accounts` as the
  tenant identity Host-header routing resolves to).
- **Named dependency this document creates for B2B-03 specifically**: replacing the
  `/partner-render/[clio_session_ref]` placeholder (Section 4.6) with a real content-pulling,
  Hume-driving render experience, and resolving how that experience's data needs interact with the
  legacy `sessions`-table-keyed runtime (`architecture.md` Section 5) — B2B-03's own Feature Brief should
  explicitly scope this in, not assume it's already solved.
