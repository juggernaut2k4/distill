import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-34 Piece 3 (docs/specs/B2B-34-requirement-document.md Part E §7) —
 * aggregation-logic tests for lib/partner/usage-summary.ts: the pure
 * grouping/rounding functions run with no Supabase mocking, and the two
 * higher-level fetchers (getMinutes30dByReseller, getResellerUsageSummary)
 * run against a mocked Supabase admin client — no real network calls,
 * following this codebase's existing chainable/thenable query-builder mock
 * convention (tests/integration/partner-usage-api.test.ts).
 */

function makeQueryBuilder(result: { data: unknown[] | null; error: { message: string } | null }) {
  const calls: { method: string; args: unknown[] }[] = []
  const builder: Record<string, unknown> = {}
  const chainable = (method: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    })
  builder.eq = chainable('eq')
  builder.in = chainable('in')
  builder.gte = chainable('gte')
  builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
  return { builder, calls }
}

const fromMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: (...args: unknown[]) => fromMock(...args),
  })),
}))

import {
  sumMinutes,
  groupMinutesByPartnerAccount,
  groupMinutesByClient,
  getMinutes30dByReseller,
  getResellerUsageSummary,
} from '@/lib/partner/usage-summary'

describe('sumMinutes', () => {
  it('sums quantity across rows and rounds to the nearest whole minute (Part E §4: "no decimals... rounded")', () => {
    expect(sumMinutes([{ quantity: 89.4 }, { quantity: 30.6 }])).toBe(120)
  })

  it('returns 0 for an empty row set', () => {
    expect(sumMinutes([])).toBe(0)
  })

  it('handles string quantities (Supabase NUMERIC columns deserialize as strings)', () => {
    expect(sumMinutes([{ quantity: '10.2' }, { quantity: '5.3' }])).toBe(16) // 15.5 -> 16
  })
})

describe('groupMinutesByPartnerAccount', () => {
  it('sums quantity per reseller and rounds each reseller total independently', () => {
    const map = groupMinutesByPartnerAccount([
      { partner_account_id: 'r1', quantity: 10.6 },
      { partner_account_id: 'r1', quantity: 5.1 },
      { partner_account_id: 'r2', quantity: 3.2 },
    ])
    expect(map.get('r1')).toBe(16) // 15.7 -> 16
    expect(map.get('r2')).toBe(3)
  })

  it('returns an empty map for no rows', () => {
    expect(groupMinutesByPartnerAccount([]).size).toBe(0)
  })
})

describe('groupMinutesByClient', () => {
  it('groups by end_client_id, sums, rounds, and sorts descending by minutes (Part E §7 acceptance test: 89 + 31 = 120)', () => {
    const breakdown = groupMinutesByClient([
      { end_client_id: 'client-self', quantity: 31 },
      { end_client_id: 'client-acme', quantity: 89 },
    ])
    expect(breakdown).toEqual([
      { client_id: 'client-acme', minutes: 89 },
      { client_id: 'client-self', minutes: 31 },
    ])
    const total = breakdown.reduce((sum, row) => sum + row.minutes, 0)
    expect(total).toBe(120)
  })

  it('sums multiple rows for the same client before sorting', () => {
    const breakdown = groupMinutesByClient([
      { end_client_id: 'client-a', quantity: 20 },
      { end_client_id: 'client-b', quantity: 100 },
      { end_client_id: 'client-a', quantity: 30 },
    ])
    expect(breakdown).toEqual([
      { client_id: 'client-b', minutes: 100 },
      { client_id: 'client-a', minutes: 50 },
    ])
  })

  it('skips rows with a null end_client_id instead of throwing (Part E §9 edge case)', () => {
    const breakdown = groupMinutesByClient([
      { end_client_id: null, quantity: 5 },
      { end_client_id: 'client-a', quantity: 10 },
    ])
    expect(breakdown).toEqual([{ client_id: 'client-a', minutes: 10 }])
  })

  it('returns an empty array for no rows (zero-usage edge case)', () => {
    expect(groupMinutesByClient([])).toEqual([])
  })
})

