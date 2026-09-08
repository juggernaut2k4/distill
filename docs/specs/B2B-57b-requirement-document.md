# Reseller Dashboard: Webhook Delivery / Usage Log View — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-30

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Per this project's standing rule that specs must be grounded in real code, every load-bearing claim in
the CEO brief (`.claude/agents/clio/feature-briefs/B2B-57b-reseller-dashboard-webhook-usage-log.md`) was
re-checked directly against source, not assumed:

- **`webhook_dispatch_log` schema** (`supabase/migrations/071_b2b02_partner_accounts_and_api_keys.sql`
  lines 233-258, widened by `078_b2b09_session_delivery_glitch_dashboard.sql` lines 89-98): columns
  `id, partner_account_id, event_type, clio_session_ref, partner_reference, payload (JSONB), payload_hash,
  signature, delivery_status, http_status_code, retry_count, next_retry_at, delivered_at, created_at`.
  `event_type` CHECK now allows `'usage.voice_minute', 'usage.llm_generation_call', 'session.completed',
  'wallet.low_balance', 'session.insights_ready'`. `delivery_status` CHECK allows `'pending', 'delivered',
  'failed', 'exhausted'`. Confirmed indexed on `(partner_account_id, created_at DESC)` — a paginated,
  reverse-chronological, per-partner query is the schema's own designed access pattern, no new index
  needed.
- **`WebhookPayload` shape** (`lib/partner/webhooks.ts` lines 35-72): confirmed fields available to
  render — `event_id, event_type, clio_session_ref, partner_reference, quantity, unit, generation_type,
  occurred_at, dispatched_at, test_mode, extraction_status?, action_items?, learner_insight?,
  end_client_id?, reseller_id?, reseller_unique_id?`. Confirmed **no `glitches` or `hume_config_id` field
  exists anywhere in this type** — B2B-57's own field-leak concern is already structurally impossible from
  this source, not just policy-enforced. `action_items`/`learner_insight` are real fields on
  `session.insights_ready` payloads (populated live from `partner_session_insights` at delivery time, per
  `attemptDispatch()` lines 791-818) — these are learner-content payloads, not billing data; see §6/§9 for
  how this screen handles them.
- **`delivery_status` mechanics** (`lib/partner/webhooks.ts` lines 777-881): a row is inserted `'pending'`
  (line 191/703). `attemptDispatch()` returns `'delivered'` (sets `delivery_status='delivered'`,
  `http_status_code`, `delivered_at`), or on failure calls `handleFailedAttempt()` which sets either
  `'pending'` again with an incremented `retry_count` and a future `next_retry_at` (retrying), or
  `'exhausted'` at `retry_count >= 5` (line 859-865, `MAX_ATTEMPTS = BACKOFF_SECONDS.length = 5`). Critically,
  when `row.outbound_base_url` is null, `attemptDispatch()` returns `'skipped_no_endpoint'` **without
  writing anything to the row at all** (lines 780-786) — the row stays `delivery_status='pending',
  retry_count=0, next_retry_at=null` forever, indistinguishable in the DB from a genuinely brand-new,
  about-to-be-attempted row. This is a real ambiguity this spec must resolve (see §6.4/§8) — the DB alone
  cannot tell "queued, will attempt shortly" apart from "will never be attempted until you configure an
  endpoint." The `'failed'` CHECK value exists in the schema but is never actually written by any code
  path found in `lib/partner/webhooks.ts` — confirmed by full read of `handleFailedAttempt()`, `attemptDispatch()`,
  `recordBillableEvent()`, `recordInsightsReadyEvent()`; only `'pending' | 'delivered' | 'exhausted'` are
  ever set. Treated as a live-but-currently-unused legacy status, handled defensively in this screen
  (§6.4) rather than assumed impossible.
- **Live data state, independently re-confirmed** (already verified once for B2B-53 per
  `docs/b2b-pivot-status.md` line 131, re-confirmed here as current): all 53 existing
  `webhook_dispatch_log` rows belong to the single `Clio Internal — Public Demo` account, which itself has
  `outbound_base_url IS NULL`. Every real (non-demo) partner account has zero `webhook_dispatch_log` rows
  today, not merely undelivered ones — the true empty state for every real reseller opening this screen at
  launch is **zero rows**, not "rows that are stuck pending." §6.2/§8 handle both cases distinctly since
  they will both occur in reality as soon as real usage starts.
