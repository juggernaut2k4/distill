# Feature Brief: Recurring Plan Tiers + Configurable Top-Up Amounts
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-16

**ID note (resolved 2026-07-16):** this brief originally claimed `B2B-12`, but a concurrently-dispatched
sibling brief (the homepage "Get Started" CTA fix) also claimed `B2B-12`, filed first, and was already
built and verified before this collision was caught. Per this project's established tie-break rule
(whichever claims the ID second renumbers), this brief has been renamed to **B2B-13**. All references
below updated accordingly.

---

## What Arun Said

From live testing on `hello-clio.com`, reviewing the onboarding wizard's Payment step (two cards:
"Pay as you go" one-time top-up and "Set a monthly minimum" auto-recharge subscription, both
hardcoded to $100):

1. The mechanism shape (wallet-funding cards) is OK. The hardcoded `$100` amounts need to become real,
   configurable prices. Arun will create the actual Stripe Products/Prices himself and update config —
   his exact words: **"so i will update the stripe accordingly."** This brief must not call for any
   code that programmatically creates real Stripe Products/Prices against his live account.
2. New requirement, his exact words: **"we also need plans (monthly and yearly) and topups for one
   time recharge. keep in mind."** He wants real recurring subscription plan tiers (monthly/annual
   billing cycles) **in addition to** one-time top-up recharges — not instead of.
3. He asked for a recommendation on pricing display UX: specific prices shown directly vs. some kind
   of list/selector.

## The Problem Being Solved

Today the only way a partner funds usage is wallet-based: a one-time top-up or an auto-recharge
subscription that tops the wallet back up to a floor whenever it depletes. Both are pure pass-through
funding mechanisms with no fixed price of their own — a partner pays exactly what they top up. There
is no product that says "pay a known monthly or annual fee, get a bundled usage allowance, buy more if
you go over." That's a standard, expected SaaS commercial shape and self-serve/mid-market partners
evaluating Clio will expect to see it next to (not instead of) the pay-as-you-go option. Right now
that shape doesn't exist anywhere in the schema, the billing code, or the wizard UI — this is
confirmed new scope, not a copy change on the two existing cards.

## What Success Looks Like

- A partner-admin going through onboarding sees three ways to pay: a recurring **Plan** (monthly or
  annual, fixed price, bundled usage allowance), a one-time **top-up** (now with real configurable
  amounts, not hardcoded $100), and — per this brief's schema recommendation below — the "Set a
  monthly minimum" auto-recharge card is retired from the self-serve wizard flow (superseded by Plans;
  its DB mechanism is not deleted, just no longer offered as a new-signup path).
- Every dollar figure and every Stripe Price ID in the shipped code is a clearly named
  `PLACEHOLDER_`-prefixed env var or an obviously-fake illustrative number in a constants file — zero
  real prices invented, zero programmatic Stripe Product/Price creation. Arun swaps in real values
  after he creates the Products/Prices in his own Stripe dashboard.
- A partner on a Plan who exceeds their bundled allowance keeps working exactly like every other
  partner today — wallet goes negative, the existing B2B-04 low-balance-alert mechanism fires, they
  can buy a one-time top-up. No new gating/blocking logic invented.
- Nothing in `lib/partner/*`, `usage_events`, `wallet_ledger`, or `billing_rate_versions` (the actual
  metering pipeline) changes. This is additive to the funding side only.

## Known Constraints

- No programmatic Stripe Product/Price creation against Arun's live account. Use `PLACEHOLDER_`-style
  env vars for every recurring Price ID, following this project's own established convention
  (`STRIPE_STARTER_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_STARTER_MONTHLY` from the pre-pivot B2C
  `CLAUDE.md` env template — same shape, new names, see Section 4 below).
