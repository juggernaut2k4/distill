import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-70 (docs/specs/B2B-70-requirement-document.md §6.5) — lib/partner/wallet-gate.ts tests.
 * resolveWalletGate() is a NEW, standalone extraction of the logic
 * app/api/partner/v1/sessions/route.ts inlines directly (that file is on the B2B-70 do-not-touch
 * list) — these tests verify the extraction preserves the exact same semantics/status codes as that
 * route's own inline test-mode/live-mode branches, using the same vi.doMock('@/lib/supabase', ...) +
 * dynamic import() convention as tests/unit/partner-session-trace-log.test.ts (createSupabaseAdminClient
 * is called fresh inside each function, so it must be mocked before the module under test is imported).
 */

const PARTNER_ACCOUNT_ID = 'partner-1'

function mockSupabaseWith(walletRow: Record<string, unknown> | null) {
  vi.doMock('@/lib/supabase', () => ({
    createSupabaseAdminClient: () => ({
      from: (table: string) => {
        if (table === 'partner_wallets') {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => ({ data: walletRow ? [walletRow] : [], error: null }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }),
  }))
}

beforeEach(() => {
  vi.resetModules()
})

describe('resolveWalletGate — test mode', () => {
  it('returns card_required when no payment method is on file', async () => {
    mockSupabaseWith({ trial_minutes_used: 0, test_minutes_balance: 0, stripe_default_payment_method_id: null })
    const { resolveWalletGate } = await import('@/lib/partner/wallet-gate')
    const result = await resolveWalletGate(PARTNER_ACCOUNT_ID, 'test', 15)
    expect(result).toEqual({ status: 'card_required' })
  })

  it('returns card_required when no wallet row exists at all', async () => {
    mockSupabaseWith(null)
    const { resolveWalletGate } = await import('@/lib/partner/wallet-gate')
    const result = await resolveWalletGate(PARTNER_ACCOUNT_ID, 'test', 15)
    expect(result).toEqual({ status: 'card_required' })
  })

  it('returns trial_exhausted when a card is on file but the trial/test-minutes allowance is used up', async () => {
    mockSupabaseWith({ trial_minutes_used: 20, test_minutes_balance: 0, stripe_default_payment_method_id: 'pm_123' })
    const { resolveWalletGate } = await import('@/lib/partner/wallet-gate')
    const result = await resolveWalletGate(PARTNER_ACCOUNT_ID, 'test', 15)
    expect(result).toEqual({ status: 'trial_exhausted' })
  })

  it('returns ok with the combined trial + test-minutes balance when allowance remains', async () => {
    mockSupabaseWith({ trial_minutes_used: 5, test_minutes_balance: 30, stripe_default_payment_method_id: 'pm_123' })
    const { resolveWalletGate } = await import('@/lib/partner/wallet-gate')
    const result = await resolveWalletGate(PARTNER_ACCOUNT_ID, 'test', 15)
    // TRIAL_MINUTES_LIFETIME_CAP is 20 (lib/billing/trial-minutes) — max(0, 20-5) + 30 = 45.
    expect(result).toEqual({ status: 'ok', availableMinutes: 45, affordableMinutes: null })
  })
})

describe('resolveWalletGate — live mode', () => {
  it('returns funding_required when no payment method is on file', async () => {
    mockSupabaseWith({ stripe_default_payment_method_id: null, balance_usd: 0 })
    const { resolveWalletGate } = await import('@/lib/partner/wallet-gate')
    const result = await resolveWalletGate(PARTNER_ACCOUNT_ID, 'live', 15)
    expect(result).toEqual({ status: 'funding_required' })
  })

  it('returns funding_required when no wallet row exists at all', async () => {
    mockSupabaseWith(null)
    const { resolveWalletGate } = await import('@/lib/partner/wallet-gate')
    const result = await resolveWalletGate(PARTNER_ACCOUNT_ID, 'live', 15)
    expect(result).toEqual({ status: 'funding_required' })
  })

  it('returns ok with no per-minute enforcement when no rate is configured (never over-blocks)', async () => {
    mockSupabaseWith({ stripe_default_payment_method_id: 'pm_123', balance_usd: 0 })
    vi.doMock('@/lib/partner/webhooks', () => ({ resolveEffectiveRate: async () => null }))
    const { resolveWalletGate } = await import('@/lib/partner/wallet-gate')
    const result = await resolveWalletGate(PARTNER_ACCOUNT_ID, 'live', 15)
    expect(result).toEqual({ status: 'ok', availableMinutes: null, affordableMinutes: null })
  })

  it('returns balance_exhausted when the balance cannot cover the expected duration at the configured rate', async () => {
    mockSupabaseWith({ stripe_default_payment_method_id: 'pm_123', balance_usd: 1 })
    vi.doMock('@/lib/partner/webhooks', () => ({ resolveEffectiveRate: async () => ({ rate_usd: 0.5 }) }))
    const { resolveWalletGate } = await import('@/lib/partner/wallet-gate')
    // 15 minutes * $0.50/min = $7.50 > $1 balance.
    const result = await resolveWalletGate(PARTNER_ACCOUNT_ID, 'live', 15)
    expect(result).toEqual({ status: 'balance_exhausted' })
  })

  it('returns ok with affordableMinutes computed from balance / rate when balance covers the expected duration', async () => {
    mockSupabaseWith({ stripe_default_payment_method_id: 'pm_123', balance_usd: 10 })
    vi.doMock('@/lib/partner/webhooks', () => ({ resolveEffectiveRate: async () => ({ rate_usd: 0.5 }) }))
    const { resolveWalletGate } = await import('@/lib/partner/wallet-gate')
    const result = await resolveWalletGate(PARTNER_ACCOUNT_ID, 'live', 15)
    expect(result).toEqual({ status: 'ok', availableMinutes: null, affordableMinutes: 20 })
  })
})
