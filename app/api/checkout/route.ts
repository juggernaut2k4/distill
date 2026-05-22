import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

const CheckoutSchema = z.object({
  plan: z.enum(['free', 'starter', 'pro', 'executive']),
  billingPeriod: z.enum(['monthly', 'annual']).default('monthly'),
})

const PRICE_ID_MAP: Record<string, Record<string, string | undefined>> = {
  starter: {
    monthly: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
    annual: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID,
  },
  pro: {
    monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
  },
  executive: {
    monthly: process.env.STRIPE_EXECUTIVE_MONTHLY_PRICE_ID,
    annual: process.env.STRIPE_EXECUTIVE_ANNUAL_PRICE_ID,
  },
}

const isStripeConfigured =
  process.env.STRIPE_SECRET_KEY &&
  !process.env.STRIPE_SECRET_KEY.startsWith('PLACEHOLDER_')

/**
 * POST /api/checkout
 * Free plan: activates directly in Supabase, returns checkoutUrl.
 * Paid plans: creates Stripe customer + SetupIntent, returns clientSecret
 * for the embedded PaymentElement on the checkout page.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  try {
    const body = await request.json()
    const parsed = CheckoutSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { plan, billingPeriod } = parsed.data
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'

    // ── Free plan: activate directly, no Stripe ──────────────────────────────
    if (plan === 'free') {
      const supabase = createSupabaseAdminClient()
      await supabase
        .from('users')
        .update({
          plan_tier: 'free',
          subscription_status: 'active',
          minutes_included: 5,
          minutes_balance: 5,
        })
        .eq('id', userId!)

      return NextResponse.json({ checkoutUrl: `${appUrl}/dashboard/welcome` })
    }

    // ── Dev / mock mode ──────────────────────────────────────────────────────
    if (!isStripeConfigured) {
      console.log('[checkout] MOCK — activating without Stripe:', plan)
      const supabase = createSupabaseAdminClient()
      await supabase
        .from('users')
        .update({ plan_tier: plan, subscription_status: 'trialing' })
        .eq('id', userId!)

      return NextResponse.json({ checkoutUrl: `${appUrl}/dashboard/welcome`, mock: true })
    }

    // ── Paid plan: create SetupIntent for embedded checkout ──────────────────
    const priceId = PRICE_ID_MAP[plan]?.[billingPeriod]
    if (!priceId || priceId.startsWith('PLACEHOLDER_')) {
      return NextResponse.json(
        { error: 'Payment is not configured yet. Please contact support.' },
        { status: 503 }
      )
    }

    const { stripe } = await import('@/lib/stripe')
    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
    }
    const supabase = createSupabaseAdminClient()

    const { data: user } = await supabase
      .from('users')
      .select('email, stripe_customer_id, stripe_subscription_id, subscription_status')
      .eq('id', userId!)
      .single()

    // Already subscribed — send to dashboard
    if (
      user?.stripe_subscription_id &&
      (user.subscription_status === 'trialing' || user.subscription_status === 'active')
    ) {
      return NextResponse.json({ alreadyActive: true })
    }

    // Get or create Stripe customer
    let customerId = user?.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user?.email ?? undefined,
        metadata: { userId: userId! },
      })
      customerId = customer.id
      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId!)
    }

    // Create SetupIntent — payment method will be saved and billed after trial
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      metadata: { userId: userId!, plan, billingPeriod },
    })

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      customerId,
    })
  } catch (err) {
    const e = err as { type?: string; code?: string; message?: string }
    console.error('[checkout-error]', e?.type, e?.code, e?.message)
    return NextResponse.json(
      { error: 'Failed to initialize checkout. Please try again.' },
      { status: 500 }
    )
  }
}
