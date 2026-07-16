import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-13 — app/api/webhooks/stripe/route.ts Plan-tier extension tests.
 * See docs/specs/B2B-13-requirement-document.md Section 7 (Success Criteria)
 * and Section 8 (Error States) — this file implements the acceptance tests
 * that document explicitly calls out for developer verification:
 *  - checkout.session.completed (plan branch) writes wallet identity, no
 *    balance credit.
 *  - invoice.paid correlates via stripe_plan_subscription_id lookup against
 *    partner_wallets (NOT invoice metadata) and credits the tier's FIXED
 *    allowance, never invoice.amount_paid.
 *  - Idempotency on repeated invoice.paid delivery.
 *  - Fallthrough for a genuine non-Plan invoice (existing B2B-04 auto-recharge
 *    logic, byte-for-byte unchanged).
 *  - The race case: invoice.paid before checkout.session.completed falls
 *    through safely, then self-heals from the next invoice onward.
 *  - customer.subscription.updated (past_due) / .deleted (canceled) lifecycle
 *    — status flag only, balance/plan_tier_key untouched.
 */

interface WalletRow {
  partner_account_id: string
  stripe_customer_id: string | null
  balance_usd: number
  plan_tier_key: string | null
  plan_billing_period: string | null
  stripe_plan_subscription_id: string | null
  plan_status: string | null
  plan_current_period_end: string | null
  funding_mechanism: string | null
  reference_topup_amount_usd: number | null
  low_balance_alert_fired_at: string | null
  tier?: string | null
  stripe_subscription_id?: string | null
  next_billing_date?: string | null
}

interface LedgerRow {
  partner_account_id: string
  entry_type: string
  delta_usd: number
  resulting_balance_usd: number
  stripe_object_id: string
  metadata?: Record<string, unknown>
}

const state: {
  wallets: WalletRow[]
  ledger: LedgerRow[]
  fromCalls: string[]
} = { wallets: [], ledger: [], fromCalls: [] }

function findWallet(filters: Record<string, unknown>): WalletRow | null {
  return (
    state.wallets.find((w) => Object.entries(filters).every(([k, v]) => (w as any)[k] === v)) ?? null
  )
}

function makeSelectChain(matchFn: (filters: Record<string, unknown>) => unknown) {
  const filters: Record<string, unknown> = {}
  const chain: any = {
    eq: (col: string, val: unknown) => {
      filters[col] = val
      return chain
    },
    maybeSingle: () => Promise.resolve({ data: matchFn(filters) }),
  }
  return chain
}

