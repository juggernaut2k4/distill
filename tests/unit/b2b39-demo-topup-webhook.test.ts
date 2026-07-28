import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §6, AT-8). Tests for
 * app/api/webhooks/stripe/route.ts's new 'demo_topup_purchase' checkout.session.completed branch —
 * credits demo_minutes_balance via the RPC, records a wallet_ledger row, idempotent under webhook
 * redelivery, and never touches trial_minutes_used/test_minutes_balance.
 */

const state = {
  ledgerAlreadyRecorded: false,
  creditRpcResult: { data: 35 as number | null, error: null as { message: string } | null },
  walletBalanceUsdRow: { balance_usd: 0 } as { balance_usd: number } | null,
  fakeEvent: null as { type: string; data: { object: unknown } } | null,
}
const ledgerInserts: Record<string, unknown>[] = []
const rpcCalls: { fn: string; args: unknown }[] = []

vi.mock('@/lib/stripe', () => ({
  constructWebhookEvent: vi.fn(() => state.fakeEvent),
  stripe: null,
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'wallet_ledger') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: state.ledgerAlreadyRecorded ? { id: 'ledger-1' } : null })),
              })),
            })),
          })),
          insert: vi.fn((row: Record<string, unknown>) => {
            ledgerInserts.push(row)
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }
      if (table === 'partner_wallets') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.walletBalanceUsdRow })),
            })),
          })),
          update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(state.creditRpcResult)
    }),
  })),
}))

import { POST } from '@/app/api/webhooks/stripe/route'

beforeEach(() => {
  vi.clearAllMocks()
  state.ledgerAlreadyRecorded = false
  state.creditRpcResult = { data: 35, error: null }
  state.walletBalanceUsdRow = { balance_usd: 0 }
  state.fakeEvent = null
  ledgerInserts.length = 0
  rpcCalls.length = 0
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fixture'
})

function makeRequest() {
  return new NextRequest('https://hello-clio.com/api/webhooks/stripe', {
    method: 'POST',
    body: '{}',
    headers: { 'stripe-signature': 't=1,v1=sig' },
  })
}

describe('POST /api/webhooks/stripe — demo_topup_purchase branch', () => {
  it('AT-8: credits demo_minutes_balance via the RPC and records a demo_topup_purchase wallet_ledger row', async () => {
    state.fakeEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          amount_total: 180,
          customer: 'cus_1',
          metadata: { purpose: 'demo_topup_purchase', partner_account_id: 'acct-reseller-1', demo_topup_tier: 'hr2', demo_topup_minutes: '120' },
        },
      },
    }
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(rpcCalls).toContainEqual({
      fn: 'credit_demo_minutes_balance',
      args: { p_partner_account_id: 'acct-reseller-1', p_minutes: 120 },
    })
    expect(ledgerInserts).toHaveLength(1)
    expect(ledgerInserts[0]).toMatchObject({
      partner_account_id: 'acct-reseller-1',
      entry_type: 'demo_topup_purchase',
      resulting_demo_minutes_balance: 35,
      stripe_object_id: 'cs_test_1',
    })
  })

  it('is idempotent — a webhook redelivery for the same Checkout Session never double-credits', async () => {
    state.ledgerAlreadyRecorded = true
    state.fakeEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          amount_total: 180,
          customer: 'cus_1',
          metadata: { purpose: 'demo_topup_purchase', partner_account_id: 'acct-reseller-1', demo_topup_tier: 'hr2', demo_topup_minutes: '120' },
        },
      },
    }
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(rpcCalls).toHaveLength(0)
    expect(ledgerInserts).toHaveLength(0)
  })

  it('never touches trial_minutes_used/test_minutes_balance — structurally separate from real test-block top-ups', async () => {
    state.fakeEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_2',
          amount_total: 75,
          metadata: { purpose: 'demo_topup_purchase', partner_account_id: 'acct-reseller-1', demo_topup_tier: 'min30', demo_topup_minutes: '30' },
        },
      },
    }
    await POST(makeRequest())
    expect(rpcCalls.map((c) => c.fn)).not.toContain('credit_test_minutes_balance')
    expect(rpcCalls.map((c) => c.fn)).not.toContain('consume_trial_and_test_minutes')
  })

  it('warns and skips (still 200s) when partner_account_id/minutes is missing from metadata', async () => {
    state.fakeEvent = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_3', metadata: { purpose: 'demo_topup_purchase' } } },
    }
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(rpcCalls).toHaveLength(0)
  })
})
