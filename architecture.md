# Clio — Architecture (B2B Pivot)

Version: 1.0 | Produced by: Business Analyst Agent, as part of B2B-02
Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-02-partner-api-multi-tenant-architecture.md`
Requirement Document: `docs/specs/B2B-02-requirement-document.md`
Schema migrations: `supabase/migrations/071_b2b02_partner_accounts_and_api_keys.sql`,
`supabase/migrations/072_b2b02_usage_events_resolution_a.sql`

Per `CLAUDE.md`: no `architecture.md` existed for the pivoted system before this brief. This file is
scoped to exactly what B2B-02 covers — partner accounts, API keys, the session-initiation contract,
the content/profile push-pull contract, and the usage-metering/signed-webhook mechanism. It is not a
speculative full schema for B2B-03 (Designer/Configurator), B2B-04 (Billing/metering), or B2B-05
(Domain/white-label infra) — each of those will extend this document when their own Feature Brief
lands.

---

## 1. Two Auth Systems — Do Not Conflate

| | Clerk | Partner API Keys |
|---|---|---|
| **Who it authenticates** | A human at a partner company (Capgemini/Pluralsight) logging into Clio's own UI | A partner's backend system calling Clio's API programmatically |
| **Scope** | Partner-admin accounts only — never end-user identity, in any form | One partner account (machine-to-machine) |
| **Where it's used** | Configurator/Designer/billing UI (B2B-03), key management endpoints (this brief) | Session-initiation, usage-read endpoints (this brief) |
| **Owned by** | B2B-01 (unchanged by this brief) | New in this brief |
| **Bridge table** | `partner_admin_users` (Clerk user ID ↔ partner_account_id) | `partner_api_keys` (hash ↔ partner_account_id) |

**Routing convention that makes this unmistakable at a glance:** every partner-API-key-authenticated
route lives under `/api/partner/v1/*`. Every Clerk-authenticated partner-admin route (key management,
future Configurator) lives under Clio's existing internal `/api/*` / `/dashboard/*` convention,
protected by the existing Clerk `middleware.ts`. A developer should never need to open a route file to
know which auth model applies — the path prefix tells them.

A Clerk-authenticated partner-admin **cannot** rotate or revoke their own API keys using an API key —
that would be a bootstrapping problem (you'd need a key to manage your keys). Key management is
Clerk-authenticated only; runtime partner→Clio calls are API-key-authenticated only. Neither system is
ever a valid credential for the other's routes.

## 2. Bidirectional API — Two Different Auth Directions

```
Partner's backend  ──[Authorization: Bearer clio_live_sk_...]──▶  Clio  (/api/partner/v1/*)
                         (Clio-issued partner API key)

Clio  ──[Authorization: Bearer <partner-supplied token>]──▶  Partner's backend  ({outbound_base_url}/*)
           (partner-supplied credential, configured once per partner account)
```

These are not the same credential and must never be implemented as if they were. Partner → Clio calls
authenticate against `partner_api_keys.key_hash`. Clio → partner calls authenticate using
`partner_accounts.outbound_auth_token_ciphertext` — a value the **partner** generated and handed to
Clio via a settings field (base URL + token), per brainstorm doc §7.5 point 4. Clio never issues this
credential; the partner does, exactly the reverse of the API-key direction.

## 3. API Route Map

All partner-facing routes are versioned under `/api/partner/v1/`. See
`docs/specs/B2B-02-requirement-document.md` Section 6 for full request/response Zod schemas.

### 3.1 Partner → Clio (authenticated by Clio-issued API key)

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/partner/v1/sessions` | Session-initiation contract. Topic/content reference in, `clio_session_ref` + render URL out. |
| GET | `/api/partner/v1/sessions/:clio_session_ref` | Status check on a session this key initiated. |
| GET | `/api/partner/v1/usage` | Read own usage (F-01-resolution-agnostic — see Section 7). Query params: `from`, `to`, `event_type`. |

### 3.2 Clerk-authenticated (partner-admin humans, not partner API keys)

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/admin/partner-keys` | Issue a new API key (test or live) for the caller's partner account. |
| DELETE | `/api/admin/partner-keys/:id` | Revoke a key immediately. |
| GET | `/api/admin/partner-keys` | List keys (prefix + label + last_used_at only — never the full key after issuance). |
| PATCH | `/api/admin/partner-accounts/:id/outbound-config` | Set/update `outbound_base_url`, rotate `outbound_auth_token`, regenerate `outbound_signing_secret`. |

These live under the existing internal `/api/admin/*`-style convention (see `middleware.ts`'s existing
Clerk-protected route list) — B2B-02 adds these specific routes to that protected set. No new UI is
built for them in this brief (that's B2B-03's Configurator); they exist as API endpoints only, per
Objective 6 ("UI renders what the API returns").

### 3.3 Clio → Partner (authenticated by partner-supplied token, called by Clio's own backend)

Not Clio routes — this is the contract the **partner must implement** on their own `outbound_base_url`.
Documented here as the client-side contract Clio's code will call.

| Method | Path (relative to `outbound_base_url`) | Direction | Purpose |
|---|---|---|---|
| POST | `/content` | push | Clio pushes once-generated, partner-approved content. |
| GET | `/content?content_ref=` or `?partner_topic_ref=` | pull | Clio pulls content back at render time. Zero Clio-side storage. |
| POST | `/profile` | push | Clio pushes a computed profile. Only called if `profile_sync_enabled`. |
| GET | `/profile?partner_end_user_ref=` | pull | Clio pulls a profile at session start. Only called if `profile_sync_enabled`. 404 if partner has no record yet — a fully legitimate response, not an error. |
| POST | `/webhooks/usage` | push (fire-and-forget, retried) | Signed usage/billing event. See Section 6. |

## 4. Session-Initiation Contract — Sequence

```
Partner's UI (Pluralsight button, or a No-Platform partner's Designer-built portal)
   │
   │ 1. POST /api/partner/v1/sessions
   │    Authorization: Bearer clio_live_sk_...
   │    { meeting_url, partner_topic_ref?, content_ref?, partner_end_user_ref?, partner_reference? }
   ▼
Clio: /api/partner/v1/sessions route
   │
   │ 2. Validate API key (hash lookup, status = active, mode recorded)
   │ 3. Validate request body (Zod)
   │ 4. Insert partner_sessions row → mints clio_session_ref (UUID)
   │ 5. Build renderUrl = `${APP_URL}/partner-render/${clio_session_ref}`
   │    (see Section 5 — this route is a placeholder in this brief; B2B-03 builds the real one)
   │ 6. getMeetingBotProvider().createBot(meeting_url, clio_session_ref, renderUrl)
   │    — vendor-agnostic; provider_bot_id/provider_name stored internally, never returned
   │ 7. Update partner_sessions.status = 'bot_active' (or 'bot_dispatch_failed' + error_message)
   ▼
Response: 201 { clio_session_ref, status, render_url }
   (render_url returned so a Platform Partner that wants to preview/debug can open it directly;
    the meeting-bot itself also loads it headlessly per step 6)
```

If `createBot()` throws (vendor API error, invalid meeting URL, etc.), the endpoint still returns 201
with `status: "bot_dispatch_failed"` and an `error` field — the `partner_sessions` row and
`clio_session_ref` already exist and are queryable via the status-check endpoint, rather than the whole
call failing atomically. This matches the existing codebase's per-item-error-tolerant pattern (e.g. the
old daily-delivery job's "log error, continue" convention) applied to a single-item case.

## 5. Why `partner_sessions` Is a New Table, Not a Reuse of `sessions`

**This is the one place this brief found a real integration gap and is naming it explicitly rather than
gliding over it**, per the CEO brief's own instruction to surface — not silently assume away — cases
where an assumption doesn't hold cleanly.

The legacy `sessions` table (`supabase/migrations/002_minutes_and_sessions.sql`) has `user_id TEXT NOT
NULL REFERENCES users(id) ON DELETE CASCADE`, where `users.id` is a Clerk end-user ID. Every piece of
the currently-live meeting-bot/voice runtime — `walkthrough_tab_manifests`, `live_conductor_state`,
`session_markers` (RTV-02), position tracking (RTV-04), the minutes ledger, the quality evaluator — is
keyed to `sessions.id` and, transitively, to that Clerk `user_id`. Under the pivot, partner-initiated
sessions have no Clerk end-user identity at all (Objective 6, Non-Negotiable Data Boundary) — there is
no value that could legitimately populate that `NOT NULL` FK for a partner session.

Two options were considered:
- **(a) Relax `sessions.user_id` to nullable** and touch the dozens of existing call sites (billing,
  quality eval, RLS policies keyed on `auth.uid()::text = user_id`) to tolerate partner-originated rows.
  This is real surgery across reused, currently-live production infrastructure — squarely the kind of
  change the CEO brief's scope boundary excludes from this brief ("no Designer UI... in this spec" /
  "this brief defines the mechanism ... it does not build the routing/rendering itself" — the same
  logic that scopes B2B-05's routing out of this brief applies here to the render runtime).
- **(b) A new table** (`partner_sessions`), with its own render entry point.

This spec takes **(b)**. Consequence, stated plainly: **B2B-02's session-initiation endpoint mints a
real `clio_session_ref`, calls the real vendor-abstracted `createBot()`, and gets a real bot into the
meeting — but the URL that bot's headless browser loads (`/partner-render/[clio_session_ref]`) is a
placeholder in this brief** (per `CLAUDE.md`'s own autonomy rule: "build the minimal version... a blank
page with the route registered" when a screen's real content is a later brief's scope). The actual page
— pulling content via Section 3.3's contract, rendering it white-label, driving the Hume voice session
against it — is the point where B2B-03 (Designer/Configurator, which per `CORE_OBJECTIVES.md` §Objective
3 owns "partner-configurable rendering of reused, once-generated content") must pick this up. **This is
a named dependency for B2B-03's own Feature Brief scoping, not a gap this brief can close** — closing it
requires either wiring the render runtime to `partner_sessions` directly or bridging it to a
`sessions` row, and that's a rendering-layer decision, not a partner-API/auth decision.

Reconciling or eventually deprecating the legacy `sessions`/`users` B2C-shaped schema once the render
runtime itself is migrated is out of scope here too — flagged, not solved.

## 6. Content & Profile Push-Pull Contracts

Both contracts share an identical shape (push once, pull at render time), per the brainstorm doc's own
framing. The only difference: profile calls are gated by `partner_accounts.profile_sync_enabled`;
content calls are not gated by a toggle at all (a partner either sends `content_ref` — Clio-generated —
or `partner_topic_ref` alone — partner-authored — at session-initiation time; the pull path is identical
either way, which is what makes this "one flexible API" rather than two).

### 6.1 Content push (Clio → partner)
Triggered internally once the Designer approval flow (B2B-03, not built here) marks a generated content
item approved. Contract only — the trigger itself belongs to B2B-03.

```json
POST {outbound_base_url}/content
Authorization: Bearer {partner-supplied token}

{
  "content_ref": "c5e2f1a0-...-uuid",     // Clio-minted
  "partner_topic_ref": "string",           // partner's own identifier, echoed back
  "format": "html" | "json",
  "payload": "<the actual content>",
  "version": 1,
  "generated_at": "2026-07-13T18:00:00Z"
}
```
Expected response: `2xx` = stored. Any other response is surfaced synchronously to whatever internal
caller triggered the push (e.g. the Designer's "approve" action) — **never retried via
`webhook_dispatch_log`** (see Section 7's scope boundary on what that table may hold).

### 6.2 Content pull (Clio → partner, at render time)
```
GET {outbound_base_url}/content?content_ref=c5e2f1a0-...   (Clio-generated case)
GET {outbound_base_url}/content?partner_topic_ref=string    (partner-authored case)
Authorization: Bearer {partner-supplied token}
```
Response: same shape as the push body, or `404` (Clio surfaces this to the render layer as "no content
available," a legitimate, handled state — not an error page).

**Zero Clio-side persistence**: the `payload` field is never written to any Clio table in either
direction. It exists only in-memory for the duration of the HTTP request/response cycle that consumes
it.

### 6.3 Profile push / pull (Clio → partner)
Identical shape, keyed by `partner_end_user_ref` instead of `content_ref`/`partner_topic_ref`:
```json
POST {outbound_base_url}/profile
{ "partner_end_user_ref": "string", "profile": { "knowledge": {}, "intellectual": {}, "psychological": {}, "business_lens": {} }, "computed_at": "..." }

GET {outbound_base_url}/profile?partner_end_user_ref=string
→ 200 { ...same shape... }  or  404 (no profile yet — first session, fully legitimate)
```
Only called at all if `partner_accounts.profile_sync_enabled = true`. If `false`, this code path is
never invoked — not called-and-ignored, **never invoked** — this is what makes Objective 1's falsifiable
test ("toggle off ⇒ Clio has no memory of the user") actually verifiable: there is no code path that
could produce cross-session memory when the toggle is off, because the only mechanism that could ever
supply it (this pull call) never executes.

## 7. Usage-Metering & Signed Webhook Mechanism

### 7.1 What triggers an event
Three event types dispatch through this mechanism — two billable, matching the CEO brief's "What
Success Looks Like" item 5 exactly, plus one non-billable lifecycle event:
- `usage.voice_minute` — emitted by whatever existing code marks a partner session's meeting-bot time
  (the natural integration point is the same code path that today calls `deduct_minutes`/writes
  `minutes_ledger` for B2C sessions — for partner sessions, the equivalent write targets
  `webhook_dispatch_log` [+ `usage_events` if F-01 resolves to Resolution A] instead, keyed to
  `partner_sessions.id`, not a Clerk `user_id`).
- `usage.llm_generation_call` — emitted at each topic/content/prerequisite generation call, with a
  `generation_type` field distinguishing which.
- `session.completed` — **not billable**, `quantity`/`unit`/`generation_type` are `null`/irrelevant on
  this event type. Fired once when `partner_sessions.status` transitions to `completed`, so a partner
  can close out their own session record (e.g. mark it done on their dashboard) without having to poll
  `GET /api/partner/v1/sessions/:ref`. Included because it is zero marginal cost on top of the
  voice-minute dispatch that already fires at session end, and closes an obvious partner-side polling
  gap — not named explicitly in the Feature Brief's success criteria, so treated as a small in-scope
  convenience rather than a new capability requiring its own justification.

Building the actual call-site instrumentation into the (not-yet-built) B2B-03 Designer generation
pipeline is out of this brief's scope — this brief defines the event contract and delivery mechanism
those future call sites will emit into.

### 7.2 Dispatch flow
```
Billable event occurs
   │
   │ 1. Insert webhook_dispatch_log row (status='pending', payload + payload_hash + HMAC signature computed)
   │    [+ insert usage_events row, if F-01 Resolution A is in effect — Section 8]
   ▼
Inngest function: webhook-dispatcher (new, this brief)
   │
   │ 2. POST {outbound_base_url}/webhooks/usage
   │    Headers: Clio-Signature: t=<unix_ts>,v1=<hmac_hex>
   │            (mirrors Stripe's header format; hex = HMAC-SHA256(signing_secret, `${t}.${raw_body}`))
   │ 3. On 2xx: delivery_status='delivered', delivered_at=now()
   │ 4. On non-2xx or timeout: retry_count++, delivery_status stays 'pending',
   │    next_retry_at = now() + backoff(retry_count)
   │    Backoff schedule: 1m, 5m, 30m, 2h, 6h (5 attempts total)
   │ 5. After 5 failed attempts: delivery_status='exhausted' — surfaced on the future
   │    partner dashboard (B2B-04) as "N undelivered events," recoverable via
   │    GET /api/partner/v1/usage (Section 3.1), which reads independent of delivery_status
   ▼
Partner's /webhooks/usage endpoint
   │ Verifies Clio-Signature the same way Clio's own Stripe/Clerk webhook
   │ handlers verify inbound signatures (HMAC recompute + constant-time
   │ compare + timestamp tolerance window of 5 minutes, rejecting anything
   │ older — replay protection, per the Feature Brief's explicit requirement)
```

### 7.3 Webhook payload — exact shape
```json
{
  "event_id": "uuid",
  "event_type": "usage.voice_minute" | "usage.llm_generation_call" | "session.completed",
  "clio_session_ref": "uuid | null",
  "partner_reference": "string | null",
  "quantity": 1.5 | null,          // null for session.completed (not billable)
  "unit": "minutes" | "calls" | null,
  "generation_type": "topic" | "content" | "prerequisite" | null,
  "occurred_at": "ISO8601",
  "dispatched_at": "ISO8601"
}
```
Notice what is **not** in this payload: no end-user identity, no content, no profile data. This shape is
identical regardless of which way F-01 resolves (see Section 8) — the fork, if any, is entirely
internal to how Clio computes/stores its own read-side numbers, never in what the partner receives.

### 7.4 What must never be logged
`webhook_dispatch_log.payload` is constrained (by the event_type CHECK constraint and by convention) to
the shape in 7.3 only. The content-push/pull and profile-push/pull calls (Section 6) are **never**
written to `webhook_dispatch_log` or any other table — they are synchronous, ephemeral, and their
failure is surfaced directly to the calling code path, not queued for retry via this log. This is a
deliberate boundary, not an oversight: allowing content/profile bodies into an audit-log table would
create exactly the kind of Clio-side persistence Objective 6 and the Non-Negotiable Data Boundary
prohibit.

## 8. F-01 Handling — Two Branches, Neither Blocking This Brief

Per the CEO brief's explicit instruction, this brief does not resolve F-01 (does Clio keep its own
opaque-reference usage ledger, or compute billing/dashboard numbers live via round-trips to partner
APIs). Both branches are spec'd concretely enough for B2B-04 to pick either without reopening this
document:

**Resolution A — opaque-reference ledger.** `usage_events` (migration
`072_b2b02_usage_events_resolution_a.sql`) is inserted alongside every `webhook_dispatch_log` write.
B2B-04's admin page and partner dashboard `SUM(quantity) ... GROUP BY partner_account_id, event_type`
over this table, filtering `test_mode = FALSE`.

**Resolution B — zero storage, live round-trip.** Migration 072 is never applied. B2B-04's dashboards
either (a) call back into the partner's own API for numbers the partner already tracks, or (b) compute
aggregates at read time directly from `webhook_dispatch_log.payload` (a `GROUP BY` over JSONB fields —
more expensive per query, no separate table, still zero *additional* Clio-side storage beyond the
F-01-independent dispatch log that exists regardless).

**Finding on whether the partner-facing contract forks**: it does not. Section 7.3's webhook payload
shape, the `/api/partner/v1/usage` read endpoint's response shape, and every partner-facing route in
Section 3 are byte-for-byte identical under either resolution. The only thing that changes is the SQL
`GET /api/partner/v1/usage` runs internally to answer the query. This confirms the CEO brief's own
working belief (not certain, but correct) — no escalation triggered.

## 9. Sub-Tenant Delegation — Confirmed: No New Identity Concept, With One Named Exception

Per `CORE_OBJECTIVES.md` and the CEO brief's working conclusion: Clio never stores a sub-tenant table,
never issues sub-tenant-scoped API keys, and never resolves `partner_reference` to any real identity.
The base case holds cleanly: because the top-level partner (Capgemini) is the one who calls
`/api/partner/v1/sessions` on Hartford's behalf (Hartford's employees never touch Clio directly),
Capgemini already receives `clio_session_ref` synchronously in the initiation response and can maintain
its own `{clio_session_ref: hartford_employee_id}` mapping entirely on its own side — Clio does not need
to store or understand anything about Hartford for this to work.

**The one case where a bare opaque reference isn't quite enough, exactly as the CEO brief anticipated**:
without any passthrough field at all, Capgemini's only correlation key on incoming usage webhooks is
`clio_session_ref` — meaning every webhook consumer on Capgemini's side has to already know, from its
own records, which session belongs to which sub-tenant. That's *workable* but pushes 100% of the
correlation burden onto Capgemini maintaining a perfect session-ref-to-sub-tenant map with no
convenience from Clio's side. `partner_reference` (present on `partner_sessions`,
`webhook_dispatch_log`, and `usage_events`) closes that gap as a pure convenience: Capgemini may
optionally pass an opaque tag (e.g. `"hartford"`, or their own internal sub-tenant ID) at
session-initiation time, and Clio echoes it verbatim on every subsequent usage webhook for that session
— without Clio ever interpreting, indexing meaningfully, validating the format of, or exposing it to
any Clio-side UI beyond raw pass-through storage. This does not introduce a new identity concept (Clio
still sees only a rollup line per top-level `partner_account_id` in every aggregate query in Section 8)
— it is a convenience field, not a schema change to how Clio thinks about tenancy.

## 10. Rate Limiting & Key Rotation (technical judgment calls, per Feature Brief delegation)

**Rate limiting** (per `partner_account_id`, token-bucket, technical decision within BA authority):
- `POST /api/partner/v1/sessions`: 60 requests/min (guards against a runaway partner-side loop spinning
  up bot sessions)
- `GET /api/partner/v1/sessions/:ref`, `GET /api/partner/v1/usage`: 300 requests/min
- `429` response includes `Retry-After` header. Limits are a hardcoded default in this brief (a column
  on `partner_accounts` for per-partner override is a natural extension point for B2B-04's enterprise
  tiers, not built here — noted as a future column, not added speculatively now).

**Key rotation/revocation UX** (technical decision within BA authority):
- A partner account may have any number of `active` keys per `mode` simultaneously — generating a new
  key does not invalidate existing ones. This enables zero-downtime rotation: generate new, migrate
  traffic, then revoke old.
- Revocation (`DELETE /api/admin/partner-keys/:id`, Clerk-authenticated) is immediate and
  uncached — every `/api/partner/v1/*` request does a direct `key_hash` lookup against
  `partner_api_keys.status = 'active'` (no revocation-propagation delay to reason about, at the cost of
  one indexed lookup per request, which is cheap and matches the existing lookup-per-request pattern
  used elsewhere in this codebase, e.g. Clerk session validation).
- No automatic expiry — keys remain valid until explicitly revoked. Automatic expiry policies (e.g.
  "unused keys auto-revoke after 90 days") are a reasonable future enhancement, not built here (not
  named in the Feature Brief's success criteria).

## 11. Meeting-Bot Vendor Abstraction — Respected, Not Bypassed

`getMeetingBotProvider()` (`lib/meeting-bot/provider.ts`) is called as-is from the new
`/api/partner/v1/sessions` route, exactly as it's called today from `inngest/session-meeting-setup.ts`
and `app/api/admin/test-session/route.ts`. Verified against the actual provider implementations
(`lib/meeting-bot/attendee.ts`, `lib/meeting-bot/recall.ts`): the `userId` parameter of `createBot()` is
used only as opaque bot metadata/a deduplication-key seed, never as an enforced Clerk-identity check —
confirming it is safe to pass `clio_session_ref` in that parameter's place without any change to
`MeetingBotProvider`'s interface. No response from `/api/partner/v1/sessions` ever includes
`provider_bot_id` or `provider_name` — the partner-facing contract has zero vendor-identifying surface,
satisfying the constraint that the Recall→Attendee migration (V-02, still mid-flight per
`docs/b2b-pivot-status.md`) must not leak through this brief's API.

---

## 12. B2B-03 — Designer/Configurator (new)

Version: 1.0 | Produced by: Business Analyst Agent, as part of B2B-03
Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-03-designer-configurator.md`
Requirement Document: `docs/specs/B2B-03-requirement-document.md`

Extends Sections 1–11 above (B2B-02), does not replace them. Requirement-level rationale lives in the
Requirement Document; this section is the exact schema/route/sequence detail a developer implements
against, per the same division of labor B2B-02 established.

### 12.1 New Tables (all partner-scoped from creation — see Requirement Document Section 6.4 for the
isolation mechanism these tables share)

```sql
-- Questionnaire authoring (definition only — submissions are never persisted, see 12.3)
CREATE TABLE IF NOT EXISTS partner_questionnaires (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  layout              TEXT NOT NULL DEFAULT 'single_page' CHECK (layout IN ('single_page', 'multi_page')),
  schema              JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{id, text, type, options?, required}]
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_partner_questionnaires_account ON partner_questionnaires(partner_account_id);
-- Enforced in application code, not a DB constraint (requires a transactional "set target published,
-- set siblings back to draft" write, not expressible as a single-column unique-partial-index without
-- a race window): at most one 'published' row per partner_account_id.

-- Thin audit-only log for questionnaire submission delivery — deliberately NO payload column.
CREATE TABLE IF NOT EXISTS questionnaire_dispatch_log (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_status     TEXT NOT NULL CHECK (delivery_status IN ('delivered', 'failed')),
  http_status_code    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_questionnaire_dispatch_log_account ON questionnaire_dispatch_log(partner_account_id, submitted_at DESC);

-- Topics/prerequisites source toggles (two independent columns, per Requirement Doc Section 6.2)
CREATE TABLE IF NOT EXISTS partner_topic_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id    UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,
  topics_source         TEXT NOT NULL DEFAULT 'clio_generated' CHECK (topics_source IN ('clio_generated', 'partner_supplied')),
  prerequisites_source  TEXT NOT NULL DEFAULT 'clio_generated' CHECK (prerequisites_source IN ('clio_generated', 'partner_supplied')),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Content generation staging — transient, never a permanent content store (see 12.3 / draft_payload lifecycle)
CREATE TABLE IF NOT EXISTS partner_content_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  partner_topic_ref   TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'generating'
                        CHECK (status IN ('generating', 'ready_for_review', 'approved', 'rejected', 'failed')),
  draft_payload       JSONB,               -- NULL once approved/rejected/discarded — see lifecycle note
  content_ref         UUID,                -- minted on approval; becomes the pushed content_ref
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_partner_content_items_account ON partner_content_items(partner_account_id, status);
CREATE INDEX IF NOT EXISTS idx_partner_content_items_expiry ON partner_content_items(expires_at);

-- Visualization Level A — Application/product
CREATE TABLE IF NOT EXISTS partner_theme_config (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id      UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,
  theme_label             TEXT,
  primary_color           TEXT NOT NULL DEFAULT '#7C3AED' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color         TEXT NOT NULL DEFAULT '#06B6D4' CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color            TEXT NOT NULL DEFAULT '#F59E0B' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  font_family             TEXT NOT NULL DEFAULT 'Inter'
                            CHECK (font_family IN ('Inter', 'Roboto', 'Source Sans Pro', 'IBM Plex Sans', 'system-ui')),
  corner_style            TEXT NOT NULL DEFAULT 'soft' CHECK (corner_style IN ('sharp', 'soft', 'rounded')),
  spacing_scale           TEXT NOT NULL DEFAULT 'standard' CHECK (spacing_scale IN ('compact', 'standard', 'spacious')),
  assistant_display_name  TEXT, -- NULL => "your AI guide" fallback in the Hume system prompt; never "Clio"
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Visualization Level B — Template (only for already-approved template_library rows, see 12.4)
CREATE TABLE IF NOT EXISTS partner_template_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id    UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  template_name         TEXT NOT NULL REFERENCES template_library(template_name),
  title_override        TEXT,
  show_so_what_footer   BOOLEAN NOT NULL DEFAULT TRUE,
  motion_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  color_variant         TEXT NOT NULL DEFAULT 'default' CHECK (color_variant IN ('default', 'lighter', 'darker')),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_account_id, template_name)
);

-- Visualization Level C — Component/container
CREATE TABLE IF NOT EXISTS partner_component_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id    UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  template_name         TEXT NOT NULL REFERENCES template_library(template_name),
  component_slot        TEXT NOT NULL, -- e.g. 'cell', 'legend', 'connector', 'callout_card' — see 12.5
  style_mode            TEXT NOT NULL DEFAULT 'fill' CHECK (style_mode IN ('fill', 'outline', 'neon')),
  motion                TEXT NOT NULL DEFAULT 'none' CHECK (motion IN ('none', 'fade', 'stagger', 'slide')),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_account_id, template_name, component_slot)
);

-- Preference meter (Requirement Doc Section 6.5)
CREATE TABLE IF NOT EXISTS partner_design_preference (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,
  score               INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  domains_touched     JSONB NOT NULL DEFAULT '[]'::jsonb, -- subset of ['color','font','spacing','motion']
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wholly-new partner-authored template types (Requirement Doc Section 6.4, Section 11 Q1 resolution,
-- CEO Agent decision 2026-07-13). Partner-scoped state, distinct from and never joined to
-- template_library — RTV-04's global gate is untouched by this table's existence.
CREATE TABLE IF NOT EXISTS partner_custom_templates (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  template_label      TEXT NOT NULL,
  skeleton_schema     JSONB NOT NULL, -- structural definition only; enforced at write-time (app layer) to
                                       -- contain only typed/enum/regex-validated primitives — no raw
                                       -- CSS, HTML/markup, or executable code, ever
  status              TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'live')),
  source              TEXT NOT NULL CHECK (source IN ('free_text_generated', 'skeleton_generated')),
  confirmed_at        TIMESTAMPTZ, -- set the moment the partner-admin clicks [Confirm & make live]
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_account_id, template_label)
);
CREATE INDEX IF NOT EXISTS idx_partner_custom_templates_account ON partner_custom_templates(partner_account_id, status);
-- Only status='live' rows are ever eligible for selectTemplate()/render — enforced in application code
-- at the render-path query, not by a DB trigger (matches this document's existing app-layer-isolation
-- precedent, Requirement Doc Section 6.4).

-- Extend usage_events for the 3 new billable Designer AI actions (Requirement Doc Section 6.5) plus the
-- 1 new billable net-new-template-generation action (Requirement Doc Section 6.4, Section 11 Q1 resolution)
ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_event_type_check;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_event_type_check
  CHECK (event_type IN (
    'voice_minute', 'llm_generation_topic', 'llm_generation_content', 'llm_generation_prerequisite',
    'llm_generation_skeleton', 'llm_generation_discovery', 'llm_generation_sample_fill',
    'llm_generation_new_template'
  ));

-- Every table above: RLS enabled, service-role-only policy, identical to every B2B-02 table.
ALTER TABLE partner_questionnaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaire_dispatch_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_topic_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_theme_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_template_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_component_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_design_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_custom_templates ENABLE ROW LEVEL SECURITY;
-- (one "Service role full access" policy per table, identical pattern to migration 071 — omitted here
-- for brevity, not omitted in the actual migration file)
```

### 12.2 API Route Map (Clerk-authenticated, `/api/admin/configurator/*` — added to `middleware.ts`'s
protected set alongside the existing `/api/admin/partner-keys*`)

| Method | Route | Purpose |
|---|---|---|
| GET/PATCH | `/api/admin/configurator/questionnaire` | List/create/edit draft questionnaires; `POST .../publish` enforces single-published invariant |
| GET/PATCH | `/api/admin/configurator/topics-config` | Read/update `partner_topic_config`'s two toggles |
| GET/PATCH | `/api/admin/configurator/content-config` | Read/update content-source toggle |
| POST | `/api/admin/configurator/content/generate` | Trigger `generatePartnerContent(partnerAccountId, partnerTopicRef)` |
| GET | `/api/admin/configurator/content/:id` | Poll a `partner_content_items` row's status |
| POST | `/api/admin/configurator/content/:id/approve` | Push via `pushPartnerContent()`, mint `content_ref`, null `draft_payload` |
| POST | `/api/admin/configurator/content/:id/reject` | Null `draft_payload`, set `status='rejected'` |
| GET/PATCH | `/api/admin/configurator/theme` | Level A read/write |
| GET | `/api/admin/configurator/templates` | List `template_library` rows with `status='approved'`, joined with this partner's `partner_template_config` |
| GET/PATCH | `/api/admin/configurator/templates/:templateName` | Level B read/write; `409 template_not_approved` if not RTV-04-approved |
| GET/PATCH | `/api/admin/configurator/templates/:templateName/components/:slot` | Level C read/write |
| POST | `/api/admin/configurator/templates/:templateName/sample-fill` | Ephemeral AI preview fill, fires `usage_events` |
| POST | `/api/admin/configurator/templates/discover` | Free-text matching (Requirement Doc Section 6.5's scoring function) |
| POST | `/api/admin/configurator/templates/generate-new` | Net-new skeleton generation (Requirement Doc Section 6.4, Section 11 Q1); validates output against the schema-safety boundary before persisting; on success inserts `partner_custom_templates` (`status='pending_review'`) and fires `usage_events` (`llm_generation_new_template`); on safety-validation failure, persists nothing and fires no `usage_events` row |
| POST | `/api/admin/configurator/templates/custom/:id/confirm` | Partner-admin's explicit `[Confirm & make live]` click; sets `status='live'`, `confirmed_at=now()`; no Clio-side check |
| GET | `/api/admin/configurator/preference-meter` | Read `partner_design_preference` |

Every route above takes `partner_account_id` explicitly (body for POST/PATCH, query param for GET) and
calls `requirePartnerAdmin(partnerAccountId)` (`lib/partner/auth.ts`, unmodified) before any DB access —
per the Requirement Document's Section 6.4 isolation mechanism.

**Public, no auth:**

| Method | Route | Purpose |
|---|---|---|
| GET | `/partner-questionnaire/[partner_account_id]` | Renders the partner's `published` questionnaire |
| POST | `/partner-questionnaire/[partner_account_id]/submit` | Forwards synchronously to `{outbound_base_url}/questionnaire-response`, never persisted (12.3) |
| GET | `/partner-render/[clio_session_ref]` | Replaces the B2B-02 placeholder — full sequence in 12.6 |

### 12.3 Questionnaire Submission — Synchronous Forward, Never Persisted

```
End user submits → POST /partner-questionnaire/[partner_account_id]/submit
  → POST {outbound_base_url}/questionnaire-response (partner token, same auth as /content)
  → 2xx: INSERT questionnaire_dispatch_log (delivered, http_status_code) → 200 to end user (Screen state 3)
  → non-2xx/timeout: INSERT questionnaire_dispatch_log (failed, http_status_code) → error to end user (Screen state 4)
```
The answer payload itself exists only in the request body of the outbound call — never written to any
Clio table, matching architecture.md Section 6.2's "zero Clio-side persistence" discipline for content,
extended here to questionnaire submissions for the same reason.

### 12.4 `partner_content_items.draft_payload` Lifecycle

```
generatePartnerContent() called → INSERT partner_content_items (status='generating', draft_payload=NULL)
  → pipeline completes → UPDATE draft_payload = {...}, status = 'ready_for_review'
  → partner reviews (Configurator Screen state 3) →
      [Approve] → pushPartnerContent() → 2xx → UPDATE content_ref = <minted>, draft_payload = NULL, status = 'approved'
      [Reject]  → UPDATE draft_payload = NULL, status = 'rejected'
  → Inngest cron (daily): DELETE FROM partner_content_items WHERE expires_at < now() AND status NOT IN ('approved') 
    -- approved rows keep their (already-NULL-payload) row as a lightweight historical index only
```

### 12.5 Component Slot Sets Per Template (Level C)

Derived directly from each template's existing `*Data` interface in `lib/templates/types.ts`, the same
method RTV-04 used to describe all 23 pre-existing templates against their confirmed schemas. Non-exhaustive
examples (full list generated programmatically from the type definitions at build time, not hand-maintained):
`Heatmap` → `cell`, `legend`; `Overlay` → `zone_marker`, `connector`, `callout_card`; `ComparisonTable` →
`row`, `column_header`, `cell`; `Flowchart`/`HorizontalDecision` → `node`, `edge`; `StepFlow`/
`ChevronProcess` → `step_card`, `connector`; every template with a `so_what` field also gets an implicit
`footer` slot (maps to `show_so_what_footer` at Level B, not a separate Level C slot, since it is a
boolean toggle, not a styleable component).

### 12.6 Live-Session Render Path — Full Sequence

```
Meeting-bot headless browser loads /partner-render/[clio_session_ref]
  │
  │ 1. SELECT * FROM partner_sessions WHERE id = clio_session_ref (existing logic, unchanged)
  │ 2. pullPartnerContent(partnerAccountId, {contentRef, partnerTopicRef}) [existing, tested]
  │ 3. IF profile_sync_enabled: pullPartnerProfile(partnerAccountId, partnerEndUserRef) [existing, tested]
  │ 4. FOR EACH content section: resolvePartnerTheme(partnerAccountId, templateName) [new]
  │      → merges partner_theme_config (Level A, always) + partner_template_config (Level B, if row exists)
  │        + partner_component_config (Level C, if rows exist) → CSS custom properties, Clio defaults as
  │        the `var(--x, default)` fallback for any unset level
  │ 5. selectTemplate(subtopicTitle, position, templateHint) [existing, pure, unmodified] → templateName
  │ 6. <TemplateRenderer> [existing component] wrapped in <style>{cssCustomProperties}</style>
  │ 7. buildHumeNativeConfig() [lib/voice/hume-native/config-provisioner.ts + prompt-template.ts, reused]
  │      injects: pulled content's coaching_narrative/script segments, pulled profile (if available),
  │      partner_theme_config.assistant_display_name ?? "your AI guide" in place of "Clio"
  │ 8. Session proceeds (existing Hume-native runtime, reused as-is)
  │ 9. On end: UPDATE partner_sessions SET status='completed', ended_at=now() [new call site, this brief]
  │      → fires usage.voice_minute + session.completed via the existing B2B-02 webhook-dispatcher
  ▼
End user sees a fully white-labeled, partner-themed session with zero Clio branding
```

**Known gap, flagged not assumed**: step 5's `selectTemplate()` currently resolves only against
`template_library` (RTV-04-approved base templates). The Section 11 Q1 resolution establishes that a
`partner_custom_templates` row with `status='live'` must be eligible to render (Requirement Doc Section
7's acceptance test), but does not specify *how* a live custom template enters `selectTemplate()`'s
candidate pool for a given content section — that integration (e.g. an extra lookup keyed on
`partner_account_id` before or alongside the `template_library` hint match) is real design work this
resolution did not cover and this document does not invent. Needs a short follow-up design pass before
`generate-new`/`confirm` are wired to an actual live render, not before the Configurator-side
generate → preview → confirm flow itself (which is fully specified and does not depend on this).

---

## 13. B2B-04 — Billing / Metering (new)

Version: 1.0 | Produced by: Business Analyst Agent, as part of B2B-04
Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-04-billing-metering.md`
Requirement Document: `docs/specs/B2B-04-requirement-document.md`
Migration: `supabase/migrations/075_b2b04_billing_metering.sql`

Extends Sections 1–12 above, does not replace them. Rationale for every decision below lives in the
Requirement Document (especially its Section 6, "Data Requirements") — this section is the exact
schema/RPC/route detail a developer implements against.

### 13.1 New Tables

```sql
-- One wallet per top-level partner account. Balance is USD dollars (NUMERIC(14,6)), not a credit-unit
-- abstraction — see Requirement Doc Section 6's denomination rationale.
CREATE TABLE IF NOT EXISTS partner_wallets (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id              UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,
  balance_usd                     NUMERIC(14,6) NOT NULL DEFAULT 0,  -- may go negative, see 13.4/Requirement Doc Section 9
  tier                            TEXT NOT NULL DEFAULT 'self_serve'
                                     CHECK (tier IN ('self_serve', 'mid_market', 'enterprise')),
  funding_mechanism               TEXT CHECK (funding_mechanism IN ('checkout_topup', 'subscription_auto_recharge', 'invoicing')),
  monthly_minimum_usd             NUMERIC(12,2),   -- mid-market only
  stripe_customer_id              TEXT,
  stripe_subscription_id          TEXT,            -- mid-market auto-recharge subscription only
  stripe_default_payment_method_id TEXT,
  payment_method_card_brand       TEXT,
  payment_method_card_last4       TEXT,
  payment_method_type             TEXT CHECK (payment_method_type IN ('card', 'us_bank_account')),
  next_billing_date               TIMESTAMPTZ,     -- cached from Stripe subscription/invoice objects, never live-fetched per page load
  reference_topup_amount_usd      NUMERIC(14,6),   -- amount of the most recent top-up; denominator for the 80%-consumed threshold
  low_balance_alert_fired_at      TIMESTAMPTZ,     -- NULL = armed; set = already fired for the current depletion cycle
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_partner_wallets_updated_at
  BEFORE UPDATE ON partner_wallets
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_wallets"
  ON partner_wallets FOR ALL
  USING (auth.role() = 'service_role');

-- Versioned burn rates, keyed by event_type (superset of "voice-minutes" / "LLM-generation-calls" —
-- one row per usage_events.event_type value). partner_account_id NULL = platform default;
-- non-null = a negotiated per-account override (mid-market/enterprise discount), per Requirement Doc
-- Section 6. Never mutated in place — effective_to closes a row, a new row opens the next rate.
CREATE TABLE IF NOT EXISTS billing_rate_versions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID REFERENCES partner_accounts(id) ON DELETE CASCADE,  -- NULL = platform default
  event_type          TEXT NOT NULL
                        CHECK (event_type IN (
                          'voice_minute', 'llm_generation_topic', 'llm_generation_content',
                          'llm_generation_prerequisite', 'llm_generation_skeleton',
                          'llm_generation_discovery', 'llm_generation_sample_fill',
                          'llm_generation_new_template'
                        )),
  unit                TEXT NOT NULL CHECK (unit IN ('minute', 'call')),
  rate_usd             NUMERIC(14,8) NOT NULL CHECK (rate_usd >= 0),
  rate_basis           TEXT NOT NULL,  -- e.g. 'cogs_placeholder_2026_05_no_margin' — always explicitly labeled, never presented as final pricing
  effective_from        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to          TIMESTAMPTZ,   -- NULL = currently in effect
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_rate_versions_lookup
  ON billing_rate_versions(event_type, effective_from DESC);

-- At most one open-ended (effective_to IS NULL) row per (partner_account_id, event_type) pair,
-- including the platform-default (NULL partner_account_id) case — COALESCE gives NULL a stable sentinel
-- so the uniqueness constraint applies to the default rows too, not just partner-specific overrides.
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_rate_versions_open_unique
  ON billing_rate_versions(COALESCE(partner_account_id, '00000000-0000-0000-0000-000000000000'::uuid), event_type)
  WHERE effective_to IS NULL;

ALTER TABLE billing_rate_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on billing_rate_versions"
  ON billing_rate_versions FOR ALL
  USING (auth.role() = 'service_role');

-- Append-only wallet balance audit trail — mirrors minutes_ledger's established BILLING-LEDGER-01
-- pattern (lib/session-billing.ts) exactly: never recompute a balance independently of what the
-- atomic RPC returned, always write resulting_balance_usd from that same call.
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id       UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  entry_type               TEXT NOT NULL
                             CHECK (entry_type IN (
                               'topup_checkout', 'topup_subscription_recharge', 'topup_invoice',
                               'usage_decrement', 'manual_adjustment'
                             )),
  delta_usd                 NUMERIC(14,6) NOT NULL,   -- signed: +N credit, -N decrement
  resulting_balance_usd      NUMERIC(14,6) NOT NULL,
  usage_events_id            UUID REFERENCES usage_events(id) ON DELETE SET NULL,           -- set for usage_decrement rows
  billing_rate_version_id     UUID REFERENCES billing_rate_versions(id) ON DELETE SET NULL,  -- rate cited, for usage_decrement rows
  stripe_object_id            TEXT,                     -- Checkout Session / Invoice id, for topup_* rows
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_account_time
  ON wallet_ledger(partner_account_id, created_at DESC);

-- Idempotency for Stripe-triggered top-ups: a webhook redelivery for the same Stripe object must
-- never double-credit. NULL stripe_object_id (not currently used, but future-proofed) is excluded
-- from the constraint by the partial WHERE.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_stripe_idempotency
  ON wallet_ledger(stripe_object_id, entry_type)
  WHERE stripe_object_id IS NOT NULL;

ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on wallet_ledger"
  ON wallet_ledger FOR ALL
  USING (auth.role() = 'service_role');
-- No UPDATE/DELETE policy for any role — append-only, matching minutes_ledger/webhook_dispatch_log.

-- ── usage_events extensions (additive ALTERs only, no existing column touched) ──────────────────────
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(14,6);
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS billing_rate_version_id UUID REFERENCES billing_rate_versions(id) ON DELETE SET NULL;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS billed BOOLEAN NOT NULL DEFAULT FALSE;

-- Idempotency close (Requirement Doc Section 1/6/7 — the real gap this brief closes): paired with the
-- lib/partner/webhooks.ts code fix (13.3 below), this guarantees at most one usage_events row per
-- genuinely-new webhook_dispatch_log row, inheriting that table's own existing idempotent unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_dispatch_log_unique
  ON usage_events(webhook_dispatch_log_id)
  WHERE webhook_dispatch_log_id IS NOT NULL;

-- ── RPCs (mirror lib/session-billing.ts's deduct_minutes/add_minutes atomic-update-returning pattern) ─
CREATE OR REPLACE FUNCTION credit_wallet_balance(p_partner_account_id UUID, p_amount_usd NUMERIC)
RETURNS NUMERIC AS $$
DECLARE new_balance NUMERIC;
BEGIN
  INSERT INTO partner_wallets (partner_account_id, balance_usd)
    VALUES (p_partner_account_id, p_amount_usd)
    ON CONFLICT (partner_account_id)
    DO UPDATE SET balance_usd = partner_wallets.balance_usd + p_amount_usd, updated_at = NOW()
    RETURNING balance_usd INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_wallet_balance(p_partner_account_id UUID, p_amount_usd NUMERIC)
RETURNS NUMERIC AS $$
DECLARE new_balance NUMERIC;
BEGIN
  INSERT INTO partner_wallets (partner_account_id, balance_usd)
    VALUES (p_partner_account_id, -p_amount_usd)
    ON CONFLICT (partner_account_id)
    DO UPDATE SET balance_usd = partner_wallets.balance_usd - p_amount_usd, updated_at = NOW()
    RETURNING balance_usd INTO new_balance;
  RETURN new_balance;  -- deliberately NOT clamped at 0 — see Requirement Doc Section 9
END;
$$ LANGUAGE plpgsql;

-- ── Seed data: the one placeholder rate genuinely on record (Requirement Doc Section 6) ─────────────
INSERT INTO billing_rate_versions (partner_account_id, event_type, unit, rate_usd, rate_basis, effective_from)
VALUES (NULL, 'voice_minute', 'minute', 0.01500000, 'cogs_placeholder_2026_05_no_margin', NOW())
ON CONFLICT DO NOTHING;
-- Deliberately no seed rows for the 7 llm_generation_* event types — no stale figure exists on record
-- for them (Requirement Doc Section 6). usage_events.billed stays FALSE for these until F-02's research
-- pass produces a real number and a row is inserted for that event_type.

COMMENT ON TABLE partner_wallets IS 'B2B-04: one unified prepaid credit wallet per top-level partner_account_id, USD-denominated. May go negative — see docs/specs/B2B-04-requirement-document.md Section 9.';
COMMENT ON TABLE billing_rate_versions IS 'B2B-04: versioned, event_type-keyed burn rates. Never mutated in place — a rate change closes the old row (effective_to) and opens a new one, so historical usage_events rows always cite the rate genuinely in effect at occurred_at.';
COMMENT ON TABLE wallet_ledger IS 'B2B-04: append-only wallet balance audit trail, mirrors minutes_ledger. Idempotent on (stripe_object_id, entry_type) for topup rows.';
```

### 13.2 API Route Map

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/admin/billing/clients` | Clerk (matches `/dashboard/admin/templates`'s boundary) | Backs the `/dashboard/admin/clients` screen — cross-partner billing/health rollup. |
| GET | `/dashboard/admin/clients` | Clerk | The one real UI screen this brief builds. |
| POST | `/api/admin/billing/checkout` | Clerk, `requirePartnerAdmin` | Self-serve wallet top-up — Stripe Checkout, `mode: "payment"`. |
| POST | `/api/admin/billing/subscription` | Clerk, `requirePartnerAdmin` | Mid-market auto-recharge — Stripe Checkout, `mode: "subscription"`. |
| POST | `/api/admin/billing/invoice` | Clerk, internal-operator (same boundary as `/api/admin/billing/clients`) | Enterprise invoicing — Stripe Invoicing. |
| GET | `/api/partner/v1/wallet` | Partner API key, `requirePartnerApiKey(..., 'reads')` | New sibling to `GET /api/partner/v1/usage` — balance/burn-rate/days-remaining, own data only. |
| POST | `/api/webhooks/stripe` | Stripe signature (`constructWebhookEvent`, reused unmodified) | Reworked (not extended) — see 13.3. Handles `checkout.session.completed` (topup), `invoice.paid` (mid-market recharge), `invoice.payment_succeeded` (enterprise), `customer.updated`/`payment_method.attached` (payment-method cache sync). |

Every `/api/admin/billing/*` route lives under the existing internal `/api/admin/*` convention already
protected by `middleware.ts`'s Clerk gate — no `middleware.ts` change needed beyond confirming these new
paths fall under the existing non-public catch-all (they do; only explicitly-listed routes are public).

### 13.3 `lib/partner/webhooks.ts` — Exact Fix

`recordBillableEvent()`'s `webhook_dispatch_log` upsert already uses
`{ onConflict: 'partner_account_id,event_type,clio_session_ref,payload_hash', ignoreDuplicates: true }`
and reads the result via `.select('id').maybeSingle()` — on a duplicate-ignored conflict, `inserted` is
`null`. Today, the subsequent `usage_events` insert runs regardless of whether `inserted` is `null`. The
fix: guard that entire block (and the wallet-decrement call this brief adds after it) behind
`if (inserted?.id) { ... }` — on a duplicate (`inserted` is `null`), skip both the `usage_events` insert
and `applyWalletDecrement()` entirely, and return the **existing** dispatch-log row's id (a lookup by the
same conflict key) rather than an empty string, so the function's return contract stays meaningful on a
duplicate call.

New function, same file: `applyWalletDecrement(usageEventId, partnerAccountId, eventType, quantity,
occurredAt, testMode)` — implements the exact sequence in Requirement Doc Section 5.B.1. Called from
`recordBillableEvent()` immediately after a genuinely-new `usage_events` insert succeeds (for billable
`eventType`s only, never `session.completed`).

### 13.4 `lib/stripe.ts` — Rework, Not Extension

Removed (B2C-era, do not survive): `getPlanFromPriceId`, `createCheckoutSession` (flat-plan
subscription), `createSubscriptionIntent` (fixed 3-day-trial flow). **Retained as-is**: `stripeClient`
initialization + `isPlaceholder` guard convention, `constructWebhookEvent` (explicitly named reusable
infrastructure by the Feature Brief), `createPortalSession` (repurposed for partner card-on-file
self-service via the Stripe Customer Portal — its signature already only takes a `customerId`, no B2C
assumption baked in, so it needs no change).

New functions, all following the existing `isPlaceholder`-guarded mock-log pattern:
- `createWalletTopupCheckoutSession(partnerAccountId, amountUsd, successUrl?, cancelUrl?)` — `mode:
  "payment"`, ad-hoc `price_data` line item (no pre-created Stripe Price object needed), `metadata: {
  partner_account_id, purpose: "wallet_topup" }`.
- `createAutoRechargeSubscriptionCheckout(partnerAccountId, monthlyMinimumUsd, successUrl?, cancelUrl?)`
  — `mode: "subscription"`, ad-hoc recurring `price_data` (`recurring: { interval: "month" }`),
  `metadata: { partner_account_id, purpose: "wallet_auto_recharge" }`.
- `createEnterpriseInvoice(partnerAccountId, amountUsd, stripeCustomerId, description,
  collectionMethod)` — `invoiceItems.create` + `invoices.create({ collection_method })` +
  `invoices.finalizeInvoice` + (`collection_method === 'send_invoice'` ? `invoices.sendInvoice` : implicit
  auto-charge), `metadata: { partner_account_id, purpose: "wallet_invoice" }`.
- `getOrCreateStripeCustomer(partnerAccountId, billingEmail?)` — finds an existing
  `partner_wallets.stripe_customer_id` or creates one, `metadata: { partner_account_id }`.

`app/api/webhooks/stripe/route.ts` is reworked to add handling for `checkout.session.completed` (branch
on `session.metadata.purpose`), `invoice.paid`/`invoice.payment_succeeded` (branch on
`invoice.subscription` presence per Requirement Doc 5.B.3 vs 5.B.4), and `customer.updated` /
`payment_method.attached` (sync `payment_method_card_brand`/`last4`/`type` onto `partner_wallets` so the
admin page never needs a live per-row Stripe API call). The existing B2C-era branches
(`customer.subscription.created/updated/deleted` keyed to `users.id`, the old `topup`-metadata `minutes`
branch, Twilio SMS send) are dead code once B2C is retired but are **not** removed as part of this brief
— removing them is a separate cleanup, out of this brief's scope (Requirement Doc Section 10 lists only
this brief's own exclusions; the B2C branches predate this brief and their removal is tracked
separately, not silently done here to avoid conflating two unrelated changes in one migration).

### 13.5 `avg_daily_burn_usd` / `projected_days_remaining` — exact formula

*(Added in Requirement Doc v1.1, closing a CEO-review gap. Computed live, at request time, by
`GET /api/admin/billing/clients` and `GET /api/partner/v1/wallet` — this is a single indexed
aggregate query per partner over `usage_events`, not an external API call, so it does not need the
"cache and never live-fetch" treatment `next_billing_date` gets for Stripe-sourced fields (13.1) —
there is no cache-invalidation problem to solve and live computation is simpler and always current.)*

**Window: trailing 7 complete UTC calendar days, current partial day always excluded.**

```
window_end   = date_trunc('day', NOW())              -- UTC midnight, start of "today"
window_start = window_end - INTERVAL '7 days'
```

Why 7 days, not 30: this number feeds an admin's "is this account about to run dry" judgment, not a
financial report. A 30-day average would smooth over a partner ramping usage sharply in the last few
days — exactly the case where the admin most needs the number to move quickly — and would keep
showing a comfortable `projected_days_remaining` while an account is actually burning through its
balance far faster than the smoothed average suggests. A 1-day window would be too noisy (one unusually
heavy or light day swings the whole number). 7 days catches a real week-over-week trend shift while a
single outlier day still only moves the average by ~1/7th.

Why the current partial day is excluded entirely, not prorated: prorating (`today's spend so far ÷
hours elapsed today × 24`) requires assuming usage accrues at a constant rate through the day, which is
not a safe assumption for this product (voice-minute usage clusters around scheduled sessions, not
evenly across 24 hours) — prorating a partial morning spike is exactly the "$50 in 3 hours ≠ $50/day"
overstatement this formula must not produce. Excluding today entirely means the number is always based
on 7 fully-observed days; it updates once, at UTC midnight, when "today" rolls into the window as a
complete day.

**New-account handling (a wallet with less than 7 complete days of history):**

```
account_start = date_trunc('day', partner_wallets.created_at)
effective_start = GREATEST(window_start, account_start)
days_in_window = (window_end - effective_start) in whole days   -- 0..7
```

If `days_in_window = 0` (wallet created today, no complete day has passed yet), there is no window to
average over at all — treated identically to "no billed usage," below (`no_burn_rate`). This is
correct, not a special case requiring different handling: a day-0 account and a 7-day-old account with
zero usage both mean "not enough signal to project," which is exactly what `no_burn_rate` communicates.

**Aggregation: simple arithmetic mean over calendar days in the window, including zero-usage days.**

```sql
SELECT COALESCE(SUM(amount_usd), 0) AS window_total_usd
FROM usage_events
WHERE partner_account_id = $1
  AND billed = true
  AND occurred_at >= effective_start
  AND occurred_at <  window_end;

avg_daily_burn_usd =
  CASE WHEN days_in_window = 0 OR window_total_usd = 0
       THEN NULL
       ELSE window_total_usd / days_in_window
  END
```

A simple mean, not a weighted or exponentially-decayed one: the window is already short (7 days) and
already excludes the noisiest input (today), so a further weighting scheme would add complexity without
a clear admin-facing benefit — this is a "warn me before it's a problem" number, not a forecasting
model. Divide by `days_in_window` (calendar days elapsed), never by "days that had any usage" — a
partner idle for 4 of the last 7 days genuinely has a lower daily burn rate than one who used the same
total in 3 days, and the average must reflect that, not paper over the idle days.

**`projected_days_remaining` — derived from `avg_daily_burn_usd` and `balance_usd`, with an explicit
null-reason field (closes the sort tie-break gap, Section 13.6):**

```
IF avg_daily_burn_usd IS NULL               -- no complete day in window, or zero billed usage in it
  → projected_days_remaining = NULL
  → days_remaining_null_reason = 'no_burn_rate'
ELSE IF balance_usd <= 0                    -- already exhausted or negative
  → projected_days_remaining = NULL
  → days_remaining_null_reason = 'exhausted_balance'
ELSE
  → projected_days_remaining = balance_usd / avg_daily_burn_usd
  → days_remaining_null_reason = NULL
```

`days_remaining_null_reason` is a new response field (not a DB column — computed at read time
alongside `avg_daily_burn_usd`/`projected_days_remaining`, all three ephemeral, never persisted) on
both `GET /api/admin/billing/clients` (Requirement Doc 4.B.1) and `GET /api/partner/v1/wallet`
(Requirement Doc 4.B.2): `"days_remaining_null_reason": "exhausted_balance" | "no_burn_rate" | null`.
It exists so every consumer of these two endpoints (the admin page today, a future partner-built
dashboard tomorrow per Objective 6) gets an explicit, pre-resolved signal instead of each one
re-deriving "which kind of null is this" from `balance_usd`/`avg_daily_burn_usd` independently and
risking two different, silently inconsistent implementations of the same distinction.

### 13.6 Admin page sort comparator — `days_remaining` column, both directions

*(Added in Requirement Doc v1.1, closing a CEO-review gap.)* The two null cases are not
interchangeable and must never collapse into "sorts as if 0" or "sorts as if last" via a generic
nulls-first/nulls-last rule — `exhausted_balance` is the most urgent state (sorts first ascending),
`no_burn_rate` is the least urgent (sorts last ascending), and a naive `ORDER BY projected_days_remaining
ASC NULLS LAST` would group both null reasons together and lose that distinction entirely.

**Implementation: map every row to a single synthetic numeric sort key, then run one ordinary numeric
sort (ascending or descending) on that key. Both directions reuse the exact same key — there is no
separate "descending" branch of logic to drift out of sync with ascending.**

```ts
function sortKey(row: { projected_days_remaining: number | null; days_remaining_null_reason: 'exhausted_balance' | 'no_burn_rate' | null }): number {
  if (row.days_remaining_null_reason === 'exhausted_balance') return -Infinity;
  if (row.days_remaining_null_reason === 'no_burn_rate') return Infinity;
  return row.projected_days_remaining as number; // finite, real value
}

function sortByDaysRemaining(rows, direction: 'asc' | 'desc') {
  const withKeys = rows.map(r => ({ row: r, key: sortKey(r), name: r.name }));
  withKeys.sort((a, b) => {
    if (a.key !== b.key) return direction === 'asc' ? a.key - b.key : b.key - a.key;
    return a.name.localeCompare(b.name); // deterministic secondary key, same for both directions
  });
  return withKeys.map(w => w.row);
}
```

Why `-Infinity` / `+Infinity` rather than e.g. `-1` / `999999`: an exhausted-balance account is
conceptually "0 or negative days left" — the true minimum of the domain — and a no-burn-rate account is
conceptually "runway of unknown/unbounded length at the current (zero-signal) rate" — the true maximum.
Using signed infinities makes both directions of the *same* comparator produce the semantically correct
order for free: ascending (fewest days left first) naturally yields `exhausted_balance → finite ascending
→ no_burn_rate`; descending (most days left first) naturally yields `no_burn_rate → finite descending →
exhausted_balance`. Clicking the "Days remaining" column header to toggle ascending/descending calls
`sortByDaysRemaining` with the flipped `direction` argument — **it reuses this exact function, not a
separate re-sort path** — so the two null meanings never scramble together regardless of which direction
the admin has toggled to. This is also why a bare `Array.prototype.sort` on the raw
`projected_days_remaining` field (which would coerce both `null`s to the same JS sort behavior) must
never be used directly against this column; `sortKey()` is the only permitted comparator input for it.

Secondary tie-break (`name.localeCompare`, ascending, always — not reversed by `direction`): ties within
the two infinity tiers (e.g. two accounts that both have `exhausted_balance`) need *some* deterministic
order so the table doesn't visibly reshuffle on every re-render; alphabetical by partner name is
arbitrary but stable, which is all that's required here — no product meaning is implied by it.

---

## 14. B2B-05 — Domain / White-label Infrastructure (new)

Version: 1.2 | Produced by: Business Analyst Agent, as part of B2B-05
Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-05-domain-whitelabel-infra.md`
Requirement Document: `docs/specs/B2B-05-requirement-document.md`
v1.2 note: §14.7.5 corrected — the `embedded` prop fix for `QuestionnaireBuilderClient` and
`ContentConfigClient` is two independent per-branch insertions, not one; see §14.7.5 and the Requirement
Document's v1.2 changelog for the full correction and rationale.

Extends Sections 1–13 above, does not replace them. Requirement-level rationale (screen states, exact
copy, acceptance tests) lives in the Requirement Document; this section is the exact schema/route/
middleware detail a developer implements against, per the same division of labor B2B-02/03/04 established.

### 14.1 Environment Variables (new)

```
CLIO_ROOT_DOMAIN=hello-clio.com          # single config value — see Requirement Doc Section 9
VERCEL_API_TOKEN=PLACEHOLDER_VERCEL_API_TOKEN
VERCEL_PROJECT_ID=PLACEHOLDER_VERCEL_PROJECT_ID
VERCEL_TEAM_ID=PLACEHOLDER_VERCEL_TEAM_ID   # optional; only required if the project is team-scoped
```
`CLIO_ROOT_DOMAIN` is server-side only (not `NEXT_PUBLIC_`) — the Configurator screen gets it via
`GET /api/admin/configurator/domain`'s `root_domain` field (Requirement Doc Section 4.B.1), never a
duplicated client-side env var, so there is exactly one source of truth.

### 14.2 Schema (migration, additive ALTER only — no new tables)

```sql
-- B2B-05: subdomain-first + custom-domain white-label infrastructure.
-- Additive only — no existing partner_accounts column is modified or dropped.

ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS subdomain_slug TEXT;
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain_status TEXT NOT NULL DEFAULT 'none'
  CHECK (custom_domain_status IN ('none', 'pending_verification', 'verified', 'failed'));
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain_error TEXT;
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain_verification JSONB;
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain_added_at TIMESTAMPTZ;
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS custom_domain_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_accounts_subdomain_slug
  ON partner_accounts (subdomain_slug) WHERE subdomain_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_accounts_custom_domain
  ON partner_accounts (custom_domain) WHERE custom_domain IS NOT NULL;

COMMENT ON COLUMN partner_accounts.subdomain_slug IS 'B2B-05: lowercase DNS label, unique, resolves {slug}.{CLIO_ROOT_DOMAIN} to this partner.';
COMMENT ON COLUMN partner_accounts.custom_domain IS 'B2B-05: lowercase hostname, unique, registered via Vercel Domains API. NULL until custom_domain_status leaves ''none''.';
```

Both new unique indexes are the mechanism that makes cross-partner domain leakage structurally
impossible (Requirement Doc Section 7's isolation acceptance test) — a second `PATCH`/`POST` attempting
to claim an already-used value fails at the DB layer even if application-level validation were ever
bypassed.

**Reserved subdomain-slug list** (`lib/partner/domain-config.ts`, exact array — not invented ad hoc
per-call, a single exported constant):
```ts
export const RESERVED_SUBDOMAIN_SLUGS = [
  'www', 'api', 'app', 'admin', 'dashboard', 'sign-in', 'sign-up', 'pricing', 'onboarding', 'plan',
  'checkout', 'topics', 'walkthrough', 'partner-render', 'partner-questionnaire', 'questionnaire',
  'mail', 'ftp', 'staging', 'dev', 'test', 'docs', 'status', 'blog', 'cdn', 'static', 'assets',
  'help', 'support', 'clio', 'vercel',
] as const
```

### 14.3 Vercel Domains API — Exact Request/Response Shapes

Called via the official `@vercel/sdk` package (approved for `CLAUDE.md`'s vendor list as part of this
brief — Requirement Doc Section 6), wrapped in `lib/partner/vercel-domains.ts`. Every function in that
file follows `lib/stripe.ts`'s `isPlaceholder` guard convention exactly: if `VERCEL_API_TOKEN` or
`VERCEL_PROJECT_ID` is a `PLACEHOLDER_` value, the function logs `console.log('[MOCK]', ...)` with what it
would have sent, and returns a realistic mock response shape (below) instead of making a network call.

**Add a domain** — `addDomainToProject(domain: string)`
```
Real call:  POST https://api.vercel.com/v10/projects/{VERCEL_PROJECT_ID}/domains
            (Authorization: Bearer {VERCEL_API_TOKEN}, body: { "name": domain })

Success (verified immediately — rare, e.g. domain already correctly pointed):
  { "name": "learning.acme.com", "verified": true }

Success (pending — the common case):
  {
    "name": "learning.acme.com",
    "verified": false,
    "verification": [
      { "type": "CNAME", "domain": "learning.acme.com", "value": "cname.vercel-dns.com", "reason": "CNAME Record" }
    ]
  }

Error (domain already in use elsewhere — Vercel returns 409 with a structured error body):
  409 { "error": { "code": "domain_already_in_use", "message": "Domain is already in use by a different project." } }

Mock response (VERCEL_API_TOKEN placeholder):
  { "name": domain, "verified": false, "verification": [
      { "type": "CNAME", "domain": domain, "value": "cname.vercel-dns.com", "reason": "CNAME Record (mocked — no VERCEL_API_TOKEN configured)" }
  ] }
```
`addDomainToProject()`'s return type is a discriminated union: `{ ok: true, verified: boolean,
verification: VercelVerificationRecord[] | null }` or `{ ok: false, errorMessage: string }` — the calling
route (`POST /api/admin/configurator/domain/custom-domain`) maps `ok: false` to the `422`
`custom_domain_status: 'failed'` response (Requirement Doc Section 4.B.4) using `errorMessage` verbatim
as `custom_domain_error`, never a Clio-rewritten string.

**Check verification status** — `checkDomainVerification(domain: string)`
```
Real call:  GET https://api.vercel.com/v9/projects/{VERCEL_PROJECT_ID}/domains/{domain}/config
            (Authorization: Bearer {VERCEL_API_TOKEN})

Response:   { "verified": true } | { "verified": false, "verification": [ ...same shape as above... ] }

Mock:       { "verified": false, "verification": [ ...same mocked record as above... ] } on first call;
            a mock implementation may optionally flip to { "verified": true } after a fixed number of
            calls purely to make manual/local testing of the "verified" screen state possible without a
            real token — this is a test-convenience detail, not a product behavior, and must never run in
            production (gated the same way every other mock stub in this codebase is: only when the
            underlying credential is a literal PLACEHOLDER_ string).
```

**Remove a domain** — `removeDomainFromProject(domain: string)`
```
Real call:  DELETE https://api.vercel.com/v9/projects/{VERCEL_PROJECT_ID}/domains/{domain}
            (Authorization: Bearer {VERCEL_API_TOKEN})

Response:   200 (removed) or 404 (already not registered) — both treated as success by the caller
            (Requirement Doc Section 5.B.4/8). Any other error is logged, not surfaced to the partner.

Mock:       always returns { ok: true } and logs what it would have called.
```

### 14.4 API Route Map (Clerk-authenticated, `/api/admin/configurator/domain*` — added to
`middleware.ts`'s existing protected set alongside the other `/api/admin/configurator/*` routes; no
change needed there since those routes are already gated by `!isPublicRoute(request)` catching everything
under `/api/admin/*` that isn't explicitly listed as public)

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/admin/configurator/domain` | Read all domain settings for a partner account (Requirement Doc 4.B.1) |
| GET | `/api/admin/configurator/domain/check-slug` | Live slug-availability check (4.B.2) |
| PATCH | `/api/admin/configurator/domain/subdomain` | Claim/change the subdomain slug (4.B.3) |
| POST | `/api/admin/configurator/domain/custom-domain` | Register a custom domain via Vercel (4.B.4) |
| POST | `/api/admin/configurator/domain/custom-domain/recheck` | Poll Vercel for verification status (4.B.5) |
| DELETE | `/api/admin/configurator/domain/custom-domain` | Deregister the custom domain (4.B.6) |

Every route calls `requirePartnerAdmin(partnerAccountId)` (`lib/partner/auth.ts`, unmodified) before any
DB or Vercel access, identical to every existing `/api/admin/configurator/*` route.

**Public, no auth (Host-resolved, not Clerk-gated):**

| Method | Route | Purpose |
|---|---|---|
| (rewrite target) | `/partner-questionnaire/[partner_account_id]` | Unchanged from B2B-03; now also reachable via a resolved Host + `/` or `/questionnaire` rewrite |
| (unchanged) | `/partner-render/[clio_session_ref]` | Unchanged from B2B-03; no new vanity path (Requirement Doc Section 10) |

### 14.5 `middleware.ts` — Exact Extension

The existing file (`isPublicRoute`, `clerkMiddleware` callback, `x-pathname` header injection, `config.matcher`)
is extended, not restructured. New logic is inserted inside the existing exported default callback, before
the existing `auth().protect()` gate, so a resolved tenant request never hits the Clerk redirect:

```ts
import { resolveTenantFromHost } from '@/lib/partner/domain-resolution'

const TENANT_SCOPED_PATTERNS = [
  /^\/$/,
  /^\/questionnaire$/,
  /^\/partner-questionnaire\/.+/,
  /^\/partner-render\/.+/,
]

export default clerkMiddleware(async (auth, request) => {
  const host = (request.headers.get('host') ?? '').toLowerCase().split(':')[0]
  const pathname = request.nextUrl.pathname
  const rootDomain = process.env.CLIO_ROOT_DOMAIN ?? ''

  const isTenantHost =
    rootDomain.length > 0 &&
    host !== rootDomain &&
    (host.endsWith(`.${rootDomain}`) || (await isVerifiedCustomDomain(host)))

  if (isTenantHost) {
    const tenant = await resolveTenantFromHost(host, rootDomain)
    const isTenantScopedPath = TENANT_SCOPED_PATTERNS.some((re) => re.test(pathname))

    if (!tenant || tenant.status !== 'active') {
      return neutralNotFoundResponse() // reuses the existing NeutralMessage copy, Requirement Doc 5.B.5
    }
    if (!isTenantScopedPath) {
      return neutralNotFoundResponse() // /dashboard, /api/admin/*, /sign-in, etc. never resolve on a partner domain
    }
    if (pathname === '/' || pathname === '/questionnaire') {
      const rewritten = request.nextUrl.clone()
      rewritten.pathname = `/partner-questionnaire/${tenant.partnerAccountId}`
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-clio-resolved-partner-account-id', tenant.partnerAccountId)
      requestHeaders.set('x-pathname', rewritten.pathname)
      return NextResponse.rewrite(rewritten, { request: { headers: requestHeaders } })
    }
    // /partner-questionnaire/(.*) or /partner-render/(.*) with the correct id/ref already in the path —
    // pass through unchanged, existing behavior.
  }

  // Existing, completely unmodified from here down:
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  if (!isApiRoute && !isPublicRoute(request)) {
    auth().protect()
  }
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
})
```

`isPublicRoute`'s array gains one new entry: `'/questionnaire'` (exact string, no wildcard) — required so
that a direct, non-tenant-resolved request to `https://{clio's own domain}/questionnaire` (e.g. hitting
the app before `CLIO_ROOT_DOMAIN` is configured, or in local dev) doesn't get redirected to `/sign-in`; on
Clio's own root domain with no resolvable tenant, this path simply falls through to a Next.js 404 (no
`app/questionnaire/page.tsx` exists), which is correct — the clean path is only ever meaningful under a
resolved partner host.

`resolveTenantFromHost(host, rootDomain)` (`lib/partner/domain-resolution.ts`):
```ts
export async function resolveTenantFromHost(
  host: string,
  rootDomain: string
): Promise<{ partnerAccountId: string; status: 'active' | 'suspended' } | null> {
  const supabase = createSupabaseAdminClient()
  if (host.endsWith(`.${rootDomain}`)) {
    const slug = host.slice(0, -(rootDomain.length + 1))
    const { data } = await supabase
      .from('partner_accounts')
      .select('id, status')
      .eq('subdomain_slug', slug)
      .maybeSingle()
    return data ? { partnerAccountId: data.id, status: data.status } : null
  }
  const { data } = await supabase
    .from('partner_accounts')
    .select('id, status')
    .eq('custom_domain', host)
    .eq('custom_domain_status', 'verified')
    .maybeSingle()
  return data ? { partnerAccountId: data.id, status: data.status } : null
}
```
Note: a `custom_domain` row only ever resolves once `custom_domain_status = 'verified'` — a
`pending_verification` domain does not yet route real traffic to the partner (Vercel itself would not yet
have valid SSL/routing for it either, so this is consistent with reality, not an extra restriction Clio
invents).

### 14.6 Sequence — Middleware Edge Runtime Note

`middleware.ts` runs on Vercel's Edge Runtime by default under Next.js 14. `resolveTenantFromHost()`'s
Supabase read must use the existing `createSupabaseAdminClient()` helper (already Edge-compatible,
reused unmodified from every other `lib/partner/*` module) — no new Supabase client variant is introduced
by this document.

### 14.7 Onboarding Wizard (v1.1 amendment — Requirement Doc Section 13)

Companion to Requirement Doc Section 13. Adds one column to `partner_accounts`, one new table
(`partner_onboarding_progress`), three new API routes, and a redirect check added to every existing
Configurator `page.tsx`. Additive only — no existing route, table, or column from §14.1–14.6 is modified.

#### 14.7.1 Schema (migration, additive)

```sql
-- B2B-05 v1.1: onboarding wizard progress + go-live flag. Additive only.

ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- Backfill: every partner_accounts row that exists BEFORE this migration runs is treated as
-- already onboarded. The wizard only ever intercepts accounts created after this ships
-- (Requirement Doc Section 13.3/13.9 — "no impact on existing", the standing project rule).
UPDATE partner_accounts
  SET onboarding_completed_at = COALESCE(onboarding_completed_at, created_at)
  WHERE onboarding_completed_at IS NULL;

CREATE TABLE IF NOT EXISTS partner_onboarding_progress (
  partner_account_id       UUID PRIMARY KEY REFERENCES partner_accounts(id) ON DELETE CASCADE,

  current_step              TEXT NOT NULL DEFAULT 'questionnaire'
                               CHECK (current_step IN
                                 ('questionnaire','topics','content','visualization','domain','payment','go_live')),

  questionnaire_status      TEXT NOT NULL DEFAULT 'pending'
                               CHECK (questionnaire_status IN ('pending','completed','skipped')),
  questionnaire_status_at   TIMESTAMPTZ,

  topics_status             TEXT NOT NULL DEFAULT 'pending'
                               CHECK (topics_status IN ('pending','completed','skipped')),
  topics_status_at          TIMESTAMPTZ,

  content_status            TEXT NOT NULL DEFAULT 'pending'
                               CHECK (content_status IN ('pending','completed','skipped')),
  content_status_at         TIMESTAMPTZ,

  visualization_status      TEXT NOT NULL DEFAULT 'pending'
                               CHECK (visualization_status IN ('pending','completed','skipped')),
  visualization_status_at   TIMESTAMPTZ,

  domain_status             TEXT NOT NULL DEFAULT 'pending'
                               CHECK (domain_status IN ('pending','completed','skipped')),
  domain_status_at          TIMESTAMPTZ,

  payment_status            TEXT NOT NULL DEFAULT 'pending'
                               CHECK (payment_status IN ('pending','completed','skipped')),
  payment_status_at         TIMESTAMPTZ,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_partner_onboarding_progress_updated_at
  BEFORE UPDATE ON partner_onboarding_progress
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on partner_onboarding_progress"
  ON partner_onboarding_progress FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON COLUMN partner_accounts.onboarding_completed_at IS
  'B2B-05 v1.1: set once by POST /api/admin/configurator/wizard/go-live, never cleared. NULL = wizard mode (Requirement Doc Section 13.3).';
COMMENT ON TABLE partner_onboarding_progress IS
  'B2B-05 v1.1: one row per partner_account_id, lazily created on first wizard-progress read. Historical/audit only after go-live (Requirement Doc Section 13.6).';
```

The six `{step}_status`/`{step}_status_at` column pairs read/write via the `steps` object keyed by the same
six step-name strings in every API response below — never a positional array, so a developer never needs to
infer which index maps to which step.

#### 14.7.2 Per-step "complete" condition — exact read path

`POST /api/admin/configurator/wizard/advance` re-validates `action="complete"` server-side using these
existing read paths (no new query logic invented; each already backs an existing `GET` endpoint per §12):

| Step | Query |
|---|---|
| `questionnaire` | `SELECT 1 FROM questionnaires WHERE partner_account_id = $1 AND status = 'published' LIMIT 1` |
| `topics` | Existing `topics-config` row-presence check already used by `GET /api/admin/configurator/topics-config` (§12) |
| `content` | Existing `content-config` row-presence check already used by `GET /api/admin/configurator/content-config` (§12) |
| `visualization` | Existing theme row-presence check already used by `GET /api/admin/configurator/theme` (§12) |
| `domain` | `SELECT subdomain_slug FROM partner_accounts WHERE id = $1` — non-null passes; `custom_domain_status` is never inspected (Requirement Doc 13.5) |
| `payment` | `SELECT funding_mechanism FROM partner_wallets WHERE partner_account_id = $1` — non-null passes |

`action="skip"` never runs any of the above — it unconditionally sets that step's status to `'skipped'`.

#### 14.7.3 API Route Map (new, Clerk-authenticated, added to the existing `/api/admin/configurator/*` protected set — no `middleware.ts` change needed, same reasoning as §14.4)

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/admin/configurator/wizard/progress` | Read (lazily create) `partner_onboarding_progress` for a partner account |
| POST | `/api/admin/configurator/wizard/advance` | Mark the server's current step `completed` or `skipped`; advances `current_step` |
| POST | `/api/admin/configurator/wizard/go-live` | Validate all 6 steps non-`pending`; set `partner_accounts.onboarding_completed_at` |

**`GET /api/admin/configurator/wizard/progress`** — query: `partner_account_id` (required, uuid).
Response 200:
```json
{
  "current_step": "topics",
  "onboarding_completed_at": null,
  "steps": {
    "questionnaire": { "status": "completed", "status_at": "2026-07-13T10:02:00Z" },
    "topics":        { "status": "pending",   "status_at": null },
    "content":       { "status": "pending",   "status_at": null },
    "visualization": { "status": "pending",   "status_at": null },
    "domain":        { "status": "pending",   "status_at": null },
    "payment":       { "status": "pending",   "status_at": null }
  }
}
```
403/400: same pattern as every other `/api/admin/configurator/*` route.

**`POST /api/admin/configurator/wizard/advance`** — body:
`{ "partner_account_id": "uuid", "step": "questionnaire"|"topics"|"content"|"visualization"|"domain"|"payment", "action": "complete"|"skip" }`.
Server re-validates `step === current partner_onboarding_progress.current_step` (never trusts the client to
name an arbitrary step — mirrors the existing "never trust a client-side-only check" discipline, §14
Requirement Doc 4.B.3). `action="complete"` additionally re-runs 14.7.2's query before accepting.
Response 200: `{ "current_step": "content", "steps": { ...same shape as GET... } }` (the next step in fixed
order becomes `current_step`; after `payment`, the next value is `go_live`).
Response 422: `{ "error": { "code": "step_not_ready" } }` — `action="complete"` attempted before the
condition was met.
Response 409: `{ "error": { "code": "step_mismatch" } }` — `step` no longer equals the server's
`current_step` (stale tab/double-submit).
403: same pattern.

**`POST /api/admin/configurator/wizard/go-live`** — body: `{ "partner_account_id": "uuid" }`.
Validates all six `{step}_status` values are `'completed'` or `'skipped'`.
Response 200: `{ "onboarding_completed_at": "2026-07-13T10:30:00Z", "live_url": "https://acme-co.hello-clio.com" }`.
`live_url` precedence (identical derivation to `GET .../domain`'s own display logic, §14.3/Requirement Doc
4.B.1): `custom_domain_url` if `custom_domain_status='verified'`, else `subdomain_url` if `subdomain_slug`
is set, else `{APP_BASE_URL}/partner-questionnaire/{partner_account_id}` (the existing, always-working
Clio-domain fallback — never blank).
Response 422: `{ "error": { "code": "steps_incomplete", "pending_steps": ["payment"] } }` — lists every
step still `'pending'`.
403: same pattern.

#### 14.7.4 Entry-point redirect — exact check added to every Configurator `page.tsx`

Every existing Configurator server component (`/dashboard/configurator`, `/questionnaire`, `/topics`,
`/content`, `/visualization`, and this document's own new `/domain`) gains this check, inserted immediately
after `activeId` resolution and before rendering its client component:

```ts
const { data: account } = await supabase
  .from('partner_accounts')
  .select('onboarding_completed_at')
  .eq('id', activeId)
  .single()

if (!account?.onboarding_completed_at) {
  redirect(`/dashboard/configurator/wizard?partner_account_id=${activeId}`)
}
```

`/dashboard/configurator/wizard/page.tsx` runs the inverse:

```ts
if (account?.onboarding_completed_at) {
  redirect(`/dashboard/configurator?partner_account_id=${activeId}`)
}
```

#### 14.7.5 `embedded` prop — exact shape added to the 5 wrapped client components

`QuestionnaireBuilderClient`, `TopicsConfigClient`, `ContentConfigClient`, `VisualizationClient` (all
B2B-03, unmodified otherwise), and `DomainConfigClient` (this document, Section 4.A) each gain:

```ts
interface Props {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  embedded?: boolean   // new, optional, default false
}
```

**Correction (v1.2 review pass):** the two components below do not each have "exactly one wrapped
return" — verified against the live files. The fix differs by component depending on how many places
currently call `<ConfiguratorShell>`:

**`TopicsConfigClient`, `VisualizationClient`, `DomainConfigClient` — single wrapped return.**
Confirmed against the live code: `TopicsConfigClient.tsx` (one `<ConfiguratorShell>` at line 35) and
`VisualizationClient.tsx` (one `<ConfiguratorShell>` at line 25) each have exactly one early return, and
`DomainConfigClient` (new, Section 4.A) is being authored with exactly one. For these three, the original
instruction applies unchanged — the component's existing
`return (<ConfiguratorShell ...>{content}</ConfiguratorShell>)` becomes:

```tsx
if (embedded) return <>{content}</>
return (
  <ConfiguratorShell accounts={accounts} activePartnerAccountId={activePartnerAccountId} title="..." backHref="...">
    {content}
  </ConfiguratorShell>
)
```

**`QuestionnaireBuilderClient`, `ContentConfigClient` — two separately-wrapped returns each.**
Confirmed against the live code:
- `QuestionnaireBuilderClient.tsx` — the `view.mode === 'edit'` branch (lines 39–48, wraps `<EditView>`
  with `title="Questionnaire Builder" backHref="#"`) and the list/default branch (lines 53–104, wraps the
  New-button header + loading/empty/list states with `title="Questionnaire Builder"`, no `backHref`) each
  call `<ConfiguratorShell>` independently.
- `ContentConfigClient.tsx` — the `reviewingItem` branch (lines 61–70, wraps `<ReviewView>` with
  `title="Content — Review" backHref="#"`) and the default/list branch (lines 72–128, wraps the
  source-toggle + generated-items list with `title="Content" backHref="/dashboard/configurator?..."`)
  each call `<ConfiguratorShell>` independently.

**Specified approach: duplicate the `embedded` check at each of the two return sites independently — do
not collapse the component to a single check point.** Rationale: the two branches in each component
render genuinely different content *and* pass different `title`/`backHref` props to `ConfiguratorShell`
(edit/review branch uses `backHref="#"`, e.g.; the other branch doesn't, or uses a different one). A true
single-check refactor would need to thread per-branch title/backHref through a shared variable even
though neither prop is used at all when `embedded=true` — unnecessary complexity for no behavioral gain.
Duplicating the guard at each site instead requires no change to which branch executes, no change to
component structure or hook order, and keeps the "byte-identical content" promise mechanically verifiable
per branch: take the JSX already nested inside that branch's own `<ConfiguratorShell>` call, assign it
unchanged to a local `content` variable, then guard-return it immediately before the existing wrap. At
each of the two return sites:

```tsx
// at the top of the existing branch, in place of the current `return (<ConfiguratorShell ...>…)`:
const content = (
  /* exactly the JSX currently nested inside this branch's <ConfiguratorShell>…</ConfiguratorShell>,
     unchanged — no business logic, validation, or API call in this branch changes */
)
if (embedded) return <>{content}</>
return (
  <ConfiguratorShell accounts={accounts} activePartnerAccountId={activePartnerAccountId} title="..." backHref="...">
    {content}
  </ConfiguratorShell>
)
```

This is applied twice per component (once per branch), each independently — not once for the whole
component. A developer implementing this must not improvise a merged/single-check version; the two
branches keep their own separate `title`/`backHref` values exactly as today whenever `embedded=false`.

For all 5 components, `content` (the JSX nested inside the relevant `<ConfiguratorShell>` call) is
otherwise byte-identical — no business logic, validation, or API call inside any of the 5 components
changes.

---

## 15. B2B-08 — Testing / Metering (new)

Version: 1.0 | Produced by: Business Analyst Agent, as part of B2B-08
Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-08-testing-metering.md`
Requirement Document: `docs/specs/B2B-08-requirement-document.md`
Migration: `supabase/migrations/077_b2b08_testing_metering.sql`

