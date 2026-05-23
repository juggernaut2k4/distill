import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

const MINUTES_MAP: Record<string, number> = {
  starter: 30,
  pro: 70,
  executive: 150,
}

const isStripeConfigured =
  process.env.STRIPE_SECRET_KEY &&
  !process.env.STRIPE_SECRET_KEY.startsWith('PLACEHOLDER_')

/**
 * POST /api/checkout/activate
 * Ends the Stripe trial early so the subscription charges immediately.
 * Called from the dashboard trial banner "Activate plan" button.
 */
export async function POST(_request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  try {
    const supabase = createSupabaseAdminClient()

    const { data: user } = await supabase
      .from('users')
      .select('stripe_subscription_id, subscription_status, plan_tier, trial_opted_in')
      .eq('id', userId!)
      .single()

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const plan = user.plan_tier ?? 'starter'
    const fullMinutes = MINUTES_MAP[plan] ?? 30

    // Mock mode — just flip the status directly
    if (!isStripeConfigured || !user.stripe_subscription_id) {
      console.log('[activate] MOCK — activating without Stripe for user:', userId)
      await supabase
        .from('users')
        .update({
          subscription_status: 'active',
          trial_opted_in: false,
          trial_ends_at: null,
          minutes_balance: fullMinutes,
          minutes_included: fullMinutes,
        })
        .eq('id', userId!)

      return NextResponse.json({ success: true })
    }

    // Real Stripe — end trial immediately so the card is charged now
    const { stripe } = await import('@/lib/stripe')
    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
    }

    await stripe.subscriptions.update(user.stripe_subscription_id, {
      trial_end: 'now',
      proration_behavior: 'none',
    })

    // Optimistic DB update — the webhook will also fire and confirm
    await supabase
      .from('users')
      .update({
        subscription_status: 'active',
        trial_opted_in: false,
        trial_ends_at: null,
        minutes_balance: fullMinutes,
        minutes_included: fullMinutes,
      })
      .eq('id', userId!)

    return NextResponse.json({ success: true })
  } catch (err) {
    const e = err as { type?: string; code?: string; message?: string }
    console.error('[activate-error]', e?.type, e?.code, e?.message)
    return NextResponse.json(
      { error: 'Failed to activate plan. Please try again.' },
      { status: 500 }
    )
  }
}
