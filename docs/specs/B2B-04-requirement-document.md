# B2B-04 — Billing / Metering
# Requirement Document

Version: 1.1
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-13

Changelog: v1.1 — closed two CEO-review precision gaps, both confirmed technical (not product)
decisions within BA authority: (1) the `days_remaining` null-tie-break rule referenced but never
actually stated in v1.0 now has an explicit `days_remaining_null_reason` response field and a real
comparator, written into `architecture.md` §13.6; the column-header re-sort question is answered
there (reuses the same comparator for both directions — see Section 4.A). (2) `avg_daily_burn_usd`/
`projected_days_remaining` now has a pinned formula (trailing 7 complete UTC days, simple mean, current
partial day fully excluded) in `architecture.md` §13.5. Sections 4.B.1, 4.B.2, 5.A, 6, 7, and 9 updated
accordingly. Section 11 remains empty.

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-04-billing-metering.md`
Authoritative source material (all read in full): `CORE_OBJECTIVES.md` v2.0 (Objective 6, Non-Negotiable
Data Boundary), `docs/brainstorm-b2b-platform-pivot.md` §7.1–7.6/§8, `docs/b2b-pivot-status.md` (F-01
RESOLVED/Option A, F-02 DEFERRED, B2B-04 row), `docs/specs/B2B-02-requirement-document.md`,
`architecture.md` Sections 1–12 (as it stood before this document's §13 addition), the live schema in
`supabase/migrations/071_b2b02_partner_accounts_and_api_keys.sql`,
`072_b2b02_usage_events_resolution_a.sql`, `074_b2b03_designer_configurator.sql`, the live code in
`lib/partner/auth.ts`, `lib/partner/webhooks.ts`, `lib/partner/webhook-signature.ts`,
`app/api/partner/v1/usage/route.ts`, `app/api/webhooks/stripe/route.ts`, `lib/stripe.ts`,
`lib/session-billing.ts` (the `minutes_ledger`/`deduct_minutes`/`add_minutes` precedent this document's
wallet mechanism mirrors), `lib/delivery/email.ts`, `middleware.ts`, and
`app/dashboard/admin/templates/page.tsx` (the internal-admin-page precedent).

Companion artifacts produced alongside this document: `architecture.md` §13 (schema/route/sequence
detail a developer implements against), `supabase/migrations/075_b2b04_billing_metering.sql`.

---

## Template Adaptation Note

Like B2B-02, this brief is primarily a billing **mechanism** (wallet, versioned rates, Stripe funding,
webhook idempotency) plus exactly **one** real Clio-hosted UI screen (`/dashboard/admin/clients`) and
**one** partner-facing API extension — it is not a screen-by-screen consumer feature. Sections are kept
in standard order/numbering to match every other spec in `docs/specs/`, adapted as follows:

- **Section 4** covers both the one real screen (states, exact copy, exact fields) and the API
  contracts (request/response shapes, exact field names/types), per the "do NOT say 'a form'" /
  "do NOT say 'a form'"-equivalent discipline applied to JSON bodies.
- **Section 5** gives one literal wireframe set for the admin page's states, plus text sequence flows
  for every mechanism (decrement, three funding paths, low-balance alert, idempotent retry).
- All other sections apply directly.

For exact schema, RPC signatures, and route-by-route detail, this document defers to `architecture.md`
§13 rather than duplicating it — this document states requirements and acceptance criteria;
`architecture.md` states the design that satisfies them.

---

## 1. Purpose

Today `usage_events` (B2B-02, F-01 Resolution A, unconditional and live) faithfully records every
billable action a partner generates, but nothing reads it into a balance, nothing decrements a balance
as usage accrues, nothing tells a partner or Clio when a balance is running low, and `lib/stripe.ts`
still assumes the retired B2C flat-subscription model (fixed monthly plan tiers billed in arrears, not
prepaid usage-metered credit). Two dashboards Arun explicitly asked for — his own cross-partner
operational view and each partner's own usage/balance view — don't exist. Until this document's
mechanism is built, B2B-02 and B2B-03 can technically emit and record usage, but Clio has no way to
turn that into revenue or give Arun visibility into account health.

**What failure looks like without this document:** a partner consumes real voice-minutes and
LLM-generation calls indefinitely with no balance ever decrementing — Clio has no mechanism to stop
giving away service, no early-warning signal before a partner's spend outstrips what they've paid, and
Arun has no single place to see which accounts are healthy, at risk, or already unprofitable. Separately,
a real correctness bug — not yet consequential, because nothing consumes the ledger for real decisions
yet — becomes consequential the moment this document's mechanism goes live: `recordBillableEvent()`
(`lib/partner/webhooks.ts`) already deduplicates `webhook_dispatch_log` correctly on retry (via its
`ON CONFLICT ... ignoreDuplicates` upsert), but the subsequent `usage_events` insert that follows it is
**not** gated on whether that upsert actually inserted a new row — a retried call today would silently
write a second `usage_events` row for the same logical event. Once this document's decrement mechanism
reads `usage_events` as its trigger, that duplicate directly double-charges a partner's wallet. Closing
this is item 7 of the CEO brief's "What Success Looks Like" and is treated in this document as equally
load-bearing as the wallet mechanism itself, not a footnote.

## 2. User Story

Like B2B-02, this is infrastructure-plus-one-operational-screen, not an individual end-user-facing
feature. Its "users" are Arun (and future Clio ops staff), partner-admin humans managing their own
account's billing, and Clio's own backend systems that must decrement a wallet the instant a billable
event occurs.

**Story 1 — Arun / Clio ops**
As the person accountable for Clio's revenue and account health,
I want one page that shows every partner's balance, burn-rate trend, days-until-exhausted, revenue, next
billing date, and payment-method status, sorted so at-risk accounts surface first,
So that I never learn an account is in trouble by discovering it ran out of balance mid-session.

**Story 2 — Partner-admin human (self-serve tier, e.g. a smaller Pluralsight-shaped partner)**
As the person managing my own company's Clio integration,
I want to buy a wallet top-up with a card, in one Stripe Checkout flow, with no minimum commitment,
So that I can start using Clio the same day I sign up, exactly like topping up an OpenAI or Twilio
account.

**Story 3 — Partner-admin human (mid-market tier)**
As the person managing a larger partner's Clio integration,
I want a monthly minimum charge that automatically keeps our wallet funded at a discounted rate, without
me manually re-topping-up,
So that our integration never silently runs dry because someone forgot to click "buy more."

**Story 4 — Partner-admin human (enterprise tier)**
As the person managing an enterprise partner's Clio integration under a negotiated annual contract,
I want to pay by invoice/ACH instead of a card, at our negotiated discount,
So that our Clio spend goes through the same procurement process as every other vendor we pay.

**Story 5 — Clio's own backend (the billing engine itself)**
As the code path that just recorded a billable `usage_events` row,
I want to resolve the correct, currently-effective burn rate for that partner and event type, decrement
their wallet by exactly that amount, cite the rate I used on the row itself, and never double-decrement
if I'm called twice for the same logical event,
So that the wallet balance is always an accurate, auditable, non-reproducible-error reflection of real
usage — and so that a future F-02 rate correction can never silently reprice history.

**Story 6 — A partner's own billing/ops tooling (consuming the API, not a Clio UI)**
As a partner's own backend system,
I want to read our own wallet balance, burn rate, and days-remaining via the same kind of API-key-
authenticated call we already use for `GET /api/partner/v1/usage`,
So that we can build our own internal alerting or a UI inside our own product, per Objective 6 — Clio's
UI is not the only path to this data.

## 3. Trigger / Entry Point

Several independent trigger points, exact per the API-contract discipline (full detail in
`architecture.md` §13):

- **Wallet decrement**: triggered internally, synchronously, at the end of `recordBillableEvent()`
  (`lib/partner/webhooks.ts`) — not a new externally-reachable route. Fires once per genuinely-new
  billable `usage_events` row (not `session.completed`, not a duplicate).
- **Self-serve top-up**: `POST /api/admin/billing/checkout`, Clerk-authenticated partner-admin, state
  required: a `partner_admin_users` row for the target `partner_account_id` (same authorization pattern
  as `POST /api/admin/partner-keys`).
- **Mid-market auto-recharge setup**: `POST /api/admin/billing/subscription`, Clerk-authenticated,
  same authorization pattern.
- **Enterprise invoicing**: `POST /api/admin/billing/invoice`, Clerk-authenticated **and** restricted to
  an internal Clio operator (see Section 4.4 — enterprise deals are negotiated manually, not self-serve;
  this route is not exposed to partner-admins in this brief).
- **Stripe webhook events** (all three funding paths land here): `POST /api/webhooks/stripe` (existing
  route, reworked — see Section 6). Triggered by Stripe, not a user action.
- **Wallet read (partner-facing)**: `GET /api/partner/v1/wallet`, partner-API-key-authenticated, same
  auth model as the existing `GET /api/partner/v1/usage`.
- **Internal admin page**: `GET /dashboard/admin/clients`, page load, Clerk-authenticated (any signed-in
  Clerk user, matching — not expanding, not restricting — the exact authorization boundary of the
  existing `/dashboard/admin/templates` precedent this route is modeled on). Backed by
  `GET /api/admin/billing/clients`, same authorization.
- **Low-balance alert dispatch**: triggered internally, synchronously, as part of the wallet-decrement
  code path (Section 5.5) — not a scheduled job, not a separate trigger.

## 4. Screen / Flow Description

### 4.A `/dashboard/admin/clients` — the one real screen this brief builds

**Layout**: follows `app/dashboard/admin/templates/page.tsx` exactly — `currentUser()` (Clerk) gate,
redirect to `/sign-in` if absent, wrapped in the existing `<DashboardShell>` component, with a new client
component `PartnerBillingClient` (mirrors `TemplateApprovalClient`'s role) doing the data fetch and
render. No new design system invented — this reuses whatever `DashboardShell`/`TemplateApprovalClient`
already establish visually, per `CLAUDE.md`'s instruction to flag rather than invent a visual direction
when none exists; here, one already exists (this exact precedent page), so it is followed, not flagged.

**Screen state 1 — default (partners exist, data loaded)**

A table, one row per `partner_accounts` row, default-sorted by `days_remaining` **ascending, NULLs
last** (so the account closest to running out is always the first row — "sortable so at-risk accounts
surface without manual checking" read literally: the default view already does this, sorting is not an
extra click required to get the useful view). Columns, exact:

- **Name** — `partner_accounts.name`
- **Tier** — `partner_wallets.tier`, rendered as one of "Self-serve" / "Mid-market" / "Enterprise"
- **Status** — `partner_accounts.status`, rendered as "Active" / "Suspended"
- **Revenue (lifetime)** — `$` + `revenue_lifetime_usd`, 2 decimal places
- **Revenue (this period)** — `$` + `revenue_current_period_usd` (month-to-date), 2 decimal places
- **Balance** — `$` + `partner_wallets.balance_usd`, 2 decimal places; rendered in red text if negative
- **Days remaining** — `projected_days_remaining` rounded to 1 decimal, or `"—"` if null (no usage
  history to project from)
- **Next billing date** — formatted date, or `"N/A — pay-as-you-go"` (self-serve with no recurring
  charge) / `"N/A — per contract"` (enterprise with no recurring cadence configured)
- **Payment method** — if `stripe_default_payment_method_id` is set: `"{card_brand} •••• {last4}"` (e.g.
  "Visa •••• 4242") for `payment_method_type = 'card'`, or `"Bank account (ACH)"` for
  `'us_bank_account'`; if not set: `"No payment method on file"`

Clicking a column header re-sorts by that column (standard ascending/descending toggle); no other
interactivity in this screen state — this brief is a read-only operational view, not a client-editable
console (editing tier/status/rates is not built here, see Section 10). For the **Days remaining**
column specifically: both the default (ascending) sort and every subsequent click-triggered re-sort
(toggling to descending and back) call the exact same comparator (`architecture.md` §13.6) — there is
no separate "naive" re-sort path for this column. Toggling to descending does not scramble the two null
meanings together; it flips the whole synthetic-key ordering coherently, so descending order is
`no_burn_rate` accounts first (most/unbounded days left), then real numbers highest-to-lowest, then
`exhausted_balance` accounts last (0-or-negative days left) — the semantic mirror of the ascending order
shown below, not an artifact of how nulls happen to sort in a generic library sort.

**Screen state 2 — loading**

While `GET /api/admin/billing/clients` is in flight: the table renders its header row with a single
centered row of skeleton/placeholder text `"Loading partner accounts…"` in place of data rows. No
partial/flickering render of stale data.

**Screen state 3 — empty (no partner accounts exist yet)**

Table header renders, body shows a single centered row: `"No partner accounts yet."` No error state —
this is a legitimate state for a pre-launch environment.

**Screen state 4 — error (the data fetch itself failed)**

Table header renders, body shows a single centered row: `"Couldn't load partner billing data. Try
refreshing the page."` — no partial data shown, no invented numbers.

