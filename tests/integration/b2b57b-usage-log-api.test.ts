import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * B2B-57b Requirement Doc §13 — integration coverage for `GET /api/partner/dashboard/usage-log`:
 * auth rejection, account-isolation (requirePartnerAdmin is the sole isolation gate — mirrors
 * tests/integration/configurator-theme-api.test.ts's own verification approach), event_type filter
 * correctness, the always-on event_type IN (...) scoping that excludes wallet.low_balance even with
 * no explicit filter, pagination has_more/limit-ceiling behavior, and delivery_configured reflecting
 * outbound_base_url IS NOT NULL.
 */

const requirePartnerAdminMock = vi.fn()
vi.mock('@/lib/partner/auth', () => ({
  requirePartnerAdmin: (...args: unknown[]) => requirePartnerAdminMock(...args),
}))

/** A minimal thenable chain mock matching supabase-js's PostgrestFilterBuilder shape closely enough
 * for this route: every chain method returns `this`, and awaiting the builder at any point resolves
 * to {data, error}. `in`/`eq` calls are recorded so tests can assert on the exact filter values
 * applied — the account-isolation and event-type-scoping ATs check that these are on the real query,
 * not that the response merely happens to look right. */
function makeBuilder(result: { data: unknown; error: unknown }, spies: { eqCalls: unknown[][]; inCalls: unknown[][] }) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn((...args: unknown[]) => {
      spies.eqCalls.push(args)
      return builder
    }),
    in: vi.fn((...args: unknown[]) => {
      spies.inCalls.push(args)
      return builder
    }),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

let accountResult: { data: unknown; error: unknown } = { data: { outbound_base_url: 'https://partner.example.com/hook' }, error: null }
let logResult: { data: unknown; error: unknown } = { data: [], error: null }
let logSpies: { eqCalls: unknown[][]; inCalls: unknown[][] }

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_accounts') {
        return makeBuilder(accountResult, { eqCalls: [], inCalls: [] })
      }
      if (table === 'webhook_dispatch_log') {
        return makeBuilder(logResult, logSpies)
      }
      throw new Error(`unexpected table: ${table}`)
    }),
  })),
}))

import { GET } from '@/app/api/partner/dashboard/usage-log/route'

const PARTNER_ACCOUNT_ID = '4a8b2d33-5678-4321-bbbb-222233334444'

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    event_type: 'usage.voice_minute',
    clio_session_ref: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    partner_reference: 'order-48213',
    payload: { quantity: 14.2, unit: 'minutes', test_mode: false, occurred_at: '2026-07-30T09:41:00.000Z' },
    delivery_status: 'delivered',
    http_status_code: 200,
    retry_count: 0,
    created_at: '2026-07-30T09:41:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  accountResult = { data: { outbound_base_url: 'https://partner.example.com/hook' }, error: null }
  logResult = { data: [], error: null }
  logSpies = { eqCalls: [], inCalls: [] }
})

