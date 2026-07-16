# B2B-13 — Recurring Plan Tiers + Configurable Top-Up Amounts
# Requirement Document
Version: 1.1
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-16

**Revision Note (v1.0 → v1.1):** CEO review of v1.0 found one confirmed, must-fix design flaw in Section
4.B's webhook correlation logic: it identified a Plan invoice by reading
`invoice.subscription_details?.metadata`, a field whose location on the `Invoice` object is governed by
the Stripe API version pinned on the **live webhook endpoint's Dashboard configuration** — not by
`lib/stripe.ts`'s outbound SDK pin (`2025-02-24.acacia`), which this document has no way to independently
confirm matches. If the live endpoint is pinned to Basil (`2025-03-31.basil`) or later, that field
resolves to `undefined` for a genuine Plan invoice, silently falling through to the old auto-recharge
branch and crediting the wallet by the full `invoice.amount_paid` instead of the intended fixed
allowance — a real wrong-credit bug, not a clean no-op. **Sections 4.B, 6.D, 7, and 8 are rewritten below**
to correlate Plan invoices by a stable Stripe object id (`invoice.subscription` looked up against
`partner_wallets.stripe_plan_subscription_id`) instead, per the CEO's explicit recommendation. Section 6.C
also gets one small, mechanically necessary addition (adding session-level `metadata` to the Checkout
Session so the new correlation mechanism has data to read) — flagged inline as a consequence of the
required fix, not independent scope creep. All other sections are unchanged from v1.0 and remain CEO-approved.

**Source Feature Brief:** `.claude/agents/clio/feature-briefs/B2B-13-recurring-plan-tiers-and-configurable-topups.md`
(read in full). The brief already resolves 5 product-shape decisions — this document does not reopen
them: (1) Plan catalog lives in code (`lib/billing/plan-tiers.ts`), not a DB table; (2) per-partner Plan
state is new nullable columns on `partner_wallets`; (3) the wallet is credited by the tier's **fixed
included allowance** on `invoice.paid`, never by the invoice's `amount_paid`; (4) the wizard's "Set a
monthly minimum" auto-recharge card is **replaced**, not joined, by Plan selection; (5) pricing is shown
as compact specific-price cards (price + included allowance together), not a "contact sales" selector.
This document turns those decisions into buildable DDL, code, and UI, and closes the 7 items the brief
explicitly left for the BA to resolve (see Section 11).

**Verified directly against the shipped, live code and live production data by this document's author,
all read/queried in full:**
- `lib/stripe.ts` — confirmed zero existing discrete Stripe Price IDs anywhere in the file; all four
  billing functions (`createWalletTopupCheckoutSession`, `createAutoRechargeSubscriptionCheckout`,
  `createEnterpriseInvoice`, `createTestBlockCheckoutSession`) use ad-hoc `price_data`, never a
  pre-created `price`. Confirmed the `isPlaceholder` (module-level, `STRIPE_SECRET_KEY`-gated) mock-guard
  pattern every function follows.
- `supabase/migrations/075_b2b04_billing_metering.sql` — `partner_wallets` schema (lines 18–56):
  `tier`'s "commitment-size/support-routing only, no feature gating" comment; `funding_mechanism`'s
  existing `CHECK` values; `stripe_subscription_id`'s "mid-market auto-recharge subscription only"
  comment; `reference_topup_amount_usd`/`low_balance_alert_fired_at`'s re-arm-on-new-credit mechanic.
  `wallet_ledger`'s `entry_type` `CHECK` (lines 133–137) and its `(stripe_object_id, entry_type)`
  idempotency unique index (lines 155–157). The `credit_wallet_balance`/`decrement_wallet_balance` RPCs
  (lines 198–227).
- `supabase/migrations/077_b2b08_testing_metering.sql` (lines 41–49) — confirmed the **exact live pattern**
  for widening `wallet_ledger.entry_type`'s `CHECK` (drop-and-recreate the named constraint) used when
  `test_block_purchase` was added; migration 081 below reproduces this pattern byte-for-byte for
  `plan_allowance_credit`.
- `supabase/migrations/` directory listing — confirmed the latest migration is
  `080_b2b11_prompt_behavior_and_join_greeting.sql`; **the next free number is 081** (the CEO brief's own
  guess, confirmed correct, not 080 — B2B-11 already claimed it).
- `app/dashboard/configurator/wizard/WizardClient.tsx` — `PaymentStep` (lines 448–503, full function read):
  the exact current two-card markup, both `startCheckout()`/`startSubscription()` handlers, the hardcoded
  `amount_usd: 100` / `monthly_minimum_usd: 100` bodies, the `successUrl`/`cancelUrl` construction
  (`&funded=1` query param). Confirmed via lines 108–140 (the wizard's own `funded=1` `useEffect`) that
  this param is a **generic** "payment step just returned from Stripe" signal — not tied to which of the
  two buttons was clicked — so a third redirect source (Plan checkout) reusing the identical convention
  needs no new handling code.
- `app/dashboard/configurator/_shared.tsx` — confirmed the exact `COLORS` palette, `Card`, `PrimaryButton`,
  `SecondaryButton` components this document's wireframes and new UI must reuse verbatim (no new visual
  system).
- `app/api/admin/billing/checkout/route.ts` / `.../subscription/route.ts` — confirmed the exact existing
  Zod bounds (`amount_usd: z.number().min(20).max(50000)`, documented in-file as "a technical
  implementation guardrail... not a pricing decision") and the `requirePartnerAdmin()` auth pattern this
  document's new route reuses identically.
- `app/api/webhooks/stripe/route.ts` — read in full. Confirmed the exact current `switch (event.type)`
  case list (`checkout.session.completed`, `invoice.paid`, `invoice.payment_succeeded`,
  `customer.updated`, `payment_method.attached`, `default`) — **there is no existing
  `customer.subscription.updated` or `customer.subscription.deleted` handler of any kind today**, for
  either the mid-market auto-recharge mechanism or anything else. This document adds both as new cases;
  it does not modify or extend an existing one. Confirmed the exact current `invoice.paid` branch's logic
  (customer→wallet lookup, `walletLedgerAlreadyRecorded` idempotency guard, `credit_wallet_balance` RPC,
  ledger insert, `partner_wallets` update including the `invoice.lines.data[0].period.end` →
  `next_billing_date` cache-not-live-call pattern) that this document's new Plan branch runs alongside,
  not on top of.
- `lib/partner/webhooks.ts` — read in full. Confirmed `checkLowBalanceAndAlert()`'s re-arm mechanic (fires
  at 80%-consumed off `reference_topup_amount_usd`, re-armed only when a webhook credit path resets
  `low_balance_alert_fired_at = null`) — this document's Plan-allowance credit path re-arms it the exact
  same way every existing credit path does. Confirmed this file is otherwise untouched — no wallet
  **decrement** logic anywhere in this document.
- `lib/partner/wizard.ts` (line 179–185) — confirmed `advanceWizardStep()`'s payment-step readiness check
  is a bare `!!data?.funding_mechanism` truthiness check, **not a whitelist of specific values**. Setting
  `funding_mechanism = 'plan_subscription'` satisfies this check with **zero code change** to
  `lib/partner/wizard.ts` or `app/api/admin/configurator/wizard/advance/route.ts`.
- `docs/specs/B2B-04-requirement-document.md` (Section 9, "Mid-market subscription cancelled") — the
  documented precedent this document's Section 9 lifecycle policy mirrors: cancellation stops future
  credits, does **not** auto-revert any classification field, does **not** touch the current balance.
