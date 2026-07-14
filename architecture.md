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
