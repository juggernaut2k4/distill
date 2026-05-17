import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'

/**
 * POST /api/subscription/cancel
 * Cancels the user's Stripe subscription at period end (no immediate charge cutoff,
 * user keeps access until the current billing period expires).
 * Updates subscription_status in users table to 'canceling'.
 */
export async function POST() {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('stripe_subscription_id, plan_tier, subscription_status')
    .eq('id', userId)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (!user.stripe_subscription_id) {
    // No active subscription — just reset to free locally
    await supabase
      .from('users')
      .update({ plan_tier: 'free', subscription_status: 'inactive' })
      .eq('id', userId)
    return NextResponse.json({ ok: true, status: 'free' })
  }

  if (!stripe) {
    // Mock mode — update locally only
    console.log('[MOCK] cancel subscription', user.stripe_subscription_id)
    await supabase
      .from('users')
      .update({ plan_tier: 'free', subscription_status: 'inactive', stripe_subscription_id: null })
      .eq('id', userId)
    return NextResponse.json({ ok: true, status: 'cancelled' })
  }

  // Cancel at period end — user keeps access until billing cycle ends, no further charges
  await stripe.subscriptions.update(user.stripe_subscription_id, {
    cancel_at_period_end: true,
  })

  // Mark as canceling locally so the UI reflects it immediately
  await supabase
    .from('users')
    .update({ subscription_status: 'canceling' })
    .eq('id', userId)

  return NextResponse.json({ ok: true, status: 'canceling' })
}
