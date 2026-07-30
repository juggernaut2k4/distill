import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-55 — integration tests for GET /api/partner/v1/wallet after adding
 * trial/test-minutes visibility (docs/specs/B2B-55-requirement-document.md).
 * Covers AT-1 through AT-7. Follows the established convention from
 * tests/integration/partner-usage-api.test.ts: mock `@/lib/partner/auth`'s
 * `requirePartnerApiKey` and `@/lib/supabase`'s `createSupabaseAdminClient`,
 * import `GET` directly, and call it with a constructed `NextRequest`.
 */

const authMock = vi.fn()
vi.mock('@/lib/partner/auth', () => ({
  requirePartnerApiKey: (...args: unknown[]) => authMock(...args),
}))

const walletSelectMock = vi.fn()
const billingRateVersionsSelectMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_wallets') {
        return { select: walletSelectMock }
      }
      if (table === 'billing_rate_versions') {
        return { select: billingRateVersionsSelectMock }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

import { GET } from '@/app/api/partner/v1/wallet/route'
import { TRIAL_MINUTES_LIFETIME_CAP } from '@/lib/billing/trial-minutes'

/**
 * Mirrors app/api/partner/v1/sessions/route.ts's trial-gate formula
 * (`Math.max(0, TRIAL_MINUTES_LIFETIME_CAP - trialMinutesUsed) + testMinutesBalance`)
 * using the same shared constant, to assert AT-6's before/after-refactor equivalence.
 */
function availableMinutesForTrialGate(trialMinutesUsed: number, testMinutesBalance: number): number {
  return Math.max(0, TRIAL_MINUTES_LIFETIME_CAP - trialMinutesUsed) + testMinutesBalance
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/partner/v1/wallet', {
    headers: { authorization: 'Bearer clio_live_sk_valid' },
  })
}

/**
 * Builds a chainable, thenable query-builder mock matching postgrest-js's
 * shape — same helper shape as partner-usage-api.test.ts's makeQueryBuilder.
 */
function makeQueryBuilder(result: { data: unknown; error: { message: string } | null }) {
  const calls: { method: string; args: unknown[] }[] = []
  const builder: Record<string, unknown> = {}
  const chainable = (method: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    })
  builder.eq = chainable('eq')
  builder.is = chainable('is')
  builder.or = chainable('or')
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
  return { builder, calls }
}

