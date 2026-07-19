# B2B-27 — Card-on-File Required for Trial/Test-Mode Access — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-19
Source brief: `.claude/agents/clio/feature-briefs/B2B-27-card-on-file-required-for-trial-access.md`

---

## 1. Purpose

Today, verified directly against `app/api/partner/v1/sessions/route.ts:152-201`, a `test`-mode partner
API key can dispatch a real, live meeting bot (`dispatchMeetingBot()`) against the free 20-minute trial
allowance with **zero payment method on file**. Nothing on the `test`-mode path checks
`partner_wallets.stripe_default_payment_method_id` — only the separate `live`-mode branch
(lines 206-227) does. A partner can therefore consume Clio's real vendor-metered trial capacity
(meeting-bot minutes, a direct cost to Clio) without Clio ever having proven the partner is a real,
chargeable entity.

Separately, verified directly against `lib/partner/wizard.ts:215-221` and
`app/dashboard/configurator/PaymentConfigClient.tsx`, the only three payment actions the Configurator
offers today (`createPlanSubscriptionCheckout`, `createWalletTopupCheckoutSession`, and the
not-yet-wired `createTestBlockCheckoutSession`) all require the partner to commit to spending real
money. There is no lightweight "prove the card is real, charge nothing" action, so a partner cannot
unlock trial access without either (a) today's zero-friction, zero-verification trial, or (b) being
forced into a real-money Checkout flow before they've decided to commit.

Per Arun's direct instruction (2026-07-19): "Even for trial, they need to add the credit card. Just
they won't get charged until trial minutes are over... i dont want the micro charge but definitely need
a card on file." This feature closes both gaps: it adds a mandatory, zero-dollar card-verification step
as a new prerequisite for any `test`-mode session dispatch, and adds the missing low-friction UI action
that lets a partner satisfy that prerequisite without committing to a Plan or top-up.

**Failure without it:** Clio continues to bear real vendor cost (meeting-bot dispatch) for every trial
session with no proof the requesting partner is a real, chargeable entity, and has no self-serve path
for a partner to clear that bar without an unwanted real-money commitment.

---

## 2. User Story

As a partner integrating with Clio for the first time (evaluating via `test`-mode API keys),
I want to add a card to my account with a low-friction, no-commitment action,
So that I can unlock my free trial testing allowance without being forced into choosing a paid Plan or
making a top-up.