- **`outbound_base_url` IS self-serve configurable today** — confirmed in
  `app/(with-clerk)/dashboard/configurator/integration/IntegrationClient.tsx` (lines 35-489): a partner
  admin can set/edit their own `outbound_base_url` and regenerate `outbound_signing_secret` directly on the
  existing Integration page. This resolves what would otherwise be an open question (§Governance Call
  Q5/Q2 in the CEO brief) — a "delivery not configured yet" state on this new screen can safely deep-link
  to `${basePath}/integration`, an already-shipped, already-self-serve page, exactly as `DocsClient.tsx`
  already links to it (lines 121-128).
- **Existing dashboard IA, confirmed by direct read of `_shared.tsx` lines 212-228 and directory listing**:
  today's `ConfiguratorNavShell` has exactly 4 top-level items — `configurator | api | docs | known_bugs`
  — not 3 as the CEO brief's framing ("the 3-surface Configurator/API/Docs dashboard") assumes. `known_bugs`
  (`app/(with-clerk)/dashboard/configurator/known-bugs/`, B2B-22) is direct, load-bearing precedent for
  exactly this spec's situation: a live, paginated, per-partner-scoped, operational **data table** (not
  static documentation, not a config form) was added as its **own standalone nav item**, reusing
  `ConfiguratorNavShell`/`Card`/`COLORS` unmodified, rather than nested inside `docs/`. This precedent
  directly answers CEO brief Governance Question 1 — see §1/§3.
- **Wallet/billing relationship, confirmed by direct read of `app/api/partner/v1/wallet/route.ts`**: the
  wallet endpoint returns balance, burn rate, and per-event-type **rates** (`burn_rate_by_event_type`) —
  it has no per-event history, no session references, and is not paginated; it is a snapshot, not a log.
  `DocsClient.tsx`'s `#billing` section (lines 437-514) explains the wallet conceptually but renders no
  transactional rows. Confirmed: nothing today shows a reseller their individual dispatched events. This
  screen is additive, not a duplicate of any existing view — see §1/§12.

---

## 1. Purpose

Real resellers who send Clio real sessions have no way today to see, inside their own dashboard, what
usage Clio has recorded and dispatched on their behalf — even though the underlying records
(`webhook_dispatch_log` rows, real field values, per Arun's direct instruction that real reseller usage
"has to be sent to reseller api and lives in reseller dashboard") already exist and accumulate the moment
real usage happens. Without this screen, a reseller has no way to independently verify what they are being
billed for, no way to self-diagnose a webhook integration that isn't receiving events, and no record to
reconcile against their own systems — they would have to ask their Clio account manager for every
question, which does not scale as real resellers come online.

This screen is a new nav item, **Usage**, on the existing partner Configurator dashboard
(`ConfiguratorNavShell`) — a reverse-chronological, filterable, paginated table of the reseller's own
`webhook_dispatch_log` rows, each showing the real field values Clio recorded (and, once
`outbound_base_url` is configured, attempted to deliver).

---

## 2. User Story

As a **reseller partner admin** (a user with a `partner_admin_users` row for their account, the same
audience as every existing Configurator/API/Docs/Known Bugs page),
I want to see a real, per-event log of the usage Clio has recorded and dispatched for my account,
So that I can verify what I'm being billed for, confirm my webhook integration is actually receiving
events once I configure it, and reconcile Clio's records against my own systems without having to ask my
account manager.

(Single user type — this screen has no distinct end-client- or admin-facing variant; internal Clio staff
use the separate `/dashboard/admin/glitches` view per B2B-09, not this screen.)

---

## 3. Trigger / Entry Point

