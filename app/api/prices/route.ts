import { NextResponse } from 'next/server'
import Stripe from 'stripe'

const DEFAULT_PRICES = {
  starter: { monthly: 12, annual: 99 },
  pro: { monthly: 25, annual: 199 },
  executive: { monthly: 49, annual: 399 },
}

type PlanKey = 'starter' | 'pro' | 'executive'
type Period = 'monthly' | 'annual'

const PRICE_ID_ENV: Record<PlanKey, Record<Period, string | undefined>> = {
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
 * GET /api/prices
 * Returns the actual USD amounts configured in Stripe for each plan.
 * Falls back to hardcoded defaults if Stripe is not configured.
 */
export async function GET() {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const isPlaceholder = !stripeKey || stripeKey.startsWith('PLACEHOLDER_')

  if (isPlaceholder) {
    return NextResponse.json(DEFAULT_PRICES)
  }

  try {
    const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' })

    const result: typeof DEFAULT_PRICES = {
      starter: { ...DEFAULT_PRICES.starter },
      pro: { ...DEFAULT_PRICES.pro },
      executive: { ...DEFAULT_PRICES.executive },
    }

    const plans: PlanKey[] = ['starter', 'pro', 'executive']
    const periods: Period[] = ['monthly', 'annual']

    await Promise.all(
      plans.flatMap((plan) =>
        periods.map(async (period) => {
          const priceId = PRICE_ID_ENV[plan][period]
          if (!priceId || priceId.startsWith('PLACEHOLDER_')) return
          try {
            const price = await stripe.prices.retrieve(priceId)
            if (price.unit_amount) {
              result[plan][period] = Math.round(price.unit_amount / 100)
            }
          } catch {
            // price ID not found — keep default
          }
        })
      )
    )

    return NextResponse.json(result)
  } catch {
    return NextResponse.json(DEFAULT_PRICES)
  }
}
