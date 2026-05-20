import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSubscriptionIntent } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'

const CheckoutSchema = z.object({
  plan: z.enum(['free', 'starter', 'pro', 'executive']),
  billingPeriod: z.enum(['monthly', 'annual']).default('monthly'),
})

const PRICE_ID_MAP: Record<string, Record<string, string | undefined>> = {
  free: {
    monthly: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
    annual: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
  },
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
 * Creates a Stripe subscription intent for Stripe Elements custom checkout.
 * Returns clientSecret for the pending SetupIntent (3-day trial flow).
 * Dev mode: activates plan directly in DB and returns checkoutUrl.
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
    const resolvedPlan = plan === 'free' ? 'starter' : plan
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'

    // ── Dev / mock mode ─────────────────────────────────────────────────────
    if (!isStripeConfigured) {
      console.log('[checkout] MOCK mode — activating plan without Stripe:', resolvedPlan)
      const supabase = createSupabaseAdminClient()
      await supabase
        .from('users')
        .update({
          plan_tier: resolvedPlan,
          subscription_status: 'trialing',
        })
        .eq('id', userId!)

      return NextResponse.json({ checkoutUrl: `${appUrl}/dashboard/welcome`, mock: true })
    }

    // ── Production: Stripe Elements flow ────────────────────────────────────
    const priceId = PRICE_ID_MAP[resolvedPlan]?.[billingPeriod]

    if (!priceId || priceId.startsWith('PLACEHOLDER_')) {
      return NextResponse.json(
        { error: 'Payment is not configured yet. Please contact support.' },
        { status: 503 }
      )
    }

    const supabase = createSupabaseAdminClient()

    // Look up user for email + existing customer ID
    const { data: user } = await supabase
      .from('users')
      .select('email, stripe_customer_id, stripe_subscription_id, subscription_status')
      .eq('id', userId!)
      .single()

    // Reuse existing trialing subscription if present
    if (user?.stripe_subscription_id && user?.subscription_status === 'trialing') {
      const Stripe = (await import('stripe')).default
      const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2025-02-24.acacia',
      })
      const sub = await stripeClient.subscriptions.retrieve(
        user.stripe_subscription_id,
        { expand: ['pending_setup_intent'] }
      )
      const existingIntent = sub.pending_setup_intent as { client_secret?: string } | null
      if (existingIntent?.client_secret) {
        return NextResponse.json({ clientSecret: existingIntent.client_secret })
      }
    }

    const { clientSecret, customerId } = await createSubscriptionIntent(
      userId!,
      priceId,
      user?.email ?? undefined,
      user?.stripe_customer_id ?? null
    )

    // Persist customer ID immediately so reuse logic works on refresh
    await supabase
      .from('users')
      .update({ stripe_customer_id: customerId })
      .eq('id', userId!)

    return NextResponse.json({ clientSecret })
  } catch (err) {
    const e = err as { type?: string; code?: string; message?: string }
    console.error('[checkout-error-type]', e?.type ?? 'unknown')
    console.error('[checkout-error-code]', e?.code ?? 'unknown')
    console.error('[checkout-error-msg]', e?.message ?? 'unknown')
    return NextResponse.json(
      { error: 'Failed to initialize checkout. Please try again.' },
      { status: 500 }
    )
  }
}
