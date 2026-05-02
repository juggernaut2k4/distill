import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createCheckoutSession } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'

const CheckoutSchema = z.object({
  plan: z.enum(['starter', 'pro', 'executive']),
  billingPeriod: z.enum(['monthly', 'annual']),
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

/**
 * POST /api/checkout
 * Creates a Stripe Checkout Session for the selected plan.
 * Requires authentication via Clerk.
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
    const priceId = PRICE_ID_MAP[plan]?.[billingPeriod]

    if (!priceId || priceId.startsWith('PLACEHOLDER_')) {
      // Mock mode: return a mock checkout URL
      console.log('[MOCK] createCheckoutSession', { plan, billingPeriod, userId })
      return NextResponse.json({
        checkoutUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?welcome=1&plan=${plan}&mock=1`,
      })
    }

    const checkoutUrl = await createCheckoutSession(userId!, priceId)

    return NextResponse.json({ checkoutUrl })
  } catch (err) {
    console.error('[checkout] Error:', err)
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
}
