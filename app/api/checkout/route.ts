import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
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

    // ── Production: Stripe hosted checkout ──────────────────────────────────
    const priceId = PRICE_ID_MAP[resolvedPlan]?.[billingPeriod]

    if (!priceId || priceId.startsWith('PLACEHOLDER_')) {
      return NextResponse.json(
        { error: 'Payment is not configured yet. Please contact support.' },
        { status: 503 }
      )
    }

    const supabase = createSupabaseAdminClient()
    const { data: user } = await supabase
      .from('users')
      .select('email, stripe_subscription_id, subscription_status')
      .eq('id', userId!)
      .single()

    // Already subscribed — send straight to dashboard
    if (user?.stripe_subscription_id && (user.subscription_status === 'trialing' || user.subscription_status === 'active')) {
      console.log('[checkout] already active — redirecting to welcome')
      return NextResponse.json({ alreadyActive: true })
    }

    const { createCheckoutSession } = await import('@/lib/stripe')
    const checkoutUrl = await createCheckoutSession(userId!, priceId)
    return NextResponse.json({ checkoutUrl })
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
