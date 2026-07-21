import { NextRequest, NextResponse } from 'next/server'
import { constructWebhookEvent, stripe } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getPlanTier, getIncludedAllowanceUsd } from '@/lib/billing/plan-tiers'
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
  entryType: 'topup_checkout' | 'topup_subscription_recharge' | 'topup_invoice' | 'test_block_purchase' | 'plan_allowance_credit'
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
              funding_mechanism: 'checkout_topup',
              ...(typeof session.customer === 'string' ? { stripe_customer_id: session.customer } : {}),
            })
            .eq('partner_account_id', partnerAccountId)

          console.log(`[stripe-webhook] B2B-04 wallet top-up: +$${amountUsd.toFixed(2)} for partner ${partnerAccountId}, new balance: ${newBalance}`)

          break
        }

        // ── B2B-08 — test-block purchase (mode: "payment", fixed $1.80 / 120 min) ──
        // Requirement Doc Section 5.F / architecture.md §15.8.
        if (session.metadata?.purpose === 'test_block_purchase') {
          const partnerAccountId = session.metadata?.partner_account_id
          if (!partnerAccountId) {
            console.warn('[stripe-webhook] test_block_purchase checkout.session.completed missing partner_account_id:', session.id)
            break
          }

          if (await walletLedgerAlreadyRecorded(supabase, session.id, 'test_block_purchase')) break

          const { data: newTestMinutesBalance, error: rpcError } = await supabase.rpc('credit_test_minutes_balance', {
            p_partner_account_id: partnerAccountId,
            p_minutes: 120,
          })
          if (rpcError) {
            console.error('[stripe-webhook] credit_test_minutes_balance RPC failed:', rpcError.message)
            break
          }

          // resulting_balance_usd is still required/populated on every wallet_ledger row — this row
          // type never moves balance_usd, so the account's CURRENT, unchanged value is cited,
          // preserving the ledger's "never independently recompute a balance" discipline for both
          // balance columns on every row type (Requirement Document, Purchase Mechanism).
          const { data: walletRow } = await supabase
            .from('partner_wallets')
            .select('balance_usd')
            .eq('partner_account_id', partnerAccountId)
            .maybeSingle()
          const currentBalanceUsd = walletRow ? Number(walletRow.balance_usd) : 0

          await supabase.from('wallet_ledger').insert({
            partner_account_id: partnerAccountId,
            entry_type: 'test_block_purchase',
            delta_usd: 1.80,
            resulting_balance_usd: currentBalanceUsd,
            resulting_test_minutes_balance: newTestMinutesBalance,
            stripe_object_id: session.id,
          })

          // Same payment-method extraction the wallet_topup branch performs, minimally — sets
          // stripe_customer_id only. Card brand/last4/type sync happens via the existing, UNMODIFIED
          // customer.updated / payment_method.attached handlers below, which already key off
          // stripe_customer_id across every partner_wallets row regardless of which funding path
          // attached it — no new code needed for that part.
          if (typeof session.customer === 'string') {
            await supabase
              .from('partner_wallets')
              .update({ stripe_customer_id: session.customer })
              .eq('partner_account_id', partnerAccountId)
          }

          console.log(`[stripe-webhook] B2B-08 test block purchase: +120 min for partner ${partnerAccountId}, new test_minutes_balance: ${newTestMinutesBalance}`)

          break
        }

        // ── B2B-13 — Plan subscription checkout completion (mode: "subscription") ──
        // Requirement Doc Section 4.B step 1 / 6.D. Writes the Plan's identity onto
        // partner_wallets immediately — NO balance credit here. Crediting happens
        // exactly once, only on invoice.paid (below), so the fixed allowance is never
        // credited twice (once at checkout, again at the first invoice). Naturally
        // idempotent under Stripe redelivery: a repeat event just re-writes the same
        // five column values.
        if (session.metadata?.purpose === 'plan_subscription') {
          const partnerAccountId = session.metadata?.partner_account_id
          const planTierKey = session.metadata?.plan_tier_key
          const planBillingPeriod = session.metadata?.plan_billing_period

          const tier = planTierKey ? getPlanTier(planTierKey) : undefined
          if (!tier) {
            console.error('[stripe-webhook] plan_subscription checkout.session.completed: unrecognized plan_tier_key:', planTierKey, session.id)
            break
          }

          if (!partnerAccountId) {
            console.warn('[stripe-webhook] plan_subscription checkout.session.completed missing partner_account_id:', session.id)
            break
          }

          // Resolve the target row before writing — mirrors the existing
          // wallet_topup/test_block_purchase branches' partner_account_id
          // resolution, no new lookup mechanism (Requirement Doc Section 4.B).
          const { data: existingWallet } = await supabase
            .from('partner_wallets')
            .select('partner_account_id')
            .eq('partner_account_id', partnerAccountId)
            .maybeSingle()

          if (!existingWallet) {
            console.warn('[stripe-webhook] plan_subscription checkout.session.completed: no partner_wallets row found for', partnerAccountId, session.id)
            break
          }

          const { error: updateError } = await supabase
            .from('partner_wallets')
            .update({
              plan_tier_key: planTierKey,
              plan_billing_period: planBillingPeriod,
              stripe_plan_subscription_id: typeof session.subscription === 'string' ? session.subscription : null,
              funding_mechanism: 'plan_subscription',
              plan_status: 'active',
            })
            .eq('partner_account_id', partnerAccountId)

          if (updateError) {
            console.error('[stripe-webhook] plan_subscription checkout.session.completed: partner_wallets update failed for', partnerAccountId, updateError.message)
            break
          }

          console.log(`[stripe-webhook] B2B-13 plan checkout completed: partner ${partnerAccountId} -> ${planTierKey}/${planBillingPeriod}, subscription ${session.subscription}`)

          break
        }

        // ── B2B-27 — card-on-file verification (mode: "setup") ─────────────
        // Requirement Doc Section 4.A/6.1. lib/stripe.ts's own comment on
        // createCardVerificationCheckoutSession assumed the existing
        // payment_method.attached/customer.updated handlers below would sync
        // the card — live-tested 2026-07-21: Stripe only ever sent
        // checkout.session.completed for this flow, never those two events,
        // so the settings page was stuck on "couldn't confirm your card yet"
        // indefinitely. A `mode: 'setup'` session's `setup_intent` isn't
        // expanded in the webhook payload, so it's retrieved explicitly to
        // get the resulting payment_method, then synced the same way the
        // other two handlers already do via applyPaymentMethodToWallet.
        if (session.metadata?.purpose === 'card_verification') {
          const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
          const setupIntentId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id

          if (!customerId || !setupIntentId || !stripe) {
            console.warn('[stripe-webhook] card_verification checkout.session.completed missing customer/setup_intent:', session.id)
            break
          }

          try {
            const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
            const paymentMethodId = typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method?.id

            if (!paymentMethodId) {
              console.warn('[stripe-webhook] card_verification setup_intent has no payment_method:', setupIntentId)
              break
            }

            const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
            await applyPaymentMethodToWallet(supabase, customerId, paymentMethod)

            console.log(`[stripe-webhook] B2B-27 card verification synced: customer ${customerId}, payment_method ${paymentMethodId}`)
          } catch (err) {
            console.error('[stripe-webhook] card_verification: failed to retrieve/sync payment method:', err)
          }

          break
        }

        break
      }

      // ── B2B-04 — mid-market auto-recharge subscription (Requirement Doc 5.B.3) ──
      // ── B2B-13 — Plan subscription allowance credit, correlated first (Requirement Doc 4.B/6.D) ──
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice

        // Enterprise one-off invoices are handled by invoice.payment_succeeded
        // below (guarded the mirror way) — Stripe can fire both events for
        // the same invoice, so each branch only proceeds for its own case.
        if (!invoice.subscription) break

        // ── B2B-13 — Plan correlation, tried FIRST. Correlates by a stable
        // Stripe object id (invoice.subscription) looked up against
        // partner_wallets — never by reading any invoice-level metadata field
        // (that field's shape shifts across Stripe API versions; see the
        // Requirement Document's Revision Note for the flaw this closes).
        // If no match (a genuine non-Plan invoice, OR the documented race
        // case where checkout.session.completed hasn't landed yet), this
        // falls through unchanged to the existing B2B-04 auto-recharge logic
        // below — that fallthrough IS the documented safe behavior, not an
        // error case.
        const { data: planWalletRow } = await supabase
          .from('partner_wallets')
          .select('partner_account_id, plan_tier_key, plan_billing_period')
          .eq('stripe_plan_subscription_id', invoice.subscription as string)
          .maybeSingle()

        if (planWalletRow && planWalletRow.plan_tier_key) {
          const planPartnerAccountId = planWalletRow.partner_account_id as string
          const tier = getPlanTier(planWalletRow.plan_tier_key as string)

          if (!tier) {
            // Catalog drift — should not happen, since plan_tier_key is only
            // ever written from a valid catalog key (checkout branch above).
            // Defensive only.
            console.error('[stripe-webhook] invoice.paid (plan): unrecognized plan_tier_key on partner_wallets:', planWalletRow.plan_tier_key, invoice.id)
            break
          }

          if (await walletLedgerAlreadyRecorded(supabase, invoice.id, 'plan_allowance_credit')) break

          const billingPeriod = (planWalletRow.plan_billing_period as string) === 'annual' ? 'annual' : 'monthly'
          const allowanceUsd = getIncludedAllowanceUsd(tier, billingPeriod)

          const { data: newBalance, error: rpcError } = await supabase.rpc('credit_wallet_balance', {
            p_partner_account_id: planPartnerAccountId,
            p_amount_usd: allowanceUsd,
          })

          if (rpcError) {
            console.error('[stripe-webhook] credit_wallet_balance RPC failed (invoice.paid, plan_allowance_credit):', rpcError.message)
            break
          }

          await supabase.from('wallet_ledger').insert({
            partner_account_id: planPartnerAccountId,
            entry_type: 'plan_allowance_credit',
            delta_usd: allowanceUsd,
            resulting_balance_usd: newBalance,
            stripe_object_id: invoice.id,
            metadata: { plan_tier_key: tier.key, plan_billing_period: billingPeriod },
          })

          const planPeriodEndUnix = invoice.lines?.data?.[0]?.period?.end
          const planCurrentPeriodEnd = planPeriodEndUnix ? new Date(planPeriodEndUnix * 1000).toISOString() : null

          await supabase
            .from('partner_wallets')
            .update({
              reference_topup_amount_usd: allowanceUsd,
              low_balance_alert_fired_at: null,
              funding_mechanism: 'plan_subscription',
              plan_tier_key: tier.key,
              plan_billing_period: billingPeriod,
              stripe_plan_subscription_id: invoice.subscription as string,
              plan_status: 'active',
              ...(planCurrentPeriodEnd ? { plan_current_period_end: planCurrentPeriodEnd } : {}),
            })
            .eq('partner_account_id', planPartnerAccountId)

          console.log(`[stripe-webhook] B2B-13 plan allowance credit: +$${allowanceUsd.toFixed(2)} for partner ${planPartnerAccountId} (${tier.key}/${billingPeriod}), new balance: ${newBalance}`)

          break
        }

        // ── B2B-04 — existing auto-recharge logic, byte-for-byte unchanged. ──
        // Also the documented safe fallback for the plan-correlation race case
        // above (Requirement Doc Section 8).
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

      // ── B2B-13 — Plan subscription lifecycle (Requirement Doc 4.B/6.D/9) ────
      // No such handler exists today for any funding mechanism (auto-recharge
      // included) — these are two brand-new cases, not extensions of an
      // existing one. Correlates via subscription.metadata?.purpose, a field
      // whose location has not moved across Stripe API versions (unlike
      // Invoice.subscription_details, which the invoice.paid correlation fix
      // above deliberately avoids reading).
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription

        // Auto-recharge subscriptions never carry this metadata key — this
        // event type has never been handled for them either; out of scope,
        // unchanged (Requirement Doc Section 10).
        if (subscription.metadata?.purpose !== 'plan_subscription') break

        const newStatus =
          subscription.status === 'past_due' ? 'past_due' :
          subscription.status === 'active' ? 'active' :
          null // trialing/incomplete/unpaid/etc. — no mapping, no-op

        if (!newStatus) break

        // The stripe_plan_subscription_id match (not just stripe_customer_id)
        // is deliberate — see Requirement Doc Section 9's "stale event after
        // a re-subscribe" edge case: a stale event for an id that's no longer
        // the row's current value matches zero rows and is a no-op by
        // construction, no special-case code needed.
        const { error: updateError } = await supabase
          .from('partner_wallets')
          .update({ plan_status: newStatus })
          .eq('stripe_customer_id', subscription.customer as string)
          .eq('stripe_plan_subscription_id', subscription.id)

        if (updateError) {
          console.error('[stripe-webhook] customer.subscription.updated: partner_wallets update failed:', updateError.message)
        } else {
          console.log(`[stripe-webhook] B2B-13 plan subscription ${subscription.id} -> plan_status=${newStatus}`)
        }

        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription

        if (subscription.metadata?.purpose !== 'plan_subscription') break

        // No change to balance_usd, plan_tier_key, or plan_billing_period —
        // Requirement Doc Section 9 lifecycle policy (mirrors the B2B-04
        // "don't auto-revert classification, don't touch balance" precedent).
        const { error: updateError } = await supabase
          .from('partner_wallets')
          .update({ plan_status: 'canceled' })
          .eq('stripe_customer_id', subscription.customer as string)
          .eq('stripe_plan_subscription_id', subscription.id)

        if (updateError) {
          console.error('[stripe-webhook] customer.subscription.deleted: partner_wallets update failed:', updateError.message)
        } else {
          console.log(`[stripe-webhook] B2B-13 plan subscription ${subscription.id} -> plan_status=canceled`)
        }

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
