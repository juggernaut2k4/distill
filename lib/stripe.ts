import Stripe from 'stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'

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

export { stripeClient as stripe }