describe('getMinutes30dByReseller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an empty map without querying Supabase when resellerIds is empty', async () => {
    const map = await getMinutes30dByReseller([])
    expect(map.size).toBe(0)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('queries usage_events filtered by event_type=voice_minute, test_mode=false, and a 30-day gte window, batched via .in() (Part E §6.1 list-page query)', async () => {
    const { builder, calls } = makeQueryBuilder({
      data: [
        { partner_account_id: 'r1', quantity: 89 },
        { partner_account_id: 'r1', quantity: 31 },
        { partner_account_id: 'r2', quantity: 18 },
      ],
      error: null,
    })
    fromMock.mockImplementation((table: string) => {
      if (table === 'usage_events') return { select: vi.fn(() => builder) }
      throw new Error(`Unexpected table: ${table}`)
    })

    const map = await getMinutes30dByReseller(['r1', 'r2'])

    expect(map.get('r1')).toBe(120)
    expect(map.get('r2')).toBe(18)

    const eqCalls = calls.filter((c) => c.method === 'eq')
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['event_type', 'voice_minute'] })
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['test_mode', false] })
    const inCall = calls.find((c) => c.method === 'in')
    expect(inCall?.args).toEqual(['partner_account_id', ['r1', 'r2']])
    expect(calls.some((c) => c.method === 'gte' && c.args[0] === 'occurred_at')).toBe(true)
  })

  it('falls back to an empty map (→ minutes_30d: 0 for every row) when the query errors (Part E §8)', async () => {
    const { builder } = makeQueryBuilder({ data: null, error: { message: 'db unreachable' } })
    fromMock.mockImplementation((table: string) => {
      if (table === 'usage_events') return { select: vi.fn(() => builder) }
      throw new Error(`Unexpected table: ${table}`)
    })

    const map = await getMinutes30dByReseller(['r1'])
    expect(map.size).toBe(0)
  })
})