- **Route:** `${basePath}/usage` (i.e. `/dashboard/configurator/usage`), following the exact routing
  convention already used by every sibling page (`?partner_account_id=<id>` query param carries the active
  account, matching `docs/api/known-bugs/integration`'s own pattern; `basePath` defaults to
  `/dashboard/configurator` per the existing `ConfiguratorSurface.tsx`/`KnownBugsClient.tsx` convention for
  reuse under the reseller's white-label subdomain).
- **Trigger:** the partner admin clicks the new **"Usage"** item in the top nav (`ConfiguratorNavShell`),
  exactly as they would click Configurator/API/Docs/Known Bugs today. No other entry point in v1 (see §10
  for the deferred cross-link from the Docs `#billing` section).
- **Required state:** the user must be an authenticated Clerk session resolved to a `partner_admin_users`
  row for the account in `partner_account_id` — identical auth gate already enforced by
  `ConfiguratorNavShell`'s existing parent layout for every sibling page. This screen adds no new auth
  logic; it inherits the existing multi-tenant scoping unmodified, per the CEO brief's own constraint.
- **Server-side data fetch:** a Server Component page (`app/(with-clerk)/dashboard/configurator/usage/page.tsx`,
  mirroring `known-bugs/page.tsx`/`docs/page.tsx`'s existing shape) resolves the active
  `partner_account_id`, then either fetches the first page of rows directly or hands off to a new
  partner-scoped internal read (see §6.1) — a Client Component (`UsageLogClient.tsx`, mirroring
  `KnownBugsClient.tsx`) handles filter/pagination interaction after initial load.

---

## 4. Screen / Flow Description

### State A — Page loads, rows exist (the eventual common case)

The page renders inside the existing `ConfiguratorNavShell` (same dark-void/purple-accent shell, same
account switcher, same billing-health banner at top as every sibling page). Below the shell's header:

1. **Page title** — text "Usage", `<h1>` styled identically to `DocsClient.tsx`'s `<h1>Docs</h1>`
   (`fontSize: 18, fontWeight: 700, marginBottom: 8`).
2. **Subtitle** — one line of body text (`fontSize: 13, color: COLORS.textSecondary`): "A record of every
   usage event Clio has recorded for your account, and its webhook delivery status."
3. **Filter row** — a single `<select>` styled to match the existing Configurator form-control visual
   language (reuse whatever base select styling `IntegrationClient.tsx`/`QuestionnaireBuilderClient.tsx`
   already establishes for `<select>` elements — no new control style invented), labeled "Event type",
   options: "All event types" (default, selected), "Voice minutes", "LLM generation calls", "Session
   completed", "Session insights ready". Selecting an option re-fetches the first page filtered to that
   `event_type`.
4. **Table** — one row per `webhook_dispatch_log` row, most recent `created_at` first. Columns, left to
   right (see §6.4 for exact source mapping):
   - **Event** — a `Badge`-styled pill (reuse existing `Badge`/pill pattern from
     `StatusBadge`/`PARTNER_STATUS_LABEL` in `KnownBugsClient.tsx`) reading one of: "Voice minutes", "LLM
     generation", "Session completed", "Insights ready".
   - **Reference** — if `partner_reference` or `reseller_unique_id` is present on the row, show that value
     (their own reference — most useful to them), in monospace, with a small "Clio ID" secondary line below
     it in muted text showing `clio_session_ref` (truncated to first 8 chars + `…`, full value in a
     `title=` tooltip attribute) for support/reconciliation purposes. If neither `partner_reference` nor
     `reseller_unique_id` is present (e.g. an account-level `wallet.low_balance` row were it ever shown —
     see §10, it is not), show `clio_session_ref` alone, or an em dash if that too is null.
   - **Amount** — for `usage.*` event types: `"{quantity} {unit}"` (e.g. "14.2 minutes", "1 call"), plus, for
     LLM generation events only, the `generation_type` in parens (e.g. "1 call (topic)"). For
     `session.completed`/`session.insights_ready` (never carry a `quantity`): an em dash (`—`).
   - **Mode** — a small pill: "Live" (default styling, `COLORS.textPrimary`) or "Test" (amber-tinted,
     matching the existing amber "test mode" convention used elsewhere in this codebase's billing/wallet
     copy), from `payload.test_mode`.
   - **Occurred** — `occurred_at` formatted via the same `toLocaleString('en-US', { month: 'short', day:
     'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })` helper pattern already defined as
     `formatDateTime()` in `KnownBugsClient.tsx` — reused, not reinvented.
   - **Delivery** — a `Badge` pill, one of five states (exact resolution logic in §6.4): "Delivered" (green),
     "Pending" (cyan), "Retrying" (amber), "Failed" (red), "Delivery not configured" (muted gray, only shown
     when `outbound_base_url` is null for the account). No retry button, no other interactive control in
     this column (§9/§10 — explicitly out of scope for v1).
5. **Pagination** — below the table, a single centered "Load more" button (reuse existing `Button`/link
   styling already established elsewhere in Configurator, e.g. the ghost/bordered secondary-button style),
   visible only when more rows exist beyond the currently-loaded set. Clicking it fetches the next page
   (offset += 25) and appends rows to the table (never replaces). No page-number pagination, no jump-to-page
   control in v1.

### State B — Page loads, zero rows exist for this account (the real, current, universal state for every
non-demo partner today)

Table area is replaced by a single centered empty-state block inside a `Card` (same `Card` component used
everywhere else in Configurator):

- A muted icon-free heading (`fontSize: 14, fontWeight: 600, color: COLORS.textPrimary`): "No usage events
  yet"
- Body text (`fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.6`): "Usage events appear here
  automatically as soon as Clio records billable activity for your account — for example, voice minutes
  from a live session. Nothing has been recorded yet."
- No CTA button in this state (there is nothing actionable to do to "make usage appear" — it appears only
  once the reseller actually sends Clio real sessions, which is not a dashboard action). The filter
  dropdown from State A is **not shown** in this state (filtering an empty set is meaningless UI).

### State C — Rows exist, but every row is `delivery_status='pending'` with `outbound_base_url` null for
this account (a real, distinct state once real usage starts before the reseller configures delivery)

Table renders exactly as State A (rows, filters, pagination all present and functional — the events
themselves are real and worth showing even though delivery hasn't happened yet), but every row's Delivery
column reads "Delivery not configured" (muted gray pill). Additionally, directly below the subtitle and
above the filter row, a single-line inline notice (not a full banner — reuse the existing muted
`fontSize: 12, color: COLORS.textMuted` treatment already used for the "Figures reflect the current
catalog…" disclaimer in `DocsClient.tsx`): "Delivery isn't configured for your account yet — these events
are recorded but not yet sent anywhere. [Configure it on the Integration page →]" with the bracketed text
as a `COLORS.cyan` link to `${basePath}/integration?partner_account_id=${activePartnerAccountId}`, matching
the exact existing link styling/pattern already used for every other Configurator cross-page link.

### State D — Loading (initial page load or "Load more" click)

Standard existing loading convention already used by every Client Component sibling page (e.g.
`KnownBugsClient.tsx`'s own `useState`/`useEffect` fetch pattern) — a lightweight inline "Loading…" text
state or skeleton row, no new spinner component invented.

### State E — Fetch error (the internal read API call fails)

A `Card`-wrapped error message, reusing the existing error-state text convention from sibling pages (muted
red text, `COLORS.red`): "Couldn't load your usage log right now. Try refreshing the page." No retry button
beyond the browser's own refresh — matches this codebase's existing minimal-error-UI convention (no other
Configurator page builds a custom retry mechanism for a failed fetch).

---

## 5. Visual Examples

**State A — rows present, filter applied, delivery not yet configured:**

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  Usage                                                                                 │
│  A record of every usage event Clio has recorded for your account, and its webhook    │
│  delivery status.                                                                      │
│                                                                                          │
│  Delivery isn't configured for your account yet — these events are recorded but not    │
│  yet sent anywhere. [Configure it on the Integration page →]                           │
│                                                                                          │
│  Event type: [ All event types ▾ ]                                                     │
│                                                                                          │
│  ┌────────────────┬────────────────────┬─────────────┬────────┬──────────────┬───────┐│
│  │ Event           │ Reference          │ Amount      │ Mode   │ Occurred      │Delivery││
│  ├────────────────┼────────────────────┼─────────────┼────────┼──────────────┼───────┤│
│  │ [Voice minutes] │ order-48213        │ 14.2 minutes│ Live   │ Jul 30, 2026, │[Delivery││
│  │                 │ Clio ID: a1b2c3d4… │             │        │ 9:41 AM       │not conf.]││
│  ├────────────────┼────────────────────┼─────────────┼────────┼──────────────┼───────┤│
│  │[LLM generation] │ order-48213        │ 1 call      │ Test   │ Jul 30, 2026, │[Delivery││
│  │                 │ Clio ID: a1b2c3d4… │ (topic)     │        │ 9:38 AM       │not conf.]││
│  └────────────────┴────────────────────┴─────────────┴────────┴──────────────┴───────┘│
│                                                                                          │
│                            [ Load more ]                                               │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**State B — empty state (real state for every current non-demo partner):**

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  Usage                                                                                 │
│  A record of every usage event Clio has recorded for your account, and its webhook    │
│  delivery status.                                                                      │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────┐   │
│  │                                                                                   │   │
│  │                          No usage events yet                                     │   │
│  │        Usage events appear here automatically as soon as Clio records            │   │
│  │        billable activity for your account — for example, voice minutes           │   │
│  │        from a live session. Nothing has been recorded yet.                       │   │
│  │                                                                                   │   │
│  └────────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**State A — a fully delivered/failed row example (once real delivery is happening):**

```
│  │ [Session completed]│ order-48213      │ —          │ Live │ Jul 30, 2026, │[Delivered]││
│  │ [Voice minutes]    │ order-48214      │ 8.5 minutes│ Live │ Jul 30, 2026, │[Failed]    ││
│  │ [Insights ready]   │ order-48210      │ —          │ Live │ Jul 29, 2026, │[Retrying]  ││
```

---

## 6. Data Requirements

### 6.1 Read path — new internal endpoint

A new endpoint, `GET /api/partner/dashboard/usage-log`, reused by the Server Component page for the first
page and by the Client Component for filtered/paginated fetches. This is a **dashboard-session-authenticated**
endpoint (Clerk session → resolved `partner_account_id` via the same `partner_admin_users` lookup every
other Configurator API route under `app/(with-clerk)/dashboard/` already uses), **not** a partner-API-key
(`requirePartnerApiKey`) endpoint — it is called by the reseller's own logged-in browser session, exactly
like `app/api/partner/dashboard/known-bugs` (or its equivalent internal route backing
`KnownBugsClient.tsx` — same auth pattern, reused unmodified) already does, not by their server-to-server
integration. This is a deliberate, existing distinction in this codebase between the public partner API
(`/api/partner/v1/*`, API-key-authed) and internal dashboard-only reads (`/api/partner/dashboard/*` or
equivalent, session-authed) — this screen follows the latter, matching Known Bugs' own precedent exactly.

**Query params:** `partner_account_id` (required, validated against the caller's own resolved account —
never trusted from the client beyond that check, matching every existing multi-tenant-scoped route's
convention), `event_type` (optional, one of the four filterable types), `cursor`/`offset` (optional,
pagination), `limit` (optional, default 25, max 100 — server-enforced ceiling regardless of what the
client requests).

**Reads:**
- `webhook_dispatch_log` — `SELECT id, event_type, clio_session_ref, partner_reference, payload,
  delivery_status, http_status_code, retry_count, created_at WHERE partner_account_id = $1 [AND event_type
  = $2] ORDER BY created_at DESC LIMIT $3 OFFSET $4`. Filtered server-side to the four in-scope event types
  (§6.3) via `AND event_type IN ('usage.voice_minute', 'usage.llm_generation_call', 'session.completed',
  'session.insights_ready')` even when no explicit filter is applied — `wallet.low_balance` rows are never
  returned by this endpoint at all (§10).
- `partner_accounts` — `SELECT outbound_base_url WHERE id = $1` (one extra lookup, or reuse whatever the
  page already resolves for the billing-health banner if that value is already in scope server-side) — used
  only to resolve the "Delivery not configured" bucket (§6.4), never rendered directly, never exposed as a
  raw URL to the reseller on this screen (it's already visible to them on the Integration page they own).

**Writes:** none. This is a read-only screen — no user action on this page mutates any row.

**Response shape:**
```
{
  rows: [{
    id: string,
    event_type: 'usage.voice_minute' | 'usage.llm_generation_call' | 'session.completed' | 'session.insights_ready',
    clio_session_ref: string | null,
    reference: string | null,        // partner_reference ?? payload.reseller_unique_id ?? null
    quantity: number | null,
    unit: 'minutes' | 'calls' | null,
    generation_type: string | null,
    test_mode: boolean,
    occurred_at: string,             // ISO
    delivery_status: 'delivered' | 'pending' | 'exhausted' | 'failed',
    http_status_code: number | null,
  }],
  has_more: boolean,
  delivery_configured: boolean,      // outbound_base_url !== null for this account
}
```

### 6.2 What is NOT read or exposed

- `payload.action_items`, `payload.learner_insight` — these are per-session learner content fields carried
  on `session.insights_ready` payloads (§0). They are never selected or rendered on this screen — this is a
  usage/billing log, not a content viewer; showing raw learner-conversation content here would also be a
  scope/privacy mismatch with what a "usage statement" should show. The Reference/Amount/Mode/Occurred/
  Delivery columns fully describe a `session.insights_ready` row without touching these fields.
- `partner_session_insights.glitches` — never joined or read by this endpoint at all (not even indirectly)
  — matches B2B-53's existing confirmed-shipped constraint that `glitches` never appears in any
  reseller-facing surface.
- `hume_config_id`, `provider_bot_id`, `provider_name` — none of these are columns on `webhook_dispatch_log`
  or fields on `WebhookPayload` (§0) — structurally absent from this endpoint's source data, not filtered
  out after the fact.
- `signature`, `payload_hash` — internal delivery-integrity fields, never rendered; a reseller has no
  action to take with either value.
- `outbound_base_url` itself — resolved server-side into the boolean `delivery_configured` only; the raw
  URL is never included in this endpoint's response (the reseller already owns and can see this value on
  the Integration page — no reason to duplicate it here).

### 6.3 Event types shown (resolves CEO brief Governance Question 3)

**In scope:** `usage.voice_minute`, `usage.llm_generation_call`, `session.completed`,
`session.insights_ready` — the four event types that are genuinely per-session usage/lifecycle records.

**Out of scope for v1:** `wallet.low_balance` (§0 — an account-level billing alert, not a usage record; it
carries no `clio_session_ref`/`quantity`/`generation_type` at all — per `lib/partner/webhooks.ts` lines
490-497 its payload is `{event_id, event_type, partner_account_id, balance_usd,
reference_topup_amount_usd, occurred_at}`, structurally a different shape that doesn't fit this table's
columns, and it already has its own dedicated email-alert delivery mechanism, `sendLowBalanceAlertEmail()`
— see §10).

### 6.4 Delivery status resolution (resolves CEO brief Governance Question 5)

Computed per-row by the endpoint (not the client), using `delivery_configured` (the account's own
`outbound_base_url IS NOT NULL`) alongside the row's own `delivery_status`/`retry_count`:

| `delivery_status` (DB) | `retry_count` | `delivery_configured` | Shown as |
|---|---|---|---|
| `delivered` | — | — | **Delivered** |
| `exhausted` | — | — | **Failed** |
| `failed` (legacy/unused today, §0 — handled defensively) | — | — | **Failed** |
| `pending` | `0` | `false` | **Delivery not configured** |
| `pending` | `0` | `true` | **Pending** |
| `pending` | `> 0` | — | **Retrying** |

No retry affordance, no manual "resend" action, no per-row detail drill-down in v1 — explicitly out of
scope (§10), matching the CEO brief's own framing of this as an open question this spec should resolve
rather than build speculatively.

### 6.5 Nav wiring

- `_shared.tsx` line 212's `active` union extended: `'configurator' | 'api' | 'docs' | 'known_bugs' |
  'usage'`.
- `navItems` array (line 225) gains one entry: `{ key: 'usage', label: 'Usage', href:
  \`${basePath}/usage?partner_account_id=${activePartnerAccountId}\` }`, positioned after `docs` and before
  `known_bugs` (usage data is closer in nature to the Docs/API integration-facing pages than to the
  Known Bugs support-ticket-style page; exact ordering is a minor, reversible detail, not a product-shape
  question).
- New page `app/(with-clerk)/dashboard/configurator/usage/page.tsx` (Server Component, mirrors
  `known-bugs/page.tsx` exactly for auth/account resolution) + `UsageLogClient.tsx` (Client Component,
  mirrors `KnownBugsClient.tsx`'s fetch/state pattern exactly).

---

## 7. Success Criteria (Acceptance Tests)

✓ Given a reseller partner admin with zero `webhook_dispatch_log` rows for their account (the real state
of every non-demo account today), when they open `/dashboard/configurator/usage`, then they see the State
B empty-state Card with the exact copy in §4, no table, no filter dropdown, and no error.

✓ Given a reseller with `outbound_base_url IS NULL` and at least one real `webhook_dispatch_log` row, when
they open the Usage page, then every row's Delivery column shows "Delivery not configured", and the
inline notice with a working link to `${basePath}/integration?partner_account_id=...` appears above the
filter row.

✓ Given a reseller with `outbound_base_url` configured and rows in every one of `delivered` / `pending,
retry_count=0` / `pending, retry_count>0` / `exhausted` states, when they open the Usage page, then the
Delivery column reads "Delivered" / "Pending" / "Retrying" / "Failed" respectively, per §6.4's table.

✓ Given a reseller with more than 25 in-scope rows, when they open the Usage page, then exactly 25 rows
load initially, most-recent-`created_at`-first, and a "Load more" button is visible; clicking it appends
the next 25 without removing the first 25, and the button disappears once `has_more` is false.

✓ Given a reseller selects "Voice minutes" from the Event type filter, when the filtered fetch completes,
then only `usage.voice_minute` rows are shown, pagination resets to the first page of the filtered set, and
selecting "All event types" again restores the unfiltered, most-recent-first view.

✓ Given a `webhook_dispatch_log` row with `event_type = 'usage.llm_generation_call'` and
`generation_type = 'topic'`, when it renders, then the Amount column reads "1 call (topic)" (or the row's
real `quantity` value if not exactly 1).

✓ Given a `session.insights_ready` row whose `payload` contains `action_items`/`learner_insight` values,
when it renders on this screen, then neither field's content appears anywhere in the row or in any tooltip
— only Event/Reference/Amount(—)/Mode/Occurred/Delivery are shown.

✓ Given partner A and partner B both have `webhook_dispatch_log` rows, when partner A's admin loads the
Usage page, then only partner A's own rows are ever returned by `GET /api/partner/dashboard/usage-log`,
even if partner A tampers with the `partner_account_id` query param to partner B's id (endpoint must
independently re-resolve and enforce the caller's own account, never trust the query param past that
check).

✓ Given the internal read endpoint returns a non-2xx response or throws, when the page attempts to load,
then the State E error Card renders with the exact copy in §4, and no partial/broken table renders.

---

## 8. Error States

- **Fetch fails on initial page load:** State E error Card (§4). No stale/partial table shown.
- **Fetch fails on "Load more" click:** the already-loaded rows remain visible; the "Load more" button
  itself shows a brief inline "Couldn't load more — try again" message in place of the button (does not
  replace the whole page with the State E Card, since existing rows are still valid and shouldn't
  disappear on a transient failure).
- **`partner_account_id` missing/invalid on the query string:** handled identically to how every existing
  sibling page under `ConfiguratorNavShell` already handles this (same redirect/resolution logic already in
  `known-bugs/page.tsx`/`docs/page.tsx` — this spec introduces no new behavior here, it inherits the
  existing pattern unmodified).
- **A row's `payload` is malformed/missing an expected field** (defensive-only — should not occur given
  `recordBillableEvent()`'s own typed construction, but the endpoint must not 500 on a single bad row):
  render that row with an em dash (`—`) in whichever cell's source field is missing, rather than omitting
  the row or failing the whole fetch. Never silently drop a row — the reseller's own count of "how many
  events happened" must stay trustworthy.
- **Legacy `delivery_status = 'failed'` row** (§0/§6.4 — schema-valid but not currently written by any code
  path): resolved to "Failed", same bucket as `exhausted` — never an unhandled/blank Delivery cell.

---

## 9. Edge Cases

- **First real usage ever recorded for a brand-new reseller, before they've configured
  `outbound_base_url`:** State C (§4) — rows are real and shown, Delivery reads "Delivery not configured"
  for all of them, with the Integration-page link. This is expected to be the single most common real-world
  state for the first weeks after this ships (per §0's confirmed current data).
- **A reseller configures `outbound_base_url` for the first time after already having pending rows:** those
  existing rows are picked up by the existing Inngest dispatch worker (`fetchDueDispatches`/
  `attemptDispatch`, unmodified by this spec) on its next run and will transition to Delivered/Retrying/
  Failed on their own; this screen simply reflects whatever `delivery_status` the worker has already set —
  no special-casing needed here.
- **A `usage.llm_generation_call` row with `quantity` present but `generation_type` null** (schema allows
  this): Amount column shows just `"{quantity} calls"` with no parenthetical, rather than `"(null)"` or a
  broken string.
- **Very high-volume account eventually generating thousands of rows:** the existing
  `idx_webhook_dispatch_log_account_time` index (§0) already supports this query pattern efficiently;
  offset-based pagination beyond a few thousand rows is a known, accepted future performance
  consideration, not a v1 blocker — no date-range filter is built now given current real-world volume is
  effectively zero (§0); adding one later is a small, additive, non-breaking change to the same endpoint
  (new optional `since`/`until` query params) whenever volume actually warrants it.
- **Reseller has both `partner_reference` (top-level column, always opaque passthrough) and
  `payload.reseller_unique_id` populated with different values for the same row:** `partner_reference`
  takes priority in the Reference column per §6.1's response-shape resolution order
  (`partner_reference ?? payload.reseller_unique_id`), since it's the field this codebase's own webhook
  documentation (`WEBHOOK_DOC.payloadFields`) already surfaces as the primary opaque reference; this is a
  minor, reversible tie-break, not a product-shape question.
- **Mobile viewport** (per this project's standing responsive-by-default rule — this is new screen surface
  area being touched for the first time, so it must ship responsive from day one, not be retrofitted
  later): the table must not force horizontal scroll of the whole page — wrap the table itself in its own
  `overflow-x: auto` container (matching this project's own established responsive pattern elsewhere), with
  column widths using relative/`minmax()` sizing rather than fixed pixel widths, and the filter
  dropdown/"Load more" button stacking full-width below the table header on narrow viewports rather than
  overflowing. No fixed `maxWidth` cap on the page container itself, consistent with the project's
  fluid-layout standing rule.

---

## 10. Out of Scope

- **Retry/resend affordance for a failed or exhausted delivery** — v1 is read-only; a reseller cannot
  trigger a redelivery from this screen. (The CEO brief explicitly flagged this as a question to resolve;
  resolved here as: not in v1, revisit only if a real reseller asks for it once real delivery is live.)
- **`wallet.low_balance` events** — account-level alerts, not usage records; already covered by email
  (§6.3).
- **Dollar/cost amounts per event** — this screen shows the real recorded usage quantity (minutes/calls),
  not a computed cost. Per-event-type rates already exist on `GET /api/partner/v1/wallet`
  (`burn_rate_by_event_type`) and the Docs `#billing` section already explains how cost is derived; this
  screen intentionally does not duplicate or recompute a dollar figure per row, to avoid introducing a new,
  unrequested combination of usage-quantity × rate math not covered by any WebhookPayload field the CEO
  brief asked for.
- **CSV/export download** — not requested, not built.
- **Date-range filtering** — deferred per §9 (current data volume does not warrant it); only an event-type
  filter ships in v1.
- **A cross-link from the Docs `#billing` section pointing to this new Usage page** — a small, obviously
  additive follow-up (one link, one line) but touches an already-shipped file outside this brief's stated
  scope; logging it in `BACKLOG.md` as a trivial follow-up rather than bundling it into this spec.
- **Raw webhook request/response inspection (headers, exact bytes sent/received, latency)** — that level of
  debug detail belongs to the internal admin glitch dashboard (`/dashboard/admin/glitches`, B2B-09), not
  this reseller-facing screen, per the CEO brief's own explicit distinction between "internal admin
  Glitches dashboard" framing and this screen's "billing/usage statement" framing.
- **Editing `outbound_base_url` from this screen** — stays exclusively on the Integration page; this screen
  only links out to it.

---

## 11. Open Questions

None. All six governance questions from the CEO brief are resolved above with sound product/technical
judgment grounded in existing shipped precedent (§0):
1. Surface → new standalone "Usage" nav item (§1/§3/§6.5), directly following the Known Bugs precedent for
   exactly this kind of live per-partner operational table.
2. Empty state → §4 State B, exact copy specified.
3. Pagination/date-range → 25/page, "Load more", no date filter in v1, event-type filter only (§4/§6.1/§9).
4. Field set/framing → §4/§6.1/§6.2, reseller-appropriate labels, confirmed zero internal-only fields
   (`glitches`, `hume_config_id`, provider/bot internals, signatures) are reachable from this endpoint.
5. Delivery status visibility → shown, five-state resolution table in §6.4, no retry affordance in v1
   (§10).
6. Relationship to wallet/billing UI → separate nav item, not nested under Docs/Billing; a future
   cross-link from Docs `#billing` is logged in `BACKLOG.md`, not built now (§10).

No item below required Arun's own product judgment beyond what the CEO brief already supplied — every
resolution above was reachable either from existing shipped precedent (Known Bugs' nav-item pattern,
Integration page's existing self-serve `outbound_base_url` config) or from the schema/code's own
constraints (event-type shapes, delivery_status mechanics). Nothing is routed back.

---

## 12. Dependencies

- `lib/partner/webhooks.ts` — unmodified, already ships `recordBillableEvent()`/`recordInsightsReadyEvent()`/
  the dispatch worker; this spec only reads what already exists.
- `webhook_dispatch_log` table (migration 071, widened by 078) — no new migration required; every column
  this spec needs already exists.
- `ConfiguratorNavShell`/`Card`/`COLORS`/`Badge`-equivalent pill pattern (`_shared.tsx`,
  `KnownBugsClient.tsx`'s `StatusBadge`) — reused unmodified, no new design system.
- `IntegrationClient.tsx`'s existing self-serve `outbound_base_url` config — the deep-link target for
  State C's notice; must remain at its current route (no dependency risk, already shipped and stable).
- Existing Clerk session → `partner_admin_users` → `partner_account_id` resolution already used by every
  sibling `app/(with-clerk)/dashboard/configurator/*` route — reused unmodified for both the page and the
  new internal endpoint's auth.
- No dependency on B2B-57a (the demo-account half of this same original CEO instruction) — the two are
  independent halves; this spec's endpoint reads real `webhook_dispatch_log` rows for any real partner
  account, demo or not, with no special-casing between them.

---

## 13. Test Plan

- **Unit:** delivery-status resolution function (§6.4's table) — one test per row of the table, including
  the legacy `'failed'` DB value and the `retry_count > 0` "Retrying" branch. Reference-field precedence
  (`partner_reference ?? payload.reseller_unique_id ?? null`). Amount-string formatting for each event
  type, including the `generation_type` null edge case (§9).
- **Integration:** `GET /api/partner/dashboard/usage-log` — auth rejection for a caller with no
  `partner_admin_users` row; account-isolation (partner A never receives partner B's rows even via a
  tampered `partner_account_id` param); `event_type` filter correctness; `event_type NOT IN
  ('wallet.low_balance')` enforced even with no explicit filter; pagination `has_more`/`limit` ceiling
  behavior; `delivery_configured` correctly reflects `outbound_base_url IS NOT NULL`.
- **E2E (Playwright):** empty-state render for a zero-row account; State C notice + working Integration-page
  link when `outbound_base_url` is null and rows exist; filter dropdown changes visible rows; "Load more"
  appends without losing existing rows; mobile-viewport table scrolls horizontally within its own
  container, not the page.