Extends Section 13 (B2B-04 billing/metering) additively — no `partner_wallets`/`usage_events`/
`wallet_ledger` column, RPC, or route built there is modified or narrowed. Rationale for every
decision below lives in the Requirement Document; this section is the exact schema/RPC/route/job
detail a developer implements against.

**Correction to the CEO brief's own pseudocode, made explicit here (BA authority, technical
naming fix, not a product-shape change):** the brief's Real-Time Cutoff mechanism names
`provider.leaveBot(providerBotId)`. The actual vendor-agnostic interface
(`lib/meeting-bot/types.ts`) exposes `deleteBot(botId): Promise<void>` — `attendeeProvider.deleteBot()`
(`lib/meeting-bot/attendee.ts:30-46`) is the function that already calls Attendee's
`POST /bots/{botId}/leave` endpoint. Every reference below uses `getMeetingBotProvider().deleteBot()`,
the real exported method; the brief's `leaveBot` was descriptive shorthand for "call the provider's
leave/remove call," not a literal API name — the underlying behavior (call the existing vendor-agnostic
leave call, unmodified, no new vendor call added) is exactly what the brief specified.

### 15.1 Schema — additive only

See `supabase/migrations/077_b2b08_testing_metering.sql` for the exact, applied DDL (not yet run — the
Orchestrator applies it after CEO re-approval of this document). Summary:

- `partner_wallets.trial_minutes_used NUMERIC(10,2) NOT NULL DEFAULT 0` (`CHECK >= 0`) — lifetime free-
  trial minutes consumed. The 20.00 ceiling is enforced by `consume_trial_and_test_minutes()` (RPC
  layer), deliberately not a DB `CHECK` against the literal figure, so a future change to the allowance
  size needs no schema migration.
- `partner_wallets.test_minutes_balance NUMERIC(10,2) NOT NULL DEFAULT 0` (`CHECK >= 0`) — purchased
  test-block minutes remaining, structurally separate from `balance_usd`.
- `usage_events.is_metered_test_usage BOOLEAN NOT NULL DEFAULT FALSE` — Clio-internal-only cost-
  visibility signal, orthogonal to `test_mode` (unchanged meaning). Never read by any partner-facing
  response; never consulted by `applyWalletDecrement()`'s existing `test_mode` skip.
- `partner_sessions.end_reason TEXT` (`CHECK (end_reason IS NULL OR end_reason IN
  ('trial_limit_reached', 'trial_exhausted'))`) — `NULL` for an ordinary session end (unchanged
  default), `'trial_limit_reached'` for a mid-session forced cutoff (lands on the existing `'completed'`
  status), `'trial_exhausted'` for a pre-dispatch rejection (lands on the existing `'failed'` status). No
  new `partner_sessions.status` enum value is added.
