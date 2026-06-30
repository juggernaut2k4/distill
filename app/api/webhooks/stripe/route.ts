import { NextRequest, NextResponse } from 'next/server'
import { constructWebhookEvent, getPlanFromPriceId } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  sendPaymentFailedEmail,
  sendTrialEndingEmail,
  sendWelcomeEmail,
  type User,
} from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'
import { inngest } from '@/inngest/client'
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
        const resolvedPlan = plan === 'unknown' ? 'starter' : plan

        const minutesMap: Record<string, number> = {
          starter: 30,
          pro: 70,
          executive: 150,
        }
        const minutesIncluded = minutesMap[resolvedPlan] ?? 30
        // During trial: give a taste (5 min). On activation, topped up to full plan minutes.
        const isTrialing = subscription.status === 'trialing'
        const minutesBalance = isTrialing ? 5 : minutesIncluded

        await supabase
          .from('users')
          .update({
            plan_tier: resolvedPlan,
            stripe_customer_id: subscription.customer as string,
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status,
            minutes_included: minutesIncluded,
            minutes_balance: minutesBalance,
            ...(isTrialing && { onboarded_at: new Date().toISOString() }),
          })
          .eq('id', userId)

        const { data: user } = await supabase
          .from('users')
          .select('id, email, role, industry, ai_maturity, topic_interests')
          .eq('id', userId)
          .single()

        if (user?.email) {
          sendWelcomeEmail(user as User, resolvedPlan, minutesBalance).catch(console.error)
        }

        // Only fire curriculum generation if topics haven't been selected yet.
        // When the user went through /topics before paying, that route already fired
        // this event — firing it again creates a duplicate plan.
        const hasTopics = Array.isArray(user?.topic_interests) && (user.topic_interests as string[]).length > 0
        if (userId && !hasTopics) {
          inngest.send({ name: 'clio/topics.selected', data: { userId } }).catch(console.error)
        }

        // Cancel the abandoned-onboarding cleanup timer — user has paid
        inngest.send({ name: 'clio/onboarding.completed', data: { userId } }).catch(console.error)

        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.userId
        if (!userId) break

        const priceId = subscription.items.data[0]?.price?.id ?? ''
        const plan = getPlanFromPriceId(priceId)
        const resolvedPlan = plan === 'unknown' ? 'starter' : plan
        const status = subscription.status

        const minutesMap: Record<string, number> = { starter: 30, pro: 70, executive: 150 }
        const minutesIncluded = minutesMap[resolvedPlan] ?? 30

        // When trial converts to active, credit full plan minutes
        const updatePayload: Record<string, unknown> = {
          plan_tier: resolvedPlan,
          subscription_status: status,
        }
        if (status === 'active') {
          updatePayload.minutes_included = minutesIncluded
          updatePayload.minutes_balance = minutesIncluded
        }

        await supabase
          .from('users')
          .update(updatePayload)
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
            plan_tier: 'starter',
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
          if (!user.email) {
            console.warn('[stripe/trial_will_end] user email is null, skipping trial email', { userId })
          } else {
            await sendTrialEndingEmail(user as User)
          }
        }

        break
      }

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        // ── Topup flow — credit purchased minutes ──────────────────────────
        if (session.metadata?.type === 'topup') {
          const userId = session.metadata?.user_id
          const minutes = parseInt(session.metadata?.minutes ?? '0', 10)
          if (!userId || !minutes) break

          const { data: newBalance, error: rpcError } = await supabase.rpc('add_minutes', {
            p_user_id: userId,
            p_minutes: minutes,
          })

          if (rpcError) {
            console.error('[stripe-webhook] add_minutes RPC error:', rpcError)
            break
          }

          console.log(`[stripe-webhook] Top-up: +${minutes} min for user ${userId}, new balance: ${newBalance}`)

          const { data: topupUser } = await supabase
            .from('users')
            .select('id, email, role, industry, ai_maturity, phone, twilio_number_assigned')
            .eq('id', userId)
            .single()

          if (topupUser?.email) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
            const { Resend } = await import('resend')
            const resendKey = process.env.RESEND_API_KEY
            if (resendKey && !resendKey.startsWith('PLACEHOLDER_')) {
              const resend = new Resend(resendKey)
              const fromName = process.env.RESEND_FROM_NAME ?? 'Clio'
              const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'hello@distill-peach.vercel.app'
              resend.emails.send({
                from: `${fromName} <${fromEmail}>`,
                to: topupUser.email,
                subject: `${minutes} minutes added to your Clio account`,
                html: `<!DOCTYPE html><html><body style="background:#080808;color:#fff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;padding:40px 24px;">
<tr><td>
<p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
<h1 style="color:#fff;font-size:28px;font-weight:800;margin:0 0 12px;">Minutes added.</h1>
<p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 24px;">
  <strong style="color:#10B981;">${minutes} coaching minutes</strong> have been added to your account.<br>
  New balance: <strong style="color:#fff;">${newBalance} minutes</strong>.
</p>
<a href="${appUrl}/dashboard/sessions" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">Schedule Your Sessions →</a>
</td></tr>
</table>
</body></html>`,
              }).catch(console.error)
            }
          }

          if (topupUser?.phone && topupUser?.twilio_number_assigned) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
            sendSMS(
              topupUser.phone,
              topupUser.twilio_number_assigned,
              `Clio: ${minutes} minutes added! New balance: ${newBalance} min. Ready to schedule: ${appUrl}/dashboard/sessions`
            ).catch(console.error)
          }

          break
        }

        // ── Regular subscription checkout — backup handler ─────────────────
        // customer.subscription.created should fire and handle DB updates,
        // but this catches any race-condition cases.
        if (session.mode === 'subscription' && session.subscription) {
          const userId = session.metadata?.userId
          if (!userId) break

          // Only act if the subscription event hasn't already updated the user
          const { data: existingUser } = await supabase
            .from('users')
            .select('stripe_subscription_id')
            .eq('id', userId)
            .single()

          if (!existingUser?.stripe_subscription_id) {
            await supabase
              .from('users')
              .update({
                stripe_customer_id: session.customer as string,
                stripe_subscription_id: session.subscription as string,
                subscription_status: 'trialing',
              })
              .eq('id', userId)

            console.log('[stripe-webhook] checkout.session.completed fallback: updated user', userId)
          }
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