### 4.B API Contracts

Every field below is exact — types, required/optional, and validation.

#### 4.B.1 `GET /api/admin/billing/clients` (Clerk-authenticated, backs 4.A)

**Response — 200:**
```
{
  "clients": [
    {
      "partner_account_id": "uuid",
      "name": "string",
      "tier": "self_serve" | "mid_market" | "enterprise",
      "status": "active" | "suspended",
      "revenue_lifetime_usd": 1234.56,
      "revenue_current_period_usd": 89.00,
      "balance_usd": -3.21,
      "avg_daily_burn_usd": 1.203 | null,
      "projected_days_remaining": 35.2 | null,
      "days_remaining_null_reason": "exhausted_balance" | "no_burn_rate" | null,
      "next_billing_date": "2026-08-13T00:00:00Z" | null,
      "payment_method_on_file": true,
      "payment_method_card_brand": "visa" | null,
      "payment_method_card_last4": "4242" | null,
      "payment_method_type": "card" | "us_bank_account" | null
    }
  ]
}
```
`days_remaining_null_reason` distinguishes the two structurally different situations that both produce
`projected_days_remaining: null` (exact formula and rationale: `architecture.md` §13.5) —
`"exhausted_balance"` (balance is zero or negative; most urgent, sorts first) vs. `"no_burn_rate"` (no
billed usage in the trailing 7-complete-day window, or the wallet is less than 1 complete day old;
least urgent, sorts last). `null` when `projected_days_remaining` is a real number. This field is what
the default sort (below) and the `days_remaining` column-header re-sort both key off — never inferred
ad hoc from `balance_usd`/`avg_daily_burn_usd` by the frontend.

