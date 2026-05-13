import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'

const TopUpSchema = z.object({
  minutes: z.number().int().positive().max(1000),
})

const PACK_PRICES: Record<number, number> = {
  60: 1500,   // $15.00 in cents
  120: 2500,  // $25.00
  300: 5500,  // $55.00
}

/**
 * POST /api/checkout/topup
 * Creates a Stripe Checkout Session for a minutes top-up pack.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  const body = await request.json()
  const parsed = TopUpSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid minutes value', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { minutes } = parsed.data
  const unitAmount = PACK_PRICES[minutes]
  if (!unitAmount) {
    return NextResponse.json({ error: 'Invalid pack selection' }, { status: 400 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'

  if (!stripe) {
    console.log('[MOCK] topup checkout', { userId, minutes, unitAmount })
    return NextResponse.json({ checkoutUrl: `${appUrl}/dashboard/schedule?topup=mock` })
  }

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('stripe_customer_id')
    .eq('id', userId!)
    .single()

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    ...(user?.stripe_customer_id ? { customer: user.stripe_customer_id } : {}),
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: unitAmount,
          product_data: {
            name: `Clio ${minutes} Coaching Minutes`,
            description: `Add ${minutes} coaching minutes to your balance`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      type: 'topup',
      user_id: userId!,
      minutes: String(minutes),
    },
    success_url: `${appUrl}/dashboard/schedule?topup=success`,
    cancel_url: `${appUrl}/dashboard/schedule`,
  })

  return NextResponse.json({ checkoutUrl: session.url })
}
