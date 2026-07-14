import { NextRequest, NextResponse } from 'next/server'
import { constructWebhookEvent, stripe } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'
import type Stripe from 'stripe'

type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>

/**
 * B2B-04 — true only when a `wallet_ledger` row already exists for this
 * exact (stripe_object_id, entry_type) pair (the table's own idempotency
 * unique index, architecture.md §13.1). Checked BEFORE calling
 * credit_wallet_balance() on every B2B-04 funding path below — the RPC
 * itself has no dedup, so guarding only the ledger insert (and not the RPC
 * call) would let a Stripe webhook redelivery double-credit the balance
 * even though the ledger only ever shows one row. This is a stricter
 * (and correct) reading of Requirement Doc 5.B.2's "a webhook redelivery
 * no-ops" than processing-then-letting-the-insert-fail would give.
 */
async function walletLedgerAlreadyRecorded(
  supabase: AdminSupabaseClient,
  stripeObjectId: string,
  entryType: 'topup_checkout' | 'topup_subscription_recharge' | 'topup_invoice'
): Promise<boolean> {
  const { data } = await supabase
    .from('wallet_ledger')
    .select('id')
    .eq('stripe_object_id', stripeObjectId)
    .eq('entry_type', entryType)
    .maybeSingle()
  return !!data
}

/** Syncs Stripe's own card/bank display metadata onto partner_wallets so the admin page never needs a live per-row Stripe API call (architecture.md §13.3). */
async function applyPaymentMethodToWallet(
  supabase: AdminSupabaseClient,
  customerId: string,
  paymentMethod: Stripe.PaymentMethod
): Promise<void> {
  const type = paymentMethod.type === 'us_bank_account' ? 'us_bank_account' : paymentMethod.type === 'card' ? 'card' : null
  if (!type) return

  const { error } = await supabase
    .from('partner_wallets')
    .update({
      stripe_default_payment_method_id: paymentMethod.id,
      payment_method_card_brand: paymentMethod.card?.brand ?? null,
      payment_method_card_last4: paymentMethod.card?.last4 ?? null,
      payment_method_type: type,
    })
    .eq('stripe_customer_id', customerId)

  if (error) {
    console.error('[stripe-webhook] Failed to sync payment method onto partner_wallets:', error.message)
  }
}