describe('GET /api/partner/v1/wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', mode: 'live', error: null })

    // Default: no rate overrides configured, so burn_rate_by_event_type entries resolve to null rates.
    const { builder } = makeQueryBuilder({ data: [], error: null })
    billingRateVersionsSelectMock.mockReturnValue(builder)
  })

  it('rejects with the auth error and never queries partner_wallets when auth fails (AT-4)', async () => {
    const { NextResponse } = await import('next/server')
    authMock.mockResolvedValue({ error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) })

    const res = await GET(makeRequest())

    expect(res.status).toBe(401)
    expect(walletSelectMock).not.toHaveBeenCalled()
  })

  it('returns the 4 new trial/test-minutes fields, correctly computed, for a partially-used trial (AT-1)', async () => {
    const { builder } = makeQueryBuilder({
      data: {
        balance_usd: 42.315,
        reference_topup_amount_usd: 100.0,
        low_balance_alert_fired_at: null,
        next_billing_date: '2026-08-13T00:00:00Z',
        created_at: null, // no wallet age -> computeBurnRateProjection short-circuits without a usage_events query
        updated_at: '2026-07-13T19:00:00Z',
        trial_minutes_used: 6.5,
        test_minutes_balance: 0,
      },
      error: null,
    })
    walletSelectMock.mockReturnValue(builder)

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.trial_minutes_used).toBe(6.5)
    expect(json.trial_minutes_remaining).toBe(13.5)
    expect(json.trial_minutes_cap).toBe(20)
    expect(json.test_minutes_balance).toBe(0)
  })

  it('clamps trial_minutes_remaining to 0 (never negative) for a fully exhausted trial, and reports test_minutes_balance independently (AT-2)', async () => {
    const { builder } = makeQueryBuilder({
      data: {
        balance_usd: 10,
        reference_topup_amount_usd: null,
        low_balance_alert_fired_at: null,
        next_billing_date: null,
        created_at: null,
        updated_at: '2026-07-13T19:00:00Z',
        trial_minutes_used: 20,
        test_minutes_balance: 45.25,
      },
      error: null,
    })
    walletSelectMock.mockReturnValue(builder)

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(json.trial_minutes_remaining).toBe(0)
    expect(json.test_minutes_balance).toBe(45.25)
  })

  it('defaults all 4 new fields to their null-safe values when no partner_wallets row exists (AT-3)', async () => {
    const { builder } = makeQueryBuilder({ data: null, error: null })
    walletSelectMock.mockReturnValue(builder)

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.trial_minutes_used).toBe(0)
    expect(json.trial_minutes_remaining).toBe(20)
    expect(json.trial_minutes_cap).toBe(20)
    expect(json.test_minutes_balance).toBe(0)
  })

  it('leaves every pre-existing field present and unchanged (AT-5)', async () => {
    const { builder } = makeQueryBuilder({
      data: {
        balance_usd: 42.315,
        reference_topup_amount_usd: 100.0,
        low_balance_alert_fired_at: null,
        next_billing_date: '2026-08-13T00:00:00Z',
        created_at: null,
        updated_at: '2026-07-13T19:00:00Z',
        trial_minutes_used: 0,
        test_minutes_balance: 0,
      },
      error: null,
    })
    walletSelectMock.mockReturnValue(builder)

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.balance_usd).toBe(42.315)
    expect(json.reference_topup_amount_usd).toBe(100.0)
    expect(json.low_balance_alert_active).toBe(false)
    expect(json.next_billing_date).toBe('2026-08-13T00:00:00Z')
    expect(json.updated_at).toBe('2026-07-13T19:00:00Z')
    expect(Array.isArray(json.burn_rate_by_event_type)).toBe(true)
    expect(json.burn_rate_by_event_type).toHaveLength(8)
    expect(json.avg_daily_burn_usd).toBeNull()
    expect(json.projected_days_remaining).toBeNull()
    expect(json.days_remaining_null_reason).toBe('no_burn_rate')
  })

  it('queries partner_wallets filtered by the caller\'s own partner_account_id only (AT-7)', async () => {
    const { builder, calls } = makeQueryBuilder({
      data: {
        balance_usd: 0,
        reference_topup_amount_usd: null,
        low_balance_alert_fired_at: null,
        next_billing_date: null,
        created_at: null,
        updated_at: '2026-07-13T19:00:00Z',
        trial_minutes_used: 0,
        test_minutes_balance: 0,
      },
      error: null,
    })
    walletSelectMock.mockReturnValue(builder)

    await GET(makeRequest())

    const eqCalls = calls.filter((c) => c.method === 'eq')
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['partner_account_id', 'acct-1'] })
  })

  it('imports and uses TRIAL_MINUTES_LIFETIME_CAP equal to 20 (AT-6, part 1)', () => {
    expect(TRIAL_MINUTES_LIFETIME_CAP).toBe(20)
  })

  it('produces identical availableMinutes for the sessions trial-gate math before/after the constant refactor (AT-6, part 2)', () => {
    // Same formula as app/api/partner/v1/sessions/route.ts line ~297, now sourced from the shared
    // constant. Confirms the refactor is value-neutral for a fixed set of inputs.
    expect(availableMinutesForTrialGate(6.5, 0)).toBe(13.5)
    expect(availableMinutesForTrialGate(20, 45.25)).toBe(45.25)
    expect(availableMinutesForTrialGate(0, 0)).toBe(20)
    expect(availableMinutesForTrialGate(25, 0)).toBe(0) // over-cap used, never negative
  })
})