- `wallet_ledger.entry_type` `CHECK` gains `'test_block_purchase'` (constraint dropped and recreated —
  see migration comment for the exact default-constraint-name assumption).
- `wallet_ledger.resulting_test_minutes_balance NUMERIC(10,2)` — nullable, set only for
  `test_block_purchase` rows.
- Two new RPCs: `credit_test_minutes_balance(p_partner_account_id, p_minutes) RETURNS NUMERIC` and
  `consume_trial_and_test_minutes(p_partner_account_id, p_minutes) RETURNS TABLE(trial_minutes_used
  NUMERIC, test_minutes_balance NUMERIC)` — exact bodies in the migration file, mirroring
  `credit_wallet_balance`/`decrement_wallet_balance`'s atomic lazy-create pattern.

`consume_trial_and_test_minutes` is **not** wallet-ledger-logged — `wallet_ledger`'s existing discipline
covers `balance_usd` credits/debits plus this brief's one addition (`test_block_purchase`, a real-money
credit event); trial/test-minute *consumption* has no `balance_usd` analog and is tracked entirely via
`partner_wallets.trial_minutes_used`/`.test_minutes_balance` plus `usage_events.is_metered_test_usage`
rows — the same non-ledgered treatment `usage_events.billed = false` rows already get for unrated event
types (Section 13.3).

### 15.2 API Route Map (additive to Section 13.2)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/admin/billing/test-block` | Clerk, `requirePartnerAdmin` | Purchases one 120-minute test block — Stripe Checkout, `mode: "payment"`, fixed $1.80 line item, `setup_future_usage: "off_session"`. |
| POST | `/api/partner/v1/sessions` | Partner API key (unchanged auth) | **Gate logic added**, test-mode branch only — see 15.4. Route/auth/response shape otherwise unchanged from Section 4. |

No new partner-facing `GET` route. `GET /api/partner/v1/wallet` (Section 13.2) is **not** extended with
`trial_minutes_used`/`test_minutes_balance` fields — see Requirement Document Section 4 for the BA
judgment call resolving this (no UI or API surface for viewing trial/test-block state in this document;
the only partner-visible signal is the `402 trial_exhausted` error itself).