describe('getResellerUsageSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Wires up the three usage_events queries getResellerUsageSummary issues,
   * in the exact order it issues them (all-time total, 30-day total,
   * per-client breakdown) — relying on Promise.all's array elements being
   * constructed left-to-right synchronously, same assumption this
   * codebase's other Promise.all-based mocks already make.
   */
  function wireUsageEvents(
    allTime: { data: unknown[] | null; error: { message: string } | null },
    windowTotal: { data: unknown[] | null; error: { message: string } | null },
    breakdown: { data: unknown[] | null; error: { message: string } | null },
    partnerAccounts?: { data: unknown[] | null; error: { message: string } | null }
  ) {
    const builders = [makeQueryBuilder(allTime), makeQueryBuilder(windowTotal), makeQueryBuilder(breakdown)]
    let callIndex = 0
    const namesBuilder = partnerAccounts ? makeQueryBuilder(partnerAccounts) : null

    fromMock.mockImplementation((table: string) => {
      if (table === 'usage_events') {
        const { builder } = builders[callIndex]
        callIndex += 1
        return { select: vi.fn(() => builder) }
      }
      if (table === 'partner_accounts') {
        if (!namesBuilder) throw new Error('partner_accounts queried but no fixture wired')
        return { select: vi.fn(() => namesBuilder.builder) }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    return { builders, namesBuilder }
  }

  it('returns the 30-day total, all-time total, and a per-client breakdown resolved to display names (Part E §7 acceptance test)', async () => {
    wireUsageEvents(
      { data: [{ quantity: 89 }, { quantity: 31 }, { quantity: 478 }], error: null }, // all-time: 598
      { data: [{ quantity: 89 }, { quantity: 31 }], error: null }, // 30d: 120
      {
        data: [
          { end_client_id: 'acme-id', quantity: 89 },
          { end_client_id: 'self-id', quantity: 31 },
        ],
        error: null,
      },
      {
        data: [
          { id: 'acme-id', name: 'Acme Corp' },
          { id: 'self-id', name: 'Self (direct sessions)' },
        ],
        error: null,
      }
    )

    const summary = await getResellerUsageSummary('reseller-1')

    expect(summary.success).toBe(true)
    expect(summary.minutes_30d).toBe(120)
    expect(summary.minutes_all_time).toBe(598)
    expect(summary.breakdown).toEqual([
      { client_id: 'acme-id', client_name: 'Acme Corp', minutes: 89 },
      { client_id: 'self-id', client_name: 'Self (direct sessions)', minutes: 31 },
    ])

    const breakdownTotal = summary.breakdown.reduce((sum, row) => sum + row.minutes, 0)
    expect(breakdownTotal).toBe(summary.minutes_30d)
  })

  it('reports 0 for the 30-day total and an empty breakdown with zero usage in the trailing window, while still reporting the all-time total (Part E §7 acceptance test)', async () => {
    wireUsageEvents({ data: [{ quantity: 250 }], error: null }, { data: [], error: null }, { data: [], error: null })

    const summary = await getResellerUsageSummary('reseller-2')

    expect(summary.success).toBe(true)
    expect(summary.minutes_30d).toBe(0)
    expect(summary.minutes_all_time).toBe(250)
    expect(summary.breakdown).toEqual([])
    // No client-id enumeration/name lookup should run when there's nothing to resolve.
    expect(fromMock).not.toHaveBeenCalledWith('partner_accounts')
  })

  it('returns success:false with all-zero totals when any of the three usage_events queries errors (Part E §8)', async () => {
    wireUsageEvents(
      { data: [{ quantity: 10 }], error: null },
      { data: null, error: { message: 'db unreachable' } },
      { data: [], error: null }
    )

    const summary = await getResellerUsageSummary('reseller-3')
    expect(summary).toEqual({ success: false, minutes_30d: 0, minutes_all_time: 0, breakdown: [] })
  })

  it('returns success:false when the per-client display-name lookup (partner_accounts) fails', async () => {
    wireUsageEvents(
      { data: [{ quantity: 10 }], error: null },
      { data: [{ quantity: 10 }], error: null },
      { data: [{ end_client_id: 'c1', quantity: 10 }], error: null },
      { data: null, error: { message: 'nope' } }
    )

    const summary = await getResellerUsageSummary('reseller-4')
    expect(summary).toEqual({ success: false, minutes_30d: 0, minutes_all_time: 0, breakdown: [] })
  })

  it('filters every usage_events query by partner_account_id/event_type=voice_minute/test_mode=false, and applies the 30-day gte only to the windowed queries, never the all-time query (Part E §6.1)', async () => {
    const { builders } = wireUsageEvents({ data: [], error: null }, { data: [], error: null }, { data: [], error: null })

    await getResellerUsageSummary('reseller-5')

    for (const { calls } of builders) {
      const eqCalls = calls.filter((c) => c.method === 'eq')
      expect(eqCalls).toContainEqual({ method: 'eq', args: ['partner_account_id', 'reseller-5'] })
      expect(eqCalls).toContainEqual({ method: 'eq', args: ['event_type', 'voice_minute'] })
      expect(eqCalls).toContainEqual({ method: 'eq', args: ['test_mode', false] })
    }

    const [allTimeCalls, windowTotalCalls, breakdownCalls] = builders.map((b) => b.calls)
    expect(allTimeCalls.some((c) => c.method === 'gte')).toBe(false)
    expect(windowTotalCalls.some((c) => c.method === 'gte' && c.args[0] === 'occurred_at')).toBe(true)
    expect(breakdownCalls.some((c) => c.method === 'gte' && c.args[0] === 'occurred_at')).toBe(true)
  })
})
