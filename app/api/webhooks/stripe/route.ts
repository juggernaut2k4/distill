import { NextRequest, NextResponse } from 'next/server'
import { constructWebhookEvent, getPlanFromPriceId } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  sendPaymentFailedEmail,
  sendTrialEndingEmail,
  type User,
} from '@/lib/delivery/email'
import type Stripe from 'stripe'

/**
 * POST /api/webhooks/stripe
 * Handles Stripe subscription lifecycle events.
 * Always returns 200 to prevent Stripe retries on handled errors.
 */
export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature') ?? ''

  const event = constructWebhookEvent(body, signature)

  if (!event) {
    // Signature verification failed or mock mode
    const isPlaceholder = !process.env.STRIPE_WEBHOOK_SECRET ||
      process.env.STRIPE_WEBHOOK_SECRET.startsWith('PLACEHOLDER_')

    if (isPlaceholder) {
      console.log('[MOCK] Stripe webhook received — mock mode active')
      return NextResponse.json({ received: true })
    }

    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  try {
    switch (event.type) {
      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.userId
        if (!userId) break

        const priceId = subscription.items.data[0]?.price?.id ?? ''
        const plan = getPlanFromPriceId(priceId)

        await supabase
          .from('users')
          .update({
            plan_tier: plan === 'unknown' ? 'starter' : plan,
            stripe_customer_id: subscription.customer as string,
            stripe_subscription_id: subscription.id,
            subscription_status: 'active',
          })
          .eq('id', userId)

        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.userId
        if (!userId) break

        const priceId = subscription.items.data[0]?.price?.id ?? ''
        const plan = getPlanFromPriceId(priceId)
        const status = subscription.status

        await supabase
          .from('users')
          .update({
            plan_tier: plan === 'unknown' ? 'starter' : plan,
            subscription_status: status,
          })
          .eq('id', userId)

        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.userId
        if (!userId) break

        await supabase
          .from('users')
          .update({
            plan_tier: 'free',
            subscription_status: 'inactive',
            delivery_paused: true,
          })
          .eq('id', userId)

        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        const { data: user } = await supabase
          .from('users')
          .select('id, email, role, industry, ai_maturity')
          .eq('stripe_customer_id', customerId)
          .single()

        if (user) {
          await sendPaymentFailedEmail(user as User)
        }

        break
      }

      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.userId
        if (!userId) break

        const { data: user } = await supabase
          .from('users')
          .select('id, email, role, industry, ai_maturity')
          .eq('id', userId)
          .single()

        if (user) {
          await sendTrialEndingEmail(user as User)
        }

        break
      }

      default:
        // Unhandled event type — log and return 200
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`)
    }
  } catch (err) {
    // Log errors but always return 200 — Stripe retries on 5xx
    console.error('[stripe-webhook] Handler error:', err)
  }

  return NextResponse.json({ received: true })
}
