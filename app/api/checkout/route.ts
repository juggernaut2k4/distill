import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createCheckoutSession } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'

const CheckoutSchema = z.object({
  plan: z.enum(['free', 'starter', 'pro', 'executive']),
  billingPeriod: z.enum(['monthly', 'annual']).default('monthly'),
  returnUrl: z.string().url().optional(),
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
 * Creates a Stripe Checkout Session for the selected plan.
 *
 * Dev mode (Stripe not configured): activates the plan directly in the DB
 * and returns the returnUrl so the schedule flow completes end-to-end.
 * Production: always goes through real Stripe checkout.
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

    const { plan, billingPeriod, returnUrl } = parsed.data
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'

    // ── Dev / mock mode ─────────────────────────────────────────────────────
    // When Stripe is not configured, activate the plan directly in the DB so
    // the rest of the scheduling flow works end-to-end without real payment.
    if (!isStripeConfigured) {
      console.log('[checkout] MOCK mode — activating plan without Stripe:', plan)
      const supabase = createSupabaseAdminClient()
      await supabase
        .from('users')
        .update({
          plan_tier: plan === 'free' ? 'starter' : plan,
          subscription_status: 'trialing',
        })
        .eq('id', userId!)

      const successUrl = returnUrl ?? `${appUrl}/dashboard/welcome`
      return NextResponse.json({ checkoutUrl: successUrl, mock: true })
    }

    // ── Production: real Stripe checkout ────────────────────────────────────
    const priceId = PRICE_ID_MAP[plan]?.[billingPeriod]

    if (!priceId || priceId.startsWith('PLACEHOLDER_')) {
      console.error('[checkout] Stripe price ID not configured', { plan, billingPeriod })
      return NextResponse.json(
        { error: 'Payment is not configured yet. Please contact support.' },
        { status: 503 }
      )
    }

    const checkoutUrl = await createCheckoutSession(userId!, priceId, returnUrl)
    return NextResponse.json({ checkoutUrl })
  } catch (err) {
    console.error('[checkout] Error creating Stripe session:', err)
    return NextResponse.json(
      { error: 'Failed to create checkout session. Please try again.' },
      { status: 500 }
    )
  }
}
