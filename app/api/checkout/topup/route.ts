import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'

const TopUpSchema = z.object({
  minutes: z.number().int().positive().max(170),
  returnUrl: z.string().url().optional(), // client passes current origin so mock mode uses the right domain
})

const PACK_PRICES: Record<number, number> = {
  50: 2000,   // $20.00 in cents
  90: 3500,   // $35.00
  170: 6500,  // $65.00
}

/**
 * POST /api/checkout/topup
 * Creates a Stripe Checkout Session for a minutes top-up pack.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const body = await request.json()
  const parsed = TopUpSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid minutes value', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { minutes, returnUrl } = parsed.data
  const unitAmount = PACK_PRICES[minutes]
  if (!unitAmount) {
    return NextResponse.json({ error: 'Invalid pack selection' }, { status: 400 })
  }

  // Use client-provided returnUrl base (so the right domain is used regardless of NEXT_PUBLIC_APP_URL)
  const appUrl = returnUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const scheduleBase = returnUrl
    ? returnUrl.replace(/\?.*$/, '') // strip any query string from returnUrl, treat as base
    : `${appUrl}/dashboard`

  if (!stripe) {
    console.log('[MOCK] topup checkout', { userId, minutes, unitAmount })
    // In mock mode, credit the minutes directly so the flow works end-to-end
    const supabaseMock = createSupabaseAdminClient()
    const { data: currentUser } = await supabaseMock
      .from('users')
      .select('minutes_balance')
      .eq('id', userId!)
      .single()
    const newBalance = (currentUser?.minutes_balance ?? 0) + minutes
    await supabaseMock
      .from('users')
      .update({ minutes_balance: newBalance })
      .eq('id', userId!)
    return NextResponse.json({ checkoutUrl: `${scheduleBase}?topup=success&added=${minutes}` })
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
    success_url: `${scheduleBase}?topup=success&added=${minutes}`,
    cancel_url: scheduleBase,
  })

  return NextResponse.json({ checkoutUrl: session.url })
}