/**
 * POST /api/webhooks/stripe
 * Handles Stripe events for B2B-04 partner wallet funding (top-up Checkout,
 * mid-market auto-recharge Subscription, enterprise Invoicing) and
 * payment-method display sync. B2C-era subscription/topup/trial branches
 * (tied to the retired per-user `users` table) were removed 2026-07-13 —
 * see docs/b2b-pivot-status.md changelog.
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
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        // ── B2B-04 — wallet top-up (self-serve, mode: "payment") ───────────
        // Requirement Doc Section 5.B.2.
        if (session.metadata?.purpose === 'wallet_topup') {
          const partnerAccountId = session.metadata?.partner_account_id
          const amountUsd = (session.amount_total ?? 0) / 100

          if (!partnerAccountId || amountUsd <= 0) {
            console.warn('[stripe-webhook] wallet_topup checkout.session.completed missing partner_account_id/amount:', session.id)
            break
          }

          if (await walletLedgerAlreadyRecorded(supabase, session.id, 'topup_checkout')) {
            break
          }

          const { data: newBalance, error: rpcError } = await supabase.rpc('credit_wallet_balance', {
            p_partner_account_id: partnerAccountId,
            p_amount_usd: amountUsd,
          })

          if (rpcError) {
            console.error('[stripe-webhook] credit_wallet_balance RPC failed (wallet_topup):', rpcError.message)
            break
          }

          await supabase.from('wallet_ledger').insert({
            partner_account_id: partnerAccountId,
            entry_type: 'topup_checkout',
            delta_usd: amountUsd,
            resulting_balance_usd: newBalance,
            stripe_object_id: session.id,
          })

          await supabase
            .from('partner_wallets')
            .update({
              reference_topup_amount_usd: amountUsd,
              low_balance_alert_fired_at: null,
              ...(typeof session.customer === 'string' ? { stripe_customer_id: session.customer } : {}),
            })
            .eq('partner_account_id', partnerAccountId)

          console.log(`[stripe-webhook] B2B-04 wallet top-up: +$${amountUsd.toFixed(2)} for partner ${partnerAccountId}, new balance: ${newBalance}`)

          break
        }

        break
      }

      // ── B2B-04 — mid-market auto-recharge subscription (Requirement Doc 5.B.3) ──
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice

        // Enterprise one-off invoices are handled by invoice.payment_succeeded
        // below (guarded the mirror way) — Stripe can fire both events for
        // the same invoice, so each branch only proceeds for its own case.
        if (!invoice.subscription) break

        const customerId = invoice.customer as string
        const { data: wallet } = await supabase
          .from('partner_wallets')
          .select('partner_account_id')
          .eq('stripe_customer_id', customerId)
          .maybeSingle()

        const partnerAccountId = wallet?.partner_account_id as string | undefined
        if (!partnerAccountId) {
          console.warn('[stripe-webhook] invoice.paid: no partner_wallets row found for Stripe customer', customerId)
          break
        }

        const amountUsd = (invoice.amount_paid ?? 0) / 100
        if (amountUsd <= 0) break

        if (await walletLedgerAlreadyRecorded(supabase, invoice.id, 'topup_subscription_recharge')) break

        const { data: newBalance, error: rpcError } = await supabase.rpc('credit_wallet_balance', {
          p_partner_account_id: partnerAccountId,
          p_amount_usd: amountUsd,
        })

        if (rpcError) {
          console.error('[stripe-webhook] credit_wallet_balance RPC failed (invoice.paid):', rpcError.message)
          break
        }

        await supabase.from('wallet_ledger').insert({
          partner_account_id: partnerAccountId,
          entry_type: 'topup_subscription_recharge',
          delta_usd: amountUsd,
          resulting_balance_usd: newBalance,
          stripe_object_id: invoice.id,
        })

        // Stripe invoices carry the subscription's current billing period on
        // each line item — avoids an extra subscriptions.retrieve() call.
        const periodEndUnix = invoice.lines?.data?.[0]?.period?.end
        const nextBillingDate = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null

        await supabase
          .from('partner_wallets')
          .update({
            reference_topup_amount_usd: amountUsd,
            low_balance_alert_fired_at: null,
            tier: 'mid_market',
            funding_mechanism: 'subscription_auto_recharge',
            stripe_subscription_id: invoice.subscription as string,
            ...(nextBillingDate ? { next_billing_date: nextBillingDate } : {}),
          })
          .eq('partner_account_id', partnerAccountId)

        console.log(`[stripe-webhook] B2B-04 auto-recharge: +$${amountUsd.toFixed(2)} for partner ${partnerAccountId}, new balance: ${newBalance}`)

        break
      }

      // ── B2B-04 — enterprise invoicing (Requirement Doc 5.B.4) ───────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice

        // Subscription invoices are handled by invoice.paid above.
        if (invoice.subscription) break

        const customerId = invoice.customer as string
        const { data: wallet } = await supabase
          .from('partner_wallets')
          .select('partner_account_id')
          .eq('stripe_customer_id', customerId)
          .maybeSingle()

        const partnerAccountId = wallet?.partner_account_id as string | undefined
        if (!partnerAccountId) {
          console.warn('[stripe-webhook] invoice.payment_succeeded: no partner_wallets row found for Stripe customer', customerId)
          break
        }

        const amountUsd = (invoice.amount_paid ?? 0) / 100
        if (amountUsd <= 0) break

        if (await walletLedgerAlreadyRecorded(supabase, invoice.id, 'topup_invoice')) break

        const { data: newBalance, error: rpcError } = await supabase.rpc('credit_wallet_balance', {
          p_partner_account_id: partnerAccountId,
          p_amount_usd: amountUsd,
        })

        if (rpcError) {
          console.error('[stripe-webhook] credit_wallet_balance RPC failed (invoice.payment_succeeded):', rpcError.message)
          break
        }

        await supabase.from('wallet_ledger').insert({
          partner_account_id: partnerAccountId,
          entry_type: 'topup_invoice',
          delta_usd: amountUsd,
          resulting_balance_usd: newBalance,
          stripe_object_id: invoice.id,
        })

        await supabase
          .from('partner_wallets')
          .update({
            reference_topup_amount_usd: amountUsd,
            low_balance_alert_fired_at: null,
            tier: 'enterprise',
            funding_mechanism: 'invoicing',
            // next_billing_date intentionally untouched — a one-off invoice
            // never implies a negotiated recurring cadence (Requirement Doc
            // Section 9).
          })
          .eq('partner_account_id', partnerAccountId)

        console.log(`[stripe-webhook] B2B-04 enterprise invoice paid: +$${amountUsd.toFixed(2)} for partner ${partnerAccountId}, new balance: ${newBalance}`)

        break
      }

      // ── B2B-04 — payment-method display cache sync (architecture.md §13.3) ──
      case 'customer.updated': {
        const customer = event.data.object as Stripe.Customer
        const defaultPaymentMethod = customer.invoice_settings?.default_payment_method
        const defaultPaymentMethodId = typeof defaultPaymentMethod === 'string' ? defaultPaymentMethod : defaultPaymentMethod?.id

        if (!defaultPaymentMethodId || !stripe) break

        try {
          const paymentMethod = await stripe.paymentMethods.retrieve(defaultPaymentMethodId)
          await applyPaymentMethodToWallet(supabase, customer.id, paymentMethod)
        } catch (err) {
          console.error('[stripe-webhook] customer.updated: failed to retrieve/sync payment method:', err)
        }

        break
      }

      case 'payment_method.attached': {
        const paymentMethod = event.data.object as Stripe.PaymentMethod
        const customerId = typeof paymentMethod.customer === 'string' ? paymentMethod.customer : paymentMethod.customer?.id

        if (!customerId) break

        await applyPaymentMethodToWallet(supabase, customerId, paymentMethod)

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