Never includes `stripe_customer_id`, `stripe_default_payment_method_id`, or any other raw Stripe object
ID — the response is display-ready values only, matching Arun's explicit "not payment details, Stripe
owns that."

#### 4.B.2 `GET /api/partner/v1/wallet` (partner-API-key-authenticated, new sibling to `GET
/api/partner/v1/usage`)

**Headers:** `Authorization: Bearer <api_key>` (required) — identical auth path to the existing
`GET /api/partner/v1/usage` (`requirePartnerApiKey(request, 'reads')`, same 300 req/min rate-limit
class).

**Response — 200:**
```
{
  "balance_usd": 42.315000,
  "reference_topup_amount_usd": 100.000000 | null,
  "low_balance_alert_active": false,
  "burn_rate_by_event_type": [
    { "event_type": "voice_minute", "unit": "minute", "rate_usd": 0.01500000, "rate_basis": "cogs_placeholder_2026_05_no_margin" },
    { "event_type": "llm_generation_topic", "unit": "call", "rate_usd": null, "rate_basis": null },
    { "event_type": "llm_generation_content", "unit": "call", "rate_usd": null, "rate_basis": null },
    { "event_type": "llm_generation_prerequisite", "unit": "call", "rate_usd": null, "rate_basis": null },
    { "event_type": "llm_generation_skeleton", "unit": "call", "rate_usd": null, "rate_basis": null },
    { "event_type": "llm_generation_discovery", "unit": "call", "rate_usd": null, "rate_basis": null },
    { "event_type": "llm_generation_sample_fill", "unit": "call", "rate_usd": null, "rate_basis": null },
    { "event_type": "llm_generation_new_template", "unit": "call", "rate_usd": null, "rate_basis": null }
  ],
  "avg_daily_burn_usd": 1.203 | null,
  "projected_days_remaining": 35.2 | null,
  "days_remaining_null_reason": "exhausted_balance" | "no_burn_rate" | null,
  "next_billing_date": "2026-08-13T00:00:00Z" | null,
  "updated_at": "2026-07-13T19:00:00Z"
}
```
`avg_daily_burn_usd`/`projected_days_remaining`/`days_remaining_null_reason` use the identical formula
and null-reason semantics as `GET /api/admin/billing/clients` (Section 4.B.1) — same trailing-7-day
window, same partial-day exclusion, same two null reasons — so a partner building their own dashboard
against this field (Objective 6) gets the same numbers Arun sees on the admin page for the same account,
never a divergent computation.
`rate_usd: null` means "no rate configured yet for this event type" (the 7 `llm_generation_*` types at
launch, per Section 6's placeholder-rate scoping) — usage of that type is recorded but not yet
decremented from the wallet. This is honest, not an error: it reflects the deferred F-02 state exactly,
never fabricates a number. `burn_rate_by_event_type` always lists all 8 current `usage_events.event_type`
values, regardless of whether the partner has ever triggered that type — a partner can see the full
metering menu before ever using a given capability.

**Response — 401/403:** identical error envelope and conditions as `GET /api/partner/v1/usage`
(`invalid_api_key` / `revoked_api_key` / `account_suspended`) — same middleware, same behavior, no new
error taxonomy introduced.

**Compatibility note (per the Feature Brief's explicit requirement):** `GET /api/partner/v1/usage`'s
existing request/response contract is **completely unchanged** by this document — this is an additive
sibling route, not a modification. The one adjacent, low-risk, in-scope fix this document does make to
that route is corrected in Section 6, not a contract change (it only affects which rows a filtered query
returns, expanding coverage of an already-documented filter value, not altering the response shape).

#### 4.B.3 `POST /api/admin/billing/checkout` (Clerk-authenticated, self-serve top-up)

**Request body:** `{ "partner_account_id": "uuid", "amount_usd": number, "success_url": "string, optional", "cancel_url": "string, optional" }`
`amount_usd` validation: required, number, `>= 20` and `<= 50000` (sane top-up bounds — arbitrary
round-number guardrails against fat-finger entry, not a pricing decision; documented as a technical
implementation choice, adjustable without a spec change).

**Response — 201:** `{ "checkout_url": "https://checkout.stripe.com/..." }`
**Response — 403:** caller has no `partner_admin_users` row for the target account (same pattern as
`POST /api/admin/partner-keys`).
**Response — 422:** `amount_usd` out of bounds or missing.

#### 4.B.4 `POST /api/admin/billing/subscription` (Clerk-authenticated, mid-market auto-recharge)

**Request body:** `{ "partner_account_id": "uuid", "monthly_minimum_usd": number, "success_url": "string, optional", "cancel_url": "string, optional" }`
`monthly_minimum_usd` validation: required, number, `>= 100`.

**Response — 201:** `{ "checkout_url": "https://checkout.stripe.com/..." }` — Stripe Checkout in
`mode: "subscription"` is used to collect the recurring payment method (Stripe's own supported primitive
for "set up a recurring charge with card collection"), not the raw Subscriptions API directly, so the
partner-admin still gets a hosted, PCI-scope-free page — this is what "auto-recharge Subscription" means
operationally, not a bespoke card-collection form.
**Response — 403/422:** same pattern as 4.B.3.

#### 4.B.5 `POST /api/admin/billing/invoice` (Clerk-authenticated **and** internal-operator-only)

Not partner-self-serve in this brief — enterprise deals are negotiated manually (CEO brief: "annual
contract, negotiated discount... dedicated contact"), so this route is called by Clio's own ops (Arun),
not exposed in any partner-facing surface. Gated the same way as 4.B.1 (matches the existing
`/dashboard/admin/templates` authorization boundary — any signed-in Clerk user; see Section 9 for the
explicit note that a stricter internal-staff-only gate is a cross-cutting future enhancement, not unique
to this route).

**Request body:** `{ "partner_account_id": "uuid", "amount_usd": number, "description": "string", "collection_method": "send_invoice" | "charge_automatically" }`

**Response — 201:** `{ "invoice_id": "in_...", "hosted_invoice_url": "https://invoice.stripe.com/..." }`
**Response — 422:** validation failure.

## 5. Visual Examples

### 5.A `/dashboard/admin/clients` — literal wireframes

**State 1 — default, data loaded, sorted by days-remaining ascending:**
```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  Partner Billing                                                                                        │
│                                                                                                          │
│  Name          Tier         Status    Revenue (life)  Revenue (period)  Balance   Days left  Next bill  Payment      │
│  ──────────────────────────────────────────────────────────────────────────────────────────────────── │
│  Capgemini     Mid-market   Active    $4,820.00        $410.00           -$3.21    —          Aug 13    Visa •••• 4242│
│  Pluralsight   Self-serve   Active    $1,200.00        $90.00            $42.32    4.2        N/A — pay-as-you-go  Mastercard •••• 8891 │
│  Acme Corp     Enterprise   Active    $50,000.00       $4,166.67         $8,912.10 210.5      N/A — per contract  Bank account (ACH) │
│  TestPartner   Self-serve   Active    $0.00            $0.00             $0.00     —          N/A — pay-as-you-go  No payment method on file │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
(Capgemini sorts first: `balance_usd = -3.21` (negative) gives `days_remaining_null_reason:
"exhausted_balance"`, which the comparator treats as the domain minimum — "0 or negative days left" —
so it sorts ahead of every finite value, not behind them. TestPartner sorts last: `$0.00` balance with
zero usage ever gives `days_remaining_null_reason: "no_burn_rate"` — no burn observed, treated as the
domain maximum ("unbounded runway at the current, zero, rate") — so it sorts after every finite value.
Both display as `"—"` (Section 4.A), but they are never interchangeable in the sort order, and both are
distinguished explicitly by the `days_remaining_null_reason` API field, not inferred from `"—"` string-
matching or a generic nulls-first/nulls-last rule. Exact formula and comparator:
`architecture.md` §13.5 (the formula) and §13.6 (the comparator, both sort directions).)

