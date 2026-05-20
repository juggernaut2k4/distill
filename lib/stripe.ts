import Stripe from 'stripe'

const isPlaceholder = !process.env.STRIPE_SECRET_KEY ||
  process.env.STRIPE_SECRET_KEY.startsWith('PLACEHOLDER_')

// Initialize Stripe client — uses real key in production, mock in dev without key
const stripeClient = isPlaceholder
  ? null
  : new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-02-24.acacia',
    })

/**
 * Maps a Stripe price ID to the plan tier name.
 * Map is built lazily at call time so env vars set after module load are respected.
 * @param priceId - Stripe price ID
 * @returns Plan tier or 'unknown' if not found
 */
export function getPlanFromPriceId(priceId: string): 'starter' | 'pro' | 'executive' | 'unknown' {
  const priceToplan: Record<string, 'starter' | 'pro' | 'executive'> = {
    [process.env.STRIPE_STARTER_MONTHLY_PRICE_ID ?? '']: 'starter',
    [process.env.STRIPE_STARTER_ANNUAL_PRICE_ID ?? '']: 'starter',
    [process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? '']: 'pro',
    [process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? '']: 'pro',
    [process.env.STRIPE_EXECUTIVE_MONTHLY_PRICE_ID ?? '']: 'executive',
    [process.env.STRIPE_EXECUTIVE_ANNUAL_PRICE_ID ?? '']: 'executive',
  }
  return priceToplan[priceId] ?? 'unknown'
}

/**
 * Creates a Stripe Checkout Session for subscription with 7-day trial.
 * @param userId - Clerk user ID (stored in Stripe metadata)
 * @param priceId - Stripe price ID for the selected plan
 * @returns Stripe checkout URL
 */
export async function createCheckoutSession(
  userId: string,
  priceId: string,
  successUrl?: string
): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
  const resolvedSuccess = successUrl ?? `${appUrl}/dashboard/welcome`

  if (isPlaceholder || !stripeClient) {
    console.error('[stripe] STRIPE_SECRET_KEY not configured — cannot create checkout session')
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in environment variables.')
  }

  const session = await stripeClient.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 3,
      metadata: { userId },
    },
    metadata: { userId },
    success_url: resolvedSuccess,
    cancel_url: `${appUrl}/pricing`,
  })

  return session.url!
}

/**
 * Creates a Stripe Customer Portal session for billing management.
 * @param customerId - Stripe customer ID
 * @returns Stripe customer portal URL
 */
export async function createPortalSession(customerId: string): Promise<string> {
  if (isPlaceholder || !stripeClient) {
    console.log('[MOCK] createPortalSession', { customerId })
    return `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?mock=1`
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
  const session = await stripeClient.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/dashboard/billing`,
  })

  return session.url
}

/**
 * Verifies and constructs a Stripe webhook event from the raw request body.
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

/**
 * Creates a Stripe subscription with a 3-day trial and returns the pending
 * SetupIntent client_secret for Stripe Elements to collect card details.
 * @param userId - Clerk user ID (stored in metadata)
 * @param priceId - Stripe price ID
 * @param email - User email for customer record
 * @param existingCustomerId - Reuse customer if already created
 */
export async function createSubscriptionIntent(
  userId: string,
  priceId: string,
  email?: string,
  existingCustomerId?: string | null
): Promise<{ clientSecret: string; customerId: string; subscriptionId: string }> {
  if (isPlaceholder || !stripeClient) {
    throw new Error('Stripe is not configured.')
  }

  let customerId = existingCustomerId ?? undefined

  if (!customerId) {
    const customer = await stripeClient.customers.create({
      ...(email ? { email } : {}),
      metadata: { userId },
    })
    customerId = customer.id
  }

  const subscription = await stripeClient.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    trial_period_days: 3,
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['pending_setup_intent'],
    metadata: { userId },
  })

  const setupIntent = subscription.pending_setup_intent as Stripe.SetupIntent | null
  if (!setupIntent?.client_secret) {
    throw new Error('Stripe did not return a pending setup intent for the trial subscription.')
  }

  return {
    clientSecret: setupIntent.client_secret,
    customerId,
    subscriptionId: subscription.id,
  }
}

export { stripeClient as stripe }
