import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

const ConfirmSchema = z.object({
  plan: z.enum(['starter', 'pro', 'executive']),
  billingPeriod: z.enum(['monthly', 'annual']),
  paymentMethodId: z.string().min(1),
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

const MINUTES_MAP: Record<string, number> = {
  starter: 30,
  pro: 70,
  executive: 150,
}

/**
 * POST /api/checkout/confirm
 * Called after Stripe SetupIntent is confirmed on the client.
 * Attaches the payment method to the customer and creates the subscription.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  try {
    const body = await request.json()
    const parsed = ConfirmSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { plan, billingPeriod, paymentMethodId } = parsed.data

    const priceId = PRICE_ID_MAP[plan]?.[billingPeriod]
    if (!priceId || priceId.startsWith('PLACEHOLDER_')) {
      return NextResponse.json(
        { error: 'Payment is not configured yet.' },
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
      .select('stripe_customer_id')
      .eq('id', userId!)
      .single()

    if (!user?.stripe_customer_id) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 400 })
    }

    const customerId = user.stripe_customer_id

    // Set as default payment method on the customer
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    })

    // Create subscription with 3-day trial
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: 3,
      default_payment_method: paymentMethodId,
      metadata: { userId: userId!, plan, billingPeriod },
    })

    // Update Supabase immediately (webhook will also update, this is for speed)
    await supabase
      .from('users')
      .update({
        plan_tier: plan,
        subscription_status: subscription.status,
        stripe_subscription_id: subscription.id,
        minutes_included: MINUTES_MAP[plan],
        minutes_balance: MINUTES_MAP[plan],
      })
      .eq('id', userId!)

    return NextResponse.json({ success: true })
  } catch (err) {
    const e = err as { type?: string; code?: string; message?: string }
    console.error('[checkout-confirm-error]', e?.type, e?.code, e?.message)

    // Surface Stripe card errors to the user
    if (e?.type === 'StripeCardError') {
      return NextResponse.json({ error: e.message }, { status: 402 })
    }

    return NextResponse.json(
      { error: 'Failed to create subscription. Please try again.' },
      { status: 500 }
    )
  }
}