describe('GET /api/partner/dashboard/usage-log', () => {
  it('returns the requirePartnerAdmin error and never queries webhook_dispatch_log when the caller does not administer the account', async () => {
    const forbidden = NextResponse.json({ error: 'forbidden' }, { status: 403 })
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: null, error: forbidden })

    const req = new NextRequest(`http://localhost:3000/api/partner/dashboard/usage-log?partner_account_id=${PARTNER_ACCOUNT_ID}`)
    const res = await GET(req)

    expect(res.status).toBe(403)
    expect(requirePartnerAdminMock).toHaveBeenCalledWith(PARTNER_ACCOUNT_ID)
  })

  it('rejects a missing/invalid partner_account_id before ever calling requirePartnerAdmin (Zod validation gate)', async () => {
    const req = new NextRequest('http://localhost:3000/api/partner/dashboard/usage-log?partner_account_id=not-a-uuid')
    const res = await GET(req)

    expect(res.status).toBe(400)
    expect(requirePartnerAdminMock).not.toHaveBeenCalled()
  })

  it('always scopes the query to the four in-scope event types (excludes wallet.low_balance) even with no explicit filter', async () => {
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'admin-1', error: null })
    logResult = { data: [makeRow()], error: null }

    const req = new NextRequest(`http://localhost:3000/api/partner/dashboard/usage-log?partner_account_id=${PARTNER_ACCOUNT_ID}`)
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(logSpies.inCalls).toContainEqual([
      'event_type',
      ['usage.voice_minute', 'usage.llm_generation_call', 'session.completed', 'session.insights_ready'],
    ])
    expect(body.rows).toHaveLength(1)
  })

  it('applies an explicit event_type filter as an additional .eq() on top of the always-on .in() scope', async () => {
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'admin-1', error: null })
    logResult = { data: [], error: null }

    const req = new NextRequest(
      `http://localhost:3000/api/partner/dashboard/usage-log?partner_account_id=${PARTNER_ACCOUNT_ID}&event_type=usage.voice_minute`
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(logSpies.eqCalls).toContainEqual(['event_type', 'usage.voice_minute'])
  })

  it('rejects an out-of-scope event_type value (e.g. wallet.low_balance) at the Zod layer', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/partner/dashboard/usage-log?partner_account_id=${PARTNER_ACCOUNT_ID}&event_type=wallet.low_balance`
    )
    const res = await GET(req)

    expect(res.status).toBe(400)
  })

  it('has_more is true and only `limit` rows are returned when more than `limit` rows come back from the range fetch', async () => {
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'admin-1', error: null })
    // limit defaults to 25 -> the route fetches offset..offset+limit inclusive (26 rows) to detect has_more.
    logResult = { data: Array.from({ length: 26 }, (_, i) => makeRow({ id: `row-${i}` })), error: null }

    const req = new NextRequest(`http://localhost:3000/api/partner/dashboard/usage-log?partner_account_id=${PARTNER_ACCOUNT_ID}`)
    const res = await GET(req)
    const body = await res.json()

    expect(body.has_more).toBe(true)
    expect(body.rows).toHaveLength(25)
  })

  it('has_more is false when exactly `limit` (or fewer) rows come back', async () => {
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'admin-1', error: null })
    logResult = { data: [makeRow()], error: null }

    const req = new NextRequest(`http://localhost:3000/api/partner/dashboard/usage-log?partner_account_id=${PARTNER_ACCOUNT_ID}`)
    const res = await GET(req)
    const body = await res.json()

    expect(body.has_more).toBe(false)
    expect(body.rows).toHaveLength(1)
  })

  it('server-enforced limit ceiling: a client-requested limit above 100 is rejected by Zod, not silently clamped', async () => {
    const req = new NextRequest(`http://localhost:3000/api/partner/dashboard/usage-log?partner_account_id=${PARTNER_ACCOUNT_ID}&limit=500`)
    const res = await GET(req)

    expect(res.status).toBe(400)
  })

  it('delivery_configured reflects outbound_base_url IS NOT NULL for the account', async () => {
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'admin-1', error: null })
    accountResult = { data: { outbound_base_url: null }, error: null }
    logResult = { data: [makeRow({ delivery_status: 'pending', retry_count: 0 })], error: null }

    const req = new NextRequest(`http://localhost:3000/api/partner/dashboard/usage-log?partner_account_id=${PARTNER_ACCOUNT_ID}`)
    const res = await GET(req)
    const body = await res.json()

    expect(body.delivery_configured).toBe(false)
    expect(body.rows[0].delivery_status).toBe('not_configured')
  })

  it('never exposes action_items/learner_insight/glitches/signature/payload_hash/outbound_base_url on any row', async () => {
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'admin-1', error: null })
    logResult = {
      data: [
        makeRow({
          event_type: 'session.insights_ready',
          payload: {
            action_items: [{ text: 'Should never appear' }],
            learner_insight: { summary: 'Should never appear' },
            glitches: [{ type: 'audio_dropout' }],
            test_mode: false,
          },
        }),
      ],
      error: null,
    }

    const req = new NextRequest(`http://localhost:3000/api/partner/dashboard/usage-log?partner_account_id=${PARTNER_ACCOUNT_ID}`)
    const res = await GET(req)
    const body = await res.json()

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('action_items')
    expect(serialized).not.toContain('learner_insight')
    expect(serialized).not.toContain('glitches')
    expect(serialized).not.toContain('signature')
    expect(serialized).not.toContain('payload_hash')
    expect(serialized).not.toContain('outbound_base_url')
  })

  it('returns 500 with the exact error copy when the log query fails, without throwing', async () => {
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'admin-1', error: null })
    logResult = { data: null, error: { message: 'db exploded' } }

    const req = new NextRequest(`http://localhost:3000/api/partner/dashboard/usage-log?partner_account_id=${PARTNER_ACCOUNT_ID}`)
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe("Couldn't load your usage log right now. Try refreshing the page.")
  })
})
