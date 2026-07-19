import Stripe from 'stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getPlanTier, type PlanBillingPeriod, type PlanTierKey } from '@/lib/billing/plan-tiers'

const isPlaceholder = !process.env.STRIPE_SECRET_KEY ||
  process.env.STRIPE_SECRET_KEY.startsWith('PLACEHOLDER_')

// Initialize Stripe client — uses real key in production, mock in dev without key
const stripeClient = isPlaceholder
  ? null
  : new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-02-24.acacia',
    })

/**
 * Creates a Stripe Customer Portal session for billing management.
 * Retained as-is (architecture.md §13.4) — repurposed for partner
 * card-on-file self-service; its signature already only takes a customerId,
 * no B2C assumption baked in.
 * @param customerId - Stripe customer ID
 * @returns Stripe customer portal URL
 */
// Currently unused (no live caller) — sole caller app/api/portal/route.ts was removed under
// B2B-14 (dead B2C dashboard cleanup); return_url below also pointed at the now-deleted
// /dashboard/billing. Left in place pending a future cleanup pass, not this brief's scope.
export async function createPortalSession(customerId: string): Promise<string> {
  if (isPlaceholder || !stripeClient) {
    console.log('[MOCK] createPortalSession', { customerId })
    return `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?mock=1`
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const session = await stripeClient.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/dashboard/billing`,
  })

  return session.url
}

/**
 * Verifies and constructs a Stripe webhook event from the raw request body.
 * Retained as-is (architecture.md §13.4) — explicitly named reusable
 * infrastructure.
 * @param body - Raw request body as string
 * @param signature - Stripe-Signature header value
 * @returns Stripe event object or null if verification fails
 */
export function constructWebhookEvent(
  body: string,
  signature: string
): Stripe.Event | null {
  if (isPlaceholder || !stripeClient) {
    console.log('[MOCK] constructWebhookEvent called')
    return null
  }

  try {
    return stripeClient.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch {
    return null
  }
}

// ─── B2B-04 — Billing / Metering (architecture.md §13.4) ─────────────────────
// All four functions below follow the existing isPlaceholder-guarded mock-log
// pattern used throughout this file — no real Stripe call is attempted
// without a real STRIPE_SECRET_KEY.

/**
 * Self-serve wallet top-up — Stripe Checkout, `mode: "payment"`, an ad-hoc
 * `price_data` line item (no pre-created Stripe Price object needed).
 * Requirement Doc Section 5.B.2 / 4.B.3.
 * @param partnerAccountId - partner_accounts.id (stored in Checkout Session metadata)
 * @param amountUsd - top-up amount in whole/fractional USD dollars (converted to cents for Stripe)
 * @param successUrl - optional override for the post-payment redirect
 * @param cancelUrl - optional override for the cancel redirect
 * @returns Stripe Checkout URL
 */
export async function createWalletTopupCheckoutSession(
  partnerAccountId: string,
  amountUsd: number,
  successUrl?: string,
  cancelUrl?: string
): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const resolvedSuccess = successUrl ?? `${appUrl}/dashboard/admin/clients?topup=success`
  const resolvedCancel = cancelUrl ?? `${appUrl}/dashboard/admin/clients?topup=cancelled`

  if (isPlaceholder || !stripeClient) {
    console.log('[MOCK] createWalletTopupCheckoutSession', { partnerAccountId, amountUsd })
    return `${appUrl}/dashboard?mock_wallet_topup=1&partner_account_id=${partnerAccountId}&amount_usd=${amountUsd}`
  }

  const session = await stripeClient.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_creation: 'always',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: 'Clio wallet top-up' },
          unit_amount: Math.round(amountUsd * 100),
        },
        quantity: 1,
      },
    ],
    metadata: { partner_account_id: partnerAccountId, purpose: 'wallet_topup' },
    success_url: resolvedSuccess,
    cancel_url: resolvedCancel,
  })

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL for the wallet top-up session.')
  }

  return session.url
}

/**
 * Mid-market auto-recharge — Stripe Checkout, `mode: "subscription"`, an
 * ad-hoc recurring `price_data` line item. Requirement Doc Section 5.B.3 /
 * 4.B.4: this is Stripe's own supported primitive for "set up a recurring
 * charge with card collection" (a hosted, PCI-scope-free page), not the raw
 * Subscriptions API directly.
 * @param partnerAccountId - partner_accounts.id (stored in Checkout Session metadata)
 * @param monthlyMinimumUsd - recurring monthly charge amount in USD dollars
 * @param successUrl - optional override for the post-setup redirect
 * @param cancelUrl - optional override for the cancel redirect
 * @returns Stripe Checkout URL
 */
export async function createAutoRechargeSubscriptionCheckout(
  partnerAccountId: string,
  monthlyMinimumUsd: number,
  successUrl?: string,
  cancelUrl?: string
): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const resolvedSuccess = successUrl ?? `${appUrl}/dashboard/admin/clients?autorecharge=success`
  const resolvedCancel = cancelUrl ?? `${appUrl}/dashboard/admin/clients?autorecharge=cancelled`

  if (isPlaceholder || !stripeClient) {
    console.log('[MOCK] createAutoRechargeSubscriptionCheckout', { partnerAccountId, monthlyMinimumUsd })
    return `${appUrl}/dashboard?mock_auto_recharge=1&partner_account_id=${partnerAccountId}&monthly_minimum_usd=${monthlyMinimumUsd}`
  }

  const session = await stripeClient.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: 'Clio wallet auto-recharge' },
          recurring: { interval: 'month' },
          unit_amount: Math.round(monthlyMinimumUsd * 100),
        },
        quantity: 1,
      },
    ],
    metadata: { partner_account_id: partnerAccountId, purpose: 'wallet_auto_recharge' },
    success_url: resolvedSuccess,
    cancel_url: resolvedCancel,
  })

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL for the auto-recharge session.')
  }

  return session.url
}

/**
 * Enterprise invoicing — invoiceItems.create + invoices.create + finalize +
 * (send if collection_method is send_invoice). Requirement Doc Section
 * 5.B.4 / 4.B.5.
 * @param partnerAccountId - partner_accounts.id (stored in Invoice metadata)
 * @param amountUsd - invoice amount in USD dollars
 * @param stripeCustomerId - resolve via getOrCreateStripeCustomer() first
 * @param description - line-item description shown on the invoice
 * @param collectionMethod - 'send_invoice' (email the partner) or 'charge_automatically' (charge the card/bank on file)
 */
export async function createEnterpriseInvoice(
  partnerAccountId: string,
  amountUsd: number,
  stripeCustomerId: string,
  description: string,
  collectionMethod: 'send_invoice' | 'charge_automatically'
): Promise<{ invoiceId: string; hostedInvoiceUrl: string | null }> {
  if (isPlaceholder || !stripeClient) {
    const mockId = `in_mock_${Date.now()}`
    console.log('[MOCK] createEnterpriseInvoice', { partnerAccountId, amountUsd, description, collectionMethod })
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
    return { invoiceId: mockId, hostedInvoiceUrl: `${appUrl}/dashboard?mock_invoice=${mockId}` }
  }

  await stripeClient.invoiceItems.create({
    customer: stripeCustomerId,
    amount: Math.round(amountUsd * 100),
    currency: 'usd',
    description,
  })

  const invoice = await stripeClient.invoices.create({
    customer: stripeCustomerId,
    collection_method: collectionMethod,
    auto_advance: collectionMethod === 'charge_automatically',
    metadata: { partner_account_id: partnerAccountId, purpose: 'wallet_invoice' },
  })

  if (!invoice.id) {
    throw new Error('Stripe did not return an invoice id.')
  }

  const finalized = await stripeClient.invoices.finalizeInvoice(invoice.id)

  if (collectionMethod === 'send_invoice') {
    await stripeClient.invoices.sendInvoice(finalized.id)
  }

  return { invoiceId: finalized.id, hostedInvoiceUrl: finalized.hosted_invoice_url ?? null }
}

// ─── B2B-08 — Testing / Metering (architecture.md §15.3) ─────────────────────

/**
 * Purchases one fixed 120-minute test block — Stripe Checkout, `mode:
 * "payment"`, one ad-hoc fixed line item ($1.80, no Stripe Price object,
 * nothing partner-configurable). `setup_future_usage: "off_session"` is the
 * one deliberate difference from `createWalletTopupCheckoutSession` — it
 * instructs Stripe to save the payment method for reuse (Requirement
 * Document, Interaction with B2B-06). `customer_creation: "always"` (reused,
 * unchanged) guarantees a `session.customer` is always present for the
 * webhook handler to persist.
 * @param partnerAccountId - partner_accounts.id (stored in Checkout Session metadata)
 * @param successUrl - optional override for the post-payment redirect
 * @param cancelUrl - optional override for the cancel redirect
 * @returns Stripe Checkout URL
 */
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

// ─── B2B-13 — Recurring Plan Tiers (docs/specs/B2B-13-requirement-document.md) ─

/**
 * Recurring Plan subscription checkout — Stripe Checkout, `mode:
 * "subscription"`, referencing a real, pre-created Stripe Price (resolved
 * from the tier's env var) rather than ad-hoc `price_data`. This is the
 * first function in this file to do so — no `stripe.products.create` /
 * `stripe.prices.create` call anywhere; Arun creates the real Products/
 * Prices himself and sets the env vars (Requirement Doc Section 6.C/10).
 *
 * Sets metadata in two places:
 *  - `subscription_data.metadata` — copied onto the created Subscription
 *    object verbatim by Stripe, read by the `customer.subscription.updated`/
 *    `.deleted` webhook cases to identify a Plan subscription.
 *  - top-level Checkout Session `metadata` — read by the
 *    `checkout.session.completed` webhook branch (added in v1.1 specifically
 *    so that handler has data to write onto `partner_wallets` at checkout
 *    time; `subscription_data.metadata` alone is never visible on the
 *    Session, only on the Subscription).
 *
 * Guarded by two independent placeholder checks: the existing module-level
 * `isPlaceholder` (missing/placeholder STRIPE_SECRET_KEY) and a new per-call
 * check that the resolved Price ID env var is itself still `PLACEHOLDER_`-
 * prefixed — Arun may set a real STRIPE_SECRET_KEY before creating the real
 * Plan Products/Prices, and this function must still mock cleanly in that
 * state. Either guard being true logs `[MOCK]` and returns a mock URL.
 *
 * @param partnerAccountId - partner_accounts.id (stored in both metadata locations)
 * @param planTierKey - 'starter' | 'growth' (lib/billing/plan-tiers.ts PLAN_TIERS key)
 * @param billingPeriod - 'monthly' | 'annual'
 * @param successUrl - optional override for the post-checkout redirect
 * @param cancelUrl - optional override for the cancel redirect
 * @returns Stripe Checkout URL
 */
export async function createPlanSubscriptionCheckout(
  partnerAccountId: string,
  planTierKey: PlanTierKey,
  billingPeriod: PlanBillingPeriod,
  successUrl?: string,
  cancelUrl?: string
): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const resolvedSuccess = successUrl ?? `${appUrl}/dashboard/admin/clients?plan=success`
  const resolvedCancel = cancelUrl ?? `${appUrl}/dashboard/admin/clients?plan=cancelled`

  const tier = getPlanTier(planTierKey)
  if (!tier) {
    throw new Error(`createPlanSubscriptionCheckout: unrecognized plan_tier_key "${planTierKey}"`)
  }

  const priceIdEnvVarName = billingPeriod === 'annual' ? tier.stripePriceIdAnnualEnvVar : tier.stripePriceIdMonthlyEnvVar
  const priceId = process.env[priceIdEnvVarName]
  const priceIdIsPlaceholder = !priceId || priceId.startsWith('PLACEHOLDER_')

  if (isPlaceholder || !stripeClient || priceIdIsPlaceholder) {
    console.log('[MOCK] createPlanSubscriptionCheckout', { partnerAccountId, planTierKey, billingPeriod })
    return `${appUrl}/dashboard?mock_plan_subscription=1&partner_account_id=${partnerAccountId}&plan_tier_key=${planTierKey}&plan_billing_period=${billingPeriod}`
  }

  const metadata = {
    partner_account_id: partnerAccountId,
    purpose: 'plan_subscription',
    plan_tier_key: planTierKey,
    plan_billing_period: billingPeriod,
  }

  const session = await stripeClient.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata },
    // (Added in v1.1, necessary consequence of the webhook correlation fix —
    // see docs/specs/B2B-13-requirement-document.md Section 6.C.) Makes
    // session.metadata readable inside checkout.session.completed, which
    // subscription_data.metadata alone would not be.
    metadata,
    success_url: resolvedSuccess,
    cancel_url: resolvedCancel,
  })

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL for the plan subscription session.')
  }

  return session.url
}

/**
 * Finds an existing `partner_wallets.stripe_customer_id` or creates one.
 * Requirement Doc Section 5.B.4's invoicing flow and the self-serve/
 * mid-market flows all resolve through this so a partner never accumulates
 * more than one Stripe Customer object.
 * @param partnerAccountId - partner_accounts.id (stored in Customer metadata)
 * @param billingEmail - optional email to attach to a newly-created customer
 * @returns Stripe customer id (real or mock)
 */
export async function getOrCreateStripeCustomer(partnerAccountId: string, billingEmail?: string): Promise<string> {
  const supabase = createSupabaseAdminClient()

  const { data: wallet } = await supabase
    .from('partner_wallets')
    .select('stripe_customer_id')
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  if (wallet?.stripe_customer_id) {
    return wallet.stripe_customer_id as string
  }

  let customerId: string

  if (isPlaceholder || !stripeClient) {
    customerId = `cus_mock_${partnerAccountId.slice(0, 8)}`
    console.log('[MOCK] getOrCreateStripeCustomer', { partnerAccountId, customerId })
  } else {
    const customer = await stripeClient.customers.create({
      ...(billingEmail ? { email: billingEmail } : {}),
      metadata: { partner_account_id: partnerAccountId },
    })
    customerId = customer.id
  }

  // Lazily creates the wallet row if none exists yet — mirrors the RPCs'
  // own ON CONFLICT DO UPDATE lazy-creation convention (architecture.md §13.1).
  await supabase
    .from('partner_wallets')
    .upsert({ partner_account_id: partnerAccountId, stripe_customer_id: customerId }, { onConflict: 'partner_account_id' })

  return customerId
}

// ─── B2B-27 — Card-on-File Required for Trial/Test-Mode Access ───────────────

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

export { stripeClient as stripe }
