# Feature Brief: Card-on-File Required for Trial/Test-Mode Access
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-19

## What Arun Said

Verbatim, 2026-07-19: "Even for trial, they need to add the credit card. Just they won't get charged
until trial minutes are over. They will be charged 0$ for verification."

Follow-up, when asked about the exact mechanism: "i dont want the micro charge but definitely need a
card on file."

## The Problem Being Solved

Today (confirmed by direct code read, `app/api/partner/v1/sessions/route.ts:150-180`), a `test`-mode
partner API key can dispatch a real, live meeting bot against the free 20-minute trial allowance
(B2B-08) with **zero payment method on file**. `checkStepComplete`'s `'payment'` case
(`lib/partner/wizard.ts:215-221`) and the Payment Configurator screen
(`app/dashboard/configurator/PaymentConfigClient.tsx`) only ever offer three paths that involve
*committing to spend real money* — a recurring Plan (`createPlanSubscriptionCheckout`), a pay-as-you-go
top-up (`createWalletTopupCheckoutSession`), or (not yet wired to a live route, per B2B-08's own
documented gap) a test-block purchase. There is no lightweight "just prove the card is real, don't
charge me" step, so a partner cannot try Clio's real bot without either (a) using the current
zero-friction trial with no card at all, or (b) being forced through a real-money Checkout flow before
they've decided to commit. Arun's instruction closes both problems at once: require a verified card for
*any* trial/test-mode usage, but never actually charge it until the partner exhausts the free allowance
and separately chooses to pay (the existing, unrelated B2B-08 test-block purchase flow, or a real Plan/
top-up).

## What Success Looks Like

- A partner cannot dispatch **any** `test`-mode session (`POST /api/partner/v1/sessions`) — not even
  their very first, with a full fresh 20-minute allowance — unless a card has been verified and is on
  file for their `partner_wallets` row. This is a new, additional prerequisite gate, checked before the
  existing trial-minutes computation.
- Verifying the card **never charges it**. Zero dollars, zero cents — not even a $0.00 or micro-charge
  attempt. The card is proven chargeable and saved for future (separate, later, real) use.
- The Payment Configurator screen (`PaymentConfigClient.tsx`) gets a new, low-friction "Add a card"
  action, distinct from and prior to the existing Plan/pay-as-you-go choices, so a partner can unlock
  trial access without committing to spend.
- Once verified, the partner's `test`-mode dispatch behaves exactly as it does today (20-minute lifetime
  trial, then the existing `trial_exhausted` 402, then the existing — separately gapped, not this
  brief's job — test-block purchase path).

## Known Constraints (from Arun, non-negotiable)

- Must use a real card-verification mechanism, not a charge of any amount, including $0.
- Applies to trial/test-mode usage specifically — Arun's own words scope this to trial, not to
  going live.

---

## Investigation Findings (grounds every resolution below — read in full before writing the spec)