### 15.3 `lib/stripe.ts` — one new function, same `isPlaceholder`-guarded pattern

```ts
export async function createTestBlockCheckoutSession(
  partnerAccountId: string,
  successUrl?: string,
  cancelUrl?: string
): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const resolvedSuccess = successUrl ?? `${appUrl}/dashboard/admin/clients?test_block=success`
  const resolvedCancel = cancelUrl ?? `${appUrl}/dashboard/admin/clients?test_block=cancelled`

  if (isPlaceholder || !stripeClient) {
    console.log('[MOCK] createTestBlockCheckoutSession', { partnerAccountId })
    return `${appUrl}/dashboard?mock_test_block=1&partner_account_id=${partnerAccountId}`
  }

  const session = await stripeClient.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_creation: 'always',
    payment_intent_data: { setup_future_usage: 'off_session' },
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: 'Clio 2-hour test block (120 minutes)' },
        unit_amount: 180, // $1.80 fixed — 120 min x $0.0150/min seeded voice_minute platform-default
                           // rate (billing_rate_versions, rate_basis='cogs_placeholder_2026_05_no_margin'),
                           // zero margin. No Stripe Price object — quantity/price are both fixed, not
                           // partner-supplied, so an ad-hoc line item is used exactly as
                           // createWalletTopupCheckoutSession already does.
      },
      quantity: 1,
    }],
    metadata: { partner_account_id: partnerAccountId, purpose: 'test_block_purchase' },
    success_url: resolvedSuccess,
    cancel_url: resolvedCancel,
  })

  if (!session.url) throw new Error('Stripe did not return a checkout URL for the test-block session.')
  return session.url
}
```

`setup_future_usage: 'off_session'` is the one deliberate difference from `createWalletTopupCheckoutSession`
— it instructs Stripe to save the payment method for reuse (Requirement Document, Interaction with
B2B-06). `customer_creation: 'always'` (reused, unchanged) guarantees a `session.customer` is always
present for the webhook handler to persist.

### 15.4 `app/api/partner/v1/sessions/route.ts` — Gate logic (inserted between the existing
`partner_sessions` insert and the existing `dispatchMeetingBot()` call)

```ts
import { inngest } from '@/inngest/client'
// ...existing imports unchanged...

// after the existing `const clioSessionRef = inserted.id as string` / renderUrl construction,
// BEFORE the existing `const dispatchResult = await dispatchMeetingBot(...)` call:

if (auth.mode === 'test') {
  const { data: wallet } = await supabase
    .from('partner_wallets')
    .select('trial_minutes_used, test_minutes_balance')
    .eq('partner_account_id', auth.partnerAccountId)
    .maybeSingle()

  const trialMinutesUsed = wallet ? Number(wallet.trial_minutes_used) : 0
  const testMinutesBalance = wallet ? Number(wallet.test_minutes_balance) : 0
  const availableMinutes = Math.max(0, 20 - trialMinutesUsed) + testMinutesBalance

  if (availableMinutes <= 0) {
    await supabase
      .from('partner_sessions')
      .update({ status: 'failed', end_reason: 'trial_exhausted' })
      .eq('id', clioSessionRef)

    return NextResponse.json(
      { error: { code: 'trial_exhausted', message: 'Free testing allowance used. Purchase a 2-hour test block to continue.' } },
      { status: 402 }
    )
  }

  const dispatchResult = await dispatchMeetingBot({ clioSessionRef, meetingUrl: meeting_url, renderUrl })

  if (dispatchResult.status === 'bot_active' && dispatchResult.botId) {
    inngest.send({
      name: 'clio/partner-trial.started',
      data: { clioSessionRef, partnerAccountId: auth.partnerAccountId, providerBotId: dispatchResult.botId, availableMinutes },
    }).catch((err) => console.error('[partner/sessions] clio/partner-trial.started emit failed:', err))
  }

  return NextResponse.json(
    { clio_session_ref: clioSessionRef, status: dispatchResult.status, render_url: renderUrl, ...(dispatchResult.error ? { error: dispatchResult.error } : {}) },
    { status: 201 }
  )
}

// auth.mode === 'live' falls through to the existing, unmodified code below —
// entirely B2B-06's scope, not touched by this document.
const dispatchResult = await dispatchMeetingBot({ clioSessionRef, meetingUrl: meeting_url, renderUrl })
// ...existing response construction, unchanged...
```

`DispatchBotResult` (`lib/partner/session-init.ts`) gains one additive optional field so the route can
fire the Inngest event without an extra DB read (the `botId` is already in scope right where
`dispatchMeetingBot()` calls `provider.createBot()`):

```ts
export interface DispatchBotResult {
  status: 'bot_active' | 'bot_dispatch_failed'
  error?: string
  botId?: string   // NEW — B2B-08, only set on 'bot_active'
}
// inside the try block, on success: return { status: 'bot_active', botId }
```

### 15.5 `inngest/partner-trial-cutoff.ts` — new job, modeled on `inngest/session-timer.ts`

```ts
import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'
import { recordBillableEvent } from '@/lib/partner/webhooks'

/**
 * B2B-08 — server-side timer that force-ends a test-mode partner session at
 * its available-minutes boundary, regardless of client state. Scoped to
 * partner_sessions (not the legacy `sessions` table session-timer.ts covers).
 * Deliberately no graceful pre-cutoff nudge (unlike session-timer.ts's
 * two-phase warning) — the meeting belongs to the partner, not to Clio;
 * there is nothing for Clio to gracefully wrap up. A clean bot-leave at the
 * boundary is correct and sufficient. See Requirement Document for the full
 * reasoning — this is a considered deviation from the session-timer.ts
 * precedent, not an oversight.
 */
export const partnerTrialCutoffJob = inngest.createFunction(
  {
    id: 'partner-trial-cutoff',
    name: 'Partner Trial Cutoff',
    triggers: [{ event: 'clio/partner-trial.started' }],
    cancelOn: [{ event: 'clio/partner-trial.ended', match: 'data.clioSessionRef' }],
    concurrency: { key: 'event.data.clioSessionRef', limit: 1 },
    retries: 1,
  },
  async ({ event, step }: {
    event: { data: { clioSessionRef: string; partnerAccountId: string; providerBotId: string; availableMinutes: number } }
    step: { sleep: (id: string, duration: string) => Promise<void>; run: <T>(id: string, fn: () => Promise<T>) => Promise<T> }
  }) => {
    const { clioSessionRef, partnerAccountId, providerBotId, availableMinutes } = event.data

    await step.sleep('wait-for-available-minutes', `${availableMinutes}m`)

    const alreadyEnded = await step.run('check-session-status', async () => {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase.from('partner_sessions').select('status').eq('id', clioSessionRef).maybeSingle()
      return data?.status === 'completed' || data?.status === 'failed'
    })
    // Race-safe no-op — cancelOn should already have caught a normal end; this is a second guard,
    // mirroring session-timer.ts's own "already ended — skipping" checks.
    if (alreadyEnded) return

    await step.run('leave-bot', async () => {
      try {
        await getMeetingBotProvider().deleteBot(providerBotId)
      } catch (err) {
        console.error('[partner-trial-cutoff] deleteBot failed (non-fatal — session is still force-ended below):', err)
      }
    })

    await step.run('consume-minutes', async () => {
      const supabase = createSupabaseAdminClient()
      const { error } = await supabase.rpc('consume_trial_and_test_minutes', {
        p_partner_account_id: partnerAccountId,
        p_minutes: availableMinutes, // the session ran its full allowance, not a re-measured duration
      })
      if (error) console.error('[partner-trial-cutoff] consume_trial_and_test_minutes RPC failed:', error.message)
    })

    await step.run('mark-session-completed', async () => {
      const supabase = createSupabaseAdminClient()
      await supabase
        .from('partner_sessions')
        .update({ status: 'completed', ended_at: new Date().toISOString(), end_reason: 'trial_limit_reached' })
        .eq('id', clioSessionRef)
    })

    await step.run('record-billable-events', async () => {
      // Mirrors handleSessionEnd()'s own two-call pattern (usage.voice_minute + session.completed)
      // so a partner's outbound webhook integration learns a forcibly-cutoff test session ended,
      // exactly as it would for a normal end — omitting session.completed here would be the one
      // observable inconsistency between the two end paths.
      await recordBillableEvent({
        partnerAccountId, eventType: 'usage.voice_minute', clioSessionRef,
        quantity: availableMinutes, unit: 'minutes', testMode: true, isMeteredTestUsage: true,
      })
      await recordBillableEvent({
        partnerAccountId, eventType: 'session.completed', clioSessionRef, testMode: true,
      })
    })
  },
)
```

Registration: `app/api/inngest/route.ts` gains `import { partnerTrialCutoffJob } from '@/inngest/partner-trial-cutoff'` and adds `partnerTrialCutoffJob` to the `functions: [...]` array — the same one-line addition every prior new job in that file has required.

**Accepted residual risk, named explicitly (not silently glossed over, not escalated to Section 11 —
a technical risk-acceptance decision, precedented by the identical shape already accepted for
`session-timer.ts`):** if the `clio/partner-trial.started` event itself fails to send (the `.catch()`
above is non-blocking, matching this codebase's existing fire-and-forget event-emission convention), or
the job's function throws and exhausts Inngest's single configured retry, there is no secondary
backstop equivalent to `voice-gap-watchdog.ts` for this specific job — the session would, in that
failure mode, run without an enforced minute-based cutoff, bounded only by the meeting's own natural
end or the partner's client eventually calling `POST /api/partner/render/end-session`. This mirrors the
exact residual-risk shape `session-timer.ts` itself already carries for the legacy session flow (its own
Inngest send-failure or exhausted-retry case is not further backstopped by `voice-gap-watchdog.ts`
either — that mechanism detects Hume silence, a different failure signature, not "Inngest job never
ran"). Building a redundant secondary watchdog for this specific job is not named in the CEO brief's
Approval Note (exactly one new Inngest job is approved) and is called out here as a follow-on
hardening item, not built as unapproved scope in this document.

### 15.6 `lib/partner/live-render.ts` — `handleSessionEnd()`, extended

**In-scope adjacent fix, not a new feature (mirrors the B2B-04 precedent of fixing an adjacent gap
found while touching the same code path):** `handleSessionEnd()` today never reads `partner_sessions.
test_mode` and never passes a `testMode` argument to either of its `recordBillableEvent()` calls —
every session-end billable event currently defaults to `testMode: false` regardless of the session's
actual mode, meaning `applyWalletDecrement()`'s `test_mode` skip (Section 13.3) has never actually been
reachable from this call site. This document is already modifying `handleSessionEnd()` to add the
trial/test-block consumption call this brief requires — leaving the pre-existing `testMode` gap unfixed
while simultaneously adding `is_metered_test_usage` logic that depends on knowing whether a session is
test-mode would be incoherent, so it is fixed here as part of this same, already-in-scope edit.

`getPartnerSession()` (same file) gains `test_mode` to its existing `select(...)` and `PartnerSessionRow`
gains a `testMode: boolean` field; `POST /api/partner/render/end-session`
(`app/api/partner/render/end-session/route.ts`) passes `session.testMode` through as
`handleSessionEnd()`'s new fourth argument — no other change to that route.

```ts
export async function handleSessionEnd(
  clioSessionRef: string,
  partnerAccountId: string,
  durationMinutes: number,
  testMode: boolean,   // NEW — B2B-08, threaded from getPartnerSession()'s now-selected test_mode
): Promise<void> {
  const supabase = createSupabaseAdminClient()
  await supabase
    .from('partner_sessions')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', clioSessionRef)

  // B2B-08 — cancel the trial-cutoff job so a normally-ended test session never triggers a
  // redundant forced cutoff. Mirrors session-timer.ts's own cancelOn pattern. Fire-and-forget.
  if (testMode) {
    inngest.send({ name: 'clio/partner-trial.ended', data: { clioSessionRef } })
      .catch((err) => console.error('[live-render] clio/partner-trial.ended emit failed:', err))
  }

  if (durationMinutes > 0) {
    await recordBillableEvent({
      partnerAccountId, eventType: 'usage.voice_minute', clioSessionRef,
      quantity: durationMinutes, unit: 'minutes',
      testMode,                          // FIX — previously always omitted/false
      isMeteredTestUsage: testMode,      // NEW — every test-mode dispatch is now gated by this
                                          // mechanism (Gate Logic, 15.4), so there is no remaining
                                          // "ordinary, unmetered" test-mode usage path to distinguish.
    })

    if (testMode) {
      // Consumes the ACTUAL duration used (not availableMinutes — that figure is only for the
      // forced-cutoff path, where the session ran its full allowance). Non-fatal on failure, same
      // discipline recordBillableEvent()'s own wallet-decrement call already uses.
      try {
        await supabase.rpc('consume_trial_and_test_minutes', {
          p_partner_account_id: partnerAccountId,
          p_minutes: durationMinutes,
        })
      } catch (err) {
        console.error('[live-render] consume_trial_and_test_minutes failed (non-fatal):', err)
      }
    }
  }

  await recordBillableEvent({ partnerAccountId, eventType: 'session.completed', clioSessionRef, testMode })
}
```

### 15.7 `lib/partner/webhooks.ts` — `recordBillableEvent()`, one new optional param

`RecordBillableEventParams` gains `isMeteredTestUsage?: boolean`, threaded onto the `usage_events`
insert (`is_metered_test_usage: params.isMeteredTestUsage ?? false`) alongside the existing `test_mode:
params.testMode ?? false` field — same insert call, one additive field, no other change to
`recordBillableEvent()`'s logic, idempotency handling, or `applyWalletDecrement()` call.

### 15.8 `app/api/webhooks/stripe/route.ts` — one new `purpose` branch

Inside the existing `case 'checkout.session.completed':` block, alongside the existing `if
(session.metadata?.purpose === 'wallet_topup')` branch (Section 13.4):

```ts
if (session.metadata?.purpose === 'test_block_purchase') {
  const partnerAccountId = session.metadata?.partner_account_id
  if (!partnerAccountId) {
    console.warn('[stripe-webhook] test_block_purchase checkout.session.completed missing partner_account_id:', session.id)
    break
  }

  if (await walletLedgerAlreadyRecorded(supabase, session.id, 'test_block_purchase')) break

  const { data: newTestMinutesBalance, error: rpcError } = await supabase.rpc('credit_test_minutes_balance', {
    p_partner_account_id: partnerAccountId,
    p_minutes: 120,
  })
  if (rpcError) {
    console.error('[stripe-webhook] credit_test_minutes_balance RPC failed:', rpcError.message)
    break
  }

  // resulting_balance_usd is still required/populated on every wallet_ledger row — this row type
  // never moves balance_usd, so the account's CURRENT, unchanged value is cited, preserving the
  // ledger's "never independently recompute a balance" discipline for both balance columns on
  // every row type (Requirement Document, Purchase Mechanism).
  const { data: walletRow } = await supabase
    .from('partner_wallets')
    .select('balance_usd')
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()
  const currentBalanceUsd = walletRow ? Number(walletRow.balance_usd) : 0

  await supabase.from('wallet_ledger').insert({
    partner_account_id: partnerAccountId,
    entry_type: 'test_block_purchase',
    delta_usd: 1.80,
    resulting_balance_usd: currentBalanceUsd,
    resulting_test_minutes_balance: newTestMinutesBalance,
    stripe_object_id: session.id,
  })

  // Same payment-method extraction the wallet_topup branch performs, minimally — sets
  // stripe_customer_id only. Card brand/last4/type sync happens via the existing, UNMODIFIED
  // customer.updated / payment_method.attached handlers below, which already key off
  // stripe_customer_id across every partner_wallets row regardless of which funding path attached
  // it — no new code needed for that part.
  if (typeof session.customer === 'string') {
    await supabase
      .from('partner_wallets')
      .update({ stripe_customer_id: session.customer })
      .eq('partner_account_id', partnerAccountId)
  }

  console.log(`[stripe-webhook] B2B-08 test block purchase: +120 min for partner ${partnerAccountId}, new test_minutes_balance: ${newTestMinutesBalance}`)

  break
}
```

`walletLedgerAlreadyRecorded()`'s `entryType` parameter type widens additively:
`'topup_checkout' | 'topup_subscription_recharge' | 'topup_invoice' | 'test_block_purchase'` — no
change to the function's body, which already operates generically on `(stripeObjectId, entryType)`.

Tier/`funding_mechanism` are deliberately **not** touched by this branch — buying a test block does not
imply a commercial tier change; `tier` remains whatever it already was (mirrors the B2B-04 precedent of
a mid-market subscription cancellation not auto-reverting `tier`, Requirement Doc Section 9).

---

## 16. B2B-09 — Session Delivery Extraction Fix + Internal Glitch Dashboard (new)

Version: 1.1 | Produced by: Business Analyst Agent, as part of B2B-09
Companion to `docs/specs/B2B-09-requirement-document.md`. Migration:
`supabase/migrations/078_b2b09_session_delivery_glitch_dashboard.sql` (next free number after
B2B-08's `077`, verified no overlap — see Requirement Doc Section 12).
v1.1 note: §16.4 and §16.7 corrected — a CEO-review gap closed. `recordInsightsReadyEvent()` hardcoded
`test_mode: false` in the outbound reference payload, and its caller (`extractInsightsForPartnerSession()`)
never fetched or threaded through the real value, so every `session.insights_ready` webhook for a
test-mode partner session reported `test_mode: false` regardless of the session's actual mode — the same
bug class B2B-08 (§15.6) fixed at a different call site (`handleSessionEnd()`'s `recordBillableEvent()`
calls). `test_mode` now flows from `partner_sessions` through both call sites of
`recordInsightsReadyEvent()` — the success path in `extractInsightsForPartnerSession()` and the failure
path in `markInsightsExtractionFailed()` — into the reference payload. See the Requirement Document's
v1.1 changelog for the full correction and rationale.

### 16.1 Schema — additive only

```sql
-- 1. The missing link: partner_sessions never had a way to be resolved from a Hume chat_id.
ALTER TABLE partner_sessions ADD COLUMN IF NOT EXISTS hume_chat_id TEXT;
CREATE INDEX IF NOT EXISTS idx_partner_sessions_hume_chat_id
  ON partner_sessions(hume_chat_id) WHERE hume_chat_id IS NOT NULL;

-- 2. New table, parallel in SHAPE to session_action_items (migration 073), not a reuse of it —
-- session_action_items is hard-FK'd to sessions(id) and this document's own Feature Brief explicitly
-- forbids forcing partner_sessions through that FK. Requirement Doc Section 6.
CREATE TABLE IF NOT EXISTS partner_session_insights (
  id                    UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  partner_session_id    UUID        NOT NULL REFERENCES partner_sessions(id) ON DELETE CASCADE,
  partner_account_id    UUID        NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  hume_chat_id          TEXT,

  extraction_status     TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (extraction_status IN ('pending', 'success', 'success_empty', 'failed')),

  -- Full detail while within the 30-day retention window; NULL after purge (action_items,
  -- psychology_keywords) or reduced-to-type-only (glitches) — see 16.4.
  action_items          JSONB       DEFAULT NULL,   -- [{ text: string }]
  glitches              JSONB       DEFAULT NULL,   -- [{ type, description }] pre-purge; [{ type }] post-purge
  psychology_keywords   JSONB       DEFAULT NULL,   -- string[] — keywords only, never full sentences

  transcript_event_count INTEGER    DEFAULT NULL,
  attempt_count          INTEGER    NOT NULL DEFAULT 0,
  error_message           TEXT       DEFAULT NULL,
  extracted_at             TIMESTAMPTZ DEFAULT NULL,   -- set only on a terminal success/success_empty write
  full_detail_purged_at    TIMESTAMPTZ DEFAULT NULL,   -- set by the daily purge job (16.4); NULL = not yet purged

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_session_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_session_insights_session ON partner_session_insights(partner_session_id);
CREATE INDEX IF NOT EXISTS idx_partner_session_insights_account_time
  ON partner_session_insights(partner_account_id, extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_session_insights_status ON partner_session_insights(extraction_status)
  WHERE extraction_status IN ('pending', 'failed');
-- Purge job's own eligibility scan (16.4).
CREATE INDEX IF NOT EXISTS idx_partner_session_insights_purge_eligibility
  ON partner_session_insights(extracted_at) WHERE full_detail_purged_at IS NULL AND extracted_at IS NOT NULL;

ALTER TABLE partner_session_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_session_insights"
  ON partner_session_insights FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE partner_session_insights IS
  'B2B-09: per-partner-session extraction result. action_items/glitches/psychology_keywords hold full
   detail for 30 days after extracted_at, then the daily purge job (16.4) reduces them to type-only
   (glitches) or NULL (action_items, psychology_keywords) permanently. Never the same table as the
   legacy session_action_items (migration 073) — see Requirement Doc Section 6 for why.';

-- 3. Widen webhook_dispatch_log.event_type to add BOTH this document's new event type AND B2B-04's
-- still-open 'wallet.low_balance' gap (lib/partner/webhooks.ts's checkLowBalanceAndAlert() has carried
-- a KNOWN GAP comment since B2B-04 shipped; migration 075 never widened this constraint). One migration
-- closes both rather than shipping a second near-identical one — Requirement Doc Section 6.
ALTER TABLE webhook_dispatch_log DROP CONSTRAINT IF EXISTS webhook_dispatch_log_event_type_check;
ALTER TABLE webhook_dispatch_log ADD CONSTRAINT webhook_dispatch_log_event_type_check
  CHECK (event_type IN (
    'usage.voice_minute',
    'usage.llm_generation_call',
    'session.completed',
    'wallet.low_balance',
    'session.insights_ready'
  ));
```

### 16.2 API Route Map (additive)

| Route | Method | Auth | Notes |
|---|---|---|---|
| `/api/partner/render/session-chat-id` | POST | None (opaque `clio_session_ref` only) | Mirrors `/api/hume-native/session-chat-id` exactly (16.5) |
| `/api/admin/glitches/summary` | GET | Clerk (any signed-in user, matches `/api/admin/billing/clients`'s boundary) | Backs Panel 1 (16.7) |
| `/api/admin/glitches` | GET | Clerk, same boundary | Backs Panel 2, `?partner_account_id=`/`?type=` filters (16.7) |
| `/dashboard/admin/glitches` | GET (page) | Clerk | `currentUser()` gate, `<DashboardShell>`, `GlitchDashboardClient` |

### 16.3 `app/api/partner/render/session-chat-id/route.ts` — new, mirrors the existing pattern exactly

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'

const CaptureSchema = z.object({
  clio_session_ref: z.string().uuid(),
  hume_chat_id: z.string().min(1),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = CaptureSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 200 }) // best-effort — never blocks connect flow
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('partner_sessions')
    .update({ hume_chat_id: parsed.data.hume_chat_id })
    .eq('id', parsed.data.clio_session_ref)

  if (error) {
    console.warn('[partner/render/session-chat-id] Failed to persist hume_chat_id:', error.message)
    return NextResponse.json({ ok: false })
  }

  return NextResponse.json({ ok: true })
}
```

`PartnerRenderClient.tsx`'s `onConnect` handler changes from `onConnect: () => setStatus('listening')` to:

```ts
onConnect: (sessionId) => {
  setStatus('listening')
  if (sessionId) {
    fetch('/api/partner/render/session-chat-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clio_session_ref: clioSessionRef, hume_chat_id: sessionId }),
    }).catch((err) => console.warn('[partner-render] Failed to persist hume_chat_id:', err))
  }
},
```

### 16.4 `inngest/partner-session-insights-extractor.ts` — new file: extraction fast path, backstop, purge

```ts
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { fetchAllTranscriptEvents } from '@/lib/voice/hume-native/session-details' // newly exported, 16.6
import { formatTranscriptLines } from './hume-action-item-extractor' // verbatim reuse, unmodified import
import { recordInsightsReadyEvent } from '@/lib/partner/webhooks'

// ─── NEW prompt/schema pair — deliberately NOT EXTRACTION_SYSTEM_PROMPT/ExtractionSchema from
// hume-action-item-extractor.ts. Requirement Doc Section 6 / Section 11 judgment call 1: editing that
// shared constant would change the live Anthropic call for every existing sessions-table session too.

const PartnerActionItemSchema = z.object({ text: z.string() })
const PartnerGlitchSchema = z.object({
  type: z.enum(['misunderstanding', 'repetition', 'confusion_about_clio', 'derailment', 'other']),
  description: z.string(),
})
export const PartnerInsightsExtractionSchema = z.object({
  action_items: z.array(PartnerActionItemSchema),
  glitches: z.array(PartnerGlitchSchema),
  psychology_keywords: z.array(z.string()),
})
type PartnerInsightsPayload = z.infer<typeof PartnerInsightsExtractionSchema>

const MODEL = 'claude-sonnet-4-6'
const isPlaceholder = !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')
const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PARTNER_INSIGHTS_SYSTEM_PROMPT = `You are reviewing a transcript of a 1:1 AI-guided conversation between an AI assistant and a user. Extract three things:
1. **Action items** — concrete next steps the User committed to, or that the assistant explicitly recommended and the User acknowledged. Do not invent items the transcript does not support.
2. **Glitches** — moments where the conversation broke down: the assistant misunderstood or mis-heard the User, the assistant repeated itself unnecessarily, the User expressed confusion specifically about the assistant (not about the subject matter), or the conversation was derailed by an off-topic interruption. Do not flag ordinary comprehension checkpoints.
3. **Psychology keywords** — short keyword/phrase signals (1-4 words each, lowercase, hyphenated if multi-word) capturing the User's inferred psychological state or communication pattern, based on HOW they asked/responded (tone, hesitation, confidence, urgency, frustration, curiosity) — never WHAT subject matter they discussed. Examples: "hesitant", "time-pressured", "skeptical-of-ai", "highly-engaged". Never a full sentence, never a verbatim quote.

Respond with ONLY a JSON object matching this exact shape, no prose outside the JSON:
{"action_items": [{"text": string}], "glitches": [{"type": "misunderstanding" | "repetition" | "confusion_about_clio" | "derailment" | "other", "description": string}], "psychology_keywords": [string]}

Empty arrays are valid, expected results when nothing of that kind is present — never fabricate content to avoid an empty array.`

async function callClaudeForPartnerInsightsExtraction(
  transcriptText: string
): Promise<{ data: PartnerInsightsPayload; isMock: boolean }> {
  if (isPlaceholder || !anthropic) {
    console.log('[MOCK partner-session-insights-extractor] ANTHROPIC_API_KEY is a placeholder — returning mock extraction')
    return {
      isMock: true,
      data: {
        action_items: [{ text: '[MOCK] Review the AI vendor shortlist discussed in this session before the next call.' }],
        glitches: [{ type: 'other', description: '[MOCK] Placeholder glitch — ANTHROPIC_API_KEY is not configured.' }],
        psychology_keywords: ['[mock]-placeholder-keyword'],
      },
    }
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: PARTNER_INSIGHTS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcriptText }],
  })

  const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  const parsedJson: unknown = JSON.parse(cleaned) // throws -> Inngest retries the step
  const validated = PartnerInsightsExtractionSchema.safeParse(parsedJson)
  if (!validated.success) {
    throw new Error(`Partner insights extraction response failed schema validation: ${validated.error.message}`)
  }
  return { isMock: false, data: validated.data }
}