- **Live production data query** (Supabase project `hello-clio`, `nqxlpcshouboplhnuvrh`, read-only
  `SELECT`, run directly by this document's author): `SELECT count(*), count(*) FILTER (WHERE
  stripe_subscription_id IS NOT NULL), count(*) FILTER (WHERE funding_mechanism =
  'subscription_auto_recharge') FROM partner_wallets` → **`{total_wallets: 0, with_stripe_subscription_id:
  0, with_auto_recharge_mechanism: 0}`**. Zero partner_wallets rows exist in production at all today —
  this resolves Section 11 item 6 with a real data check, not an assumption.

---

## 1. Purpose

Today `partner_wallets` funds usage in three ways — a one-time top-up, a mid-market auto-recharge
subscription (a floor the wallet is topped back up to), or manual enterprise invoicing — and none of
them has a fixed price of its own; a partner pays exactly what they fund. There is no product that says
"pay a known monthly or annual fee, get a bundled usage allowance, buy more if you go over" — the
standard SaaS commercial shape self-serve and mid-market partners expect to see. The wizard's Payment
step also hardcodes both funding amounts to `$100`, which is a real launch blocker independent of the
Plan-tier work: no partner should ever see a fabricated number presented as a real price.

**What failure looks like without this document:** partners evaluating Clio hit a Payment step with only
"top up an arbitrary dollar amount" or "commit to an auto-recharge floor" as choices — no predictable
monthly/annual cost, no bundled-allowance value story, and a hardcoded `$100` that Arun cannot safely
demo or sell against. Every day this ships late is a day self-serve signups either bounce at the Payment
step or, worse, complete it against numbers nobody actually priced.

## 2. User Story

As a **partner-admin going through the Configurator wizard's Payment step**,
I want to **choose a recurring monthly or annual Plan with a clear price and a bundled usage allowance**,
So that **I know exactly what I'm committing to before I pay, the way any SaaS pricing page works**.

As the **same partner-admin**,
I want to **alternatively fund my wallet with a one-time top-up of an amount I choose (a quick preset or
a custom figure)**,
So that **I'm not forced into a recurring commitment if pay-as-you-go suits me better**.

As **the system processing Stripe billing events for a Plan subscription**,
I want to **credit the partner's wallet by the Plan's fixed included allowance on every successful
invoice, and track the subscription's payment health**,
So that **the partner gets exactly the bundled value their Plan promises — no more, no less — and Clio's
own records accurately reflect whether that Plan is current, struggling, or gone**.

## 3. Trigger / Entry Point

- **Route:** `/dashboard/configurator/wizard?partner_account_id=<id>&step=payment` — the existing wizard
  route, existing `payment` step. No new route.
- **Trigger:** the partner-admin reaches the Payment step in the existing linear wizard flow (after
  Domain), or navigates directly to it via the step indicator once earlier steps are complete/skipped.
- **State required:** an authenticated Clerk session with a `partner_admin_users` row for the target
  `partner_account_id` (existing `requirePartnerAdmin()` gate, unchanged, reused by the one new API
  route this document adds).
- **Backend trigger (webhook side):** an inbound `POST /api/webhooks/stripe` from Stripe for
  `invoice.paid`, `customer.subscription.updated`, or `customer.subscription.deleted` — server-to-server,
  no user action, existing route, existing signature verification (`constructWebhookEvent`), unchanged.

## 4. Screen / Flow Description

### 4.A — Wizard Payment step (redesigned `PaymentStep`)

**Screen state 1 — initial load.** Replaces the existing two-card layout. Top-to-bottom:

1. Unchanged heading: `"Add a payment method"` (18px bold) and subheading `"Choose how you'll fund
   usage."` (13px, `COLORS.textSecondary`) — both reused byte-for-byte from the existing component.
2. A new sub-label, `"Plans"` (13px, weight 600, `COLORS.textPrimary`), directly above a **Monthly /
   Annual toggle**: two adjoining pill buttons, `"Monthly"` and `"Annual"`, default selection
   `"Monthly"`. The selected pill uses `COLORS.purple` background with white text; the unselected pill
   is transparent with `COLORS.textSecondary` text and a `COLORS.borderStrong` border — same
   selected/unselected idiom as this codebase's other segmented controls (e.g. the existing option-button
   selected-state convention). Clicking the unselected pill switches the toggle and live-updates every
   Plan card's displayed price and allowance text below — no page reload, no re-fetch.
3. Two `Card` components (from `_shared.tsx`, unchanged import) side by side, `display: flex, gap: 12` —
   the exact same row layout the existing two-card row already uses, just with new content:
   - **Starter card:** `"Starter"` (bold, 14px). Price line, bold, 20px: `"$99/mo"` when Monthly is
     selected, `"$950/yr"` when Annual is selected. Allowance line, 12px `COLORS.textSecondary`:
     `"Includes $50/mo of usage"` (Monthly) or `"Includes $600/yr of usage"` (Annual). A `PrimaryButton`
     labelled `"Choose Starter"`.
   - **Growth card:** `"Growth"` (bold, 14px). Price line: `"$299/mo"` (Monthly) / `"$2,870/yr"`
     (Annual). Allowance line: `"Includes $200/mo of usage"` (Monthly) / `"Includes $2,400/yr of usage"`
     (Annual). A `PrimaryButton` labelled `"Choose Growth"`.
4. A visual divider (`border-top: 1px solid COLORS.borderSubtle`, `padding-top: 16px`) then a new
   sub-label `"Pay as you go"` (13px, weight 600).
5. **One** `Card` (not two — the former "Set a monthly minimum" card is removed, per the brief's
   replace-not-add decision) containing:
   - Retained subtext: `"One-time top-up via Stripe Checkout."` (12px, `COLORS.textSecondary`).
   - A row of 4 preset amount buttons: `"$50"`, `"$100"`, `"$250"`, `"$500"` — small pill buttons
     (`SecondaryButton`-styled, `COLORS.borderStrong` border, transparent background). Clicking one (a)
     visually highlights it (`COLORS.purple` border, 2px) and (b) writes that number into the custom-amount
     input described next, so the input is always the single visible source of truth for what will be
     charged.
   - Below the presets, a labelled numeric input: label `"Or enter a custom amount"` (12px
     `COLORS.textSecondary`), a text input (`type="number"`, placeholder `"e.g. 150"`, prefixed with a
     `"$"` glyph inside the input's left padding) bound to the same `topupAmount` state the presets write
     into. Typing a value clears any preset's highlighted state (typing and preset-click are two ways to
     set one state, not two independent states).
   - A `PrimaryButton`: label is `"Pay as you go"` while no valid amount is chosen (**disabled**), and
     `"Pay as you go — $<amount>"` once a valid amount is set (**enabled**). "Valid" mirrors the existing
     server-side bound exactly: an integer or decimal `>= 20` and `<= 50000` (`app/api/admin/billing/
     checkout/route.ts`'s own `z.number().min(20).max(50000)`, reused client-side as a UX convenience,
     not duplicated as a second source of truth — the server route remains authoritative and unchanged).
     If the typed value is outside that range, an inline message appears below the input:
     `"Enter an amount between $20 and $50,000."` in `COLORS.red`, and the button stays disabled.