- Must not resurrect or depend on `app/plan/`, `app/dashboard/plan/`, `app/(marketing)/pricing/`, or
  `app/checkout/` — confirmed dead B2C code, explicitly slated for deletion in a sibling brief
  (`docs/b2b-pivot-status.md` finding #4, Arun-confirmed 2026-07-16: "remove it, don't just gate it").
  Those files may only be used as a **structural/visual reference** (e.g. the monthly/annual toggle
  pattern), never imported or extended.
- Must not touch the metered-usage pipeline (`usage_events`, `wallet_ledger`, `billing_rate_versions`,
  `lib/partner/webhooks.ts`) — B2B-04 is done and live; this brief only adds a new way money enters
  `partner_wallets`.
- `partner_wallets.tier` (`self_serve`/`mid_market`/`enterprise`) stays commit-size/support-routing
  only per its own schema comment ("no feature gating by tier," Objective 6) — a Plan tier is a
  **separate concept** from this column and must not be confused with it or reuse its values.
- Migration must be additive-only, matching migration `075`'s own stated discipline ("no existing
  `partner_accounts`/`partner_sessions`/`webhook_dispatch_log` column is modified").

---

## Grounding — What's Actually True in the Code Today

Confirmed by direct reads, not inference:

- **`app/dashboard/configurator/wizard/WizardClient.tsx`**, `PaymentStep` (lines 448–503): two `Card`
  components side by side. "Pay as you go" → `POST /api/admin/billing/checkout` with
  `{ partner_account_id, amount_usd: 100, success_url, cancel_url }` (hardcoded `100`, line 459).
  "Set a monthly minimum" → `POST /api/admin/billing/subscription` with
  `{ partner_account_id, monthly_minimum_usd: 100, success_url, cancel_url }` (hardcoded `100`, line
  476). Both just redirect to `data.checkout_url`. No plan names, no feature list, no monthly/annual
  toggle anywhere in this component.
- **`lib/stripe.ts`**: zero discrete Stripe Price IDs exist anywhere in this file today. All four
  billing functions — `createWalletTopupCheckoutSession`, `createAutoRechargeSubscriptionCheckout`,
  `createEnterpriseInvoice`, `createTestBlockCheckoutSession` — construct ad-hoc `price_data` line
  items per request (`mode: 'payment'` or `mode: 'subscription'` with an inline `price_data` object,
  never `stripeClient.checkout.sessions.create({ line_items: [{ price: '<id>' }] })`). This brief is
  the first thing in the codebase that would reference a real, pre-created Stripe Price ID.
- **`app/api/admin/billing/checkout/route.ts`**: validates `amount_usd: z.number().min(20).max(50000)`
  — this bound is documented in the route's own comment as "a technical implementation guardrail
  against fat-finger entry, not a pricing decision," i.e. already meant to be reused, not reinvented.
- **`app/api/admin/billing/subscription/route.ts`**: validates `monthly_minimum_usd: z.number().min(100)`.
- **`supabase/migrations/075_b2b04_billing_metering.sql`**, `partner_wallets` (lines 18–56):
  - `tier` — `self_serve`/`mid_market`/`enterprise`, explicitly commented "Commitment-size/support-
    level tiering only ... every tier gets the identical API surface." No price attached to this
    column at all.
  - `funding_mechanism` — `checkout_topup` / `subscription_auto_recharge` / `invoicing`. This is the
    *how money entered the wallet* field, not a plan/price concept.
  - `monthly_minimum_usd` — commented "mid-market only," the auto-recharge floor amount.
  - `stripe_subscription_id` — commented **"mid-market auto-recharge subscription only."** This is a
    load-bearing detail: this column is explicitly scoped to one specific mechanism already. A Plan
    subscription is a structurally different Stripe Subscription object (different Product/Price,
    different lifecycle) and cannot reuse this column without corrupting its documented meaning.
  - `balance_usd` — `NUMERIC(14,6)`, USD-denominated by deliberate past decision ("not a credit-unit
    abstraction," migration's own closing comment), may go negative (sessions can't pause mid-call).
  - `reference_topup_amount_usd` / `low_balance_alert_fired_at` — the 80%-consumed alert threshold,
    re-armed every time a new top-up lands.
  - **Confirmed: there is no existing concept of a recurring plan tier with its own price anywhere in
    this schema.** `partner_wallets` is purely prepaid-balance + metered usage.
- **`docs/specs/B2B-04-requirement-document.md`**: confirms `funding_mechanism='subscription_auto_recharge'`
  credits the wallet by the *Stripe invoice's actual `amount_paid`* on `invoice.paid` (1:1 pass-
  through, no separate "included allowance" concept) — a materially different mechanic from what a
  bundled-allowance Plan needs (see Section 1 below).
- **Old B2C files** (`app/plan/PlanClient.tsx`, `app/(marketing)/pricing/page.tsx`,
  `app/checkout/page.tsx`, `app/dashboard/plan/PlanClient.tsx`): confirmed present in the repo but
  fully disconnected from the wallet schema and the wizard (they reference the retired B2C `users`
  table shape, not `partner_accounts`/`partner_wallets`). `app/(marketing)/pricing/page.tsx` does have
  a real, working monthly/annual toggle (`useState(false)` `annual` flag, a `PlanPrices` map switched
  by the flag) and three tiered cards with a "Most popular" badge on the middle tier — useful as a
  **structural precedent only**, per the constraint above. These files are slated for deletion in the
  sibling B2C-dashboard-removal brief; this brief must not import from or extend them.
- **Old B2C `CLAUDE.md` env template** (`/Users/arunprakash/Documents/claudeWS/CLAUDE.md`, now
  superseded but still the right structural precedent): established the naming convention
  `STRIPE_<TIER>_<PERIOD>_PRICE_ID=PLACEHOLDER_STRIPE_<TIER>_<PERIOD>`, e.g.
  `STRIPE_STARTER_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_STARTER_MONTHLY`. This brief's new env vars
  should follow the identical shape (see Section 4).
- Note: I attempted to read the current `.env.local.example` directly and hit a file-permission
  restriction in this session (denied, not missing) — could not confirm its exact present contents.
  Not a blocker: the naming convention above is well-established project precedent and the BA/dev
  agent that implements this will have normal file access to add the new vars correctly.

---

## Section 1 — Schema: How a Plan Tier Fits the Existing Wallet Architecture

**Reasoned recommendation (not yet BA-finalized — flagged for the BA to formally document, wireframe,
and confirm the exact column list):**

A plan tier is a **base access fee that includes a bundled usage allowance**, with the existing
wallet/metering pipeline handling everything beyond that allowance. Concretely:

1. **Plan catalog is code, not a DB table.** A small, rarely-changing list of tiers (2–4 entries,
   monthly + annual price each) doesn't need the historical-integrity treatment `billing_rate_versions`
   has (that table is versioned specifically so a rate change never silently reprices already-occurred
   `usage_events` — a genuinely different problem). Recommend a single new constants module, e.g.
   `lib/billing/plan-tiers.ts`, exporting a `PLAN_TIERS` array: `{ key, displayName, monthlyPriceUsd,
   annualPriceUsd, includedAllowanceUsd, stripePriceIdMonthlyEnvVar, stripePriceIdAnnualEnvVar }`. Both
   the wizard's display card AND the Stripe webhook handler's wallet-credit logic import this same
   module — one source of truth, no drift between what's displayed and what's actually credited.
   Placeholder tier names for the BA to adjust: **"Starter"** and **"Growth"** (2 tiers, self-serve/
   mid-market equivalents — see Section 2 on why Enterprise stays out of the self-serve wizard).
2. **Per-partner plan state is new nullable columns on `partner_wallets`**, following the exact pattern
   the table already uses for mechanism-specific optional fields (`monthly_minimum_usd` is "mid-market
   only," `stripe_subscription_id` is "auto-recharge only" — same idiom, new fields):
   - `plan_tier_key TEXT` — references a key in the `PLAN_TIERS` code catalog, not an FK (catalog isn't
     DB-backed). Recommend `CHECK (plan_tier_key IN ('starter','growth'))` for now, matching this
     schema's own strong existing preference for `CHECK`-constrained text everywhere (`tier`,
     `funding_mechanism`, `payment_method_type` all do this) — accepting that adding a new tier later
     needs a small migration, same tradeoff the schema already makes elsewhere.
   - `plan_billing_period TEXT CHECK (plan_billing_period IN ('monthly','annual'))`
   - `stripe_plan_subscription_id TEXT` — **deliberately a new column, not a reuse of
     `stripe_subscription_id`**, because that column's own comment scopes it to auto-recharge only; a
     Plan subscription is a different Stripe Subscription object entirely.
   - `plan_current_period_end TIMESTAMPTZ`
   - `plan_status TEXT CHECK (plan_status IN ('active','past_due','canceled'))` — mirrors Stripe
     subscription status coarsely, same idea as `custom_domain_status` elsewhere in this codebase.
   - `funding_mechanism` gets one new allowed value: `'plan_subscription'`, added to the existing
     `CHECK` alongside `checkout_topup` / `subscription_auto_recharge` / `invoicing`.
   - Migration is additive-only (new columns, widened `CHECK`), matching `075`'s own stated discipline.
     BA to assign the next migration number.
3. **Wallet crediting mechanic, reusing B2B-04's existing pattern exactly:** on `invoice.paid` for a
   Plan subscription, credit the wallet by the tier's `includedAllowanceUsd` (a fixed number from the
   `PLAN_TIERS` catalog) — **not** by the invoice's `amount_paid` the way auto-recharge does. This is
   the one deliberate difference from `subscription_auto_recharge`'s existing webhook logic, and it's
   what makes a $99/mo plan with a $50 included allowance a real, distinct commercial product (margin
   is the gap between price and allowance) rather than just a relabeled auto-recharge. Also re-arms
   `reference_topup_amount_usd`/`low_balance_alert_fired_at` exactly as any top-up event does today —
   no new alert logic needed, reuse what B2B-04 already built.
   - **Runs through the existing two RPCs / ledger conventions** referenced in `docs/specs/B2B-04-
     requirement-document.md` (the credit RPC used by top-up/auto-recharge webhooks) — BA to confirm
     the exact RPC name and whether a new `wallet_ledger` entry `source` value (e.g.
     `'plan_allowance_credit'`) is needed to distinguish it from a top-up in the ledger history. This
     is the one piece of real ledger-adjacent work in this brief; everything else about metering is
     untouched.