// ─── Idempotency guard — structurally identical to runIdempotencyGuard() in
// hume-action-item-extractor.ts, against partner_session_insights instead of session_action_items.

type GuardOutcome = { shortCircuit: true; status: 'already_terminal' } | { shortCircuit: false }

async function runInsightsIdempotencyGuard(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  partnerSessionId: string,
  partnerAccountId: string,
  humeChatId: string | null
): Promise<GuardOutcome> {
  const { data: existing } = await supabase
    .from('partner_session_insights')
    .select('extraction_status, attempt_count')
    .eq('partner_session_id', partnerSessionId)
    .maybeSingle()

  if (existing) {
    const status = existing.extraction_status as string
    if (status === 'success' || status === 'success_empty') return { shortCircuit: true, status: 'already_terminal' }
    if (status === 'failed' && (existing.attempt_count ?? 0) >= 3) return { shortCircuit: true, status: 'already_terminal' }
    return { shortCircuit: false }
  }

  await supabase.from('partner_session_insights').upsert(
    { partner_session_id: partnerSessionId, partner_account_id: partnerAccountId, hume_chat_id: humeChatId, extraction_status: 'pending' },
    { onConflict: 'partner_session_id', ignoreDuplicates: true }
  )

  const { data: afterInsert } = await supabase
    .from('partner_session_insights')
    .select('extraction_status')
    .eq('partner_session_id', partnerSessionId)
    .maybeSingle()

  const afterStatus = afterInsert?.extraction_status as string | undefined
  if (afterStatus === 'success' || afterStatus === 'success_empty') return { shortCircuit: true, status: 'already_terminal' }
  return { shortCircuit: false }
}

// ─── Core extraction — mirrors extractActionItemsForSession()'s shape exactly, against the new table.

export async function extractInsightsForPartnerSession(partnerSessionId: string): Promise<{ status: string }> {
  const supabase = createSupabaseAdminClient()

  const { data: session } = await supabase
    .from('partner_sessions')
    .select('id, partner_account_id, hume_chat_id, test_mode')
    .eq('id', partnerSessionId)
    .maybeSingle()

  if (!session) throw new Error(`No partner_sessions row for id ${partnerSessionId}`)
  if (!session.hume_chat_id) throw new Error(`partner_sessions ${partnerSessionId} has no hume_chat_id`)

  const guard = await runInsightsIdempotencyGuard(supabase, partnerSessionId, session.partner_account_id as string, session.hume_chat_id as string)
  if (guard.shortCircuit) return { status: guard.status }

  const apiKey = process.env.HUME_API_KEY
  if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) throw new Error('HUME_API_KEY not configured')

  const transcriptEvents = await fetchAllTranscriptEvents(apiKey, session.hume_chat_id as string)
  const messageLines = formatTranscriptLines(transcriptEvents)

  let result: { status: string; extraction_status: 'success' | 'success_empty'; actionItems: unknown[]; glitches: unknown[]; psychologyKeywords: string[]; isMock: boolean; eventCount: number }

  if (messageLines.length === 0) {
    result = { status: 'success_empty', extraction_status: 'success_empty', actionItems: [], glitches: [], psychologyKeywords: [], isMock: false, eventCount: 0 }
  } else {
    const { data, isMock } = await callClaudeForPartnerInsightsExtraction(messageLines.join('\n'))
    const isEmpty = data.action_items.length === 0 && data.glitches.length === 0 && data.psychology_keywords.length === 0
    result = {
      status: isEmpty ? 'success_empty' : 'success',
      extraction_status: isEmpty ? 'success_empty' : 'success',
      actionItems: data.action_items, glitches: data.glitches, psychologyKeywords: data.psychology_keywords,
      isMock, eventCount: messageLines.length,
    }
  }

  await supabase.from('partner_session_insights').update({
    extraction_status: result.extraction_status,
    action_items: result.actionItems,
    glitches: result.glitches,
    psychology_keywords: result.psychologyKeywords,
    transcript_event_count: result.eventCount,
    error_message: result.isMock ? '[MOCK] ANTHROPIC_API_KEY not configured — mock data written' : null,
    extracted_at: new Date().toISOString(),
  }).eq('partner_session_id', partnerSessionId)

  await recordInsightsReadyEvent({
    partnerSessionId, partnerAccountId: session.partner_account_id as string, extractionStatus: result.extraction_status,
    testMode: session.test_mode as boolean, // v1.1 — was missing; see §16 v1.1 note
  })

  return { status: result.status }
}

async function markInsightsExtractionFailed(partnerSessionId: string, errorMessage: string): Promise<void> {
  const supabase = createSupabaseAdminClient()
  // v1.1 — select gains the partner_sessions!inner(test_mode) embed (identical FK-embed pattern to
  // fetchDueDispatches()'s partner_accounts!inner() embed, §16.7) so this failure path can thread
  // test_mode through too, same as the success path in extractInsightsForPartnerSession() above.
  const { data: current } = await supabase
    .from('partner_session_insights')
    .select('attempt_count, partner_account_id, partner_sessions!inner(test_mode)')
    .eq('partner_session_id', partnerSessionId)
    .maybeSingle()
  if (current) {
    await supabase.from('partner_session_insights').update({
      extraction_status: 'failed', error_message: errorMessage.slice(0, 2000), attempt_count: (current.attempt_count ?? 0) + 1,
    }).eq('partner_session_id', partnerSessionId)
    // A permanently-failed extraction still tells the partner explicitly, once, per the Requirement
    // Doc's "extraction_status: 'failed'" webhook shape — only fired on the FIRST time this row crosses
    // into 'failed' with attempt_count reaching 3 (mirrors the guard's own >= 3 exhaustion check), never
    // re-fired on every retry attempt below that.
    if (((current.attempt_count ?? 0) + 1) >= 3) {
      const testMode = (current.partner_sessions as unknown as { test_mode: boolean } | null)?.test_mode ?? false
      await recordInsightsReadyEvent({ partnerSessionId, partnerAccountId: current.partner_account_id as string, extractionStatus: 'failed', testMode })
    }
  }
}

// ─── Fast path

export const partnerSessionInsightsExtractor = inngest.createFunction(
  { id: 'partner-session-insights-extractor', name: 'Extract Partner Session Insights (Fast Path)', retries: 3, triggers: [{ event: 'clio/partner-session.ended' }] },
  async ({ event, step }) => {
    const { partnerSessionId } = event.data as { partnerSessionId?: string }
    if (!partnerSessionId) return { status: 'skipped', reason: 'missing_partner_session_id' }
    try {
      return await step.run('extract-partner-insights', () => extractInsightsForPartnerSession(partnerSessionId))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await markInsightsExtractionFailed(partnerSessionId, message)
      return { status: 'failed', reason: message }
    }
  }
)

// ─── Backstop — mirrors humeActionItemBackstopSweep exactly, against partner_sessions/partner_session_insights.

export const partnerSessionInsightsBackstopSweep = inngest.createFunction(
  { id: 'partner-session-insights-backstop-sweep', name: 'Partner Session Insights — Backstop Sweep', retries: 3, triggers: [{ cron: '*/30 * * * *' }] },
  async ({ step }) => {
    const supabase = createSupabaseAdminClient()
    const eligibleIds = await step.run('find-eligible-sessions', async () => {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      const { data: candidates } = await supabase.from('partner_sessions').select('id')
        .eq('status', 'completed').not('ended_at', 'is', null).lt('ended_at', cutoff).not('hume_chat_id', 'is', null)
      const candidateIds = (candidates ?? []).map((s) => s.id as string)
      if (candidateIds.length === 0) return [] as string[]
      const { data: existing } = await supabase.from('partner_session_insights').select('partner_session_id, extraction_status, attempt_count').in('partner_session_id', candidateIds)
      const existingMap = new Map((existing ?? []).map((r) => [r.partner_session_id as string, r as { extraction_status: string; attempt_count: number }]))
      return candidateIds.filter((id) => {
        const row = existingMap.get(id)
        if (!row) return true
        if (row.extraction_status === 'success' || row.extraction_status === 'success_empty') return false
        if (row.extraction_status === 'failed') return (row.attempt_count ?? 0) < 3
        return true
      })
    })
    let extracted = 0, failed = 0
    for (const id of eligibleIds) {
      try {
        await step.run(`extract-partner-insights-${id}`, () => extractInsightsForPartnerSession(id))
        extracted++
      } catch (err) {
        await markInsightsExtractionFailed(id, err instanceof Error ? err.message : String(err))
        failed++
      }
    }
    return { checked: eligibleIds.length, extracted, failed }
  }
)

// ─── Purge — new daily cron. 30-day window, reasoning: Requirement Doc Section 9.

const PURGE_WINDOW_DAYS = 30