**Screen state 2 — a Plan card's button is clicked (`"Choose Starter"` or `"Choose Growth"`).** The
clicked card's button shows `"Redirecting…"` (mirrors the existing `busy === 'topup'` /
`busy === 'subscription'` label-swap convention) and is disabled; every other button on the screen (both
Plan cards' buttons, the toggle, the top-up button) is also disabled for the duration
(`busy !== null` gate, reused pattern from the existing component). `POST
/api/admin/billing/plan-subscription` is called with `{ partner_account_id, plan_tier_key: 'starter' |
'growth', billing_period: 'monthly' | 'annual' (from the current toggle state), success_url, cancel_url
}`. On success, `window.location.href = data.checkout_url` (same redirect-on-response pattern as both
existing handlers). `success_url`/`cancel_url` reuse the identical `&funded=1` / no-param convention
already used by `startCheckout()`/`startSubscription()` — confirmed generic, no new return-handling code
needed (see Grounding).

**Screen state 3 — the "Pay as you go" button is clicked with a valid amount.** Identical existing
behavior, unchanged: `POST /api/admin/billing/checkout` with `{ partner_account_id, amount_usd:
<the chosen amount, no longer hardcoded 100>, success_url, cancel_url }`, redirect to `checkout_url` on
success. Button shows `"Redirecting…"` while busy.

**Screen state 4 — return from Stripe Checkout (`&funded=1`).** Unchanged — the existing wizard-level
`useEffect` (lines 114–140) already handles this generically for any of the three buttons; no new code.

### 4.B — Backend: `POST /api/webhooks/stripe` new/changed event handling

**Correlation strategy (rewritten in v1.1 — see Revision Note below the document header).** A Plan
invoice is no longer identified by reading `invoice.subscription_details?.metadata` or any other
invoice-level metadata field — that field's location on the `Invoice` object shifts across Stripe API
versions (`invoice.subscription_details.metadata` under Acacia; restructured to
`invoice.parent.subscription_details.metadata` under Basil, `2025-03-31.basil`, and later) in a way this
document cannot independently verify against the live webhook endpoint's Dashboard-configured API
version. Instead, correlation uses a stable Stripe object id (`invoice.subscription`) looked up against
`partner_wallets`, a table this codebase's own webhook code controls end to end:

1. **`checkout.session.completed` — one new branch, additive, alongside the existing unchanged
   `'wallet_topup'`/`'test_block_purchase'` branches of the same `switch (session.metadata?.purpose)`.**
   Fires once, synchronously, when the partner-admin completes Stripe Checkout for a Plan — writes the
   Plan's identity onto `partner_wallets` immediately, before any `invoice.paid` event for that
   subscription can arrive in the common case (see Section 8 for the documented safe behavior when
   ordering isn't guaranteed):

   ```
   IF session.metadata?.purpose === 'plan_subscription':
     a. tier = PLAN_TIERS.find(t => t.key === session.metadata.plan_tier_key).
        If no match: console.error, break — no partner_wallets write (Section 8).
     b. Resolve the target partner_wallets row using the identical session.metadata → partner_wallets
        resolution the existing 'wallet_topup'/'test_block_purchase' branches already use (no new lookup
        mechanism — same file, same resolution, a third purpose value).
        If no row resolves: console.warn, break — no write (Section 8).
     c. UPDATE partner_wallets SET
          plan_tier_key = session.metadata.plan_tier_key,
          plan_billing_period = session.metadata.plan_billing_period,
          stripe_plan_subscription_id = session.subscription,
          funding_mechanism = 'plan_subscription',
          plan_status = 'active'
        WHERE <resolved row>.
     d. break.  NO wallet balance credit here — crediting still happens exactly once, only on
        invoice.paid (below), so the fixed allowance is never credited twice (once at checkout, again at
        the first invoice).
   ```

   Naturally idempotent under Stripe redelivery: a repeated `checkout.session.completed` for the same
   session just re-writes the same five column values — no ledger entry, no balance change, nothing to
   double-count.

2. **`invoice.paid` (existing case, correlation logic replaced; existing auto-recharge branch otherwise
   byte-for-byte untouched):**

   ```
   1. invoice = event.data.object.  If !invoice.subscription: break.                    [UNCHANGED]
   2. planWalletRow = SELECT * FROM partner_wallets                                     [REPLACES the
        WHERE stripe_plan_subscription_id = invoice.subscription                          old metadata
        LIMIT 1                                                                           read — no
                                                                                            invoice-shape
                                                                                            dependency, no
                                                                                            extra Stripe
                                                                                            API call]
   3. IF planWalletRow exists AND planWalletRow.plan_tier_key IS NOT NULL:               [NEW BRANCH]
        a. tier = PLAN_TIERS.find(t => t.key === planWalletRow.plan_tier_key).
           If no match (catalog drift — should not happen, since plan_tier_key is only ever written from
           a valid catalog key in step 1 above; defensive only): console.error, break (Section 8).
        b. If already recorded for this invoice.id + 'plan_allowance_credit'
           (walletLedgerAlreadyRecorded, type union extended by one value): break — idempotent no-op.
        c. credit_wallet_balance RPC for tier.includedAllowanceUsdMonthly OR
           .includedAllowanceUsdAnnual (selected by planWalletRow.plan_billing_period) — the FIXED
           catalog figure, NEVER invoice.amount_paid.
        d. Insert wallet_ledger row: entry_type='plan_allowance_credit', delta_usd=<that fixed amount>,
           stripe_object_id=invoice.id, metadata={plan_tier_key, plan_billing_period}.
        e. Update partner_wallets: reference_topup_amount_usd=<that amount> (re-arms the low-balance
           alert, same mechanic every existing credit path uses), low_balance_alert_fired_at=null,
           funding_mechanism='plan_subscription', plan_tier_key, plan_billing_period (re-asserted
           defensively here too — self-healing if step 1's checkout-time write ever partially failed),
           stripe_plan_subscription_id=invoice.subscription, plan_status='active',
           plan_current_period_end=<from invoice.lines.data[0].period.end, same cache-not-live-call
           pattern the existing next_billing_date field already uses>.
        f. break.
   4. ELSE (no planWalletRow, or a matched row whose plan_tier_key IS NULL): existing B2B-04 mid-market   [UNCHANGED —
        auto-recharge logic, BYTE-FOR-BYTE UNCHANGED.                                                       also the
                                                                                                              documented
                                                                                                              safe
                                                                                                              fallback
                                                                                                              for the
                                                                                                              race case,
                                                                                                              Section 8]
   ```

**`customer.subscription.updated` / `customer.subscription.deleted` — unchanged from v1.0, reproduced here
for completeness only.** These correlate via `subscription.metadata?.purpose === 'plan_subscription'`,
read directly off the Stripe `Subscription` object's own top-level `metadata` field — a field whose
location has not moved across API versions (unlike `Invoice.subscription_details`, the specific field
this revision replaces). They are unrelated to the flaw the CEO identified and need no change:

```
customer.subscription.updated (new case — no such handler exists today for any mechanism):
1. subscription = event.data.object.
2. If subscription.metadata?.purpose !== 'plan_subscription': break.  (Auto-recharge subscriptions never
   carry this metadata key — this event type has never been handled for them either; out of scope,
   unchanged, see Section 10.)
3. newStatus = subscription.status === 'past_due' ? 'past_due'
             : subscription.status === 'active'   ? 'active'
             : null (any other Stripe status — trialing/incomplete/unpaid — has no mapping; no-op).
4. If newStatus is null: break.
5. UPDATE partner_wallets SET plan_status = newStatus
   WHERE stripe_customer_id = subscription.customer AND stripe_plan_subscription_id = subscription.id.
   (The stripe_plan_subscription_id match, not just stripe_customer_id, is deliberate — see Section 9's
   "stale event after a re-subscribe" edge case.)
6. break.

customer.subscription.deleted (new case — same non-existence-today note as above):
1. subscription = event.data.object.
2. If subscription.metadata?.purpose !== 'plan_subscription': break.
3. UPDATE partner_wallets SET plan_status = 'canceled'
   WHERE stripe_customer_id = subscription.customer AND stripe_plan_subscription_id = subscription.id.
   No change to balance_usd, plan_tier_key, or plan_billing_period (Section 9 policy).
4. break.
```

## 5. Visual Examples

**Wizard Payment step — Monthly selected (default), no top-up amount chosen yet:**
```
┌──────────────────────────────────────────────────────────────────────┐
│  Add a payment method                                                │
│  Choose how you'll fund usage.                                       │
│                                                                        │
│  Plans                                                                │
│  [ Monthly ] [ Annual ]      ← Monthly pill filled purple, selected  │
│                                                                        │
│  ┌────────────────────────┐  ┌────────────────────────┐              │
│  │ Starter                │  │ Growth                 │              │
│  │ $99/mo                 │  │ $299/mo                │              │
│  │ Includes $50/mo of     │  │ Includes $200/mo of    │              │
│  │ usage                  │  │ usage                  │              │
│  │ [ Choose Starter ]     │  │ [ Choose Growth ]       │              │
│  └────────────────────────┘  └────────────────────────┘              │
│  ──────────────────────────────────────────────────────────────────  │
│  Pay as you go                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ One-time top-up via Stripe Checkout.                          │   │
│  │ [ $50 ] [ $100 ] [ $250 ] [ $500 ]                            │   │
│  │ Or enter a custom amount                                       │   │
│  │ [ $ ______________ ]                                           │   │
│  │ [ Pay as you go ]   ← disabled, no amount chosen yet           │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**Same screen — Annual toggled, $250 preset selected:**
```
┌──────────────────────────────────────────────────────────────────────┐
│  Add a payment method                                                │
│  Choose how you'll fund usage.                                       │
│                                                                        │
│  Plans                                                                │
│  [ Monthly ] [ Annual ]      ← Annual pill now filled purple         │
│                                                                        │
│  ┌────────────────────────┐  ┌────────────────────────┐              │
│  │ Starter                │  │ Growth                 │              │
│  │ $950/yr                │  │ $2,870/yr               │              │
│  │ Includes $600/yr of    │  │ Includes $2,400/yr of  │              │
│  │ usage                  │  │ usage                  │              │
│  │ [ Choose Starter ]     │  │ [ Choose Growth ]       │              │
│  └────────────────────────┘  └────────────────────────┘              │
│  ──────────────────────────────────────────────────────────────────  │
│  Pay as you go                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ One-time top-up via Stripe Checkout.                          │   │
│  │ [ $50 ] [◆$250◆] [ $500 ]  ...  ← $250 highlighted, purple    │   │
│  │           border                                                │   │
│  │ Or enter a custom amount                                       │   │
│  │ [ $ 250 ]                                                       │   │
│  │ [ Pay as you go — $250 ]   ← now enabled                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**Redirecting state — "Choose Growth" clicked (Monthly):**
```
┌──────────────────────────────────────────────────────────────────────┐
│  Plans                                                                │
│  [ Monthly ] [ Annual ]     ← both disabled while busy               │
│  ┌────────────────────────┐  ┌────────────────────────┐              │
│  │ Starter                │  │ Growth                 │              │
│  │ $99/mo                 │  │ $299/mo                │              │
│  │ Includes $50/mo         │  │ Includes $200/mo        │              │
│  │ [ Choose Starter ]      │  │ [ Redirecting… ]  ← disabled          │
│  │   (disabled)            │  └────────────────────────┘              │
│  └────────────────────────┘                                          │
│  Pay as you go card: all controls disabled                            │
└──────────────────────────────────────────────────────────────────────┘
```

**Backend — Plan allowance credit sequence (happy path, v1.1 correlation):**
```
Step 1 — checkout time (once, synchronous with partner-admin's Stripe Checkout):
Partner-admin completes Checkout for Growth/Monthly
  → checkout.session.completed fires (session.metadata.purpose = 'plan_subscription',
                                       plan_tier_key = 'growth', plan_billing_period = 'monthly',
                                       session.subscription = 'sub_abc')
  → POST /api/webhooks/stripe
  → tier = PLAN_TIERS.find(key === 'growth') → matches, valid catalog key
  → partner_wallets resolved via session.metadata.partner_account_id (same resolution
    'wallet_topup'/'test_block_purchase' already use)
  → partner_wallets update: plan_tier_key='growth', plan_billing_period='monthly',
    stripe_plan_subscription_id='sub_abc', funding_mechanism='plan_subscription',
    plan_status='active'  — NO balance credit yet
  → 200 { received: true }

Step 2 — invoice time (every billing cycle):
Stripe generates the Plan subscription's invoice for the current billing period
  → invoice.paid fires (invoice.subscription = 'sub_abc')
  → POST /api/webhooks/stripe
  → if (!invoice.subscription) break                                          [unchanged guard]
  → planWalletRow = SELECT * FROM partner_wallets WHERE stripe_plan_subscription_id = 'sub_abc'
    → match, plan_tier_key = 'growth' IS NOT NULL → Plan branch taken
  → tier = PLAN_TIERS.find(key === 'growth') → includedAllowanceUsdMonthly = 200
  → walletLedgerAlreadyRecorded(invoice.id, 'plan_allowance_credit') → false (first time)
  → credit_wallet_balance(+200) → new_balance   [FIXED catalog figure, never invoice.amount_paid]
  → wallet_ledger insert: entry_type='plan_allowance_credit', delta_usd=200
  → partner_wallets update: reference_topup_amount_usd=200, low_balance_alert_fired_at=null,
    funding_mechanism='plan_subscription' (re-asserted), plan_tier_key='growth' (re-asserted),
    plan_billing_period='monthly' (re-asserted), stripe_plan_subscription_id='sub_abc' (re-asserted),
    plan_status='active', plan_current_period_end=<next period>
  → 200 { received: true }
```

**Backend — past_due then canceled (transient decline, no recovery):**
```
Card declines on renewal → Stripe marks the subscription past_due, begins its own dunning retries
  → customer.subscription.updated { status: 'past_due' }
  → partner_wallets.plan_status = 'past_due'   (balance/allowance UNCHANGED — partner keeps working)
Stripe's dunning retries are exhausted (Stripe's own configured retry schedule, not Clio's)
  → Stripe cancels the subscription → customer.subscription.deleted
  → partner_wallets.plan_status = 'canceled'   (balance/allowance/plan_tier_key UNCHANGED)
  → no further invoice.paid events will ever fire for this subscription id
  → partner's wallet behaves exactly like any other partner's from here: usage decrements normally,
    may go negative, existing low-balance alert fires if/when applicable — nothing new invented
```

## 6. Data Requirements

### 6.A — Schema (migration `081_b2b13_plan_tiers_and_topups.sql`, next free number, additive-only)

```sql
-- B2B-13 — Recurring Plan Tiers + Configurable Top-Up Amounts
-- See docs/specs/B2B-13-requirement-document.md for full rationale.
--
-- Additive only, mirrors migration 075's own discipline: no existing
-- partner_wallets/wallet_ledger column, row, or CHECK value is removed or narrowed.
-- Adds 5 new nullable partner_wallets columns for per-partner Plan subscription
-- state, widens partner_wallets.funding_mechanism's CHECK by one value
-- ('plan_subscription'), and widens wallet_ledger.entry_type's CHECK by one value
-- ('plan_allowance_credit'), reproducing migration 077's own widening pattern
-- byte-for-byte. No new table — the Plan catalog (tier names, prices, included
-- allowance) lives in code (lib/billing/plan-tiers.ts), not the database.

-- ─── partner_wallets — new nullable Plan-subscription-state columns ─────────

ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS plan_tier_key TEXT;
ALTER TABLE partner_wallets DROP CONSTRAINT IF EXISTS partner_wallets_plan_tier_key_check;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_plan_tier_key_check
  CHECK (plan_tier_key IS NULL OR plan_tier_key IN ('starter', 'growth'));

ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS plan_billing_period TEXT;
ALTER TABLE partner_wallets DROP CONSTRAINT IF EXISTS partner_wallets_plan_billing_period_check;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_plan_billing_period_check
  CHECK (plan_billing_period IS NULL OR plan_billing_period IN ('monthly', 'annual'));

-- Deliberately a NEW column, not a reuse of stripe_subscription_id — that column's
-- own comment (migration 075) scopes it to "mid-market auto-recharge subscription
-- only." A Plan subscription is a structurally different Stripe Subscription object.
ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS stripe_plan_subscription_id TEXT;

ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS plan_current_period_end TIMESTAMPTZ;

ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS plan_status TEXT;
ALTER TABLE partner_wallets DROP CONSTRAINT IF EXISTS partner_wallets_plan_status_check;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_plan_status_check
  CHECK (plan_status IS NULL OR plan_status IN ('active', 'past_due', 'canceled'));

-- ─── partner_wallets.funding_mechanism — widen by one value ─────────────────

ALTER TABLE partner_wallets DROP CONSTRAINT IF EXISTS partner_wallets_funding_mechanism_check;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_funding_mechanism_check
  CHECK (funding_mechanism IS NULL OR funding_mechanism IN (
    'checkout_topup', 'subscription_auto_recharge', 'invoicing', 'plan_subscription'
  ));

-- ─── wallet_ledger.entry_type — widen by one value ───────────────────────────
-- Reproduces migration 077's own widening pattern exactly (drop-and-recreate the
-- named constraint).

ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_entry_type_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_entry_type_check
  CHECK (entry_type IN (
    'topup_checkout', 'topup_subscription_recharge', 'topup_invoice',
    'usage_decrement', 'manual_adjustment', 'test_block_purchase',
    'plan_allowance_credit'
  ));

COMMENT ON COLUMN partner_wallets.plan_tier_key IS 'B2B-13: references a key in the code-only PLAN_TIERS catalog (lib/billing/plan-tiers.ts), not an FK — the catalog is not DB-backed. NULL if the partner is not on a recurring Plan.';
COMMENT ON COLUMN partner_wallets.plan_billing_period IS 'B2B-13: monthly or annual, set at Plan checkout time.';
COMMENT ON COLUMN partner_wallets.stripe_plan_subscription_id IS 'B2B-13: Plan subscription only — distinct from stripe_subscription_id, which is scoped to auto-recharge only (migration 075).';
COMMENT ON COLUMN partner_wallets.plan_current_period_end IS 'B2B-13: cached from the Plan subscription''s invoice line item at webhook time, mirrors next_billing_date''s existing cache-not-live-call convention.';
COMMENT ON COLUMN partner_wallets.plan_status IS 'B2B-13: coarse mirror of the Plan subscription''s Stripe status. See docs/specs/B2B-13-requirement-document.md Section 9 for the exact lifecycle policy.';
```

No RLS changes — new columns inherit `partner_wallets`'/`wallet_ledger`'s existing service-role-only
policies (migration 075, unchanged).

### 6.B — Plan catalog (new file, `lib/billing/plan-tiers.ts`)

```ts
export type PlanTierKey = 'starter' | 'growth'
export type PlanBillingPeriod = 'monthly' | 'annual'

export interface PlanTier {
  key: PlanTierKey
  displayName: string
  monthlyPriceUsd: number
  annualPriceUsd: number
  /** Credited on invoice.paid for a MONTHLY-billed subscription's invoice. */
  includedAllowanceUsdMonthly: number
  /** Credited on invoice.paid for an ANNUAL-billed subscription's invoice (once/year — NOT the
   *  monthly figure re-applied 12x, since Stripe only fires one invoice.paid per year for an
   *  annual subscription). Set to keep the same effective monthly run-rate as the monthly plan. */
  includedAllowanceUsdAnnual: number
  stripePriceIdMonthlyEnvVar: string
  stripePriceIdAnnualEnvVar: string
}

// PLACEHOLDER figures — illustrative only, Arun sets real prices in Stripe and
// these numbers are updated to match at that time. Annual prices are ~20% off
// the equivalent 12x monthly cost (standard SaaS annual-prepay discount);
// annual included-allowance figures are exactly 12x the monthly allowance, so
// an annual subscriber's usage headroom matches a monthly subscriber's,
// dollar for dollar — only the price gets the prepay discount, not the
// allowance.
export const PLAN_TIERS: PlanTier[] = [
  {
    key: 'starter',
    displayName: 'Starter',
    monthlyPriceUsd: 99,
    annualPriceUsd: 950,
    includedAllowanceUsdMonthly: 50,
    includedAllowanceUsdAnnual: 600,
    stripePriceIdMonthlyEnvVar: 'STRIPE_PLAN_STARTER_MONTHLY_PRICE_ID',
    stripePriceIdAnnualEnvVar: 'STRIPE_PLAN_STARTER_ANNUAL_PRICE_ID',
  },
  {
    key: 'growth',
    displayName: 'Growth',
    monthlyPriceUsd: 299,
    annualPriceUsd: 2870,
    includedAllowanceUsdMonthly: 200,
    includedAllowanceUsdAnnual: 2400,
    stripePriceIdMonthlyEnvVar: 'STRIPE_PLAN_GROWTH_MONTHLY_PRICE_ID',
    stripePriceIdAnnualEnvVar: 'STRIPE_PLAN_GROWTH_ANNUAL_PRICE_ID',
  },
]
```

### 6.C — New Stripe function (`lib/stripe.ts`, additive)

`createPlanSubscriptionCheckout(partnerAccountId, planTierKey, billingPeriod, successUrl?, cancelUrl?)`
— `mode: 'subscription'`, `line_items: [{ price: <resolved env-var Price ID>, quantity: 1 }]` (the
**first** function in this file to reference a real, pre-created Stripe Price rather than ad-hoc
`price_data` — no `stripe.products.create`/`stripe.prices.create` call anywhere). Sets metadata in **two**
places:
- `subscription_data.metadata: { partner_account_id, purpose: 'plan_subscription', plan_tier_key,
  plan_billing_period }` — Stripe copies this onto the created Subscription object verbatim, which is what
  lets the `customer.subscription.updated`/`.deleted` cases (6.D) identify a Plan subscription by
  `subscription.metadata.purpose`, unchanged from v1.0.
- **(Added in v1.1, necessary consequence of the Section 4.B correlation fix — not independent scope.)**
  Top-level `metadata: { partner_account_id, purpose: 'plan_subscription', plan_tier_key,
  plan_billing_period }` on the Checkout Session itself. This is what makes `session.metadata` readable
  inside the new `checkout.session.completed` branch (Section 4.B step 1) — the same `session.metadata`
  field the existing `'wallet_topup'`/`'test_block_purchase'` branches already read reliably today.
  `subscription_data.metadata` alone is only ever visible on the created Subscription object, not on the
  Session, and would not have been readable from a `checkout.session.completed` handler — without this
  addition, the v1.1 correlation fix in 4.B would have no data to write into `partner_wallets` at checkout
  time.

Guarded by **two** independent placeholder checks: the existing module-level `isPlaceholder`
(missing/placeholder `STRIPE_SECRET_KEY`) **and** a new per-call check that the resolved Price ID env var
is itself still `PLACEHOLDER_`-prefixed — because Arun may set a real `STRIPE_SECRET_KEY` before he's
created the real Plan Products/Prices, and this function must still mock cleanly in that state. Either
guard being true logs `[MOCK] createPlanSubscriptionCheckout` and returns a mock URL, exactly the existing
pattern's shape.

### 6.D — Webhook handler changes (`app/api/webhooks/stripe/route.ts`)

Detailed byte-for-byte in Section 4.B (rewritten in v1.1 — see Revision Note). Summary:
- One new branch inside the existing `checkout.session.completed` case's `switch
  (session.metadata?.purpose)` (additive, alongside the existing unchanged `'wallet_topup'`/
  `'test_block_purchase'` branches) that writes the Plan's identity onto `partner_wallets` at checkout
  time — no balance credit.
- The `invoice.paid` case's correlation logic replaced: it now looks up `partner_wallets` by
  `stripe_plan_subscription_id = invoice.subscription` instead of reading any invoice-level metadata
  field, with the existing B2B-04 auto-recharge logic running unchanged as the fallthrough case whenever
  no match is found (this is also the documented safe behavior for the race case, Section 8).
- Two entirely new `case` statements (`customer.subscription.updated`, `customer.subscription.deleted`,
  unchanged from v1.0) added to the existing `switch`.
- `walletLedgerAlreadyRecorded()`'s type union gains one value: `'plan_allowance_credit'` (unchanged from
  v1.0).

### 6.E — New API route

`POST /api/admin/billing/plan-subscription` (new file, `app/api/admin/billing/plan-subscription/route.ts`)
— identical shape to the existing `checkout`/`subscription` routes: Zod body `{ partner_account_id:
z.string().uuid(), plan_tier_key: z.enum(['starter','growth']), billing_period:
z.enum(['monthly','annual']), success_url: z.string().optional(), cancel_url: z.string().optional() }`,
`requirePartnerAdmin()` gate (reused, unchanged), calls `createPlanSubscriptionCheckout()`, returns
`{ checkout_url }` on 201 or `{ error: { code: 'stripe_error', ... } }` on 502 — identical error-shape
convention to the two existing routes.

### 6.F — Read from the database

- `partner_wallets` — existing `getOrCreateStripeCustomer()` lookups, unchanged. New: the webhook's
  customer→`partner_account_id` lookup for the Plan branch (identical shape to the existing auto-recharge
  branch's own lookup).
- `wallet_ledger` — `walletLedgerAlreadyRecorded()`, extended type union, unchanged query shape.

### 6.G — Written to the database

- `wallet_ledger` — one new row per successful Plan-subscription invoice, `entry_type =
  'plan_allowance_credit'` (Section 4.B, 6.A).
- `partner_wallets` — `plan_tier_key`, `plan_billing_period`, `stripe_plan_subscription_id`,
  `plan_current_period_end`, `plan_status`, `funding_mechanism`, `reference_topup_amount_usd`,
  `low_balance_alert_fired_at`, `balance_usd` (via the `credit_wallet_balance` RPC) — all only on the
  three webhook event types this document adds/extends.

### 6.H — APIs / internal functions called

- `credit_wallet_balance` RPC (existing, migration 075, unchanged signature) — reused, not reimplemented.
- No new external vendor calls beyond Stripe itself (already approved, already integrated).

### 6.I — localStorage / sessionStorage

None. The wizard's `topupAmount`/preset-selection/toggle state is in-memory React state only, matching
the existing `PaymentStep`'s `busy` state — nothing persisted client-side.

### 6.J — New environment variables (`.env.local.example` — append, do not remove any existing entry)

```
STRIPE_PLAN_STARTER_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_PLAN_STARTER_MONTHLY
STRIPE_PLAN_STARTER_ANNUAL_PRICE_ID=PLACEHOLDER_STRIPE_PLAN_STARTER_ANNUAL
STRIPE_PLAN_GROWTH_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_PLAN_GROWTH_MONTHLY
STRIPE_PLAN_GROWTH_ANNUAL_PRICE_ID=PLACEHOLDER_STRIPE_PLAN_GROWTH_ANNUAL
```

(This document's author could not read the current `.env.local.example` directly — hit the same
file-permission restriction the Feature Brief itself flagged, denied not missing. Not a blocker: the
developer implementing this has normal file access and appends these four lines following the file's
existing `STRIPE_*` convention, none of which this document needs to inspect to add to correctly.)

## 7. Success Criteria (Acceptance Tests)

✓ Given a partner-admin on the Payment step with the Monthly toggle selected (the default), when they
click "Choose Starter", then `POST /api/admin/billing/plan-subscription` is called with
`{ plan_tier_key: 'starter', billing_period: 'monthly' }` and the browser redirects to the returned
`checkout_url`. (Happy path — Plan checkout initiation.)

✓ Given `STRIPE_PLAN_STARTER_MONTHLY_PRICE_ID` is still `PLACEHOLDER_`-prefixed, when a partner-admin
clicks "Choose Starter" (Monthly), then `createPlanSubscriptionCheckout()` logs `[MOCK]` and returns a
mock URL — no real Stripe API call is made and no real Stripe Product/Price is ever referenced. (Mock-mode
guard — zero real Stripe objects created.)

✓ Given a Stripe `checkout.session.completed` event whose `session.metadata.purpose =
'plan_subscription'`, `plan_tier_key = 'growth'`, `plan_billing_period = 'monthly'`, `session.subscription
= 'sub_abc'`, when the webhook processes it, then `partner_wallets.plan_tier_key = 'growth'`,
`plan_billing_period = 'monthly'`, `stripe_plan_subscription_id = 'sub_abc'`, `funding_mechanism =
'plan_subscription'`, and `plan_status = 'active'` are written — and `balance_usd` is **unchanged**
(crediting happens only on `invoice.paid`, never at checkout). (Happy path — Plan checkout completion
writes wallet state. New in v1.1.)

✓ Given a `partner_wallets` row already has `stripe_plan_subscription_id = 'sub_abc'`, `plan_tier_key =
'growth'`, `plan_billing_period = 'monthly'` (written by a prior `checkout.session.completed`), when a
Stripe `invoice.paid` event with `invoice.subscription = 'sub_abc'` arrives, then `partner_wallets
.balance_usd` increases by exactly `$200` (the catalog's `includedAllowanceUsdMonthly` for `growth`) —
**not** by `invoice.amount_paid` — and one `wallet_ledger` row with `entry_type = 'plan_allowance_credit'`
is inserted. (Happy path — `invoice.paid` correlates via the `stripe_plan_subscription_id` wallet lookup,
not invoice metadata, and credits the fixed allowance. Rewritten in v1.1.)

✓ Given the identical `invoice.paid` event delivered a second time (Stripe redelivery), when the webhook
processes the duplicate, then no second `wallet_ledger` row is inserted and `balance_usd` is not
double-credited. (Idempotency — `walletLedgerAlreadyRecorded(invoice.id, 'plan_allowance_credit')`.)

✓ Given no `partner_wallets` row has `stripe_plan_subscription_id` matching an incoming `invoice.paid`
event's `invoice.subscription` (a genuine non-Plan invoice — e.g. an existing mid-market auto-recharge
subscription), when the webhook processes it, then it falls through to the existing B2B-04 auto-recharge
logic unchanged and credits `invoice.amount_paid` exactly as it does today. (Fallthrough — confirms the
new correlation lookup doesn't disturb the existing, unrelated auto-recharge mechanism. New in v1.1.)

✓ Given an `invoice.paid` event for a Plan subscription's very first invoice arrives **before** the
corresponding `checkout.session.completed` event has been processed (no `partner_wallets` row yet has
`stripe_plan_subscription_id` set to that subscription id — the documented race case, Section 8), when
the webhook processes the `invoice.paid` event, then it falls through to the existing auto-recharge logic
without erroring (credited via the old path, per the documented safe-fallback behavior) — and when the
`checkout.session.completed` event is subsequently processed for that same session, then `partner_wallets`
is correctly updated with the Plan's identity, and **every subsequent** `invoice.paid` event for that
subscription id correlates correctly as a Plan invoice going forward. (Race case — confirms no error, no
crash, and self-healing from the second invoice onward. New in v1.1, required by the CEO's review.)

✓ Given a `partner_wallets` row with `plan_status = 'active'` and `stripe_plan_subscription_id` set, when
a `customer.subscription.updated` event with `status: 'past_due'` arrives for that exact subscription id,
then `plan_status` becomes `'past_due'` and `balance_usd`/`plan_tier_key`/`plan_billing_period` are
unchanged. (Past-due — no punitive action, no silent continued crediting either, since no `invoice.paid`
fires while past due. Unaffected by the v1.1 revision.)

✓ Given a `partner_wallets` row with `plan_status = 'past_due'`, when a `customer.subscription.deleted`
event arrives for that same subscription id, then `plan_status` becomes `'canceled'`, `balance_usd` is
unchanged, and `plan_tier_key`/`plan_billing_period` remain set (not cleared). (Cancellation — matches the
B2B-04 "don't auto-revert classification, don't touch balance" precedent. Unaffected by the v1.1 revision.)

✓ Given the Payment step on initial load (no preset clicked, no custom amount typed), when the screen
renders, then the "Pay as you go" button is disabled. (Empty state.)

✓ Given a partner-admin types `"15"` into the custom top-up amount field (below the $20 minimum), when
they finish typing, then the inline message `"Enter an amount between $20 and $50,000."` appears, the
button stays disabled, and no checkout request is ever sent. (Validation edge — client-side mirror of the
existing server-side `min(20)` bound.)

✓ Given a partner-admin clicks the `$250` preset button, when the click registers, then the custom-amount
input updates to show `250`, the `$250` preset button shows the selected (purple-border) state, and the
"Pay as you go" button becomes enabled with the label `"Pay as you go — $250"`. (Preset interaction —
single source of truth between presets and free text.)

✓ Given a partner-admin toggles from Monthly to Annual while viewing the Payment step, when the toggle
switches, then both Plan cards' price and allowance text update immediately (`"$99/mo"` → `"$950/yr"`,
`"Includes $50/mo of usage"` → `"Includes $600/yr of usage"`, and the Growth card equivalently) with no
page reload or network request. (Toggle — client-only state.)

## 8. Error States

| Failure | Partner-admin-visible behavior | Backend behavior |
|---|---|---|
| `POST /api/admin/billing/plan-subscription` — Zod validation fails (bad `plan_tier_key`/`billing_period`) | Generic client-side error surfaced the same way the existing two buttons' `fetch` calls handle a non-OK response today (no `data.checkout_url` → button resets to non-busy, no redirect) | `422` with `{ error: 'Validation failed', details: ... }` — identical shape to the two existing routes |
| `POST /api/admin/billing/plan-subscription` — `requirePartnerAdmin()` rejects (not an admin for this account) | Same as above — no redirect happens | `401`/`403` per `requirePartnerAdmin()`'s existing, unchanged behavior |
| `createPlanSubscriptionCheckout()` throws (a genuine Stripe API error once real keys are live) | Same as above | `502 { error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }` — identical convention to the two existing routes |
| `checkout.session.completed` (Plan branch) — `session.metadata.plan_tier_key` doesn't match any `PLAN_TIERS` entry (shouldn't happen since `createPlanSubscriptionCheckout` only ever sets a valid catalog key; defensive only) — **new in v1.1** | None — Stripe always gets `200 { received: true }` | `console.error` logged with the session id and the unrecognized `plan_tier_key`; branch `break`s with no `partner_wallets` write |
| `checkout.session.completed` (Plan branch) — no `partner_wallets` row resolves for the session (should not happen in the normal wizard flow, since the wallet row is created earlier in onboarding; defensive only) — **new in v1.1** | `200 { received: true }` | `console.warn` logged (mirrors the existing auto-recharge branch's warning shape for an analogous "no match" condition), no write |
| `invoice.paid` — no `partner_wallets` row has `stripe_plan_subscription_id` matching `invoice.subscription` — **rewritten in v1.1, this is the correlation-lookup-miss case the CEO's review specifically required be documented.** Covers two situations: (a) a genuine non-Plan invoice (existing auto-recharge subscription), and (b) the race case — a Plan invoice whose `checkout.session.completed` write hasn't landed yet | `200 { received: true }` | **Not an error, not a no-op** — falls through to the existing B2B-04 auto-recharge logic unchanged, credited via `invoice.amount_paid` under the old path. This is deliberate and CEO-specified safe behavior, not a bug to detect or retry differently: a legitimate non-Plan invoice must keep working exactly as it does today. For the race sub-case specifically, the practical consequence is narrow — that one invoice (a subscription's very first) is credited via the auto-recharge path instead of the Plan's fixed allowance, a one-time timing anomaly, not a recurring mis-credit (contrast with the flaw this revision closes, which mis-credited **every** invoice under certain Stripe API-version configurations). Once the corresponding `checkout.session.completed` write lands, every subsequent invoice for that subscription id correlates correctly as a Plan invoice. |
| `invoice.paid` (Plan branch matched) — `planWalletRow.plan_tier_key` doesn't match any `PLAN_TIERS` entry (catalog drift — should not happen, since the value is only ever written from a valid catalog key at checkout time; defensive only) — **new in v1.1, replaces the removed metadata-shape error row** | `200 { received: true }` | `console.error` logged with the invoice id and the unrecognized `plan_tier_key`; branch `break`s with no wallet mutation |
| `invoice.paid` (Plan branch) — `credit_wallet_balance` RPC fails | `200 { received: true }` | `console.error` logged, `break`s before the ledger insert/wallet update — no partial-credit state (RPC failure means the balance itself never moved, so nothing needs rolling back) |
| `customer.subscription.updated`/`.deleted` — no `partner_wallets` row matches `(stripe_customer_id, stripe_plan_subscription_id)` (e.g. event arrives before the first `invoice.paid` ever ran, or after a re-subscribe already overwrote the id) | `200 { received: true }` | The `.update()` call affects zero rows — Supabase does not error on a zero-row update; logged only if the query itself errors, otherwise silently a no-op (matches this route's existing tolerance for "event doesn't match anything yet") — unaffected by the v1.1 revision |
| Top-up custom amount outside `[20, 50000]` | Inline red validation message, button stays disabled (Section 4.A) | N/A — request is never sent; server-side `min(20).max(50000)` remains the authoritative backstop unchanged |
| Stripe webhook signature invalid / `STRIPE_WEBHOOK_SECRET` still placeholder | N/A (server-to-server) | Existing unchanged behavior: `400` on genuine bad signature, or `[MOCK]` log + `200` in placeholder mode — this document adds no new signature-handling logic |

## 9. Edge Cases

- **A partner re-subscribes to a Plan after a prior cancellation** (new Checkout Session → new Stripe
  Subscription object → new `sub_...` id). The first `invoice.paid` for the new subscription overwrites
  `stripe_plan_subscription_id` to the new id. If the OLD subscription's `customer.subscription.deleted`
  event is delivered late (after the new one is already active), it does **not** corrupt state: both new
  `case` handlers filter their `UPDATE` by `stripe_plan_subscription_id = subscription.id`, so a stale
  event for an id that's no longer the row's current value matches zero rows and is a no-op by
  construction — not a special case that needed extra code, a direct consequence of the WHERE clause
  already being that specific.
- **A partner switches Plan tiers or billing period** (e.g. Starter monthly → Growth annual). This document
  does not build an in-app "change plan" control — the wizard only offers "Choose Starter"/"Choose Growth"
  as fresh Checkout Session starts. A partner wanting to switch would need to cancel the existing
  subscription (in Stripe, or a future admin-page control — out of scope here) and start a new Checkout.
  Not building a dedicated upgrade/downgrade flow is a deliberate scope boundary (Section 10), not an
  oversight.
- **A partner who already has an active `subscription_auto_recharge` mechanism from before this ships,
  then buys a Plan.** Confirmed via a direct production data check (Grounding) that **zero** such partners
  exist today — `partner_wallets` has zero rows in production at all. This is a purely theoretical
  forward case: `funding_mechanism` would simply be overwritten to `'plan_subscription'` on the Plan's
  first `invoice.paid`; the OLD auto-recharge Stripe Subscription object is **not** automatically
  canceled by this document's code (no code in this brief's scope touches
  `createAutoRechargeSubscriptionCheckout` or cancels any existing subscription) — a partner in that
  state would keep paying both until one is manually canceled in Stripe. Flagged here for awareness, not
  built around, since the mechanism is confirmed unused in production today.
- **Annual Plan allowance vs. monthly run-rate.** An annual subscriber's `includedAllowanceUsdAnnual` is
  set to exactly 12x the monthly figure (Section 6.B) specifically so annual billing doesn't shortchange
  usage headroom relative to monthly — only the *price* carries the prepay discount, confirmed as a
  deliberate technical decision this document makes (the Feature Brief's catalog sketch used one
  undifferentiated `includedAllowanceUsd` figure per tier; this document splits it by billing period to
  avoid a real under-crediting bug for annual subscribers, since Stripe fires `invoice.paid` once per year
  for an annual subscription, not twelve times).
- **`checkout.session.completed` fires for a Plan subscription's initial Checkout** (Stripe fires this in
  addition to the first `invoice.paid`). No new handling needed: the existing `checkout.session.completed`
  case only branches on `session.metadata?.purpose === 'wallet_topup'` or `'test_block_purchase'`; a
  `'plan_subscription'` purpose value falls through to the existing unconditional `break` at the end of
  that case, exactly the same silent-no-op behavior `'wallet_auto_recharge'` already gets today. All real
  crediting happens on `invoice.paid`, consistent with the existing auto-recharge mechanism's own design.
- **Mobile vs. desktop.** Not applicable — the Configurator wizard is an internal admin-facing setup tool,
  matching `docs/specs/B2B-04-requirement-document.md`'s identical "internal operational tool, no
  mobile-specific layout" precedent for `/dashboard/admin/clients`.
- **`plan_current_period_end` update on `customer.subscription.updated`.** This document deliberately does
  **not** refresh `plan_current_period_end` on that event — only `invoice.paid` writes it (Section 4.B),
  mirroring `next_billing_date`'s existing identical restriction in the unmodified auto-recharge branch.
  A `past_due` subscription's stale `plan_current_period_end` is expected and harmless — it is a
  display-cache field, never used in any billing calculation.

## 10. Out of Scope

- **Any real Stripe Product/Price creation.** No `stripe.products.create`/`stripe.prices.create` call
  anywhere in this document's code. Arun creates the 2 Products × 2 Prices (4 total) himself and sets the
  4 env vars (Section 6.J).
- **Canceling or otherwise modifying any existing `subscription_auto_recharge` Stripe subscription.**
  Confirmed zero exist in production (Grounding); even if one did, this document's code never touches it.
- **An in-app "change/upgrade/downgrade Plan" control.** A partner who wants a different tier or billing
  period starts a fresh Checkout via the wizard; no dedicated switch flow is built (Section 9).
- **Any change to `usage_events`, `wallet_ledger`'s `usage_decrement` entry type, or
  `billing_rate_versions`** — the metered-usage pipeline is completely untouched, per the Feature Brief's
  explicit constraint.
- **Any hard usage cap or "plan exhausted, blocked" state.** Once a Plan partner's allowance is used up,
  the wallet goes negative exactly like every other partner today — no new gating logic (Feature Brief
  Section 1.4).
- **Enterprise as a self-serve wizard Plan option.** Enterprise/`invoicing` stays exactly where it is
  today — outside the self-serve wizard, in the existing assisted invoicing flow.
- **Displaying `plan_status`/`plan_tier_key`/`plan_current_period_end` anywhere on
  `/dashboard/admin/clients` or any other admin page.** Not named in the Feature Brief's explicit
  in-scope list (Section 6: `plan-tiers.ts`, migration, `createPlanSubscriptionCheckout`, webhook
  handling, wizard UI, 4 env vars) — building admin-page visibility for this new state is a natural
  follow-on but is not this document's scope. Flagging this explicitly so it isn't silently assumed to be
  included.
- **Reading `.env.local.example`'s exact current contents.** Blocked by a file-permission restriction
  (Section 6.J) — not a blocker to this document's completeness, since the 4 new lines to append are
  fully specified regardless of the file's existing contents.
- **Any change to `app/plan/`, `app/dashboard/plan/`, `app/(marketing)/pricing/`, `app/checkout/`.**
  Confirmed dead B2C code, untouched, per the Feature Brief's explicit constraint — used only as a
  structural reference for the monthly/annual toggle pattern, never imported.

## 11. Open Questions

None — all 7 items the Feature Brief left for the BA are resolved below, not escalated.

1. **Migration DDL, exact column list/types, migration number.** Resolved in Section 6.A. Confirmed via
   direct directory listing that `081` is the next free number (`080_b2b11_...` already exists).
2. **`wallet_ledger.entry_type` value for a plan-allowance credit, and which RPC it reuses.** Resolved:
   `'plan_allowance_credit'` (Section 6.A); reuses the existing `credit_wallet_balance` RPC unmodified —
   no new RPC needed, since crediting a fixed dollar amount is identical in shape to every existing
   top-up credit path (Section 6.C/4.B).
3. **Full wireframe/acceptance-criteria detail for the wizard's Plan-selection UI.** Resolved in Sections
   4.A and 5 — every screen state, every label, every button, the toggle behavior, the preset/free-text
   interaction, all specified to exact copy.
4. **Final tier names and top-up preset amounts.** Resolved: tier names `"Starter"`/`"Growth"` (the
   Feature Brief's own suggested placeholders, adopted as-is); top-up presets `$50`/`$100`/`$250`/`$500`
   (also the Feature Brief's own suggestion, adopted as-is); Plan prices/allowances are this document's
   own necessary placeholder additions (Section 6.B) since the brief didn't specify them — clearly
   labeled as illustrative, Arun's call to finalize.
5. **Exact webhook handler diff.** Resolved in Sections 4.B and 6.C/6.D — file confirmed
   (`app/api/webhooks/stripe/route.ts`), exact existing `switch` structure confirmed by direct read, new
   branch/cases specified line-by-line.
6. **Whether any real partner holds `funding_mechanism = 'subscription_auto_recharge'` today.** Resolved
   with an actual production data check (Grounding), not an assumption: **zero** `partner_wallets` rows
   exist in production at all. This is a pure non-issue — no backfill, no migration-time notice, nothing
   to coexist with yet.
7. **Past-due/canceled Plan-subscription lifecycle policy.** Resolved in Section 4.B/9/Success Criteria:
   `past_due` sets `plan_status = 'past_due'` only — no balance/allowance change, no block, since Stripe's
   own dunning retries handle recovery and a successful retry's `invoice.paid` naturally flips
   `plan_status` back to `'active'`. `canceled` sets `plan_status = 'canceled'` only — no balance change,
   no clearing of `plan_tier_key`/`plan_billing_period` (historical record, mirrors the B2B-04
   `tier`-not-auto-reverted precedent exactly). Neither state ever blocks the partner from using Clio;
   the existing negative-balance/low-balance-alert mechanism is the only thing that ever throttles a
   partner's practical usage, unchanged from today.

## 12. Dependencies

- **B2B-04** (done, live) — `partner_wallets`, `wallet_ledger`, `credit_wallet_balance` RPC, the
  low-balance-alert re-arm mechanic, the existing `invoice.paid` auto-recharge branch this document adds
  a sibling branch alongside without modifying.
- **B2B-05** (done, live) — the Configurator wizard shell, `PaymentStep`, `_shared.tsx`'s `COLORS`/`Card`/
  `PrimaryButton`/`SecondaryButton`, `advanceWizardStep()`'s `funding_mechanism` truthiness check (no
  change needed there, confirmed by direct read).
- **B2B-08** (done, live) — the precedent migration (`077`) this document's `wallet_ledger.entry_type`
  widening reproduces exactly.
- **Operational dependency on Arun, outside this document's code:**
  1. Create 2 Stripe Products (Starter, Growth) × 2 Prices each (monthly recurring, annual recurring) = 4
     real Stripe Price objects, in his own Stripe dashboard.
  2. Set the 4 `STRIPE_PLAN_*_PRICE_ID` env vars (Section 6.J) to those real Price IDs.
  3. Add `customer.subscription.updated` and `customer.subscription.deleted` to the existing Stripe
     webhook endpoint's subscribed-events list in the Stripe Dashboard — **the code changes in this
     document alone do not cause Stripe to send these event types**; the endpoint's event subscription is
     configured in Stripe, not in Clio's code. (`invoice.paid` is presumably already subscribed, since the
     existing auto-recharge branch depends on it working today.)
  None of these three steps require a code change on Clio's side beyond what's already specified here.
- **No dependency on B2B-09, B2B-10, B2B-11, or B2B-12** — confirmed non-overlapping scope by direct read
  of this codebase's current webhook/billing surface.