**Files read directly, not assumed:** `lib/stripe.ts` (all 6 exported functions), `app/dashboard/
configurator/PaymentConfigClient.tsx`, `app/dashboard/configurator/GoLivePanel.tsx`, `lib/partner/
wizard.ts` (`checkStepComplete`'s `'payment'` case, lines 215-221), `app/api/partner/v1/sessions/
route.ts` (full trial-gate and live-mode funding-guardrail branches, lines 150-230), `app/api/webhooks/
stripe/route.ts` (`applyPaymentMethodToWallet`, `customer.updated`, `payment_method.attached`
handlers, lines 35-56 and 531-557), `app/api/admin/billing/checkout/route.ts` (the
`requirePartnerAdmin()` auth pattern every sibling `/api/admin/billing/*` route uses), `supabase/
migrations/075_b2b04_billing_metering.sql` and `081_b2b13_plan_tiers_and_topups.sql` (full
`partner_wallets` schema), `docs/specs/B2B-08-requirement-document.md` (the existing trial-gate
mechanism this brief extends), `docs/specs/B2B-26-requirement-document.md` (sales-partner/client model,
confirming client-account scope below), `docs/b2b-pivot-status.md`'s B2B-26 row (confirms clients have
zero logins, per Arun's own prior instruction).

### 1. The right Stripe primitive: Checkout in `mode: 'setup'` — not SetupIntent-without-Checkout, not a Charge

Arun explicitly ruled out any charge, including $0. Stripe's `PaymentIntent`/`Charge` objects require a
positive `amount` — Stripe does not support a $0 Charge at all, so "charge $0 for verification" was
never actually possible on Stripe's platform regardless of Arun's preference; his instruction and
Stripe's own constraints agree. The correct primitive is a **SetupIntent** (proves a card is valid and
saves it for future off-session use, with no `amount` field at all — structurally cannot charge
anything).

This codebase already has direct, working precedent for exactly this primitive: `app/api/checkout/
route.ts:135-139` (retired B2C code, `stripe.setupIntents.create({ customer, usage: 'off_session' })`
returning a `clientSecret` for an embedded `PaymentElement`). Per `CLAUDE.md`'s standing rule, this
retired B2C surface must not be resurrected or extended — it is cited here only as proof the exact
Stripe primitive and its two supporting packages (`@stripe/stripe-js@^9.6.0`, `@stripe/
react-stripe-js@^6.4.0`) are already installed dependencies, confirmed in `package.json`. **Do not
reuse or call into `app/api/checkout/route.ts` or its confirm route** — write new, B2B-scoped code.

**Decision: use Stripe Checkout's `mode: 'setup'`, not embedded Elements.** Every existing B2B funding
function in `lib/stripe.ts` (`createWalletTopupCheckoutSession`, `createAutoRechargeSubscriptionCheckout`,
`createTestBlockCheckoutSession`, `createPlanSubscriptionCheckout`) uses `stripeClient.checkout.
sessions.create(...)` — a hosted, redirect-based Checkout Session, matching `PaymentConfigClient.tsx`'s
existing `window.location.href = data.checkout_url` pattern. Checkout supports `mode: 'setup'` as a
first-class mode specifically for "collect and save a card, charge nothing" — Stripe's own primitive
for exactly this problem, requiring no new UI pattern (no Elements provider, no client-side card form)
and matching this codebase's established `isPlaceholder`-guarded mock-log convention byte for byte.
This is a deliberate divergence from the retired B2C embedded-Elements pattern, in favor of the pattern
every live B2B billing function already uses.

**New function to add to `lib/stripe.ts`**, named and shaped to match its four B2B-04/08/13 siblings
exactly (BA to finalize exact name/signature, following this precedent):
- Reuse `getOrCreateStripeCustomer(partnerAccountId, billingEmail?)` (already exists,
  `lib/stripe.ts:381-414`) to resolve/create the Stripe Customer and persist `stripe_customer_id` onto
  `partner_wallets` **before** creating the Checkout Session — this is required, not optional: the
  existing `payment_method.attached` webhook handler (`app/api/webhooks/stripe/route.ts:548-556`)
  matches purely on `.eq('stripe_customer_id', customerId)` and silently no-ops if no `partner_wallets`
  row carries that customer ID yet.
- `stripeClient.checkout.sessions.create({ mode: 'setup', payment_method_types: ['card'], customer:
  customerId, metadata: { partner_account_id: partnerAccountId, purpose: 'card_verification' },
  success_url, cancel_url })`.
- Mock-mode guard identical to every sibling function's `isPlaceholder || !stripeClient` branch.

**No new webhook branch is strictly required for the DB write.** The existing, unmodified
`payment_method.attached` handler already sets `stripe_default_payment_method_id`,
`payment_method_card_brand/last4/type` on `partner_wallets` the instant Stripe attaches the card to the
customer — which happens automatically when a `mode: 'setup'` Checkout Session completes. BA should
still decide whether `checkout.session.completed` needs a `purpose === 'card_verification'` branch
purely for a same-page confirmation message (mirroring `PaymentConfigClient.tsx`'s existing
`funded=1`/`returnMessage` UX for the other three funding paths) — this is a UX polish question, not a
data-correctness one, since the DB write path is already correct and live.

### 2. Enforcement point: extend the existing B2B-08 test-mode gate, checked before minutes

The gate lives in `app/api/partner/v1/sessions/route.ts:150-180`, inside the existing
`if (auth.mode === 'test')` block. Add a card-on-file check **before** the trial-minutes computation —
a card is a hard prerequisite, independent of how much allowance remains:

```
if (auth.mode === 'test') {
  const { data: wallet } = await supabase
    .from('partner_wallets')
    .select('trial_minutes_used, test_minutes_balance, stripe_default_payment_method_id')
    .eq('partner_account_id', auth.partnerAccountId)
    .maybeSingle()

  if (!wallet?.stripe_default_payment_method_id) {
    // reject 402, new code e.g. 'card_required', update partner_sessions to
    // status:'failed', end_reason: <new value, see Data Requirements note below>
    // dispatchMeetingBot() never called — zero vendor cost, matching the
    // existing trial_exhausted rejection's own discipline.
  }

  // ...existing trial-minutes computation, unchanged
}
```

This reuses the exact same column (`stripe_default_payment_method_id`) the existing B2B-06 live-mode
funding guardrail already checks (`app/api/partner/v1/sessions/route.ts:203-220`) — the same signal,
applied one branch earlier. No new column and no migration are required for the enforcement itself.

**No grandfathering.** Per the same precedent B2B-06's own live-mode guardrail set (enforced
immediately, no exception for accounts that predate it), this gate applies to every account the moment
it ships, including partners already mid-integration with no card on file today. This matches Arun's
instruction's own unconditional framing ("even for trial, they need to add the credit card") — BA
should confirm this reading with Arun only if genuinely uncertain; it is not escalated here because it
mirrors an already-shipped precedent in the same codebase.

**Response body**, matching the exact shape/style of the existing `trial_exhausted`/`funding_required`
errors (`app/api/partner/v1/sessions/route.ts:167-175`, `217-224`):
```
402 { error: { code: 'card_required', message: 'Add a payment method to start testing. No charge —
this only verifies the card is valid.' } }
```

### 3. Resolved: this does NOT change Go-Live's required "Payment" checklist item

This is the one real ambiguity named in the dispatch prompt, and it resolves cleanly from the live code
without escalation. Two structurally separate "is payment set up" signals already exist in this
codebase, unrelated to each other before this brief and staying unrelated after it:

- `checkStepComplete`'s `'payment'` case (`lib/partner/wizard.ts:215-221`) checks
  `partner_wallets.funding_mechanism IS NOT NULL` — set only by an actual committed funding mechanism
  (`checkout_topup`, `subscription_auto_recharge`, `invoicing`, `plan_subscription`; confirmed via
  `supabase/migrations/075_b2b04...sql:31-32` and `081_b2b13...sql:41-45`). This drives the Configurator
  "Payment" completion dot and `GoLivePanel.tsx`'s required-to-go-live checklist
  (`REQUIRED_LABELS`, `app/dashboard/configurator/GoLivePanel.tsx:35-38`).
- The B2B-06 live-mode session-dispatch guardrail (`app/api/partner/v1/sessions/route.ts:203-220`)
  checks `stripe_default_payment_method_id IS NOT NULL` — a card on file, independent of
  `funding_mechanism`.

A bare card verification (this brief's new mechanism) sets only the second signal, never the first.
**Decision: leave this exactly as is.** Arun's instruction is explicitly scoped to trial/test-mode
access, not to going live — going live is a materially bigger commitment (real per-minute production
billing) than a zero-dollar card check, and conflating the two would let a partner reach "Go Live" with
a verified-but-uncharged card and no actual funding commitment, which is not what was asked. `GoLivePanel`
and `checkStepComplete('payment')` are unmodified by this brief. (A pre-existing, unrelated inconsistency
was also found in the course of this investigation — the live B2B-06 dispatch gate already treats "has a
card" as sufficient to dispatch a *live* session regardless of `funding_mechanism`/`balance_usd`, while
the Configurator's own "Payment" checklist dot requires `funding_mechanism`. This is a pre-existing gap
between two already-shipped mechanisms, not something this brief introduces or is required to fix — BA
should note it in the spec's own findings for future awareness, not attempt to resolve it here.)

### 4. Resolved: applies uniformly to every `partner_wallets` row, direct partner or sales-partner client — no special-casing

Per `docs/b2b-pivot-status.md`'s B2B-26 row and `docs/specs/B2B-26-requirement-document.md` (read
directly): a sales-partner's client is "a normal `partner_accounts` row with zero `partner_admin_users`
members (the client never logs in, confirmed by Arun earlier)." Sessions are inserted keyed by
`partner_account_id` regardless of `account_kind`, so the server-side gate in Section 2 above applies
identically and automatically to a client account the moment one is ever issued a `test`-mode API key —
no `account_kind` branching needed or wanted.

The **UI** half (the new "Add a card" action on `PaymentConfigClient.tsx`) is, in practice, reachable
today only for direct partners: a sales-partner's client has no login and therefore cannot reach
`/dashboard/configurator` at all yet (confirmed — this is an existing, already-named gap; per-client
detail screens are explicitly deferred to a not-yet-written future brief, and sales-partner billing to
its own not-yet-written brief, "kept separate since it touches real money" per the B2B-26 changelog).
This brief does not need to build client-facing card UI — once a future brief gives clients their own
Payment surface, it will reuse this same component (`PaymentConfigClient`, keyed by `partner_account_id`)
and inherit this mechanism automatically, with no additional work. The sales-partner's own
`/dashboard/channel-partner` surface is unrelated (no wallet, no sessions, billing explicitly "coming
soon" per shipped B2B-26 copy) and is out of scope.

**Numbering note (RESOLVED by Orchestrator, 2026-07-19):** this brief collided at write time with a
sibling brief (`direct-partner-invite-only-and-sales-partner-revenue-visibility.md`), both claiming
B2B-27. Per this project's standing tie-break rule (whichever claims an ID second renumbers, resolved
by file mtime), this brief filed first (mtime 1784480839 vs. the sibling's 1784480840) and **keeps
B2B-27**. The sibling brief renumbers to B2B-28.

## Data Requirements (for BA to finalize in the spec)

- **No new column required for the enforcement check itself** — reuses `partner_wallets.
  stripe_default_payment_method_id`, already present (migration 075).
- **`partner_sessions.end_reason`** — the existing `CHECK` constraint
  (`end_reason IS NULL OR end_reason IN ('trial_limit_reached', 'trial_exhausted', 'funding_required')`,
  the last value added by B2B-06 after B2B-08) needs one more additive value for this rejection path,
  e.g. `'card_required'`. BA to write the migration, following migrations 077/081's exact
  drop-and-recreate-`CHECK` pattern.
- **New Checkout Session `metadata.purpose` value**: `'card_verification'`, alongside the existing
  `wallet_topup`, `wallet_auto_recharge`, `wallet_invoice`, `test_block_purchase`, `plan_subscription`
  values already handled in `app/api/webhooks/stripe/route.ts`. Confirm whether a dedicated
  `checkout.session.completed` branch is needed (see Section 1's UX-polish note) or whether the
  existing `payment_method.attached` handler alone is sufficient for correctness (it is, per direct code
  read) with only a client-side "was this a `card_verification` return?" query-param check needed for
  the confirmation message, matching `PaymentConfigClient.tsx`'s existing `funded=1` pattern
  (BA to name the new param, e.g. `card_verified=1`, not `funded=1` — money did not move).
- **New route**: `POST /api/admin/billing/card-verification` (or BA's preferred name, matching sibling
  naming), Clerk-authenticated via `requirePartnerAdmin(partner_account_id)` — the identical pattern
  `POST /api/admin/billing/checkout` already uses (`app/api/admin/billing/checkout/route.ts:1-40`).
- **`/api/admin/configurator/status`**: BA to decide whether to add a new `card_on_file: boolean` field
  (derived from `stripe_default_payment_method_id IS NOT NULL`) alongside the existing `payment: boolean`
  (derived from `funding_mechanism`), so the UI can show "Card on file ✓" independently of the unrelated,
  unmodified "Payment" Go-Live checklist item. Recommended, not mandatory — BA's call on the cleanest
  contract shape.

## UX Requirement (per standing responsive policy)

`PaymentConfigClient.tsx` is being touched for any reason under this brief, which triggers the standing
"any screen touched for any reason must be brought to a genuinely responsive bar as part of the same
change" rule (`CLAUDE.md`). The file currently uses inline pixel styles with a mix of fixed/flex layout
(`flexWrap: 'wrap'`, `minWidth: 180` on plan cards) — BA to specify in the spec whether the new
card-verification section needs any layout adjustment beyond what already wraps correctly, and to
confirm no hardcoded pixel-width caps are introduced by the new UI. No `clamp()`-based typography/spacing
work appears necessary for a single new section matching the existing `Card`/`PrimaryButton` components,
but BA should verify directly against the live rendered screen, not assume.

## Questions for BA

None outstanding — every question named in the CEO dispatch (Stripe primitive choice, Go-Live
interaction, sales-partner/client scope) is resolved above with direct code citations. BA's job is to
turn Sections 1-4 above into the full 12-section Requirement Document: exact route/function
signatures, the exact new `metadata.purpose` webhook branch decision (Section 1's one open
implementation choice — UX polish, not correctness), the exact migration for the new `end_reason` value,
wireframe/example of the new "Add a card" UI state on `PaymentConfigClient.tsx` (per the 3-line-minimum
rule — this needs a real example, not a one-line description, since it is new user-facing UI), and full
acceptance tests mirroring B2B-08's own falsifiable-test convention (e.g., "given a `test`-mode key with
no `stripe_default_payment_method_id` on file and a full fresh 20-minute allowance, when `POST /api/
partner/v1/sessions` is called, then the response is `402 card_required` and `dispatchMeetingBot()` is
never invoked").