function makeUpdateChain(applyFn: (filters: Record<string, unknown>) => { error: string | null }) {
  const filters: Record<string, unknown> = {}
  const chain: any = {
    eq: (col: string, val: unknown) => {
      filters[col] = val
      return chain
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(applyFn(filters)).then(resolve, reject),
  }
  return chain
}

const constructWebhookEventMock = vi.fn()
vi.mock('@/lib/stripe', () => ({
  constructWebhookEvent: (...args: unknown[]) => constructWebhookEventMock(...args),
  stripe: null,
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      state.fromCalls.push(table)

      if (table === 'partner_wallets') {
        return {
          select: () => makeSelectChain((filters) => findWallet(filters)),
          update: (patch: Record<string, unknown>) =>
            makeUpdateChain((filters) => {
              const row = findWallet(filters)
              if (row) Object.assign(row, patch)
              return { error: null }
            }),
        }
      }

      if (table === 'wallet_ledger') {
        return {
          select: () =>
            makeSelectChain((filters) =>
              state.ledger.find((l) =>
                Object.entries(filters).every(([k, v]) => (l as any)[k] === v)
              ) ?? null
            ),
          insert: (row: LedgerRow) => {
            state.ledger.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn((fnName: string, args: Record<string, unknown>) => {
      if (fnName === 'credit_wallet_balance') {
        const row = findWallet({ partner_account_id: args.p_partner_account_id })
        if (!row) return Promise.resolve({ data: null, error: { message: 'no wallet row' } })
        row.balance_usd = Number(row.balance_usd) + Number(args.p_amount_usd)
        return Promise.resolve({ data: row.balance_usd, error: null })
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fnName}` } })
    }),
  })),
}))

import { POST } from '@/app/api/webhooks/stripe/route'

function makeRequest(event: unknown) {
  return new NextRequest('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'test-signature' },
    body: JSON.stringify(event),
  })
}

function checkoutSessionCompletedEvent(opts: {
  sessionId: string
  customerId: string
  subscriptionId: string
  partnerAccountId?: string
  planTierKey?: string
  planBillingPeriod?: string
}) {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId,
        customer: opts.customerId,
        subscription: opts.subscriptionId,
        metadata: {
          purpose: 'plan_subscription',
          partner_account_id: opts.partnerAccountId,
          plan_tier_key: opts.planTierKey,
          plan_billing_period: opts.planBillingPeriod,
        },
      },
    },
  }
}

function invoicePaidEvent(opts: { invoiceId: string; customerId: string; subscriptionId: string; amountPaidCents: number }) {
  return {
    type: 'invoice.paid',
    data: {
      object: {
        id: opts.invoiceId,
        customer: opts.customerId,
        subscription: opts.subscriptionId,
        amount_paid: opts.amountPaidCents,
        lines: { data: [{ period: { end: 1755000000 } }] },
      },
    },
  }
}

function subscriptionUpdatedEvent(opts: { subscriptionId: string; customerId: string; status: string; purpose?: string }) {
  return {
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: opts.subscriptionId,
        customer: opts.customerId,
        status: opts.status,
        metadata: { purpose: opts.purpose ?? 'plan_subscription' },
      },
    },
  }
}

function subscriptionDeletedEvent(opts: { subscriptionId: string; customerId: string; purpose?: string }) {
  return {
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: opts.subscriptionId,
        customer: opts.customerId,
        metadata: { purpose: opts.purpose ?? 'plan_subscription' },
      },
    },
  }
}

describe('POST /api/webhooks/stripe — B2B-13 Plan tiers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.wallets = []
    state.ledger = []
    state.fromCalls = []
  })

  it('checkout.session.completed (plan branch): writes plan identity onto partner_wallets, balance_usd unchanged', async () => {
    state.wallets.push({
      partner_account_id: 'partner-1',
      stripe_customer_id: 'cus_1',
      balance_usd: 100,
      plan_tier_key: null,
      plan_billing_period: null,
      stripe_plan_subscription_id: null,
      plan_status: null,
      plan_current_period_end: null,
      funding_mechanism: null,
      reference_topup_amount_usd: null,
      low_balance_alert_fired_at: null,
    })

    constructWebhookEventMock.mockReturnValue(
      checkoutSessionCompletedEvent({
        sessionId: 'cs_1',
        customerId: 'cus_1',
        subscriptionId: 'sub_abc',
        partnerAccountId: 'partner-1',
        planTierKey: 'growth',
        planBillingPeriod: 'monthly',
      })
    )

    const res = await POST(makeRequest({ type: 'checkout.session.completed' }))
    expect(res.status).toBe(200)

    const wallet = findWallet({ partner_account_id: 'partner-1' })!
    expect(wallet.plan_tier_key).toBe('growth')
    expect(wallet.plan_billing_period).toBe('monthly')
    expect(wallet.stripe_plan_subscription_id).toBe('sub_abc')
    expect(wallet.funding_mechanism).toBe('plan_subscription')
    expect(wallet.plan_status).toBe('active')
    expect(wallet.balance_usd).toBe(100) // UNCHANGED — no credit at checkout time
  })

  it('invoice.paid: correlates via stripe_plan_subscription_id and credits the FIXED tier allowance, not invoice.amount_paid', async () => {
    state.wallets.push({
      partner_account_id: 'partner-1',
      stripe_customer_id: 'cus_1',
      balance_usd: 100,
      plan_tier_key: 'growth',
      plan_billing_period: 'monthly',
      stripe_plan_subscription_id: 'sub_abc',
      plan_status: 'active',
      plan_current_period_end: null,
      funding_mechanism: 'plan_subscription',
      reference_topup_amount_usd: null,
      low_balance_alert_fired_at: '2026-01-01T00:00:00.000Z',
    })

    constructWebhookEventMock.mockReturnValue(
      invoicePaidEvent({ invoiceId: 'in_1', customerId: 'cus_1', subscriptionId: 'sub_abc', amountPaidCents: 29900 })
    )

    const res = await POST(makeRequest({ type: 'invoice.paid' }))
    expect(res.status).toBe(200)

    const wallet = findWallet({ partner_account_id: 'partner-1' })!
    // growth/monthly includedAllowanceUsdMonthly = 200, NOT invoice.amount_paid ($299)
    expect(wallet.balance_usd).toBe(300) // 100 + 200
    expect(wallet.low_balance_alert_fired_at).toBeNull()
    expect(wallet.reference_topup_amount_usd).toBe(200)

    const ledgerRow = state.ledger.find((l) => l.stripe_object_id === 'in_1')!
    expect(ledgerRow.entry_type).toBe('plan_allowance_credit')
    expect(ledgerRow.delta_usd).toBe(200)
    expect(ledgerRow.partner_account_id).toBe('partner-1')
  })

  it('invoice.paid idempotency: a redelivered event does not double-credit', async () => {
    state.wallets.push({
      partner_account_id: 'partner-1',
      stripe_customer_id: 'cus_1',
      balance_usd: 100,
      plan_tier_key: 'starter',
      plan_billing_period: 'monthly',
      stripe_plan_subscription_id: 'sub_abc',
      plan_status: 'active',
      plan_current_period_end: null,
      funding_mechanism: 'plan_subscription',
      reference_topup_amount_usd: null,
      low_balance_alert_fired_at: null,
    })

    constructWebhookEventMock.mockReturnValue(
      invoicePaidEvent({ invoiceId: 'in_dup', customerId: 'cus_1', subscriptionId: 'sub_abc', amountPaidCents: 9900 })
    )

    await POST(makeRequest({ type: 'invoice.paid' }))
    await POST(makeRequest({ type: 'invoice.paid' })) // redelivery

    const wallet = findWallet({ partner_account_id: 'partner-1' })!
    expect(wallet.balance_usd).toBe(150) // 100 + 50 (starter monthly allowance), only once
    expect(state.ledger.filter((l) => l.stripe_object_id === 'in_dup')).toHaveLength(1)
  })

  it('invoice.paid fallthrough: no partner_wallets row has this stripe_plan_subscription_id -> existing B2B-04 auto-recharge logic runs unchanged, credits invoice.amount_paid', async () => {
    state.wallets.push({
      partner_account_id: 'partner-autorecharge',
      stripe_customer_id: 'cus_ar',
      balance_usd: 50,
      plan_tier_key: null,
      plan_billing_period: null,
      stripe_plan_subscription_id: null, // no Plan correlation for this partner
      plan_status: null,
      plan_current_period_end: null,
      funding_mechanism: 'subscription_auto_recharge',
      reference_topup_amount_usd: null,
      low_balance_alert_fired_at: null,
    })

    constructWebhookEventMock.mockReturnValue(
      invoicePaidEvent({ invoiceId: 'in_ar', customerId: 'cus_ar', subscriptionId: 'sub_ar_1', amountPaidCents: 10000 })
    )

    const res = await POST(makeRequest({ type: 'invoice.paid' }))
    expect(res.status).toBe(200)

    const wallet = findWallet({ partner_account_id: 'partner-autorecharge' })!
    expect(wallet.balance_usd).toBe(150) // 50 + $100 invoice.amount_paid — the OLD path
    expect(wallet.plan_tier_key).toBeNull() // never touched

    const ledgerRow = state.ledger.find((l) => l.stripe_object_id === 'in_ar')!
    expect(ledgerRow.entry_type).toBe('topup_subscription_recharge')
    expect(ledgerRow.delta_usd).toBe(100)
  })

  it('race case: invoice.paid arrives before checkout.session.completed -> falls through safely, then self-heals from the next invoice onward', async () => {
    // Wallet exists (created earlier in onboarding) but has NOT yet had its
    // Plan identity written — the checkout.session.completed event for this
    // subscription has not been processed yet.
    state.wallets.push({
      partner_account_id: 'partner-race',
      stripe_customer_id: 'cus_race',
      balance_usd: 20,
      plan_tier_key: null,
      plan_billing_period: null,
      stripe_plan_subscription_id: null,
      plan_status: null,
      plan_current_period_end: null,
      funding_mechanism: null,
      reference_topup_amount_usd: null,
      low_balance_alert_fired_at: null,
    })

    // Step 1: invoice.paid for the Plan subscription's first invoice arrives early.
    constructWebhookEventMock.mockReturnValue(
      invoicePaidEvent({ invoiceId: 'in_race_1', customerId: 'cus_race', subscriptionId: 'sub_race', amountPaidCents: 29900 })
    )
    const res1 = await POST(makeRequest({ type: 'invoice.paid' }))
    expect(res1.status).toBe(200) // no crash

    let wallet = findWallet({ partner_account_id: 'partner-race' })!
    // Falls through to the old auto-recharge path — credited the invoice's full amount.
    expect(wallet.balance_usd).toBe(319) // 20 + 299
    expect(wallet.plan_tier_key).toBeNull()

    // Step 2: the corresponding checkout.session.completed event is now processed.
    constructWebhookEventMock.mockReturnValue(
      checkoutSessionCompletedEvent({
        sessionId: 'cs_race',
        customerId: 'cus_race',
        subscriptionId: 'sub_race',
        partnerAccountId: 'partner-race',
        planTierKey: 'growth',
        planBillingPeriod: 'monthly',
      })
    )
    await POST(makeRequest({ type: 'checkout.session.completed' }))

    wallet = findWallet({ partner_account_id: 'partner-race' })!
    expect(wallet.plan_tier_key).toBe('growth')
    expect(wallet.stripe_plan_subscription_id).toBe('sub_race')
    expect(wallet.balance_usd).toBe(319) // still unchanged — checkout never credits

    // Step 3: every SUBSEQUENT invoice.paid for this subscription now correlates correctly as Plan.
    constructWebhookEventMock.mockReturnValue(
      invoicePaidEvent({ invoiceId: 'in_race_2', customerId: 'cus_race', subscriptionId: 'sub_race', amountPaidCents: 29900 })
    )
    await POST(makeRequest({ type: 'invoice.paid' }))

    wallet = findWallet({ partner_account_id: 'partner-race' })!
    expect(wallet.balance_usd).toBe(519) // 319 + 200 (growth monthly allowance, NOT another 299)
    const secondLedgerRow = state.ledger.find((l) => l.stripe_object_id === 'in_race_2')!
    expect(secondLedgerRow.entry_type).toBe('plan_allowance_credit')
    expect(secondLedgerRow.delta_usd).toBe(200)
  })

  it('customer.subscription.updated (past_due): sets plan_status only, balance/plan_tier_key/plan_billing_period untouched', async () => {
    state.wallets.push({
      partner_account_id: 'partner-1',
      stripe_customer_id: 'cus_1',
      balance_usd: 300,
      plan_tier_key: 'growth',
      plan_billing_period: 'monthly',
      stripe_plan_subscription_id: 'sub_abc',
      plan_status: 'active',
      plan_current_period_end: null,
      funding_mechanism: 'plan_subscription',
      reference_topup_amount_usd: 200,
      low_balance_alert_fired_at: null,
    })

    constructWebhookEventMock.mockReturnValue(
      subscriptionUpdatedEvent({ subscriptionId: 'sub_abc', customerId: 'cus_1', status: 'past_due' })
    )

    const res = await POST(makeRequest({ type: 'customer.subscription.updated' }))
    expect(res.status).toBe(200)

    const wallet = findWallet({ partner_account_id: 'partner-1' })!
    expect(wallet.plan_status).toBe('past_due')
    expect(wallet.balance_usd).toBe(300)
    expect(wallet.plan_tier_key).toBe('growth')
    expect(wallet.plan_billing_period).toBe('monthly')
  })

  it('customer.subscription.updated: no-op when subscription metadata.purpose is not plan_subscription (auto-recharge subscription)', async () => {
    state.wallets.push({
      partner_account_id: 'partner-ar',
      stripe_customer_id: 'cus_ar',
      balance_usd: 10,
      plan_tier_key: null,
      plan_billing_period: null,
      stripe_plan_subscription_id: null,
      plan_status: null,
      plan_current_period_end: null,
      funding_mechanism: 'subscription_auto_recharge',
      reference_topup_amount_usd: null,
      low_balance_alert_fired_at: null,
      stripe_subscription_id: 'sub_ar_1',
    })

    constructWebhookEventMock.mockReturnValue(
      subscriptionUpdatedEvent({ subscriptionId: 'sub_ar_1', customerId: 'cus_ar', status: 'past_due', purpose: 'unrelated_mechanism' })
    )

    const res = await POST(makeRequest({ type: 'customer.subscription.updated' }))
    expect(res.status).toBe(200)

    const wallet = findWallet({ partner_account_id: 'partner-ar' })!
    expect(wallet.plan_status).toBeNull() // never written
  })

  it('customer.subscription.deleted: sets plan_status=canceled, balance/plan_tier_key/plan_billing_period preserved (not cleared)', async () => {
    state.wallets.push({
      partner_account_id: 'partner-1',
      stripe_customer_id: 'cus_1',
      balance_usd: 300,
      plan_tier_key: 'growth',
      plan_billing_period: 'monthly',
      stripe_plan_subscription_id: 'sub_abc',
      plan_status: 'past_due',
      plan_current_period_end: null,
      funding_mechanism: 'plan_subscription',
      reference_topup_amount_usd: 200,
      low_balance_alert_fired_at: null,
    })

    constructWebhookEventMock.mockReturnValue(
      subscriptionDeletedEvent({ subscriptionId: 'sub_abc', customerId: 'cus_1' })
    )

    const res = await POST(makeRequest({ type: 'customer.subscription.deleted' }))
    expect(res.status).toBe(200)

    const wallet = findWallet({ partner_account_id: 'partner-1' })!
    expect(wallet.plan_status).toBe('canceled')
    expect(wallet.balance_usd).toBe(300) // unchanged
    expect(wallet.plan_tier_key).toBe('growth') // NOT cleared
    expect(wallet.plan_billing_period).toBe('monthly') // NOT cleared
  })

  it('customer.subscription.updated: a stale event for an id no longer current is a no-op by construction (WHERE matches zero rows)', async () => {
    state.wallets.push({
      partner_account_id: 'partner-1',
      stripe_customer_id: 'cus_1',
      balance_usd: 300,
      plan_tier_key: 'growth',
      plan_billing_period: 'monthly',
      stripe_plan_subscription_id: 'sub_new', // already re-subscribed to a NEW subscription id
      plan_status: 'active',
      plan_current_period_end: null,
      funding_mechanism: 'plan_subscription',
      reference_topup_amount_usd: 200,
      low_balance_alert_fired_at: null,
    })

    // A late event for the OLD (now-stale) subscription id.
    constructWebhookEventMock.mockReturnValue(
      subscriptionUpdatedEvent({ subscriptionId: 'sub_old_stale', customerId: 'cus_1', status: 'past_due' })
    )

    const res = await POST(makeRequest({ type: 'customer.subscription.updated' }))
    expect(res.status).toBe(200)

    const wallet = findWallet({ partner_account_id: 'partner-1' })!
    expect(wallet.plan_status).toBe('active') // untouched — filter matched zero rows
  })
})