export const partnerSessionInsightsPurge = inngest.createFunction(
  { id: 'partner-session-insights-purge', name: 'Partner Session Insights — 30-Day Full-Detail Purge', retries: 3, triggers: [{ cron: '0 3 * * *' }] },
  async ({ step }) => {
    const purged = await step.run('purge-expired-full-detail', async () => {
      const supabase = createSupabaseAdminClient()
      const cutoffIso = new Date(Date.now() - PURGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase.rpc('purge_partner_session_insights_full_detail', { p_cutoff: cutoffIso })
      if (error) throw new Error(`Purge RPC failed: ${error.message}`)
      return (data as number) ?? 0
    })
    console.log(`[partner-session-insights-purge] Purged full-detail text from ${purged} row(s)`)
    return { purged }
  }
)
```

Registered alongside the existing functions in `app/api/inngest/route.ts`'s `serve([...])` array —
additive entries, no existing entry modified.

**Purge RPC** (migration, `078`):

```sql
CREATE OR REPLACE FUNCTION purge_partner_session_insights_full_detail(p_cutoff TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH purged AS (
    UPDATE partner_session_insights
    SET
      action_items = NULL,
      psychology_keywords = NULL,
      glitches = CASE
        WHEN glitches IS NULL OR jsonb_array_length(glitches) = 0 THEN glitches
        ELSE (SELECT jsonb_agg(jsonb_build_object('type', g->>'type')) FROM jsonb_array_elements(glitches) AS g)
      END,
      full_detail_purged_at = now()
    WHERE full_detail_purged_at IS NULL
      AND extracted_at IS NOT NULL
      AND extracted_at < p_cutoff
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM purged;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
```

### 16.5 `app/api/webhooks/hume/route.ts` — `chat_ended` handler, fallback extension

Inserted immediately after the existing `if (!session) { ... }` block (the point where a `sessions`
lookup by `hume_chat_id` has already come back empty):

```ts
    if (!session) {
      // NEW — fallback: this chat_id may belong to a partner session, not a legacy sessions row.
      const { data: partnerSession } = await supabase
        .from('partner_sessions')
        .select('id, partner_account_id')
        .eq('hume_chat_id', chatId)
        .maybeSingle()

      if (partnerSession) {
        // No writeAuditEvent() for the partner branch — that function requires a Clerk userId and a
        // sessions(id) FK, neither of which a partner_sessions row has; partner completion accounting
        // already happens independently via handleSessionEnd(), client-triggered on disconnect.
        await inngest.send({ name: 'clio/partner-session.ended', data: { partnerSessionId: partnerSession.id as string } })
        return NextResponse.json({ received: true })
      }

      console.warn('[hume-webhook] No sessions or partner_sessions row found for hume_chat_id:', chatId)
      return NextResponse.json({ received: true })
    }
```

### 16.6 `lib/voice/hume-native/session-details.ts` — one-line export change

```ts
// Before: async function fetchAllTranscriptEvents(...)
// After:
export async function fetchAllTranscriptEvents(apiKey: string, chatId: string): Promise<unknown[]> {
```
No change to the function body — every existing call site (`getHumeSessionDetails()`) is unaffected;
this only widens visibility so `inngest/partner-session-insights-extractor.ts` can import it directly
rather than duplicating Hume's Chat History pagination loop a third time.

### 16.7 `lib/partner/webhooks.ts` — `WebhookPayload`/`BillableEventType` extension + `recordInsightsReadyEvent()`

```ts
export type BillableEventType =
  | 'usage.voice_minute'
  | 'usage.llm_generation_call'
  | 'session.completed'
  | 'session.insights_ready' // B2B-09 — not billable; reuses this union purely for webhook_dispatch_log typing, same as the existing non-billable 'session.completed'

export interface WebhookPayload {
  // ... existing fields, unchanged ...
  // B2B-09 — additive. null/absent on every event type except 'session.insights_ready'.
  extraction_status?: 'success' | 'success_empty' | 'failed' | null
  action_items?: { text: string }[] | null
  glitches?: { type: string; description?: string }[] | null
  psychology_keywords?: string[] | null
}

/**
 * B2B-09 — inserts a REFERENCE-ONLY webhook_dispatch_log row for session.insights_ready. Deliberately
 * does NOT include action_items/glitches/psychology_keywords in the stored payload — that content is
 * reconstructed live from partner_session_insights at each delivery attempt (attemptDispatch(), below),
 * per the Requirement Doc Section 6 / Section 11 judgment call 2 (migration 071's own restriction on
 * this column). Never routed through recordBillableEvent() — this is not a billable event and doesn't
 * fit that function's usage_events/wallet-decrement branches.
 */
export async function recordInsightsReadyEvent(params: {
  partnerSessionId: string
  partnerAccountId: string
  extractionStatus: 'success' | 'success_empty' | 'failed'
  testMode: boolean // v1.1 — was missing; every caller must thread the session's real test_mode through
}): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase.from('partner_accounts').select('id, outbound_signing_secret').eq('id', params.partnerAccountId).maybeSingle()
  if (!account) return

  const now = new Date().toISOString()
  const referencePayload = {
    event_id: crypto.randomUUID(),
    event_type: 'session.insights_ready' as const,
    clio_session_ref: params.partnerSessionId,
    partner_reference: null,
    occurred_at: now,
    dispatched_at: now,
    test_mode: params.testMode, // v1.1 — was hardcoded false; see §16 v1.1 note
    extraction_status: params.extractionStatus,
    // action_items / glitches / psychology_keywords intentionally omitted — see function doc comment.
  }
  const payloadHash = crypto.createHash('sha256').update(canonicalHashInput({ event_type: 'session.insights_ready', clio_session_ref: params.partnerSessionId, partner_reference: null, quantity: null, unit: null, generation_type: null, occurred_at: now })).digest('hex')
  const signature = buildSignatureHeader((account.outbound_signing_secret as string | null) ?? 'unconfigured-partner-signing-secret', JSON.stringify(referencePayload))

  const { error } = await supabase.from('webhook_dispatch_log').upsert(
    { partner_account_id: params.partnerAccountId, event_type: 'session.insights_ready', clio_session_ref: params.partnerSessionId, payload: referencePayload, payload_hash: payloadHash, signature, delivery_status: 'pending' },
    { onConflict: 'partner_account_id,event_type,clio_session_ref,payload_hash', ignoreDuplicates: true }
  )
  if (error) console.error('[partner/webhooks] recordInsightsReadyEvent insert failed:', error.message)
}
```

`fetchDueDispatches()` — one additional selected column (`outbound_signing_secret`, needed for the
fresh-signature path below), all other event types unaffected:

```ts
    .select('id, partner_account_id, event_type, payload, signature, retry_count, partner_accounts!inner(outbound_base_url, outbound_signing_secret)')
```

`attemptDispatch()` — the one event-type-specific branch:

```ts
export async function attemptDispatch(row: DueDispatchRow): Promise<'delivered' | 'retrying' | 'exhausted' | 'skipped_no_endpoint'> {
  const supabase = createSupabaseAdminClient()
  if (!row.outbound_base_url) return 'skipped_no_endpoint'

  let rawBody: string
  let signatureHeader: string

  if (row.event_type === 'session.insights_ready') {
    // NEW — reconstruct live from partner_session_insights; never replay the stored reference payload.
    const { data: live } = await supabase
      .from('partner_session_insights')
      .select('action_items, glitches, psychology_keywords')
      .eq('partner_session_id', row.payload.clio_session_ref)
      .maybeSingle()

    const fullPayload = {
      ...row.payload,
      action_items: live?.action_items ?? null,
      glitches: live?.glitches ?? null,
      psychology_keywords: live?.psychology_keywords ?? null,
    }
    rawBody = JSON.stringify(fullPayload)
    signatureHeader = buildSignatureHeader(row.outbound_signing_secret ?? 'unconfigured-partner-signing-secret', rawBody)
  } else {
    rawBody = JSON.stringify(row.payload)   // unchanged — every other event type
    signatureHeader = row.signature          // unchanged — every other event type
  }

  const url = `${row.outbound_base_url.replace(/\/$/, '')}/webhooks/usage`
  // ... rest of the function (fetch, timeout, delivered/retry/exhausted handling) unchanged ...
}
```

`DueDispatchRow` gains `outbound_signing_secret: string | null` (populated from the extended
`fetchDueDispatches()` select above).

### 16.8 `GET /api/admin/glitches/summary` and `GET /api/admin/glitches` — exact queries

```ts
// GET /api/admin/glitches/summary
const { data } = await supabase.rpc('glitch_summary_by_type_and_partner')
// backing SQL function (migration 078):
//
// CREATE OR REPLACE FUNCTION glitch_summary_by_type_and_partner()
// RETURNS TABLE(glitch_type text, partner_account_id uuid, partner_name text, count bigint, first_seen timestamptz, last_seen timestamptz)
// AS $$
//   SELECT g->>'type' AS glitch_type, psi.partner_account_id, pa.name AS partner_name,
//          count(*) AS count, min(psi.extracted_at) AS first_seen, max(psi.extracted_at) AS last_seen
//   FROM partner_session_insights psi
//   CROSS JOIN LATERAL jsonb_array_elements(psi.glitches) AS g
//   JOIN partner_accounts pa ON pa.id = psi.partner_account_id
//   WHERE psi.glitches IS NOT NULL AND jsonb_array_length(psi.glitches) > 0
//   GROUP BY g->>'type', psi.partner_account_id, pa.name
//   ORDER BY count DESC;
// $$ LANGUAGE sql STABLE;

// GET /api/admin/glitches?partner_account_id=&type=
let query = supabase
  .from('partner_session_insights')
  .select('partner_session_id, partner_account_id, glitches, full_detail_purged_at, extracted_at, partner_accounts!inner(name)')
  .not('glitches', 'is', null)
if (partnerAccountId) query = query.eq('partner_account_id', partnerAccountId)
// unnest `glitches` (and filter by `type` if provided) in application code after the fetch — the
// per-row JSONB array is small (typically 0-3 glitches per session), so this avoids a second SQL
// function purely for the drill-down's row-level filtering.
//
// Per unnested glitch element, derive the two response fields the RD's Section 4.B.3 shape requires
// directly, no extra query needed:
//   full_detail_purged = (row.full_detail_purged_at !== null)   // session-level flag, same for every
//                                                                 // glitch unnested from that row
//   description         = glitchElement.description ?? null     // present pre-purge; the purge RPC
//                                                                 // (migration 078) physically removes
//                                                                 // this key from every element in the
//                                                                 // array when it runs, so `?? null`
//                                                                 // is the correct, sufficient guard —
//                                                                 // never a separate purge-aware branch
```

### 16.9 `/dashboard/admin/glitches/page.tsx` + `GlitchDashboardClient.tsx`

`page.tsx` — byte-for-byte the same shape as `app/dashboard/admin/clients/page.tsx` (16.2), substituting
`GlitchDashboardClient` for `PartnerBillingClient`. `GlitchDashboardClient.tsx` fetches both endpoints
(16.8) on mount, renders Panel 1 (summary) and Panel 2 (drill-down, with the two filter dropdowns) per
Requirement Doc Section 4.A/5.A, using the same table/loading/empty/error state components
`PartnerBillingClient.tsx` already established (no new shared UI primitive needed).

---

## 18. B2B-06 — Partner Provisioning (new)

Companion to `docs/specs/B2B-06-requirement-document.md` (v3 Feature Brief). Migration:
`supabase/migrations/079_b2b06_provisioning.sql` (079 is the next free number — 078 is B2B-09, verified
against the live `supabase/migrations/` directory listing, not assumed).

### 18.1 Schema — additive only

```sql
-- 1. partner_accounts: one new nullable column, keys a Clerk Organization to a partner account.
-- Nullable because internal-operator-provisioned accounts (v1/v2's recovery path, still preserved)
-- never have a Clerk Organization behind them.
ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS clerk_org_id TEXT UNIQUE;

-- 2. partner_sessions.end_reason: extend the existing CHECK constraint (migration 077) with the
-- funding-guardrail's own rejection reason. Same DROP-then-ADD pattern 077 itself used against 075's
-- inline default-named constraint.
ALTER TABLE partner_sessions DROP CONSTRAINT IF EXISTS partner_sessions_end_reason_check;
ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN ('trial_limit_reached', 'trial_exhausted', 'funding_required'));

-- 3. New table: partner_oauth_clients. Mirrors partner_api_keys's proven security shape exactly
-- (Requirement Doc Section 6) — never store a plaintext secret, hash it; keep a safe-to-display
-- identifier; mode test/live split preserved for the same billing-exclusion reason it exists on
-- partner_api_keys. Deliberately NOT an extension of partner_api_keys (client_id is a standalone
-- identifier, not a truncated prefix of a secret like key_prefix is).
CREATE TABLE IF NOT EXISTS partner_oauth_clients (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id    UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,

  mode                  TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('test', 'live')),

  client_id             TEXT NOT NULL,   -- e.g. "clio_client_a1b2c3d4e5f6..." — safe to display indefinitely
  client_secret_hash    TEXT NOT NULL,   -- SHA-256 hex digest of the full secret, never the plaintext
  label                 TEXT,            -- partner-assigned name, e.g. "Production integration"

  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),

  last_used_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_oauth_clients_client_id ON partner_oauth_clients(client_id);
CREATE INDEX IF NOT EXISTS idx_partner_oauth_clients_account ON partner_oauth_clients(partner_account_id);
CREATE INDEX IF NOT EXISTS idx_partner_oauth_clients_status ON partner_oauth_clients(status) WHERE status = 'active';

ALTER TABLE partner_oauth_clients ENABLE ROW LEVEL SECURITY;

-- No token-storage table — access tokens are stateless (Requirement Doc Section 6): verified by
-- signature + expiry, never looked up by value. The two status checks the verification path performs
-- (this table's own `status`, and partner_accounts.status) are reads of already-existing rows the
-- static-key path already reads identically, not a per-issued-token record.
CREATE POLICY "Service role full access on partner_oauth_clients"
  ON partner_oauth_clients FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE partner_oauth_clients IS 'B2B-06: OAuth2 Client Credentials (RFC 6749 §4.4) issuance. The v1/day-one self-serve default credential, per Arun''s direct instruction (docs/brainstorm-partner-signup-integration.md Decision #2) — not an extension of partner_api_keys, which is preserved as a secondary, internal-operator-only path.';
COMMENT ON COLUMN partner_accounts.clerk_org_id IS 'B2B-06: keys a Clerk Organization (self-serve signup) to this row. NULL for internal-operator-provisioned accounts (the v1/v2 recovery path), which never have a Clerk Organization.';

-- 4. partner_sessions: reconcile the auth-credential FK for OAuth2-authenticated sessions.
--
-- CEO review finding (2026-07-15, B2B-06 v3 spec review — see docs/specs/B2B-06-requirement-document.md
-- Version 3.1 changelog): POST /api/partner/v1/sessions inserts partner_api_key_id unconditionally on
-- every request (app/api/partner/v1/sessions/route.ts:51), but an OAuth2-authenticated request has no
-- partner_api_keys row at all — §18.3's OAuth2 branch resolves a partner_oauth_clients row instead and
-- returns apiKeyId: null. Because partner_api_key_id was NOT NULL (migration 071, line 177), every
-- OAuth2-authenticated session-create call would fail this column's NOT NULL constraint before the
-- test/live dispatch branch is ever reached — session creation, the core partner operation, was
-- uncallable via the mechanism this brief mandates as the v1/day-one default.
--
-- Fix: make partner_api_key_id nullable, add a new nullable partner_oauth_client_id FK alongside it
-- (mirrors the apiKeyId/clientId distinction now on PartnerApiKeyContext, §18.3), and require exactly
-- one of the two to be set — a partner_sessions row is always authenticated by exactly one credential
-- mechanism, never both, never neither, matching this table's own one-row-one-cause discipline already
-- established for end_reason above.
ALTER TABLE partner_sessions ALTER COLUMN partner_api_key_id DROP NOT NULL;

ALTER TABLE partner_sessions ADD COLUMN IF NOT EXISTS partner_oauth_client_id UUID
  REFERENCES partner_oauth_clients(id) ON DELETE RESTRICT;

ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_auth_credential_check
  CHECK (num_nonnulls(partner_api_key_id, partner_oauth_client_id) = 1);

CREATE INDEX IF NOT EXISTS idx_partner_sessions_oauth_client ON partner_sessions(partner_oauth_client_id)
  WHERE partner_oauth_client_id IS NOT NULL;

COMMENT ON COLUMN partner_sessions.partner_api_key_id IS 'B2B-06: nullable as of this migration — NULL for OAuth2-authenticated sessions (see partner_oauth_client_id). Exactly one of the two credential FKs is always set (partner_sessions_auth_credential_check).';
COMMENT ON COLUMN partner_sessions.partner_oauth_client_id IS 'B2B-06: set for OAuth2-authenticated sessions only. NULL for static-API-key-authenticated sessions (see partner_api_key_id). ON DELETE RESTRICT mirrors partner_api_key_id''s existing discipline — a session record must never be silently orphaned by credential deletion.';
```

### 18.2 `lib/partner/oauth.ts` — client generation, secret hashing, JWT sign/verify

New file, mirrors `lib/partner/api-keys.ts`'s exact shape for the generation/hash half, and hand-rolls a
minimal HS256 JWT (no new npm dependency — `package.json` confirms no JWT library is present; this
follows the exact precedent `lib/partner/webhook-signature.ts` already set for hand-rolled HMAC
primitives on Node's built-in `crypto`, per `CLAUDE.md`'s no-new-dependency-without-justification rule).

```typescript
import crypto from 'crypto'

export type OAuthClientMode = 'test' | 'live'

export interface GeneratedOAuthClient {
  clientId: string
  /** Full plaintext secret. Shown to the caller exactly once — never store this value. */
  clientSecret: string
  clientSecretHash: string
}

/** Generates a new OAuth2 client_id/client_secret pair. Never logs the plaintext secret. */
export function generateOAuthClient(mode: OAuthClientMode): GeneratedOAuthClient {
  const clientId = `clio_client_${crypto.randomBytes(16).toString('hex')}`
  const clientSecret = `clio_secret_${crypto.randomBytes(24).toString('hex')}`
  return { clientId, clientSecret, clientSecretHash: hashClientSecret(clientSecret) }
}

export function hashClientSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex')
}

/** 3-segment JWT shape check — cheap pre-filter before attempting signature verification. */
export function looksLikeOAuthAccessToken(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
}

export interface OAuthTokenClaims {
  sub: string              // client_id
  partner_account_id: string
  mode: OAuthClientMode
  iat: number
  exp: number
  jti: string
}

const TOKEN_TTL_SECONDS = 3600 // 1 hour — BA technical judgment call, Requirement Doc Section 4.B.2

function deriveSigningSecret(): string {
  const secret = process.env.PARTNER_OAUTH_TOKEN_SIGNING_SECRET
  return secret && !secret.startsWith('PLACEHOLDER_') ? secret : 'clio-dev-only-fallback-oauth-signing-key'
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/** Signs a hand-rolled HS256 JWT. No external JWT library — see file header. */
export function signAccessToken(clientId: string, partnerAccountId: string, mode: OAuthClientMode): { token: string; expiresIn: number } {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const claims: OAuthTokenClaims = {
    sub: clientId,
    partner_account_id: partnerAccountId,
    mode,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID(),
  }
  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(claims))
  const signature = crypto
    .createHmac('sha256', deriveSigningSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url')
  return { token: `${encodedHeader}.${encodedPayload}.${signature}`, expiresIn: TOKEN_TTL_SECONDS }
}

/** Verifies signature + expiry only (stateless) — caller is responsible for the two DB status checks (Section 18.3). */
export function verifyAccessToken(token: string): { valid: true; claims: OAuthTokenClaims } | { valid: false } {
  const parts = token.split('.')
  if (parts.length !== 3) return { valid: false }
  const [encodedHeader, encodedPayload, signature] = parts

  const expectedSig = crypto
    .createHmac('sha256', deriveSigningSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url')

  const expectedBuf = Buffer.from(expectedSig)
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false }
  }

  try {
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as OAuthTokenClaims
    if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return { valid: false }
    return { valid: true, claims }
  } catch {
    return { valid: false }
  }
}
```

### 18.3 `lib/partner/auth.ts` — `requirePartnerApiKey()` extension

Exact insertion point: after the existing `looksLikePartnerApiKey(rawKey)` check fails, before the
existing `invalid_api_key` 401 return. Zero changes to the function's exported *signature* —
`sessions`/`usage`/`wallet` route call sites need no changes to how they *call*
`requirePartnerApiKey()` (Requirement Doc Section 4.B.2 point 3) — but the returned context shape
gains one field, `clientId`, alongside the existing `apiKeyId` (CEO review, 2026-07-15: see §18.1 step
4's changelog note for why this pair is now required, not just `apiKeyId: null`).

**Type changes** — `PartnerApiKeyContext` and `PartnerApiKeyResult`:

```typescript
export interface PartnerApiKeyContext {
  partnerAccountId: string
  /** Set for a static-API-key-authenticated request (the partner_api_keys.id row). Null for OAuth2. */
  apiKeyId: string | null
  /** Set for an OAuth2-authenticated request (the partner_oauth_clients.id row, NOT the public
   *  client_id string). Null for a static-API-key request. Exactly one of apiKeyId/clientId is ever
   *  non-null on a successful result — mirrors partner_sessions' own auth-credential CHECK
   *  constraint (§18.1 step 4) that this field pair exists specifically to satisfy. */
  clientId: string | null
  mode: 'test' | 'live'
}

type PartnerApiKeyResult =
  | (PartnerApiKeyContext & { error: null })
  | { partnerAccountId: null; apiKeyId: null; clientId: null; mode: null; error: NextResponse }
```

**Code changes** — every existing early-return in the static-key path (the four `partnerAccountId:
null, apiKeyId: null, mode: null, error: ...` returns already in the live file, one each for
malformed key / key not found / revoked key / suspended account / rate-limited) gains `clientId: null`
alongside the existing `apiKeyId: null`, and the function's final success return
(`{ partnerAccountId: accountRow.id, apiKeyId: keyRow.id, mode: keyRow.mode, error: null }`) gains
`clientId: null` alongside `apiKeyId: keyRow.id` — a mechanical, type-driven addition to every existing
return statement, not a behavior change to the static-key path itself. The new OAuth2 branch below is
the only place `clientId` is ever set to a non-null value:

```typescript
// Existing static-key path, unchanged in behavior — every existing return in this branch now also
// includes `clientId: null` (mechanical addition, shown inline below only where new code is added):
if (!rawKey || !looksLikePartnerApiKey(rawKey)) {
  // NEW: fall through to OAuth2 token verification before giving up.
  if (rawKey && looksLikeOAuthAccessToken(rawKey)) {
    const verified = verifyAccessToken(rawKey)
    if (verified.valid) {
      const supabase = createSupabaseAdminClient()

      const { data: clientRow } = await supabase
        .from('partner_oauth_clients')
        .select('id, status')
        .eq('client_id', verified.claims.sub)
        .maybeSingle()

      const { data: accountRow } = await supabase
        .from('partner_accounts')
        .select('id, status')
        .eq('id', verified.claims.partner_account_id)
        .maybeSingle()

      if (clientRow?.status === 'active' && accountRow) {
        if (accountRow.status !== 'active') {
          return { partnerAccountId: null, apiKeyId: null, clientId: null, mode: null, error: NextResponse.json(errorEnvelope('account_suspended', 'This partner account is suspended.'), { status: 403 }) }
        }

        const rateLimit = checkRateLimit(accountRow.id, routeClass)
        if (!rateLimit.allowed) {
          const res = NextResponse.json(errorEnvelope('rate_limit_exceeded', 'Rate limit exceeded.'), { status: 429 })
          res.headers.set('Retry-After', String(rateLimit.retryAfterSeconds))
          return { partnerAccountId: null, apiKeyId: null, clientId: null, mode: null, error: res }
        }

        // Best-effort, non-blocking — mirrors the static-key path's own last_used_at update.
        supabase.from('partner_oauth_clients').update({ last_used_at: new Date().toISOString() }).eq('id', clientRow.id)
          .then(undefined, (err: unknown) => console.error('[partner/auth] oauth last_used_at update failed (non-fatal):', err))

        // clientId is the partner_oauth_clients row id (clientRow.id) — the FK value
        // app/api/partner/v1/sessions/route.ts writes into partner_sessions.partner_oauth_client_id
        // (§18.7), exactly parallel to how apiKeyId already carries keyRow.id, not the raw key string.
        return { partnerAccountId: accountRow.id, apiKeyId: null, clientId: clientRow.id, mode: verified.claims.mode, error: null }
      }
    }
  }

  return {
    partnerAccountId: null, apiKeyId: null, clientId: null, mode: null,
    error: NextResponse.json(errorEnvelope('invalid_api_key', 'Missing or malformed API key.'), { status: 401 }),
  }
}
// Existing static-key lookup path continues from here down, unchanged in behavior; its own
// pre-existing return statements each gain `clientId: null` alongside their existing `apiKeyId: ...`.
```

`PartnerApiKeyContext.apiKeyId` is `null` for an OAuth2-authenticated request, and `.clientId` is
`null` for a static-API-key-authenticated request — a documented, additive shape difference
(Requirement Doc Section 5.B.2). The one call site that reads either field —
`app/api/partner/v1/sessions/route.ts`'s `partner_sessions` insert — is updated in §18.7 below to
write whichever of `partner_api_key_id`/`partner_oauth_client_id` corresponds to the non-null field,
satisfying the `partner_sessions_auth_credential_check` constraint added in §18.1 step 4. (This
replaces the prior draft's unresolved "developer note: verify this FK column's own nullability during
implementation" — the CEO's 2026-07-15 review confirmed the column was in fact NOT NULL and would have
failed on every OAuth2-authenticated call; §18.1 step 4 and this section's `clientId` field are the
resolution, not a build-time check left for later.)

### 18.4 `POST /api/partner/v1/oauth/token/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { hashClientSecret, signAccessToken } from '@/lib/partner/oauth'
import { checkRateLimit } from '@/lib/partner/rate-limit'

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? ''
  let grantType: string | null, clientId: string | null, clientSecret: string | null

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(await request.text())
    grantType = form.get('grant_type')
    clientId = form.get('client_id')
    clientSecret = form.get('client_secret')
  } else {
    const body = await request.json().catch(() => ({}))
    grantType = body.grant_type ?? null
    clientId = body.client_id ?? null
    clientSecret = body.client_secret ?? null
  }

  if (grantType !== 'client_credentials' || !clientId || !clientSecret) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'grant_type must be client_credentials.' }, { status: 400 })
  }

  const rateLimit = checkRateLimit(clientId, 'oauth_token')
  if (!rateLimit.allowed) {
    const res = NextResponse.json({ error: 'invalid_request', error_description: 'Rate limit exceeded.' }, { status: 429 })
    res.headers.set('Retry-After', String(rateLimit.retryAfterSeconds))
    return res
  }

  const supabase = createSupabaseAdminClient()
  const { data: clientRow } = await supabase
    .from('partner_oauth_clients')
    .select('id, partner_account_id, mode, status, client_secret_hash')
    .eq('client_id', clientId)
    .maybeSingle()

  if (!clientRow || clientRow.status !== 'active' || clientRow.client_secret_hash !== hashClientSecret(clientSecret)) {
    return NextResponse.json({ error: 'invalid_client', error_description: 'Client authentication failed.' }, { status: 401 })
  }

  const { data: accountRow } = await supabase
    .from('partner_accounts')
    .select('id, status')
    .eq('id', clientRow.partner_account_id)
    .maybeSingle()

  if (!accountRow || accountRow.status !== 'active') {
    return NextResponse.json({ error: 'invalid_client', error_description: 'This partner account is suspended.' }, { status: 403 })
  }

  const { token, expiresIn } = signAccessToken(clientRow.client_id ?? clientId, accountRow.id, clientRow.mode as 'test' | 'live')

  supabase.from('partner_oauth_clients').update({ last_used_at: new Date().toISOString() }).eq('id', clientRow.id)
    .then(undefined, (err: unknown) => console.error('[oauth/token] last_used_at update failed (non-fatal):', err))

  return NextResponse.json({ access_token: token, token_type: 'Bearer', expires_in: expiresIn })
}
```

`lib/partner/rate-limit.ts`'s `RateLimitClass` union gains one new value, `'oauth_token'` (20 req/min),
keyed by `client_id` rather than `partner_account_id` (the account isn't resolved until after a
successful secret hash-compare) — a one-line addition to the existing `LIMITS` record, no change to the
bucket mechanism itself.

### 18.5 Rate limit table addition

```typescript
export type RateLimitClass = 'sessions_create' | 'reads' | 'oauth_token'

const LIMITS: Record<RateLimitClass, { capacity: number; refillPerMs: number }> = {
  sessions_create: { capacity: 60, refillPerMs: 60 / 60_000 },
  reads: { capacity: 300, refillPerMs: 300 / 60_000 },
  oauth_token: { capacity: 20, refillPerMs: 20 / 60_000 }, // B2B-06 — keyed by client_id, not partner_account_id
}
```

### 18.6 `app/api/webhooks/clerk-organization/route.ts`

New route, structurally identical to the existing `app/api/webhooks/clerk/route.ts` (svix verify →
switch on event type), never merged into that file.

```typescript
import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendPartnerSignupWelcomeEmail } from '@/lib/delivery/email'
import { inngest } from '@/inngest/client'

interface ClerkOrgCreatedEvent {
  type: 'organization.created'
  data: { id: string; name: string; created_by: string }
}
interface ClerkOrgMembershipCreatedEvent {
  type: 'organizationMembership.created'
  data: { organization: { id: string }; public_user_data: { user_id: string; identifier: string } }
}
type ClerkOrgEvent = ClerkOrgCreatedEvent | ClerkOrgMembershipCreatedEvent | { type: string; data: unknown }