**State 2 — loading:**
```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  Partner Billing                                                                                        │
│                                                                                                          │
│  Name          Tier         Status    Revenue (life)  Revenue (period)  Balance   Days left  Next bill  Payment      │
│  ──────────────────────────────────────────────────────────────────────────────────────────────────── │
│                              Loading partner accounts…                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**State 3 — empty:**
```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  Partner Billing                                                                                        │
│                                                                                                          │
│  Name          Tier         Status    Revenue (life)  Revenue (period)  Balance   Days left  Next bill  Payment      │
│  ──────────────────────────────────────────────────────────────────────────────────────────────────── │
│                              No partner accounts yet.                                                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**State 4 — error:**
```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  Partner Billing                                                                                        │
│                                                                                                          │
│                    Couldn't load partner billing data. Try refreshing the page.                         │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.B Sequence flows

**5.B.1 — Wallet decrement (the core mechanism)**
```
recordBillableEvent() inserts webhook_dispatch_log (idempotent upsert) + usage_events row
  [only if a genuinely NEW webhook_dispatch_log row was created — Section 6's idempotency fix]
   │
   ▼
applyWalletDecrement(usageEventId, partnerAccountId, eventType, quantity, occurredAt)
   │
   │ 1. IF test_mode = true on the originating event → skip entirely, no wallet mutation
   │    (mirrors the existing test_mode=FALSE billing-exclusion convention)
   │ 2. resolveEffectiveRate(partnerAccountId, eventType, occurredAt):
   │      prefer a partner-specific billing_rate_versions row covering occurredAt
   │      else the platform-default (partner_account_id IS NULL) row covering occurredAt
   │      else null
   │ 3. IF no rate found → UPDATE usage_events SET billed=false WHERE id=usageEventId
   │      → STOP. No wallet mutation, no alert check. (7 of 8 event types at launch — Section 6.)
   │ 4. IF rate found → amount_usd = quantity * rate_usd
   │      → decrement_wallet_balance(partnerAccountId, amount_usd) RPC → new_balance (atomic;
   │        lazily creates the wallet row at 0 first if none exists yet)
   │      → UPDATE usage_events SET billed=true, amount_usd, billing_rate_version_id
   │      → INSERT wallet_ledger (entry_type='usage_decrement', delta_usd=-amount_usd, resulting_balance_usd=new_balance, usage_events_id, billing_rate_version_id)
   │      → checkLowBalanceAndAlert(partnerAccountId, new_balance)  [5.B.5]
   ▼
Done — never blocks or reverses the original usage_events/webhook_dispatch_log writes on any failure
here; a decrement failure is logged and surfaced via wallet_ledger/usage_events.billed staying
inconsistent (a recoverable, queryable state), matching this codebase's existing per-item-error-tolerant
convention (never take down the whole ingestion path over one partner's billing hiccup).
```

**5.B.2 — Self-serve top-up (Stripe Checkout, one-time)**
```
Partner-admin (Clerk session) → POST /api/admin/billing/checkout {partner_account_id, amount_usd}
  → Clio creates Stripe Checkout Session (mode: "payment", metadata: {partner_account_id, purpose: "wallet_topup"})
  → 201 {checkout_url} → partner-admin completes payment on Stripe's hosted page
  → Stripe fires checkout.session.completed → POST /api/webhooks/stripe
  → handler reads session.metadata.purpose === "wallet_topup"
  → credit_wallet_balance(partner_account_id, amount_usd) RPC → new_balance (atomic; lazily creates
    the wallet row if none exists yet)
  → INSERT wallet_ledger (entry_type='topup_checkout', delta_usd=+amount_usd, resulting_balance_usd=new_balance,
    stripe_object_id=session.id)  [unique on (stripe_object_id, entry_type) — a webhook redelivery no-ops]
  → UPDATE partner_wallets SET reference_topup_amount_usd=amount_usd, low_balance_alert_fired_at=NULL
    (re-arm — 5.B.5)
```

**5.B.3 — Mid-market auto-recharge (Stripe Subscription)**
```
Partner-admin → POST /api/admin/billing/subscription {partner_account_id, monthly_minimum_usd}
  → Clio creates Stripe Checkout Session (mode: "subscription", ad-hoc recurring Price at
    monthly_minimum_usd, metadata: {partner_account_id, purpose: "wallet_auto_recharge"})
  → 201 {checkout_url} → partner-admin completes setup
  → Stripe fires invoice.paid (invoice.subscription is NOT null) → POST /api/webhooks/stripe
  → credit_wallet_balance(partner_account_id, invoice.amount_paid / 100) → new_balance
  → INSERT wallet_ledger (entry_type='topup_subscription_recharge', stripe_object_id=invoice.id)
  → UPDATE partner_wallets SET reference_topup_amount_usd, low_balance_alert_fired_at=NULL,
    tier='mid_market', funding_mechanism='subscription_auto_recharge',
    stripe_subscription_id=invoice.subscription, next_billing_date=<subscription.current_period_end>
  (repeats every billing cycle — each cycle's invoice.paid re-credits and re-arms)
```

**5.B.4 — Enterprise invoicing**
```
Clio ops (Arun) → POST /api/admin/billing/invoice {partner_account_id, amount_usd, description, collection_method}
  → Clio creates a Stripe Invoice (invoiceItems.create + invoices.create + finalize + send,
    metadata: {partner_account_id, purpose: "wallet_invoice"})
  → 201 {invoice_id, hosted_invoice_url} → sent to partner's AP contact (outside Clio, via Stripe's own
    invoice email or manually shared)
  → Stripe fires invoice.payment_succeeded (invoice.subscription IS null — distinguishes this from 5.B.3)
  → credit_wallet_balance(partner_account_id, invoice.amount_paid / 100) → new_balance
  → INSERT wallet_ledger (entry_type='topup_invoice', stripe_object_id=invoice.id)
  → UPDATE partner_wallets SET reference_topup_amount_usd, low_balance_alert_fired_at=NULL,
    tier='enterprise', funding_mechanism='invoicing', next_billing_date=<next negotiated date, if any — else remains null>
```

**5.B.5 — Low-balance alert + re-arm**
```
checkLowBalanceAndAlert(partnerAccountId, newBalanceUsd):
  IF reference_topup_amount_usd IS NULL OR 0 → STOP (no reference to measure 80%-consumed against yet)
  threshold = reference_topup_amount_usd * 0.2
  IF newBalanceUsd > threshold → STOP (not yet at 80% consumed)
  → UPDATE partner_wallets SET low_balance_alert_fired_at = now()
      WHERE partner_account_id = X AND low_balance_alert_fired_at IS NULL   [compare-and-set, race-safe]
  IF the UPDATE affected a row (this caller won the race — first crossing) →
      sendLowBalanceAlertEmail() to every partner_admin_users email for this account (Resend,
        account-level, fire-and-forget)
      + recordBillableEvent-style dispatch of a new webhook_dispatch_log row,
        event_type='wallet.low_balance', via the existing HMAC/signature/retry mechanism (fire-and-forget)
  ELSE → already fired for this depletion cycle, no duplicate send (this is what "fires once per
      threshold-crossing" means concretely)
Re-arm happens ONLY in 5.B.2/5.B.3/5.B.4 (a new top-up lands) — never in this function.
```

**5.B.6 — Idempotent retry (the closed gap)**
```
recordBillableEvent() called twice with identical (partner_account_id, event_type, clio_session_ref,
canonicalized payload) — e.g. an upstream retry after a transient network error:

Call 1: webhook_dispatch_log upsert INSERTS a new row (id=A) → usage_events insert proceeds,
        row created, applyWalletDecrement() runs, wallet decremented once.
Call 2 (retry): webhook_dispatch_log upsert conflicts on the same unique index
        (partner_account_id, event_type, clio_session_ref, payload_hash) → ignoreDuplicates → no row
        returned → `inserted` is null → usage_events insert is SKIPPED entirely (the fix) →
        applyWalletDecrement() never runs a second time → wallet decremented exactly once, total.
```

## 6. Data Requirements

Full schema/DDL, RPCs, and route-by-route detail live in `architecture.md` §13 and
`supabase/migrations/075_b2b04_billing_metering.sql`. Summarized:

**New tables** (all additive, none modify existing B2B-02/B2B-03 table columns except the two ALTERs
below): `partner_wallets` (1:1 with `partner_accounts`), `billing_rate_versions` (versioned, keyed by
`event_type` + optional `partner_account_id` override + `effective_from`/`effective_to`), `wallet_ledger`
(append-only, mirrors `minutes_ledger`'s established pattern — same discipline `writeMinutesLedgerEvent`
already uses: never recompute a balance independently of what the atomic RPC returned).

**Modified tables (additive ALTERs only):**
- `usage_events` gains `amount_usd NUMERIC(14,6)`, `billing_rate_version_id UUID REFERENCES
  billing_rate_versions(id)`, `billed BOOLEAN NOT NULL DEFAULT FALSE` — records the exact dollar amount
  and the exact rate row cited, at the moment of decrement, satisfying "a rate change must never silently
  reprice already-recorded historical usage" literally: the historical row carries its own cited rate
  forever, independent of what `billing_rate_versions` looks like later.
- `usage_events` gains a **unique index** on `webhook_dispatch_log_id` (`WHERE webhook_dispatch_log_id IS
  NOT NULL`) — the idempotency close. Paired with the code fix in `lib/partner/webhooks.ts`
  (`recordBillableEvent()`): the `usage_events` insert only executes when the `webhook_dispatch_log`
  upsert actually returned a newly-inserted row (`inserted !== null`), not unconditionally as it does
  today. This mirrors `webhook_dispatch_log`'s own existing unique-index pattern
  (`partner_account_id, event_type, clio_session_ref, payload_hash`) exactly, per the Feature Brief's own
  instruction.

**New RPC functions** (Postgres, mirroring `deduct_minutes`/`add_minutes`'s atomic-update-returning
pattern exactly): `decrement_wallet_balance(p_partner_account_id, p_amount_usd) RETURNS NUMERIC`,
`credit_wallet_balance(p_partner_account_id, p_amount_usd) RETURNS NUMERIC` — both lazily
`INSERT ... ON CONFLICT (partner_account_id) DO UPDATE` the wallet row if it doesn't exist yet, so there
is never a distinct "wallet not found" error state to handle. Neither clamps at zero — a wallet can go
negative (Section 9).

**Denomination decision (Feature Brief's explicit "BA's call, document the choice")**: the wallet balance
is denominated in **USD dollars**, `NUMERIC(14,6)` (not a credit-unit abstraction, not integer cents).
Rationale: the only numbers on record anywhere (F-02's stale COGS figures) are already expressed in
fractional USD per unit (`$0.0108/min` etc.); a credit-unit abstraction would require inventing an
exchange rate between "credits" and dollars, which is itself exactly the kind of invented pricing number
the Feature Brief forbids. Six decimal places accommodate the smallest per-unit COGS figure on record
(`$0.0002/min`) without rounding it to zero.

**Placeholder rate seeding (the one dollar figure genuinely on record vs. the seven that are not):** the
CEO brief authorizes using stale F-02 figures for acceptance tests and forbids inventing new ones. On
inspection, `docs/b2b-pivot-status.md` F-02 records a COGS figure only for `voice_minute`
(Recall.ai $0.0108/min + Claude Sonnet ~$0.0002/min + infra ~$0.004/min = **$0.0150/min**, seeded as a
single `billing_rate_versions` row, `partner_account_id = NULL` (platform default),
`rate_basis = 'cogs_placeholder_2026_05_no_margin'` — explicitly labeled both as a placeholder and as
carrying no margin, since the Feature Brief separately forbids inventing a markup). **No comparable
figure exists on record, stale or otherwise, for any of the 7 `llm_generation_*` event types** — the
`~$0.0002/min` Claude figure is a cost-per-minute-of-conversation number, not a cost-per-generation-call
number, and is not a substitutable stand-in (different unit, different workload shape per generation
type). Per the Feature Brief's own constraint ("never invent real dollar figures... do not research or
estimate new ones"), this document does **not** invent one. Instead: those 7 event types launch with **no
seeded rate row**, `usage_events.billed` stays `false` for them, they are visibly present-but-unrated in
both dashboards (Section 4), and seeding them is named explicitly in Section 12 as a dependency tracked
alongside F-02's already-deferred research pass — not silently dropped, not silently guessed. This is a
scoping/data-completeness decision, not a spec fork (the mechanism handles rated and unrated event types
identically and correctly either way), so it does not require Section 11 escalation.

**Read from the database:** `partner_wallets`, `billing_rate_versions` (resolved at decrement time and at
every wallet-read endpoint), `wallet_ledger` (admin page revenue aggregates), `usage_events` (burn-rate
projection aggregate — `billed=true` rows only, `occurred_at` within the trailing 7 complete UTC calendar
days, current partial day always excluded; exact window/aggregation/partial-day formula:
`architecture.md` §13.5), `partner_admin_users` (to resolve low-balance alert recipient emails).

**`avg_daily_burn_usd` / `projected_days_remaining` / `days_remaining_null_reason`** are computed live
at request time (a single indexed aggregate query, not an external API call, so no caching is needed —
unlike `next_billing_date`, which is cached because it requires a Stripe round-trip). Formula: sum of
`amount_usd` over `billed=true` `usage_events` rows in the trailing 7 complete UTC calendar days
(`[today_00:00_UTC − 7 days, today_00:00_UTC)`, i.e. today is always fully excluded, never prorated),
divided by the number of complete days actually in that window (7, or fewer for a wallet under 7 days
old). `projected_days_remaining = balance_usd / avg_daily_burn_usd` when both a real burn rate and a
positive balance exist; otherwise `null` with an explicit `days_remaining_null_reason` distinguishing
"balance already exhausted" from "no burn signal yet" (full derivation, the two-tier null logic, and the
sort comparator that consumes it: `architecture.md` §13.5–13.6).

**Written to the database:** `partner_wallets` (balance/tier/funding fields, via the two RPCs plus
Stripe-webhook-driven field syncs), `billing_rate_versions` (seeded at migration time; no write API in
this brief — see Section 10), `wallet_ledger` (one append-only row per credit or decrement), `usage_events`
(the two new columns, populated at decrement time).

**APIs called:** Stripe (`checkout.sessions.create`, `subscriptions`-via-Checkout,
`invoiceItems.create`/`invoices.create`/`.finalizeInvoice`/`.sendInvoice`, `customers.create`/`retrieve`,
`paymentMethods.retrieve` — all via the official `stripe` SDK, no raw HTTP).

**Never written anywhere:** raw card numbers, CVCs, bank account numbers — only Stripe object references
(`stripe_customer_id`, `stripe_default_payment_method_id`) and Stripe-supplied display metadata (card
brand/last4/payment type), matching Arun's explicit instruction and the existing `redactAuditTokenFromUrl`
discipline this codebase already applies to other secrets.

**localStorage/sessionStorage:** none — this brief has no browser-side persisted state.

**In-scope adjacent fix, not a new feature:** `app/api/partner/v1/usage/route.ts`'s
`usageEventTypesFor('usage.llm_generation_call')` currently maps only to
`['llm_generation_topic', 'llm_generation_content', 'llm_generation_prerequisite']` — the 3 event types
that existed when B2B-02 wrote that route. Migration 074 (B2B-03) later extended
`usage_events.event_type` to 8 values; this mapping was never updated, so a partner filtering
`event_type=usage.llm_generation_call` today silently never sees the 4 newer sub-types'
(`skeleton`/`discovery`/`sample_fill`/`new_template`) usage rows. This document is already touching
`usage_events`-adjacent billing/read code, so this document scopes the one-line fix (add the 4 missing
values to that array) into this brief rather than leaving a partner blind to usage this same brief is
simultaneously billing them for — leaving it unfixed while shipping a wallet that DOES decrement for
those types would be a materially worse, confusing state than either fixing it or not touching the area
at all.

## 7. Success Criteria (Acceptance Tests)

✓ Given a platform-default `billing_rate_versions` row for `voice_minute` at `$0.0150/min` and a partner
with a `$50.00` wallet balance, when a `usage.voice_minute` event for `2.0` minutes is recorded, then the
wallet balance becomes `$49.97`, the originating `usage_events` row has `billed=true`,
`amount_usd=0.0300`, and `billing_rate_version_id` set to that exact rate row's id, and a `wallet_ledger`
row exists with `entry_type='usage_decrement'`, `delta_usd=-0.0300`, `resulting_balance_usd=49.97`.

✓ Given a `usage.llm_generation_call` event of `generation_type='discovery'` (one of the 7 currently
unrated types) and a partner with a `$50.00` balance, when the event is recorded, then the wallet balance
remains exactly `$50.00`, the `usage_events` row has `billed=false`, `amount_usd IS NULL`, and
`GET /api/partner/v1/wallet`'s `burn_rate_by_event_type` array shows `rate_usd: null` for
`llm_generation_discovery`.

✓ Given a `billing_rate_versions` row for `voice_minute` at `$0.0150/min` effective from `T1`, when a new
rate row at `$0.0200/min` is inserted effective from `T2` (`T2` > `T1`), then a `usage_events` row with
`occurred_at` between `T1` and `T2` — queried **after** the rate change — still shows
`amount_usd`/`billing_rate_version_id` citing the original `$0.0150` rate, unchanged, proving history is
never silently repriced.

✓ Given `recordBillableEvent()` is called twice with byte-identical `(partner_account_id, event_type,
clio_session_ref, canonicalized payload)`, when both calls complete, then exactly one `usage_events` row
exists for that logical event, the wallet was decremented exactly once (not twice), and
`webhook_dispatch_log` also shows exactly one row (its own pre-existing idempotency, unaffected).

✓ Given a partner wallet with `reference_topup_amount_usd=$100.00` and `low_balance_alert_fired_at IS
NULL`, when a decrement brings the balance to `$19.50` (below the `$20.00` / 20%-of-reference threshold),
then exactly one low-balance alert email is sent and `low_balance_alert_fired_at` is set; when a further
decrement brings the balance to `$5.00`, no second email is sent (already-fired guard); when a new top-up
of `$50.00` lands, `reference_topup_amount_usd` becomes `$50.00` and `low_balance_alert_fired_at` resets
to `NULL` (re-armed); when a subsequent decrement crosses below `$10.00` (20% of the new `$50.00`
reference), a second alert email fires.

✓ Given a partner-admin with a `partner_admin_users` row for their account, when they call
`POST /api/admin/billing/checkout` with `amount_usd=100` and complete the resulting Stripe Checkout
session, then Stripe's `checkout.session.completed` webhook credits the wallet by exactly `$100.00`, a
`wallet_ledger` row with `entry_type='topup_checkout'` and `stripe_object_id` set to the Checkout Session
ID exists, and redelivering the same webhook event (Stripe's own retry behavior) does not credit the
wallet a second time (unique index on `(stripe_object_id, entry_type)`).

✓ Given a mid-market partner's auto-recharge subscription, when Stripe fires `invoice.paid` with
`invoice.subscription` set, then the wallet is credited by `invoice.amount_paid`, `partner_wallets.tier`
becomes `'mid_market'`, and `next_billing_date` is set to the subscription's `current_period_end` —
distinct from an enterprise `invoice.payment_succeeded` event (`invoice.subscription IS null`), which
credits the wallet identically but sets `tier='enterprise'` and does not touch `stripe_subscription_id`.

✓ Given the `/dashboard/admin/clients` page with 3 partners — one with a negative balance (and some
billed usage in the trailing window, so `avg_daily_burn_usd` is non-null), one with a positive balance
and recent billed usage, one with a positive balance and zero usage ever — when the page loads, then the
negative-balance partner sorts first with API field `days_remaining_null_reason: "exhausted_balance"`,
the recent-usage partner sorts second (finite `days_remaining`, `days_remaining_null_reason: null`), and
the zero-usage partner sorts last with `days_remaining_null_reason: "no_burn_rate"` — both null-reason
partners display `days_remaining` as `"—"` on screen, never as `0`, `null` rendered literally, or an
error, but are never treated as equal or ambiguous by the sort itself, verified explicitly via the
distinct `days_remaining_null_reason` values (`architecture.md` §13.5/13.6).

✓ Given the same 3-partner setup as above, when the admin clicks the "Days remaining" column header
twice (once to force ascending, once more to toggle to descending), then the ascending order is
`exhausted_balance → finite ascending → no_burn_rate` (as above) and the descending order is exactly its
mirror — `no_burn_rate → finite descending → exhausted_balance` — proving both directions call the same
comparator (`architecture.md` §13.6) rather than a naive reverse-of-array or a generic nulls-last rule
that would group the two null reasons together in either direction.

✓ Given a partner with `billed=true` `usage_events` totaling exactly `$14.00` spread across 3 of the
last 7 complete UTC calendar days (the other 4 days had zero usage), and `$50.00` of usage recorded
`billed=true` in the first 3 hours of the current (still in-progress) UTC day, when
`GET /api/admin/billing/clients` is called, then `avg_daily_burn_usd = 14.00 / 7 = 2.00` (the current
partial day's `$50.00` is excluded entirely from both the numerator and the day count, not prorated),
and `projected_days_remaining` is computed from that `$2.00/day` figure, not from any figure that would
imply a `$50.00`-or-more daily burn rate.

✓ Given two different partner accounts, when Partner A calls `GET /api/partner/v1/wallet` with their own
valid API key, then the response contains only Partner A's `balance_usd`/`burn_rate_by_event_type`/etc. —
never any field, aggregate, or reference derived from Partner B's data, verified by asserting the response
is byte-identical regardless of how much usage Partner B has generated.

✓ Given the three tiers (self-serve/mid-market/enterprise), when any tier calls any `/api/partner/v1/*`
route, then the request/response contract, available fields, and error codes are identical across all
three — the only observable difference across tiers anywhere in this brief is which
`POST /api/admin/billing/*` funding route their Clerk-authenticated admin used and what `rate_usd` a
partner-specific `billing_rate_versions` override row (if any) resolves to, never a difference in API
surface, feature availability, or response shape (Objective 6 / "no feature gating by tier," verified
explicitly here per the CEO brief's own review checklist item (a)).

## 8. Error States

| Failure | User-visible behavior | Clio-side behavior |
|---|---|---|
| Stripe webhook signature invalid | N/A (Stripe-to-Clio call) | `400`, no wallet mutation, reuses existing `constructWebhookEvent()` null-return path |
| Stripe webhook references a `partner_account_id` in metadata that no longer exists | N/A | Logged, `200` returned (never `5xx` — Stripe retries on `5xx`, matching the existing stripe-webhook-route convention of "always 200, log errors") |
| `POST /api/admin/billing/checkout`/`subscription`/`invoice` called by a Clerk user with no `partner_admin_users` row for the target account | `403`, same error envelope as `POST /api/admin/partner-keys` | No Stripe object created |
| `amount_usd`/`monthly_minimum_usd` out of bounds or missing | `422`, field-level error | No Stripe object created |
| Decrement attempted for a partner with no `partner_wallets` row yet | No user-visible error — RPC lazily creates the row at `$0` and proceeds into negative territory | Wallet row created transparently, decrement proceeds |
| `resolveEffectiveRate()` finds no applicable rate | No user-visible error (event still recorded) | `usage_events.billed=false`, no wallet mutation, no alert check (Section 6) |
| `GET /api/partner/v1/wallet` called with a revoked/invalid/missing key | `401`, identical envelope to `GET /api/partner/v1/usage` | No DB read beyond the auth lookup |
| `GET /api/partner/v1/wallet` called against a suspended partner account | `403`, `code: "account_suspended"` | Same as existing `requirePartnerApiKey` behavior, reused unmodified |
| `GET /api/admin/billing/clients` query fails | Screen state 4 (Section 4.A) | `500` from the API route, logged server-side, no partial/stale data rendered |
| Concurrent decrements race on the low-balance threshold | N/A (background mechanism) | Compare-and-set `UPDATE ... WHERE low_balance_alert_fired_at IS NULL` guarantees exactly one alert fires per crossing, not zero, not more than one |
| Stripe API itself unreachable/erroring when creating a Checkout Session, Subscription, or Invoice | `502`-equivalent JSON error from the relevant `POST /api/admin/billing/*` route, no Stripe object left half-created client-side (the SDK call either succeeds and returns an object, or throws before any URL is returned) | Logged; the partner-admin can retry the same `POST` — no partial state persisted on Clio's side since nothing is written to `partner_wallets`/`wallet_ledger` until the corresponding webhook confirms payment |

**Loading/slow-network state:** `GET /api/admin/billing/clients` and `GET /api/partner/v1/wallet` are
both simple aggregate reads over indexed tables — no specific timeout beyond the codebase's existing
default fetch behavior; Screen state 2 (Section 4.A) covers the admin page's loading UX explicitly.

## 9. Edge Cases

- **Wallet balance going negative**: fully supported, not an error state. A live meeting-bot session's
  per-minute voice billing cannot be paused mid-call, so usage that crosses a zero balance mid-session
  still completes and still decrements (to negative). This is the state the admin page's default sort
  surfaces first (Section 4/5.A). This document does **not** build an automatic hard-block on
  `POST /api/partner/v1/sessions` for an already-negative balance — see Section 10 for why this is
  explicitly out of scope, not silently included.
- **A brand-new partner account with no wallet row and no usage yet**: `partner_wallets` row is created
  lazily on first credit or first decrement (Section 6) — a partner can exist, hold API keys, and even
  initiate sessions (B2B-02) before ever touching billing, exactly mirroring B2B-02's own "first-ever
  session ... outbound config unset ... fails cleanly" precedent.
- **`reference_topup_amount_usd` never set (partner has never topped up — e.g. test-mode-only
  integration testing)**: `checkLowBalanceAndAlert()` is a no-op (Section 5.B.5) — no alert is possible or
  expected without a funded reference point; this is correct, not a gap.
- **`avg_daily_burn_usd` computed with zero billed usage in the trailing 7-complete-day window**:
  `avg_daily_burn_usd` and `projected_days_remaining` are both `null`, `days_remaining_null_reason =
  "no_burn_rate"`, rendered as `"—"` (Section 4.A/5.A), never a divide-by-zero error and never
  `Infinity` — and this row sorts *last*, not first, in the default ascending sort (Section 4.A,
  `architecture.md` §13.6), distinct from the exhausted-balance case below.
- **A wallet with a zero or negative `balance_usd` but a real, non-null `avg_daily_burn_usd`**:
  `projected_days_remaining` is `null`, `days_remaining_null_reason = "exhausted_balance"`, rendered as
  `"—"` — but this row sorts *first* in the default ascending sort, the opposite end of the table from
  the zero-usage case above, despite both displaying the identical `"—"` string on screen
  (`architecture.md` §13.5/13.6).
- **A wallet less than 7 complete UTC days old (a brand-new partner)**: the burn-rate window is
  truncated to however many complete days have actually elapsed since `partner_wallets.created_at`
  (never a full 7-day denominator that would understate a new account's true daily rate); a wallet with
  zero complete days elapsed (created today) has no window at all and is treated identically to
  zero-usage — `days_remaining_null_reason = "no_burn_rate"` (`architecture.md` §13.5).
- **Enterprise partner with no recurring negotiated cadence**: `next_billing_date` stays `null`, rendered
  as `"N/A — per contract"` — a one-off invoice does not fabricate a future date.
- **Mid-market subscription cancelled** (`customer.subscription.deleted`): auto-recharge stops (no further
  `invoice.paid` events will fire); `partner_wallets.tier` is **not** automatically reverted to
  `self_serve` — tier is a manually-set operational fact about the commercial relationship, not something
  this document infers from a single Stripe event; an already-funded balance is unaffected and keeps
  decrementing normally against whatever rate applies to that partner.
- **Test-mode usage events (`test_mode=true`)**: explicitly and always skipped by
  `applyWalletDecrement()`'s first check (Section 5.B.1) — preserves the existing
  `test_mode=FALSE`-only-billable convention this document must not reintroduce a leak into, per the
  Feature Brief's explicit constraint.
- **Sub-tenant usage (`partner_reference` set, e.g. `"hartford"`)**: `wallet_ledger.metadata` and
  `usage_events` already carry `partner_reference` as a pass-through (unchanged from B2B-02) — Clio still
  decrements exactly one wallet per top-level `partner_account_id`; no per-sub-tenant wallet or billing
  split is computed or stored anywhere, per the Feature Brief's explicit "No sub-tenant billing
  complexity" constraint.
- **A partner-specific `billing_rate_versions` override row exists for only some event types**: rate
  resolution falls back to the platform-default row per event type independently — a partner can have a
  negotiated discount on `voice_minute` only, while every `llm_generation_*` type (once seeded) still
  resolves to the platform default, with no cross-event-type coupling.
- **Mobile vs. desktop**: not applicable — `/dashboard/admin/clients` is an internal operational tool; no
  mobile-specific layout is specified (matches the existing `/dashboard/admin/templates` precedent, which
  has none either).

## 10. Out of Scope

Explicitly excluded, per the Feature Brief's own scope boundaries plus this document's own findings:

- **F-02's real COGS/margin numbers** — explicitly deferred by Arun's own decision; this document uses
  only the one figure genuinely on record (`voice_minute`) and leaves the 7 `llm_generation_*` types
  unrated rather than inventing figures for either COGS or margin (Section 6).
- **Automatic hard-blocking of `POST /api/partner/v1/sessions` on a zero/negative wallet balance.** Not
  named in the Feature Brief's "What Success Looks Like" list; would require its own error code,
  partner-facing UX, and product decision about whether/how a live-session request should ever be
  rejected for a billing reason — a real product-policy question this document does not invent an answer
  to. Today's mitigation is the existing `partner_accounts.status='suspended'` mechanism (B2B-02,
  unmodified), usable manually by Arun if a persistently negative balance needs to stop new sessions.
- **Automatic account suspension on negative/exhausted balance.** Same reasoning — manual only, via the
  existing `status` column, not a new automated policy.
- **Seeding `billing_rate_versions` for the 7 `llm_generation_*` event types.** Tracked as a dependency
  (Section 12), blocked on the same F-02 research pass already deferred.
- **Designer/Configurator UI, the partner-facing Configurator screen that would eventually render
  `GET /api/partner/v1/wallet`'s data as a visual dashboard inside the partner's own login** — B2B-03's
  scope. This document delivers the API contract (Objective 6: API-observable is the requirement; a
  Clio-hosted UI is not, since no partner-facing UI shell/auth surface exists yet to attach one to — see
  Section 11 for why this scoping call does not require escalation).
- **A write/editing API for `billing_rate_versions`** (e.g. a UI or endpoint for Arun to adjust rates
  going forward). This document seeds the initial rate via migration only; an authoring surface for future
  rate changes is a reasonable follow-on, not built here since it wasn't named in the Feature Brief's
  success criteria.
- **Subdomain/custom-domain provisioning** — B2B-05, unrelated to billing.
- **Per-sub-tenant wallets or billing splits** — explicitly excluded by the Feature Brief's own Known
  Constraints.
- **Any monitoring/paging system beyond the low-balance email + webhook** (e.g. Slack alerts to Clio's own
  ops channel) — not named in the Feature Brief's success criteria.

## 11. Open Questions

None.

Two items the Feature Brief itself flagged as CEO-resolved-without-escalation (the 80% threshold, and the
internal-admin-dashboard being in scope here) are treated as settled per the Feature Brief's own stated
reasoning — not re-opened.

Two additional judgment calls this document made, documented here per the Feature Brief's own instruction
to surface findings rather than silently resolve or silently escalate low-stakes ones:

1. **The "partner-facing usage dashboard" (Feature Brief item 6) is delivered in this document as an API
   contract (`GET /api/partner/v1/wallet`), not a new Clio-hosted UI screen.** The Feature Brief's own
   phrasing for this item is API-shaped throughout ("extending... the existing `GET
   /api/partner/v1/usage` contract," "BA to determine whether this extends the existing endpoint's
   response shape or adds a sibling endpoint") and never specifies a route, wireframe, or screen states
   the way item 5 (the internal admin page) explicitly does. No partner-facing UI shell or Clerk-scoped
   partner-admin dashboard exists yet to attach a new screen to — that shell is B2B-03's Configurator,
   not yet built. Building a one-off dashboard page ahead of that shell would mean inventing UI/visual
   direction for a screen with no established partner-facing design system, which `CLAUDE.md` explicitly
   instructs against ("flag it as a blocker rather than inventing a visual direction"). Delivering the
   data as an API contract instead directly satisfies Objective 6 ("API-observable... feeding both
   billing and the partner's own dashboard" — the partner's own dashboard, not necessarily Clio's) and
   leaves B2B-03 free to render it once that UI shell exists. This is a technical/scoping decision, not a
   product decision the Feature Brief withheld — it does not change what data is computed or exposed, only
   where it's rendered.
2. **The `llm_generation_*` unrated-event-type resolution (Section 6)** is treated as a data-completeness
   scoping decision, not a spec fork, because the mechanism (rate resolution, decrement, versioning,
   idempotency) behaves identically and correctly whether or not a given event type currently has a rate
   configured — the only difference is whether `billed` ends up `true` or `false`. No branch of this
   document's design changes based on which state a given event type is in, so there is no fork to
   escalate, only an honest gap to name (done, throughout this document) rather than paper over with an
   invented number.

## 12. Dependencies

- **B2B-02** (done) — `partner_accounts`, `partner_api_keys`, `partner_sessions`, `webhook_dispatch_log`,
  `requirePartnerApiKey`/`requirePartnerAdmin` (`lib/partner/auth.ts`), the HMAC signing mechanism
  (`lib/partner/webhook-signature.ts`), and `recordBillableEvent()`
  (`lib/partner/webhooks.ts`) — this document modifies the last of these (the idempotency fix, Section 6)
  and calls the rest unmodified.
- **F-01 Resolution A** (done, unconditional) — `usage_events` (migration 072) is the live source of
  truth this document's decrement mechanism reads from.
- **B2B-03 / migration 074** (done) — the 8-value `usage_events.event_type` domain this document's
  `billing_rate_versions` table keys off exactly.
- **F-02 (real COGS + margin research)** — explicitly not a blocker for this brief per Arun's own
  decision, but is a hard blocker for two specific, named follow-on items this document deliberately does
  not attempt: seeding `billing_rate_versions` for the 7 currently-unrated `llm_generation_*` event
  types, and adding a margin/markup on top of the one seeded `voice_minute` COGS-basis rate. Both are
  tracked as backlog items alongside F-02's own already-tracked research pass, not invented here.
  Documenting this dependency explicitly is what lets this document ship with Section 11 empty despite
  the gap.
- **Stripe test-mode configuration** — verifying all three funding sequence flows (Section 5.B.2–5.B.4)
  end-to-end requires Stripe test-mode Checkout/Subscription/Invoicing to be exercised; `STRIPE_SECRET_KEY`
  remains a `PLACEHOLDER_`-safe mock in any environment without a real key, per `CLAUDE.md`'s existing
  mock-stub convention (`lib/stripe.ts`'s `isPlaceholder` guard, reused unmodified for this document's new
  functions).
- **Resend / `lib/delivery/email.ts` pattern** (existing, reused) — the low-balance alert email
  (`sendLowBalanceAlertEmail`) follows the exact `isPlaceholder`-guarded, `logEmailResult`-wrapped pattern
  already established there; this document adds one new function to that file, does not rework it.
- **What this document unblocks**: B2B-03's Configurator UI can render `GET /api/partner/v1/wallet`'s
  data as an actual partner-facing dashboard screen once that UI shell exists (named dependency for
  B2B-03's own scoping, mirroring how B2B-02 named the render-runtime dependency for B2B-03 previously).