As Arun (Clio's owner),
I want every `test`-mode session dispatch — even a fresh account's very first, fully-available trial —
to require a verified card on file, with absolutely no charge attempted at verification time,
So that Clio never incurs real vendor cost for a requester it cannot later charge for going live, while
never asking a prospective partner to pay anything just to try the product.

---

## 3. Trigger / Entry Point

| # | Trigger | Route / mechanism | Auth | State required |
|---|---|---|---|---|
| E-1 | A partner's integration calls the session-create API in `test` mode | `POST /api/partner/v1/sessions` | `test`-mode partner API key or OAuth2 client (`requirePartnerApiKey`, unchanged) | Existing trigger; this brief adds a new prerequisite check inside it |
| E-2 | A partner admin opens the Configurator's Payment section and clicks "Add a card" | `POST /api/admin/billing/card-verification` (NEW) | Clerk session + `requirePartnerAdmin(partner_account_id)` (identical pattern to `POST /api/admin/billing/checkout`) | Signed in, administers the target `partner_accounts` row |
| E-3 | Stripe redirects back after the hosted Checkout Session (`mode: 'setup'`) completes or is cancelled | `GET /dashboard/configurator?partner_account_id=...&section=payment&card_verified=1` (success) or `...&section=payment` (cancel) | Clerk session (unchanged page auth) | Returning from Stripe |
| E-4 | Stripe attaches the verified payment method to the Customer (automatic consequence of a completed `mode: 'setup'` Checkout Session) | `POST /api/webhooks/stripe` → `payment_method.attached` case (EXISTING, unmodified) | Stripe webhook signature (`constructWebhookEvent`, unchanged) | A `partner_wallets` row already carries the matching `stripe_customer_id` (guaranteed by E-2's flow — see §6.2) |
| E-5 | The Configurator's Payment section loads or re-checks status | `GET /api/admin/configurator/status?partner_account_id=...` (EXISTING route, additive response field) | Clerk session + `requirePartnerAdmin` (unchanged) | Same as today |

---

## 4. Screen / Flow Description

### 4.A — Server-side enforcement (no screen — API behavior)

**State S1 — `test`-mode session requested, no card on file (NEW rejection path).**
`POST /api/partner/v1/sessions` is called with a valid `test`-mode credential and a schema-valid body.
The `partner_sessions` row is inserted (unchanged — this insert always happens regardless of what
follows, matching the existing `trial_exhausted` path's own behavior of inserting first, then
rejecting). Inside the existing `if (auth.mode === 'test')` block
(`app/api/partner/v1/sessions/route.ts:153`), **before** the existing trial-minutes computation, a new
check reads `partner_wallets.stripe_default_payment_method_id` for this `partner_account_id`. If it is
`null` or no `partner_wallets` row exists at all:
- The just-inserted `partner_sessions` row is updated: `status: 'failed'`, `end_reason: 'card_required'`.
- `dispatchMeetingBot()` is **never called** — no vendor cost is incurred, matching the exact discipline
  the existing `trial_exhausted` rejection already follows.
- The response is `402` with body:
  ```json
  { "error": { "code": "card_required", "message": "Add a payment method to start testing. No charge — this only verifies the card is valid." } }
  ```
  (Byte-for-byte the same envelope shape as the existing `trial_exhausted`/`funding_required` errors in
  this same file — no `request_id` field, matching this route's own established convention, not the
  `errorEnvelope()` helper used elsewhere in `lib/partner/auth.ts`.)

**State S2 — card on file, trial allowance available (UNCHANGED behavior, now gated one step later).**
If `stripe_default_payment_method_id` is present, execution proceeds exactly as it does today: the
existing trial-minutes computation runs, and if `availableMinutes > 0`, `dispatchMeetingBot()` is
called and a `201` is returned. **No change to this path's response shape, timing, or logic** — the new
check is a pure prerequisite gate positioned before it, not a modification of it.

**State S3 — card on file, but trial allowance exhausted (UNCHANGED — pre-existing `trial_exhausted`
path, unaffected by this brief).**

**No grandfathering.** This check applies to every `partner_account_id` the instant it ships, including
accounts that predate this brief with no card on file today — identical rollout discipline to B2B-06's
live-mode funding guardrail (`app/api/partner/v1/sessions/route.ts:206-227`), which shipped with no
exception for pre-existing accounts either.

### 4.B — `PaymentConfigClient.tsx` — new "Card verification" section (MODIFIED)

The existing component (`app/dashboard/configurator/PaymentConfigClient.tsx`) renders, top to bottom
today: an `<h1>` + subtext, an optional `returnMessage` line, then "Plans" (billing-period pills + 3
tier cards), then "Pay as you go" (preset/custom top-up amounts). This brief inserts one new block
**directly below the existing `returnMessage` paragraph and above the "Plans" heading** — distinct from
and prior to the existing Plan/pay-as-you-go choices, per the CEO brief's explicit requirement.

**On mount**, the component now always fetches `GET /api/admin/configurator/status?partner_account_id=...`
(a call this component does not make today except conditionally on a Stripe return) to resolve whether
a card is already on file, populating a new `cardOnFile: boolean | null` state (`null` = not yet loaded).

**State C1 — loading (`cardOnFile === null`).** The new block renders its heading and body copy, but in
place of the button/checkmark shows muted text `"Checking…"` (`COLORS.textSecondary, fontSize: 12`).
This is the only render before the first status fetch resolves; it is not gated behind a full-page
spinner — the rest of the section (Plans, Pay as you go) renders immediately and unaffected, since
those two blocks have no dependency on card status.

**State C2 — no card on file (`cardOnFile === false`).** Heading `"Card verification"`, body text
`"Verify a card to unlock test-mode access. This never charges you — it only confirms the card is
valid."` (`COLORS.textSecondary, fontSize: 12`), then a single `PrimaryButton` labelled `"Add a card"`.
Clicking it calls `POST /api/admin/billing/card-verification`, and on a successful response redirects
the full page to the returned `checkout_url` (`window.location.href = data.checkout_url`) — identical
mechanics to `startCheckout()`/`startPlanCheckout()` already in this file. While the request is
in-flight, the button reads `"Redirecting…"` and is disabled (`busy` state reused — see §6.3, this
action participates in the same `busy` state the Plan/top-up buttons already use, so only one billing
action can be in flight at a time, matching this component's existing single-`busy`-state discipline).

**State C3 — card on file (`cardOnFile === true`).** Heading `"Card verification"`, then a single line:
`"✓ Card on file — testing unlocked."` (`COLORS.green` for the checkmark, `COLORS.textPrimary` for the
rest), no button. This state is permanent for the account (see §9 Edge Case 4 for the one known gap —
no mechanism exists anywhere in this codebase to ever clear `stripe_default_payment_method_id` once
set, a pre-existing limitation, not introduced by this brief).

**Return handling (`card_verified=1`, mirrors the existing `funded=1` handler exactly, kept as a
structurally separate effect/ref pair — not merged with the `funded` handler, since the two query
params gate two independent Stripe flows that can each fire on their own return trip):** on mount, if
`?card_verified=1` is present, the effect re-fetches configurator status, sets `cardOnFile` from
`status.card_on_file`, strips the query param via `router.replace(...)`, and — only if the live status
still does not confirm a card on file — shows a message: `"We couldn't confirm your card yet — this can
take a few seconds if Stripe hasn't finished processing. Refresh in a moment to check again."`
(identical wording pattern, same `COLORS.red` styling, to the existing `funded=1` handler's message).

---

## 5. Visual Examples

### `PaymentConfigClient.tsx` — Card verification block, State C2 (no card yet)

```
┌─────────────────────────────────────────────────────────┐
│  Add a payment method                                    │
│  Choose how you'll fund usage.                            │
│                                                             │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Card verification                                    │  │
│  │ Verify a card to unlock test-mode access. This never │  │
│  │ charges you — it only confirms the card is valid.    │  │
│  │                                                        │  │
│  │  [        Add a card        ]                        │  │
│  └───────────────────────────────────────────────────┘  │
│                                                             │
│  Plans                                                     │
│  [ Monthly ] [ Annual ]                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                  │
│  │ Starter  │ │  Growth  │ │   ...    │                  │
│  └──────────┘ └──────────┘ └──────────┘                  │
│  ─────────────────────────────────────                    │
│  Pay as you go                                             │
│  ...                                                        │
└─────────────────────────────────────────────────────────┘
  New Card block: bg-[#111111] (COLORS.surface), border COLORS.borderSubtle — same <Card>
  component every other block in this file already uses. No new pixel-width cap.
```

### `PaymentConfigClient.tsx` — Card verification block, busy/redirecting

```
┌───────────────────────────────────────────────────────┐
│ Card verification                                        │
│ Verify a card to unlock test-mode access. This never     │
│ charges you — it only confirms the card is valid.        │
│                                                             │
│  [        Redirecting…        ]   (disabled)              │
└───────────────────────────────────────────────────────┘
```

### `PaymentConfigClient.tsx` — Card verification block, State C3 (verified)

```
┌───────────────────────────────────────────────────────┐
│ Card verification                                        │
│ ✓ Card on file — testing unlocked.                        │
└───────────────────────────────────────────────────────┘
  Checkmark: COLORS.green. Rest of line: COLORS.textPrimary.
  No button rendered in this state.
```

### `PaymentConfigClient.tsx` — return, unconfirmed (mirrors existing `funded=1` failure copy)

```
┌───────────────────────────────────────────────────────┐
│ Add a payment method                                     │
│ Choose how you'll fund usage.                             │
│                                                             │
│ We couldn't confirm your card yet — this can take a few   │
│ seconds if Stripe hasn't finished processing. Refresh in  │
│ a moment to check again.                                   │
│                                             (COLORS.red)   │
│ ┌───────────────────────────────────────────────────┐  │
│ │ Card verification                                    │  │
│ │ Verify a card to unlock test-mode access...           │  │
│ │  [        Add a card        ]                        │  │
│ └───────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

### `POST /api/partner/v1/sessions` — 402 `card_required` response (no screen; API contract)

```json
{
  "error": {
    "code": "card_required",
    "message": "Add a payment method to start testing. No charge — this only verifies the card is valid."
  }
}
```
HTTP status: `402`. `partner_sessions.status` is set to `'failed'`, `end_reason` to `'card_required'`.

---

## 6. Data Requirements

### 6.1 Schema — new migration `supabase/migrations/087_b2b27_card_verification.sql`

Additive only: one new `partner_sessions.end_reason` CHECK value. No new column, no new table — the
enforcement signal itself (`partner_wallets.stripe_default_payment_method_id`) already exists
(migration 075) and needs no schema change. 087 is the next-free migration number, verified against
the current `supabase/migrations/` directory listing (086 is the highest existing file at spec time —
same directory-listing verification discipline migration 079's own header used).

```sql
-- B2B-27 — Card-on-File Required for Trial/Test-Mode Access
-- See docs/specs/B2B-27-requirement-document.md and the CEO Feature Brief
-- (.claude/agents/clio/feature-briefs/B2B-27-card-on-file-required-for-trial-access.md).
--
-- Additive only, mirrors migration 079's own DROP-then-ADD pattern against 077's
-- end_reason CHECK constraint. No new column, no new table: the enforcement signal
-- (partner_wallets.stripe_default_payment_method_id) already exists (migration 075).

ALTER TABLE partner_sessions DROP CONSTRAINT IF EXISTS partner_sessions_end_reason_check;
ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN (
    'trial_limit_reached', 'trial_exhausted', 'funding_required', 'card_required'
  ));

COMMENT ON COLUMN partner_sessions.end_reason IS
  'B2B-08/B2B-06/B2B-27: NULL for an ordinary partner-ended session; trial_limit_reached for a mid-session forced cutoff; trial_exhausted for a pre-dispatch test-mode rejection when the trial+test-block allowance is used up; funding_required for a pre-dispatch live-mode rejection with no card on file; card_required for a pre-dispatch test-mode rejection with no card on file (checked before the trial-minutes computation, B2B-27).';
```

### 6.2 `lib/stripe.ts` — new function `createCardVerificationCheckoutSession`

Added alongside the other B2B-04/08/13 Checkout-Session functions, following the file's established
`isPlaceholder`-guarded mock-log convention exactly. Uses Stripe Checkout's `mode: 'setup'` — Stripe's
own first-class primitive for "collect and save a card, charge nothing" (structurally cannot carry an
`amount`, so a $0 charge is not merely avoided but not expressible). This is a deliberate divergence
from the retired B2C embedded-Elements/`SetupIntent`-without-Checkout pattern at
`app/api/checkout/route.ts:135-139` (confirmed present in the repo, confirmed NOT reused or called into
by any code in this spec) — every live B2B billing function in this file already uses
`stripeClient.checkout.sessions.create(...)`, a hosted redirect flow, matching
`PaymentConfigClient.tsx`'s existing `window.location.href = data.checkout_url` pattern for every other
billing action.

```ts
/**
 * Card-on-file verification — Stripe Checkout, `mode: "setup"`. Proves a card
 * is valid and saves it for future off-session use; structurally cannot
 * charge anything (Checkout setup-mode sessions carry no `amount` field at
 * all). Requirement Doc Section 4.A/6.1 (B2B-27).
 *
 * Resolves/creates the Stripe Customer via getOrCreateStripeCustomer() FIRST
 * and persists stripe_customer_id onto partner_wallets before creating the
 * Checkout Session — required, not optional: the existing, unmodified
 * payment_method.attached webhook handler (app/api/webhooks/stripe/route.ts,
 * applyPaymentMethodToWallet) matches purely on
 * `.eq('stripe_customer_id', customerId)` and silently no-ops if no
 * partner_wallets row carries that customer ID yet.
 *
 * @param partnerAccountId - partner_accounts.id (stored in Checkout Session metadata)
 * @param successUrl - optional override for the post-verification redirect
 * @param cancelUrl - optional override for the cancel redirect
 * @returns Stripe Checkout URL
 */
export async function createCardVerificationCheckoutSession(
  partnerAccountId: string,
  successUrl?: string,
  cancelUrl?: string
): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const resolvedSuccess = successUrl ?? `${appUrl}/dashboard/admin/clients?card_verification=success`
  const resolvedCancel = cancelUrl ?? `${appUrl}/dashboard/admin/clients?card_verification=cancelled`

  const customerId = await getOrCreateStripeCustomer(partnerAccountId)

  if (isPlaceholder || !stripeClient) {
    console.log('[MOCK] createCardVerificationCheckoutSession', { partnerAccountId, customerId })
    return `${appUrl}/dashboard?mock_card_verification=1&partner_account_id=${partnerAccountId}`
  }

  const session = await stripeClient.checkout.sessions.create({
    mode: 'setup',
    payment_method_types: ['card'],
    customer: customerId,
    metadata: { partner_account_id: partnerAccountId, purpose: 'card_verification' },
    success_url: resolvedSuccess,
    cancel_url: resolvedCancel,
  })

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL for the card verification session.')
  }

  return session.url
}
```

**Note on placement:** this function must be declared after `getOrCreateStripeCustomer` in file order
(or TypeScript/JS hoisting makes this a non-issue for function declarations — either is fine; BA notes
it only so the dev agent doesn't second-guess ordering).

**No new webhook branch.** Resolved per the CEO brief's own Section 1 UX-polish question: the existing,
unmodified `payment_method.attached` handler (`app/api/webhooks/stripe/route.ts:548-556`) already
performs the only DB write this flow needs — it fires automatically the moment Stripe attaches a
payment method to a Customer, which happens as an intrinsic consequence of a completed `mode: 'setup'`
Checkout Session, independent of the `checkout.session.completed` event or any `metadata.purpose`
value. A dedicated `checkout.session.completed` branch for `purpose === 'card_verification'` would add
no correctness value (there is no additional field to write — unlike `wallet_topup`/`test_block_purchase`,
there is no dollar amount or minute count to credit) and no UX value beyond what the client-side
`card_verified=1` → live-status-recheck pattern (§4.B) already provides, which itself directly mirrors
the existing `funded=1` handler's own "never trust the URL param alone, re-verify against live state"
discipline. **Decision: do not add a webhook branch.**

### 6.3 `app/api/admin/billing/card-verification/route.ts` (NEW)

Identical shape and auth pattern to `app/api/admin/billing/checkout/route.ts` — Clerk-authenticated via
`requirePartnerAdmin`, the same pattern every sibling `/api/admin/billing/*` route uses.

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { createCardVerificationCheckoutSession } from '@/lib/stripe'

/**
 * POST /api/admin/billing/card-verification
 *
 * B2B-27 — zero-dollar card-on-file verification. Clerk-authenticated,
 * requires a partner_admin_users row for the target account (identical
 * authorization pattern to POST /api/admin/billing/checkout).
 */

const CardVerificationSchema = z.object({
  partner_account_id: z.string().uuid(),
  success_url: z.string().optional(),
  cancel_url: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = CardVerificationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  try {
    const checkoutUrl = await createCardVerificationCheckoutSession(
      parsed.data.partner_account_id,
      parsed.data.success_url,
      parsed.data.cancel_url
    )
    return NextResponse.json({ checkout_url: checkoutUrl }, { status: 201 })
  } catch (err) {
    console.error('[admin/billing/card-verification] Failed to create card verification checkout session:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }, { status: 502 })
  }
}
```

### 6.4 `app/api/partner/v1/sessions/route.ts` — new prerequisite check (MODIFIED)

Inserted at the top of the existing `if (auth.mode === 'test')` block
(`app/api/partner/v1/sessions/route.ts:153-201`), before the existing trial-minutes computation. The
existing `select()` call is extended with one more column (`stripe_default_payment_method_id`) rather
than adding a second query — a single round trip, not two.

```ts
// B2B-08 — trial/test-block gate check, test-mode keys only.
if (auth.mode === 'test') {
  const { data: wallet } = await supabase
    .from('partner_wallets')
    .select('trial_minutes_used, test_minutes_balance, stripe_default_payment_method_id')
    .eq('partner_account_id', auth.partnerAccountId)
    .maybeSingle()

  // B2B-27 — card-on-file prerequisite, checked BEFORE trial-minutes math.
  // A card is a hard prerequisite independent of remaining allowance — even a
  // full, fresh 20-minute trial is blocked with no card on file. No
  // grandfathering: applies to every account immediately, mirroring B2B-06's
  // live-mode funding guardrail's own unconditional rollout.
  if (!wallet?.stripe_default_payment_method_id) {
    await supabase
      .from('partner_sessions')
      .update({ status: 'failed', end_reason: 'card_required' })
      .eq('id', clioSessionRef)

    return NextResponse.json(
      {
        error: {
          code: 'card_required',
          message: 'Add a payment method to start testing. No charge — this only verifies the card is valid.',
        },
      },
      { status: 402 }
    )
  }

  const trialMinutesUsed = wallet ? Number(wallet.trial_minutes_used) : 0
  const testMinutesBalance = wallet ? Number(wallet.test_minutes_balance) : 0
  const availableMinutes = Math.max(0, 20 - trialMinutesUsed) + testMinutesBalance

  // ...unchanged trial_exhausted / dispatch logic below this point
```

### 6.5 `lib/partner/configurator-status.ts` — new helper `checkCardOnFile` (additive, NOT part of `ConfiguratorStatus`)

**Deliberately not added to the `ConfiguratorSection`/`ConfiguratorStatus` union.** `ConfiguratorStatus`
is a closed `Record<ConfiguratorSection, boolean>` (`lib/partner/configurator-sections.ts:20`) that
directly drives `VISIBLE_SECTIONS` (the Configurator nav's dots) and `GO_LIVE_REQUIRED_STEPS` (the
Go-Live gate). Card-on-file is neither a nav section nor a Go-Live requirement (§ resolved finding
below) — adding it to that union would require touching both lists for no reason and risks it being
mistaken for a Go-Live requirement later. Instead, a small standalone helper is added next to (not
inside) `getConfiguratorStatus()`, and the API route composes it separately.

```ts
/**
 * B2B-27 — true when a verified card is on file for this account
 * (partner_wallets.stripe_default_payment_method_id IS NOT NULL). This is
 * NOT the same signal as checkStepComplete('payment') (which reads
 * funding_mechanism, a committed funding path) — see Section 3 of the
 * Requirement Document for why these two signals are deliberately kept
 * separate. Deliberately not part of ConfiguratorStatus/ConfiguratorSection —
 * this is not a nav section or a Go-Live requirement, just a status flag the
 * Payment screen's new card-verification block reads directly.
 */
export async function checkCardOnFile(partnerAccountId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_wallets')
    .select('stripe_default_payment_method_id')
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()
  return !!data?.stripe_default_payment_method_id
}
```

(`createSupabaseAdminClient` is already imported in this file today via `checkStepComplete`'s
re-export path — `lib/partner/configurator-status.ts` currently imports only `checkStepComplete` and
the section constants, so this new helper needs its own `import { createSupabaseAdminClient } from
'@/lib/supabase'` line added to this file.)

### 6.6 `app/api/admin/configurator/status/route.ts` — additive response field (MODIFIED)

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getConfiguratorStatus, checkCardOnFile } from '@/lib/partner/configurator-status'

export async function GET(request: NextRequest) {
  const partnerAccountId = request.nextUrl.searchParams.get('partner_account_id')
  if (!partnerAccountId) {
    return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const [status, cardOnFile] = await Promise.all([
    getConfiguratorStatus(partnerAccountId),
    checkCardOnFile(partnerAccountId),
  ])
  return NextResponse.json({ ...status, card_on_file: cardOnFile })
}
```

`card_on_file` is an additive sibling field on the JSON response, not a new key inside the typed
`ConfiguratorStatus` object — no existing consumer of this endpoint (the Configurator nav dots,
`GoLivePanel`) reads or is affected by an unrecognized extra field.

### 6.7 `PaymentConfigClient.tsx` — new state + effects (MODIFIED, see §4.B for full behavior)

New local state: `cardOnFile: boolean | null` (initialized `null`), `cardReturnMessage: string | null`,
a `handledCardVerifiedRef` (mirrors the existing `handledFundedRef` pattern, kept separate). New
functions: `startCardVerification()` (mirrors `startCheckout()`), `cardVerificationUrls()` (mirrors
`successAndCancelUrls()`, returning `card_verified=1` instead of `funded=1`). Two new `useEffect`s: an
always-run mount-time status fetch (populates `cardOnFile` on first load, independent of any return
param), and a `card_verified=1` return handler (mirrors the existing `funded=1` effect exactly, kept
structurally separate per §4.B). The `busy` state (`useState<PlanTierKey | 'topup' | null>`) is widened
to `useState<PlanTierKey | 'topup' | 'card_verification' | null>` so the new action participates in the
same single-in-flight-action discipline the rest of this component already enforces.

---

## 7. Success Criteria (Acceptance Tests)

✓ Given a `test`-mode partner API key for an account with no `partner_wallets` row at all, when
`POST /api/partner/v1/sessions` is called, then the response is `402` with
`error.code === 'card_required'`, the inserted `partner_sessions` row has `status: 'failed'` and
`end_reason: 'card_required'`, and `dispatchMeetingBot()` is never invoked.

✓ Given a `test`-mode partner API key for an account with a `partner_wallets` row where
`stripe_default_payment_method_id IS NULL` and `trial_minutes_used = 0` (a full, fresh 20-minute
allowance), when `POST /api/partner/v1/sessions` is called, then the response is still `402
card_required` — a full trial balance never overrides the card prerequisite.

✓ Given a `test`-mode partner API key for an account where `stripe_default_payment_method_id` is set
and `trial_minutes_used = 0`, when `POST /api/partner/v1/sessions` is called, then the response is
`201`, `dispatchMeetingBot()` is invoked, and behavior is byte-for-byte identical to this endpoint's
pre-B2B-27 behavior (no regression to the existing trial-minutes path).

✓ Given a `test`-mode partner API key for an account where `stripe_default_payment_method_id` is set
but `trial_minutes_used = 20` and `test_minutes_balance = 0` (allowance exhausted), when
`POST /api/partner/v1/sessions` is called, then the response is `402 trial_exhausted` (unchanged
existing behavior) — `card_required` never fires once a card is on file.

✓ Given a `live`-mode partner API key/OAuth client, when `POST /api/partner/v1/sessions` is called,
then behavior is entirely unaffected by this brief — the new check only executes inside the
`auth.mode === 'test'` branch.

✓ Given a signed-in partner admin on `/dashboard/configurator?section=payment` for an account with no
card on file, when the page loads, then the new "Card verification" block renders State C2 ("Add a
card" button) after the initial status fetch resolves, and briefly shows "Checking…" before that.

✓ Given a signed-in partner admin clicks "Add a card", when `POST /api/admin/billing/card-verification`
is called, then a real (non-mock) Stripe environment returns a `checkout_url` for a Checkout Session
with `mode: 'setup'`, `customer` set to a resolved `partner_wallets.stripe_customer_id`, and
`metadata.purpose === 'card_verification'` — and the browser is redirected to that URL.

✓ Given `STRIPE_SECRET_KEY` is a `PLACEHOLDER_` value (mock mode), when
`POST /api/admin/billing/card-verification` is called, then no real Stripe call is attempted, a
`[MOCK] createCardVerificationCheckoutSession` line is logged, and a mock URL is returned with a `201`.

✓ Given a completed `mode: 'setup'` Checkout Session in a real Stripe environment, when Stripe fires
`payment_method.attached` for the resulting payment method, then the existing, unmodified
`applyPaymentMethodToWallet()` handler sets `partner_wallets.stripe_default_payment_method_id` for the
row matching that `stripe_customer_id` — with no new webhook code required for this brief.

✓ Given a partner returns to `/dashboard/configurator?...&section=payment&card_verified=1` after a
successful verification, when the page loads, then it re-fetches
`/api/admin/configurator/status`, sets the card-verification block to State C3 ("✓ Card on file —
testing unlocked."), and strips `card_verified` from the URL via `router.replace`.

✓ Given a partner returns with `card_verified=1` but the live status check still shows
`card_on_file: false` (webhook not yet landed), when the page loads, then the card-verification block
remains in State C2 and the message "We couldn't confirm your card yet..." is shown, matching the
existing `funded=1` handler's own unconfirmed-return behavior.

✓ Given `checkStepComplete(partnerAccountId, 'payment')` (reads `funding_mechanism`) and
`checkCardOnFile(partnerAccountId)` (reads `stripe_default_payment_method_id`) for the same account
where only a bare card verification has occurred (no Plan/top-up ever purchased), when both are called,
then `checkStepComplete('payment')` returns `false` and `checkCardOnFile` returns `true` — confirming
the two signals remain independent, and `GoLivePanel`'s required "Payment" checklist item is
unaffected by a bare card verification.

✓ Given `GET /api/admin/configurator/status` is called for any account, when the response is parsed,
then it includes both the existing seven `ConfiguratorStatus` keys (unchanged shape) and a new
`card_on_file: boolean` sibling field — and `GoLivePanel.tsx`'s existing `status.integration`/
`status.payment` reads are unaffected by the new field's presence.

---

## 8. Error States

| Trigger | User/partner-visible behavior |
|---|---|
| `test`-mode session requested, no card on file | `402 card_required`; `partner_sessions.status = 'failed'`; no vendor dispatch (§7) |
| `POST /api/admin/billing/card-verification` called with an invalid/missing `partner_account_id` | `422` Zod validation error (`Validation failed` + `details`), identical shape to `POST /api/admin/billing/checkout`'s existing validation failure |
| `POST /api/admin/billing/card-verification` called by a Clerk user who does not administer the target account | `403` via `requirePartnerAdmin`'s existing `forbidden` envelope, unchanged pattern |
| `POST /api/admin/billing/card-verification` called while signed out | `401` via `requirePartnerAdmin`'s existing `Unauthorized` response, unchanged pattern |
| Stripe Checkout Session creation throws (network/API error) | `502 { error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }` — identical pattern/status to `POST /api/admin/billing/checkout`'s own catch block |
| Partner cancels the Stripe Checkout page | Redirected to `cancel_url` (no `card_verified` param) — the Payment section renders unchanged, still State C2, no error message shown (mirrors the existing Plan/top-up cancel behavior — a cancel is not an error) |
| `GET /api/admin/configurator/status` fails/network error on initial mount | `cardOnFile` stays `null`; the block shows `"Checking…"` indefinitely until the next successful poll or page reload — no crash, no thrown error surfaced to the user (mirrors this component's existing `catch {}` discipline on its other `fetch` calls) |
| Webhook (`payment_method.attached`) delayed past the Stripe redirect | Handled by the existing unconfirmed-return message (§7, §4.B) — never a hard error, always a "check again shortly" message |

---

## 9. Edge Cases

1. **Card already on file, partner clicks a Plan/top-up checkout anyway.** Unaffected — those flows are
   independent of `stripe_default_payment_method_id` and continue to work exactly as they do today; a
   partner may still choose to fund a wallet by top-up/Plan/invoice even after (or without) a bare card
   verification. `funding_mechanism` and `stripe_default_payment_method_id` remain two independent
   signals (§7's dedicated acceptance test).

2. **Partner completes card verification, then later purchases a Plan or top-up.** The subsequent
   Checkout Session (a different flow, different `metadata.purpose`) may attach a *different* default
   payment method via its own `payment_method.attached` event, silently overwriting
   `stripe_default_payment_method_id` with the newer card. This is existing, pre-B2B-27 behavior
   (`applyPaymentMethodToWallet` has always unconditionally overwritten this column on any attach event
   for the matching customer) — not a new risk introduced by this brief, and out of scope to change.

3. **A partner with an existing Plan subscription or top-up history (and therefore already a card on
   file from that purchase) has never seen the new "Card verification" block before.** On next load,
   `checkCardOnFile` reads `true` immediately (their prior purchase already set
   `stripe_default_payment_method_id` via the same `payment_method.attached` handler) — the block
   renders directly in State C3 with no action needed. This also means such accounts were **never
   actually blocked** by the new `test`-mode gate even before ever seeing the new UI, since the
   underlying signal predates this brief for them.

4. **No mechanism anywhere in this codebase ever clears `stripe_default_payment_method_id`.** Confirmed
   by direct grep — no `payment_method.detached` handler exists, and no code path sets this column back
   to `null`. Once true, `checkCardOnFile` returns `true` permanently for that account, even if the
   underlying card is later expired, disputed, or removed in Stripe's dashboard directly. This is a
   pre-existing gap (the same gap already latent in B2B-06's live-mode guardrail, which reads the exact
   same column) — not introduced or worsened by this brief, and explicitly out of scope per the CEO
   brief's own instruction not to conflate this brief with fixing pre-existing, unrelated gaps.

5. **Mock mode (`STRIPE_SECRET_KEY` placeholder) end-to-end.** `createCardVerificationCheckoutSession`
   logs and returns a mock URL, but no code path in mock mode ever sets
   `stripe_default_payment_method_id` (there is no real Stripe webhook to fire it) — so a `test`-mode
   session dispatch will still return `402 card_required` even after "completing" a mock card
   verification. This mirrors the exact same limitation every other mock-mode Checkout function in
   `lib/stripe.ts` already has (e.g. a mock wallet top-up never actually credits `balance_usd` either,
   since that also only happens via the real webhook) — not a new gap, and not this brief's job to
   solve. Noted here so a developer testing locally without real Stripe keys is not confused by
   `card_required` persisting after a "successful" mock redirect.

6. **A sales-partner's client (`account_kind='partner'`, `owning_channel_partner_id` set, zero
   `partner_admin_users` per B2B-26) is issued a `test`-mode API key before any human can log in to add
   a card for it.** The server-side gate (§4.A, §6.4) applies identically — `partner_sessions` rows are
   keyed by `partner_account_id` regardless of `account_kind`, so such a client is blocked exactly like
   any other account with no card on file. There is currently no UI path for anyone to clear this block
   for a client account (clients have no login today, per B2B-26 §1) — this is a real, present
   limitation, but it is the same pre-existing "clients have no login yet" gap B2B-26 already
   documented and explicitly deferred, not a new gap this brief introduces. Once a future brief gives
   clients their own Payment surface (reusing `PaymentConfigClient`, keyed by `partner_account_id` per
   B2B-26 §4's own stated reuse plan), this mechanism extends to them automatically with zero
   additional work — nothing in `lib/stripe.ts`, the sessions route, or the status endpoint is
   `account_kind`-aware or needs to become so.

7. **Two tabs/requests racing to call `POST /api/admin/billing/card-verification` for the same
   account.** Each call independently resolves/creates a Stripe Customer via `getOrCreateStripeCustomer`
   (idempotent — it reads `partner_wallets.stripe_customer_id` first and only creates one if absent) and
   creates its own Checkout Session. Both sessions are valid; whichever the partner completes first sets
   `stripe_default_payment_method_id`. No data corruption risk — this mirrors the existing, unaddressed
   concurrency behavior of every other Checkout-Session-creating admin route in this file already.

8. **Mobile viewport on `/dashboard/configurator?section=payment`.** The new block reuses the existing
   `<Card>` component with no new fixed-width styling — it stacks in the same single-column flow every
   other block in this file already uses inside the fluid `ConfiguratorShell`/embedded container. No
   `clamp()`-based typography or spacing work is introduced or required (per the CEO brief's own
   assessment, confirmed correct on direct inspection of the existing file's layout — every block here
   already wraps/stacks correctly at narrow widths with `flexWrap: 'wrap'` already in place on the
   sibling sections).

---

## 10. Out of Scope

- Fixing the pre-existing inconsistency between `checkStepComplete('payment')`
  (`funding_mechanism`-based) and the B2B-06 live-mode dispatch guardrail
  (`stripe_default_payment_method_id`-based) — a real gap, found during investigation, explicitly
  scoped out by the CEO brief. Noted here for future awareness only.
- Any change to `GoLivePanel.tsx` or `checkStepComplete`'s `'payment'` case — both are confirmed
  unmodified by this brief (§6.5, §9 Edge Case 1's acceptance test).
- Clearing/re-verifying a card once set (§9 Edge Case 4) — no `payment_method.detached` handling, no
  "remove card" UI action. Out of scope; a pre-existing gap this brief does not worsen.
- Any change to the `live`-mode session-dispatch path (`app/api/partner/v1/sessions/route.ts:206-227`)
  — the new check is strictly scoped to `auth.mode === 'test'`, per Arun's own explicit framing
  ("trial," not "going live").
- Any client-facing (sales-partner client) card-verification UI — clients have no login today (B2B-26),
  this is a pre-existing, separately-tracked gap (§9 Edge Case 6).
- Displaying card brand/last4 in the new "Card verification" block — the block shows only a boolean
  on-file confirmation, matching the literal minimum this brief needs; the existing internal admin
  clients list (`app/api/admin/billing/clients/route.ts`) already exposes brand/last4 elsewhere if ever
  needed.
- Any change to `createTestBlockCheckoutSession` or its (already-documented, pre-existing,
  B2B-08-scoped) unwired-route gap — unrelated purchase flow, untouched by this brief.
- Sales-partner-level billing (B2B-28) — entirely separate, unrelated brief.

---

## 11. Open Questions

None.

---

## 12. Dependencies

- `partner_wallets.stripe_default_payment_method_id` (migration 075) — already exists, no change
  required.
- The existing, unmodified `payment_method.attached` webhook handler
  (`app/api/webhooks/stripe/route.ts:548-556`, `applyPaymentMethodToWallet`) — must remain wired exactly
  as-is; this brief's correctness depends on it, adds no code to it.
- `getOrCreateStripeCustomer()` (`lib/stripe.ts:381-414`) — reused verbatim, no changes.
- `requirePartnerAdmin()` (`lib/partner/auth.ts:214`) — reused verbatim for the new admin route's auth,
  no changes. (Note: `lib/partner/auth.ts` also contains the unrelated, separately-tracked B2B-26
  `requireChannelPartnerAdmin()` — not used by this brief, cited only to confirm no naming collision.)
  Its signature is unaffected by any pending B2B-26 chokepoint work on the same file: this brief's use
  of `requirePartnerAdmin(partnerAccountId)` matches the identical call shape already live in
  `app/api/admin/billing/checkout/route.ts`.
- `checkStepComplete` / `ConfiguratorStatus` / `VISIBLE_SECTIONS` / `GO_LIVE_REQUIRED_STEPS`
  (`lib/partner/wizard.ts`, `lib/partner/configurator-sections.ts`) — read-only dependency, confirmed
  unmodified by this brief (§6.5, §10).
- Migration numbering: this spec claims `087_b2b27_card_verification.sql` as the next-free number
  against the directory listing at spec time (086 highest). If a concurrent in-flight brief also claims
  087 before this one is built, the dev agent should follow this project's existing file-mtime
  tie-break convention (the same one that resolved this brief's own B2B-27/B2B-28 ID collision) rather
  than guessing.