export async function POST(request: Request) {
  const secret = process.env.CLERK_ORGANIZATION_WEBHOOK_SECRET
  if (!secret) {
    console.error('[clerk-org-webhook] CLERK_ORGANIZATION_WEBHOOK_SECRET not set')
    return new NextResponse('Webhook secret not configured', { status: 500 })
  }

  const headersList = headers()
  const svixId = headersList.get('svix-id')
  const svixTimestamp = headersList.get('svix-timestamp')
  const svixSignature = headersList.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse('Missing svix headers', { status: 400 })
  }

  const body = await request.text()
  let event: ClerkOrgEvent
  try {
    const wh = new Webhook(secret)
    event = wh.verify(body, { 'svix-id': svixId, 'svix-timestamp': svixTimestamp, 'svix-signature': svixSignature }) as ClerkOrgEvent
  } catch (err) {
    console.error('[clerk-org-webhook] Signature verification failed:', err)
    return new NextResponse('Invalid signature', { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  if (event.type === 'organization.created') {
    const data = event.data as ClerkOrgCreatedEvent['data']
    const { data: account, error } = await supabase
      .from('partner_accounts')
      .upsert({ clerk_org_id: data.id, name: data.name, archetype: 'unspecified', status: 'active' }, { onConflict: 'clerk_org_id', ignoreDuplicates: true })
      .select('id')
      .maybeSingle()

    const partnerAccountId = account?.id ?? (await supabase.from('partner_accounts').select('id').eq('clerk_org_id', data.id).single()).data?.id

    if (!error && partnerAccountId) {
      inngest.send({ name: 'clio/partner-org.created', data: { partnerAccountId, orgName: data.name, createdAt: new Date().toISOString() } })
        .catch((err: unknown) => console.error('[clerk-org-webhook] Failed to emit clio/partner-org.created:', err))
    }
    return NextResponse.json({ received: true })
  }

  if (event.type === 'organizationMembership.created') {
    const data = event.data as ClerkOrgMembershipCreatedEvent['data']
    const { data: account } = await supabase.from('partner_accounts').select('id').eq('clerk_org_id', data.organization.id).maybeSingle()

    if (!account) {
      // organization.created hasn't landed yet (delivery race) — non-2xx so Clerk redelivers.
      return new NextResponse('Organization not yet provisioned', { status: 409 })
    }

    const { count } = await supabase
      .from('partner_admin_users')
      .select('id', { count: 'exact', head: true })
      .eq('partner_account_id', account.id)

    const role = (count ?? 0) === 0 ? 'owner' : 'admin'

    const { error: insertError } = await supabase
      .from('partner_admin_users')
      .upsert({ clerk_user_id: data.public_user_data.user_id, partner_account_id: account.id, role }, { onConflict: 'clerk_user_id,partner_account_id', ignoreDuplicates: true })

    if (!insertError && role === 'owner') {
      const { data: orgRow } = await supabase.from('partner_accounts').select('name').eq('id', account.id).single()
      await sendPartnerSignupWelcomeEmail(data.public_user_data.identifier, orgRow?.name ?? 'your organization')
        .catch((err: unknown) => console.error('[clerk-org-webhook] sendPartnerSignupWelcomeEmail failed:', err))
    }

    return NextResponse.json({ received: true })
  }

  return NextResponse.json({ received: true })
}
```

`middleware.ts`'s `isPublicRoute` matcher gains `/partner-signup(.*)` (the two new signup pages) and
`/api/webhooks/(.*)` already covers the new webhook route (existing wildcard, unmodified).

### 18.7 `app/api/partner/v1/sessions/route.ts` — auth-credential FK fix + funding guardrail insertion

Two changes to this existing, live route, both required by this document — not one:

**18.7.1 — Fix the `partner_sessions` insert to write the correct credential FK (CEO review finding,
2026-07-15).** The live file's insert (currently `app/api/partner/v1/sessions/route.ts:51`) writes
`partner_api_key_id: auth.apiKeyId` unconditionally. Per §18.1 step 4 and §18.3, an OAuth2-authenticated
request now resolves `auth.clientId` instead, with `auth.apiKeyId` null — the insert must write
whichever of the pair is non-null into whichever of `partner_api_key_id`/`partner_oauth_client_id` is
non-null, satisfying `partner_sessions_auth_credential_check`. Exact diff, replacing the existing
`partner_api_key_id: auth.apiKeyId,` line inside the existing `.insert({...})` call:

```typescript
  const { data: inserted, error: insertError } = await supabase
    .from('partner_sessions')
    .insert({
      partner_account_id: auth.partnerAccountId,
      // B2B-06: exactly one of these two is non-null on any successful auth result (§18.3) —
      // satisfies partner_sessions_auth_credential_check (§18.1 step 4). Replaces the prior
      // unconditional `partner_api_key_id: auth.apiKeyId` line, which NOT NULL-violated on every
      // OAuth2-authenticated request before this fix.
      partner_api_key_id: auth.apiKeyId,
      partner_oauth_client_id: auth.clientId,
      test_mode: auth.mode === 'test',
      meeting_url,
      partner_topic_ref: partner_topic_ref ?? null,
      content_ref: content_ref ?? null,
      partner_end_user_ref: partner_end_user_ref ?? null,
      partner_reference: partner_reference ?? null,
      status: 'requested',
    })
    .select('id')
    .single()
```

**18.7.2 — Funding guardrail.** Exact diff, inserted at the file's own already-annotated location
(between the `partner_sessions` insert and the `auth.mode === 'live'` comment block):

```typescript
  // auth.mode === 'live' — B2B-06 funding guardrail, inserted here per this file's own reserved comment.
  const { data: wallet } = await supabase
    .from('partner_wallets')
    .select('stripe_default_payment_method_id')
    .eq('partner_account_id', auth.partnerAccountId)
    .maybeSingle()

  if (!wallet || !wallet.stripe_default_payment_method_id) {
    await supabase
      .from('partner_sessions')
      .update({ status: 'failed', end_reason: 'funding_required' })
      .eq('id', clioSessionRef)

    return NextResponse.json(
      { error: { code: 'funding_required', message: 'Add a payment method before starting a live session. Test-mode sessions remain unaffected.' } },
      { status: 402 }
    )
  }

  const dispatchResult = await dispatchMeetingBot({ clioSessionRef, meetingUrl: meeting_url, renderUrl })
  // ... unchanged from here down
```

### 18.8 `app/api/admin/configurator/oauth-clients/route.ts`

`POST`/`GET`, Clerk-authenticated via `requirePartnerAdmin(partner_account_id)`, structurally identical
to `app/api/admin/partner-keys/route.ts` (Section headers reproduced in Requirement Doc 4.B.3/4.B.4) —
substitutes `generateOAuthClient()`/`hashClientSecret()` (18.2) for `generateApiKey()`, and the
`partner_oauth_clients` table for `partner_api_keys`. Not reproduced line-for-line here since it is a
direct structural copy with a different table/generator — a developer implements this by following
`admin/partner-keys/route.ts` as the literal template, substituting per Requirement Doc Section 4.B.3/4.B.4's
exact field names.

### 18.9 `app/api/admin/configurator/outbound-config/route.ts` (GET) + pass-through PATCH

```typescript
// GET
export async function GET(request: NextRequest) {
  const partnerAccountId = new URL(request.url).searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('outbound_base_url, outbound_auth_token_ciphertext, outbound_signing_secret')
    .eq('id', partnerAccountId)
    .maybeSingle()

  return NextResponse.json({
    outbound_base_url: data?.outbound_base_url ?? null,
    outbound_auth_token_set: Boolean(data?.outbound_auth_token_ciphertext),
    outbound_signing_secret_set: Boolean(data?.outbound_signing_secret),
  })
}

// PATCH — pure pass-through, re-exports the existing handler's logic against the same table/columns;
// a developer may literally re-export the existing route's POST handler function here rather than
// duplicating it, since the request/response contract is identical (Requirement Doc Section 4.B.5).
export { PATCH } from '@/app/api/admin/partner-accounts/[id]/outbound-config/route'
```

(Developer note: the existing route's handler signature takes `{ params: { id: string } }` from the
dynamic segment; this new flat route takes `partner_account_id` from the request body instead — the
literal `export { PATCH }` re-export shown above is illustrative of intent, not necessarily valid as
written given the signature mismatch. The actual implementation should have this route's own thin
`PATCH` handler that extracts `partner_account_id` from the body and calls the existing
`outbound-config` route's underlying update logic directly, or simply duplicates its ~15-line body. This
is a small, mechanical implementation detail, not a spec ambiguity.)

### 18.10 `app/api/admin/configurator/integration/test-outbound/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { buildSignatureHeader } from '@/lib/partner/webhook-signature'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const partnerAccountId = body?.partner_account_id
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('outbound_base_url, outbound_signing_secret')
    .eq('id', partnerAccountId)
    .maybeSingle()

  if (!account?.outbound_base_url || !account?.outbound_signing_secret) {
    return NextResponse.json({ error: { code: 'outbound_not_configured', message: 'Set your outbound base URL and signing secret first.' } }, { status: 422 })
  }

  const payload = { event_id: `test-${crypto.randomUUID()}`, event_type: 'webhook.test', occurred_at: new Date().toISOString(), test: true }
  const rawBody = JSON.stringify(payload)
  const signature = buildSignatureHeader(account.outbound_signing_secret, rawBody)
  const url = `${account.outbound_base_url.replace(/\/$/, '')}/webhooks/usage`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Clio-Signature': signature }, body: rawBody, signal: controller.signal })
      .finally(() => clearTimeout(timeout))

    return NextResponse.json({ success: res.ok, status_code: res.status, ...(res.ok ? {} : { error: `Received HTTP ${res.status}.` }) })
  } catch {
    return NextResponse.json({ success: false, status_code: null, error: 'Could not reach the endpoint (timeout or connection refused).' })
  }
}
```
Deliberately never writes to `webhook_dispatch_log` (Requirement Doc Section 4.B.6) — this is a
synchronous, ephemeral test call, not a queued/audited billing event.

### 18.11 `inngest/partner-signup-reminder.ts`

```typescript
import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { clerkClient } from '@clerk/nextjs/server'
import { sendPartnerSignupReminderEmail } from '@/lib/delivery/email'

export const partnerSignupReminder = inngest.createFunction(
  { id: 'partner-signup-reminder', name: 'Partner Signup Reminder', triggers: [{ event: 'clio/partner-org.created' }], retries: 2 },
  async ({ event, step }) => {
    await step.sleep('wait-24h', '24h')

    await step.run('check-and-remind', async () => {
      const { partnerAccountId, orgName } = event.data as { partnerAccountId: string; orgName: string }
      const supabase = createSupabaseAdminClient()

      const { data: account } = await supabase
        .from('partner_accounts')
        .select('onboarding_completed_at')
        .eq('id', partnerAccountId)
        .maybeSingle()

      if (!account || account.onboarding_completed_at) return // finished on their own — no reminder needed

      const { data: owner } = await supabase
        .from('partner_admin_users')
        .select('clerk_user_id')
        .eq('partner_account_id', partnerAccountId)
        .eq('role', 'owner')
        .maybeSingle()

      if (!owner) return // no owner resolved yet — nothing to email

      const clerkUser = await clerkClient().users.getUser(owner.clerk_user_id as string)
      const email = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress
      if (email) await sendPartnerSignupReminderEmail(email, orgName)
    })
  }
)
```
Registered in `app/api/inngest/route.ts`'s existing function-list array alongside every other Inngest
function (one-line addition, not reproduced here — matches the existing registration convention).

### 18.12 `lib/delivery/email.ts` — two new functions

`sendPartnerSignupWelcomeEmail(email, orgName)` and `sendPartnerSignupReminderEmail(email, orgName)`
follow `sendSignupWelcomeEmail()`'s exact shape (isPlaceholder-guarded mock, `Promise<EmailResult>`
return, `resend.emails.send()` call) with B2B-appropriate copy (not reused B2C copy, per Known
Constraints) — e.g. welcome subject `"Welcome to Clio — let's get {orgName} set up"`, linking to
`/dashboard/configurator`; reminder subject `"Finish setting up {orgName} on Clio"`, same link. Full copy
is a content decision within BA/dev authority per the existing precedent that email body copy is not
spec'd word-for-word in this repo's prior BA documents either (e.g. B2B-04's `sendLowBalanceAlertEmail`).

## 17. B2B-07 — Developer Portal (Documentation + Playground) (new)

Companion to `docs/specs/B2B-07-requirement-document.md`. **No migration** — this brief adds no schema
(Requirement Doc Section 6). No new API route of Clio's own either — the Playground calls the four already-live
`/api/partner/v1/*` routes directly from the browser.

### 17.1 File layout

```
app/dashboard/configurator/developer/
  page.tsx                    — server component, auth/onboarding gate (identical shape to
                                 app/dashboard/configurator/topics/page.tsx, Requirement Doc Section 3)
  DeveloperDocsClient.tsx      — 'use client', renders the static reference content (17.2)
  content.ts                   — the hand-authored TypeScript constants (17.2), imported by both
                                 DeveloperDocsClient.tsx and PlaygroundClient.tsx (example payloads are
                                 shared, not duplicated)
  playground/
    page.tsx                  — server component, identical gate shape to ../page.tsx
    PlaygroundClient.tsx       — 'use client', the interactive Send/response flow (17.3)
```

### 17.2 `content.ts` — the documentation source of truth

```ts
// app/dashboard/configurator/developer/content.ts
//
// Hand-transcribed from the live route files cited in the Requirement Doc's header, verified against
// them directly (not from any other spec doc, which can drift). Update this file whenever any of those
// four routes' request/response contract changes — a stale reference here is worse than none, matching
// this repo's existing docs/reference-vendor-api-integrations.md convention.

export type PlaygroundEndpointId = 'sessions_create' | 'sessions_get' | 'usage' | 'wallet'

export interface EndpointDoc {
  id: PlaygroundEndpointId
  method: 'GET' | 'POST'
  path: string                 // display path, e.g. '/api/partner/v1/sessions/:clio_session_ref'
  purpose: string
  rateLimit: string
  requestFields?: { field: string; type: string; required: string; notes: string }[]
  queryParams?: { param: string; type: string; default: string; notes: string }[]
  pathParam?: { name: string; type: string; notes: string }
  exampleRequestBody?: object   // undefined for GET endpoints with no body
  exampleResponse: object
  responseNotes: string[]       // rendered as a bullet list under the example response
  otherResponses: { status: string; meaning: string }[]
  playgroundDisabled: boolean
  playgroundDisabledReason?: string
}

export const ENDPOINTS: EndpointDoc[] = [
  {
    id: 'sessions_create',
    method: 'POST',
    path: '/api/partner/v1/sessions',
    purpose: 'Starts a new Clio session — dispatches a real meeting bot into the given URL and provisions the live voice/visual experience.',
    rateLimit: '60 requests/minute per partner account.',
    requestFields: [
      { field: 'meeting_url', type: 'string (URL)', required: 'Yes', notes: 'Must be a valid URL.' },
      { field: 'partner_topic_ref', type: 'string', required: 'No*', notes: '1–512 printable-ASCII chars.' },
      { field: 'content_ref', type: 'string (UUID)', required: 'No*', notes: '' },
      { field: 'partner_end_user_ref', type: 'string', required: 'No', notes: '1–256 printable-ASCII chars.' },
      { field: 'partner_reference', type: 'string', required: 'No', notes: '1–256 printable-ASCII chars. Echoed on every usage webhook for this session.' },
    ],
    exampleRequestBody: { meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'onboarding-101', partner_reference: 'acct_492' },
    exampleResponse: { clio_session_ref: 'uuid', status: 'bot_active', render_url: 'string' },
    responseNotes: [
      '* At least one of partner_topic_ref or content_ref is required.',
      '401/403/429 use { error: { code, message, request_id } }.',
      '402/500 use { error: { code, message } } — no request_id.',
      '422 uses { error: "Validation failed", details } — error is a plain string here, not an object.',
    ],
    otherResponses: [
      { status: '401', meaning: 'invalid_api_key / revoked_api_key' },
      { status: '402', meaning: 'trial_exhausted (test-mode keys only, once the free 20-minute allowance is used up)' },
      { status: '403', meaning: 'account_suspended' },
      { status: '422', meaning: 'validation failure' },
      { status: '429', meaning: 'rate limit exceeded, Retry-After header present' },
    ],
    playgroundDisabled: true,
    playgroundDisabledReason:
      "Live testing for this endpoint is temporarily disabled. Dispatching a session sends a real meeting bot into the meeting URL you provide — Clio's current test-mode safeguard does not yet prevent this for every account state, so this Playground does not enable it until that's fixed. The request/response shape above is accurate; you just can't send it from here yet.",
  },
  {
    id: 'sessions_get',
    method: 'GET',
    path: '/api/partner/v1/sessions/:clio_session_ref',
    purpose: 'Reads the current status of a session you previously created.',
    rateLimit: '300 requests/minute per partner account.',
    pathParam: { name: 'clio_session_ref', type: 'UUID', notes: 'Required.' },
    exampleResponse: { clio_session_ref: 'uuid', status: 'bot_active', created_at: 'ISO 8601', ended_at: null },
    responseNotes: ['Never includes provider_bot_id, provider_name, or meeting_url — internal-only fields.'],
    otherResponses: [
      { status: '401/403', meaning: 'same as sessions_create' },
      { status: '404', meaning: 'not_found — identical whether the ref does not exist or belongs to a different partner' },
    ],
    playgroundDisabled: false,
  },
  {
    id: 'usage',
    method: 'GET',
    path: '/api/partner/v1/usage',
    purpose: "Reads your account's own billable usage history — one row per metered event.",
    rateLimit: '300 requests/minute per partner account.',
    queryParams: [
      { param: 'from', type: 'ISO 8601 string', default: '30 days ago', notes: '' },
      { param: 'to', type: 'ISO 8601 string', default: 'now', notes: '' },
      { param: 'event_type', type: '"usage.voice_minute" | "usage.llm_generation_call" | "session.completed"', default: '(all types)', notes: 'session.completed always returns an empty events array.' },
      { param: 'cursor', type: 'opaque base64 string', default: '(first page)', notes: 'From the previous response next_cursor.' },
    ],
    exampleResponse: { events: [{ event_id: 'uuid', event_type: 'usage.voice_minute', quantity: 2.0, unit: 'minutes', test_mode: false, delivery_status: 'delivered' }], next_cursor: null },
    responseNotes: ['Always filtered to test_mode = false.', 'Page size 100.'],
    otherResponses: [
      { status: '401/403', meaning: 'same as sessions_create' },
      { status: '422', meaning: 'invalid event_type (string-error shape, same as sessions_create)' },
      { status: '429', meaning: 'rate limit exceeded' },
    ],
    playgroundDisabled: false,
  },
  {
    id: 'wallet',
    method: 'GET',
    path: '/api/partner/v1/wallet',
    purpose: 'Reads your current prepaid balance, per-event-type burn rate, and projected days-until-exhausted.',
    rateLimit: '300 requests/minute per partner account.',
    exampleResponse: {
      balance_usd: 42.315,
      reference_topup_amount_usd: 100.0,
      low_balance_alert_active: false,
      burn_rate_by_event_type: [{ event_type: 'voice_minute', unit: 'minute', rate_usd: 0.015, rate_basis: 'cogs_placeholder_2026_05_no_margin' }],
      avg_daily_burn_usd: 1.203,
      projected_days_remaining: 35.2,
      days_remaining_null_reason: null,
      next_billing_date: '2026-08-13T00:00:00Z',
      updated_at: '2026-07-13T19:00:00Z',
    },
    responseNotes: [
      'burn_rate_by_event_type always lists all 8 current event types; rate_usd: null means no rate configured yet.',
      'No explicit 4xx handling beyond auth — a DB read failure surfaces as a generic, unstructured 500.',
    ],
    otherResponses: [{ status: '401/403', meaning: 'same as usage' }],
    playgroundDisabled: false,
  },
]

export const WEBHOOK_DOC = {
  path: 'POST {your outbound_base_url}/webhooks/usage',
  payloadFields: ['event_id', 'event_type', 'clio_session_ref', 'partner_reference', 'quantity', 'unit', 'generation_type', 'occurred_at', 'dispatched_at', 'test_mode'],
  signatureHeader: 'Clio-Signature: t=<unix_timestamp>,v1=<hex_hmac>',
  verificationRecipe: 'HMAC-SHA256(signing_secret, `${t}.${raw_body}`), constant-time compare, reject if |now - t| > 300s.',
  retrySchedule: '1m, 5m, 30m, 2h, 6h (5 attempts total, then marked exhausted).',
  knownGap: 'No transcript, action-item, glitch, or psychology data in this payload today — usage/billing fields only.',
}
```

### 17.3 `PlaygroundClient.tsx` — Send mechanics

```ts
// Simplified to the load-bearing logic (Requirement Doc Section 4.B/7).

async function handleSend(endpoint: EndpointDoc, apiKey: string, editorValue: string, pathParamValue: string) {
  if (endpoint.playgroundDisabled) return // belt-and-suspenders — the button has no onClick wired at all
                                           // in this state; this guard is defense-in-depth, not the only gate.
  if (!apiKey) { setValidationError('Enter an API key first.'); return }

  let url = endpoint.path
  const init: RequestInit = { method: endpoint.method, headers: { Authorization: `Bearer ${apiKey}` } }

  if (endpoint.id === 'sessions_get') {
    url = url.replace(':clio_session_ref', encodeURIComponent(pathParamValue))
  } else if (endpoint.id === 'usage') {
    let params: Record<string, string>
    try { params = JSON.parse(editorValue || '{}') }
    catch (e) { setValidationError(`Not valid JSON: ${(e as Error).message}`); return }
    const qs = new URLSearchParams(params).toString()
    if (qs) url += `?${qs}`
  }
  // 'wallet' — no path param, no query params, no body.
  // 'sessions_create' — unreachable here; playgroundDisabled short-circuits above.

  setValidationError(null)
  setSending(true)
  try {
    const res = await fetch(url, init)
    const body = await res.json().catch(() => null)
    setResponse({ status: res.status, retryAfter: res.headers.get('Retry-After'), body })
  } catch {
    setResponse({ networkError: true })
  } finally {
    setSending(false)
  }
}
```

Not persisted: `apiKey` state is never written to `localStorage`/`sessionStorage` (Requirement Doc Section
6/9) — plain `useState`, cleared on navigation/reload by React's own unmount behavior, no explicit clear
logic needed.

### 17.4 Auth/onboarding gate — identical to every existing Configurator screen

```ts
// app/dashboard/configurator/developer/page.tsx (and playground/page.tsx, identical shape)
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPartnerAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { NoPartnerAccounts } from '../_shared'
import DeveloperDocsClient from './DeveloperDocsClient'

export default async function DeveloperDocsPage({ searchParams }: { searchParams: { partner_account_id?: string } }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const accounts = await getPartnerAccountsForClerkUser(userId)
  if (accounts.length === 0) return <NoPartnerAccounts />

  const activeId = searchParams.partner_account_id && accounts.some((a) => a.id === searchParams.partner_account_id)
    ? searchParams.partner_account_id
    : accounts[0].id

  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('onboarding_completed_at')
    .eq('id', activeId)
    .single()

  if (!account?.onboarding_completed_at) {
    redirect(`/dashboard/configurator/wizard?partner_account_id=${activeId}`)
  }

  return <DeveloperDocsClient accounts={accounts} activePartnerAccountId={activeId} />
}
```

Byte-for-byte the same shape as `app/dashboard/configurator/topics/page.tsx` — no new gate logic invented
for these two screens (Requirement Doc Section 3).

### 17.5 The `dispatchMeetingBot()` test-mode gap — not fixed by this brief, named for the record

Confirmed by direct read, not assumed: `lib/partner/session-init.ts`'s `dispatchMeetingBot()` calls
`provider.createBot()` (`session-init.ts:57-61`) with no `test_mode` parameter and no conditional branch of
any kind. `app/api/partner/v1/sessions/route.ts`'s B2B-08 gate (lines 75-126) only prevents this call when
`availableMinutes <= 0`; whenever any trial/test-block allowance remains, the call proceeds identically to a
`live`-mode request. This document's Playground therefore ships `sessions_create.playgroundDisabled = true`
(17.2) rather than wiring a real Send for that endpoint. Re-enabling it requires either (a) a `test_mode`
branch added to `dispatchMeetingBot()`/`session-init.ts` itself, or (b) a confirmed-equivalent guard — neither
is built by this section. When either lands, the follow-on change to this brief's own code is small: flip
`playgroundDisabled` to `false` for `sessions_create` in `content.ts`, and add the client-side
test-mode-only restriction the original Feature Brief's Q3 named (reject a `clio_live_sk_...` key client-side
for this one endpoint specifically) as the layered guard on top of the now-real server-side fix.
