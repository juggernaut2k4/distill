import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createCheckoutSession } from '@/lib/stripe'

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

/**
 * POST /api/checkout
 * Creates a Stripe Checkout Session for the selected plan.
 * Returns 503 if Stripe price IDs are not configured — never silently bypasses payment.
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