4. **Overage behavior: no new logic.** Once a Plan partner's credited allowance is used up, the wallet
   goes negative exactly as it does for every other partner today (the existing "may go negative — a
   live session can't pause mid-call" behavior). The existing low-balance-alert mechanism fires the
   same way. A Plan partner can still buy a one-time top-up (Section 3) to top themselves up between
   billing cycles. **Do not invent a hard usage cap or a "plan exhausted, blocked" state** — that's new
   product behavior nobody asked for and would need its own BA spec if wanted later.
5. **`subscription_auto_recharge` is not deleted from the schema or backend** — any code path that
   already writes/reads it stays valid. It is only removed as an *offered option in the self-serve
   wizard UI* (Section 2), superseded there by Plan selection. BA to confirm via a quick check whether
   any real partner has actually signed up via that path yet (if zero, this is a non-issue; if any
   exist, BA documents how they're handled — most likely: left alone, no forced migration).

## Section 2 — Wizard Payment Step: Third Option or Replacement?

**Recommendation: replace, not add a third card.**

"Set a monthly minimum" (auto-recharge) and a new "Plan" option are both "commit to a recurring
monthly Stripe charge" — offering both side by side in the same wizard step is two confusingly similar
recurring options with no bundled-allowance story on one of them, which fails the Executive UX standard
(crisp, no unnecessary friction, Product Principle #5). A Plan is the more complete version of the same
commercial idea (fixed price + bundled allowance + wallet handles overage) — it doesn't coexist as a
genuinely different choice the way "recurring" vs. "one-time" do.

Recommended wizard `PaymentStep` shape: **two** funding choices, not three —
1. **Plan** (monthly/annual toggle, tiered cards, replaces "Set a monthly minimum")
2. **Pay as you go** (one-time top-up, unchanged position, now with real configurable amounts —
   Section 3)

Enterprise/`invoicing` is not part of this decision — it's already handled outside the self-serve
wizard (assisted, per `docs/specs/B2B-04-requirement-document.md`'s invoicing flow) and stays that way;
Enterprise should not appear as a self-serve Plan card either.

This is a product-shape call, not a pure technical one — flagging explicitly per the CEO's standing
instruction not to guess on UX shape. Presenting it here as the BA's build direction since a Feature
Brief needs to give a direction to spec against; if Arun wants three cards instead of a replacement, or
wants auto-recharge kept as a third option, that's a one-line correction back to this brief, not a
reason to block BA dispatch.

## Section 3 — Top-Up UX: Presets + Free Text (Both)

Recommend **both** preset amount buttons and a free-text custom field, not one or the other:
- A small row of preset buttons (e.g. $50 / $100 / $250 / $500 — illustrative placeholders, exact
  amounts are Arun's call same as everything price-related here) for one-click selection on the common
  case — matches the Executive UX standard (minimal friction for the 80% case).
- A free-text numeric input for anything else, bounded by the **existing** server-side validation
  already in `app/api/admin/billing/checkout/route.ts` (`amount_usd: z.number().min(20).max(50000)`) —
  reuse that bound exactly, don't invent a new one. A preset-only UI would be too rigid for a B2B
  audience whose usage varies widely partner-to-partner, which is exactly the reasoning Arun's own
  question pointed at.

## Section 4 — Pricing Display UX Recommendation

**Recommendation: specific prices shown directly, in compact cards matching the Configurator's existing
utilitarian visual idiom — not a "contact sales" list/selector, and not the old B2C marketing page's
splashy treatment.**

Reasoning, grounded in what's actually true here:
1. **Arun has real numbers he's about to plug into Stripe.** A selector/list that hides price behind a
   click ("see plans," "contact us") is the right call when pricing is negotiated or genuinely unknown
   at build time — neither is true here. Specificity signals confidence and removes a step, which is
   exactly the Executive UX standard (Product Principle #5).
2. **Usage varies a lot by partner, so each card must show the price AND the included allowance
   together** (e.g. "$X/mo — includes $Y of usage"), not price alone — a partner self-selects based on
   comparing their own expected volume against the allowance, and that comparison is the actual
   decision driver. A dropdown/selector hides this comparison; side-by-side cards make it a glance.
   This is why 2–4 clearly differentiated cards, not a list, is the right form.
3. **Visual treatment should match `WizardClient.tsx`'s existing `PaymentStep`**, which already uses
   plain, dark, compact `Card` components from `../_shared` (`COLORS`, `Card`, `PrimaryButton`) — dense
   and inline, no Framer Motion gradient hero treatment. The wizard is a setup flow inside an admin
   tool, not a marketing page; reuse its existing visual system, don't reintroduce the old
   `(marketing)/pricing` page's aesthetic even as a design reference beyond its interaction pattern.
4. **Include a monthly/annual toggle above the cards** — a standard, expected pattern, and the old B2C
   pricing page already had a working one (`useState` `annual` flag switching a price map, "Most
   popular" badge on one tier) that's a legitimate **structural** reference even though that file
   itself is being deleted. BA to design the toggle in the Configurator's own visual language, not copy
   the old component.

## Section 5 — Env Vars (Placeholders Only — Zero Real Stripe Objects Created)

Following the established `STRIPE_<NAME>_PRICE_ID=PLACEHOLDER_STRIPE_<NAME>` convention:

```
STRIPE_PLAN_STARTER_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_PLAN_STARTER_MONTHLY
STRIPE_PLAN_STARTER_ANNUAL_PRICE_ID=PLACEHOLDER_STRIPE_PLAN_STARTER_ANNUAL
STRIPE_PLAN_GROWTH_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_PLAN_GROWTH_MONTHLY
STRIPE_PLAN_GROWTH_ANNUAL_PRICE_ID=PLACEHOLDER_STRIPE_PLAN_GROWTH_ANNUAL
```

(Prefixed `STRIPE_PLAN_` to disambiguate from any other Price ID usage.) The code this brief specs
references these via `process.env`, follows the same `isPlaceholder` mock-guard pattern already used
throughout `lib/stripe.ts` (checks for the `PLACEHOLDER_` prefix, logs `[MOCK]` and returns a mock
checkout URL rather than calling Stripe), and does not call `stripe.products.create` /
`stripe.prices.create` anywhere. Arun updates these four vars once he's created the real Products/
Prices in Stripe; no code change required on his end beyond that.

## Section 6 — Explicit Scope Boundary

**In scope:** `lib/billing/plan-tiers.ts` (new constants module), new `partner_wallets` columns +
migration, a new Stripe Checkout function (`createPlanSubscriptionCheckout`, `mode: 'subscription'`,
referencing a real `price` — not `price_data` — resolved from the env vars above), Stripe webhook
handler changes for plan `invoice.paid`/`customer.subscription.updated`/`.deleted` events, the wizard
`PaymentStep` UI redesign (Plan cards + toggle + top-up presets/free-text), the four new env vars.

**Out of scope, do not touch:** `usage_events`, `wallet_ledger`, `billing_rate_versions`, any file
under `lib/partner/` unrelated to billing, the Enterprise/invoicing flow, any real Stripe Product/Price
creation, anything under `app/plan/`, `app/dashboard/plan/`, `app/(marketing)/pricing/`,
`app/checkout/` (dead B2C code, separate deletion brief).

## Questions for BA

All of the following need to land in the Requirement Document's Section 11 as **answered**, not open,
before this goes to a developer — per the CEO→BA→Dev gate, zero open questions at approval:

1. Exact migration number and full column list/types for the `partner_wallets` additions in Section 1
   (this brief's list is a strong recommendation, not final DDL).
2. Exact `wallet_ledger` `source`/`type` value for a plan-allowance credit event, and confirmation of
   which existing credit RPC it reuses (or whether a small new one is needed) — name it precisely.
3. Full wireframe for the redesigned `PaymentStep` (Plan cards + monthly/annual toggle + top-up preset
   buttons + free-text field) — this is a real UI, needs the full 3+ line description with example this
   project's "Ambiguous UX = STOP" rule requires, not a paraphrase of Section 2–4 above.
4. Confirm final tier count/names (this brief suggests "Starter"/"Growth" as placeholders only) and
   preset top-up amounts (this brief suggests $50/$100/$250/$500 as placeholders only) — both are
   Arun's call, BA to route back through CEO if Arun hasn't weighed in by spec time.
5. Exact Stripe webhook event handling diff for `app/api/webhooks/stripe/route.ts` (or wherever B2B-04
   ended up landing that handler) — confirm file path and existing event-handling structure before
   writing the new `invoice.paid`-for-plan branch.
6. Confirm whether any real partner currently holds `funding_mechanism='subscription_auto_recharge'`
   (via a quick data check) — determines whether "remove from wizard, keep in schema" needs any
   migration-time backfill/notice, or is a pure no-op.
7. Decide and document the exact behavior when a Plan subscription's Stripe status goes `past_due` or
   `canceled` (mirrors what `subscription_auto_recharge` already does for its own lifecycle events,
   per `docs/specs/B2B-04-requirement-document.md` — reuse that precedent, don't invent new behavior).
