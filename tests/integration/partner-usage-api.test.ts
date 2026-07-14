import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-02 — integration tests for GET /api/partner/v1/usage after F-01's
 * resolution to Resolution A (2026-07-13 owner decision): the endpoint now
 * reads from `usage_events` (migration 072, applied and live) instead of
 * `webhook_dispatch_log` directly, while keeping the partner-facing response
 * shape (architecture.md §7.3 payload + delivery_status) and the
 * cursor-based pagination contract (docs/specs/B2B-02-requirement-document.md
 * Section 4.3) unchanged.
 */

const authMock = vi.fn()
vi.mock('@/lib/partner/auth', () => ({
  requirePartnerApiKey: (...args: unknown[]) => authMock(...args),
}))

const usageEventsSelectMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'usage_events') {
        return { select: usageEventsSelectMock }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

import { GET } from '@/app/api/partner/v1/usage/route'

function makeRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/partner/v1/usage${query}`, {
    headers: { authorization: 'Bearer clio_live_sk_valid' },
  })
}

/**
 * Builds a chainable, thenable query-builder mock matching postgrest-js's
 * shape: every filter method (eq/in/gte/lte/order/or/limit) returns the same
 * builder for further chaining, and the builder itself resolves to
 * `{ data, error }` when awaited — mirroring how the real
 * PostgrestFilterBuilder is both chainable and a thenable.
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
  builder.lte = chainable('lte')
  builder.order = chainable('order')
  builder.or = chainable('or')
  builder.limit = chainable('limit')
  builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
  return { builder, calls }
}

describe('GET /api/partner/v1/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', mode: 'live', error: null })
  })

  it('rejects with the auth error and never queries usage_events when auth fails', async () => {
    const { NextResponse } = await import('next/server')
    authMock.mockResolvedValue({ error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) })

    const res = await GET(makeRequest())

    expect(res.status).toBe(401)
    expect(usageEventsSelectMock).not.toHaveBeenCalled()
  })

  it('returns 422 for an invalid event_type', async () => {
    const res = await GET(makeRequest('?event_type=not_a_real_type'))
    expect(res.status).toBe(422)
    expect(usageEventsSelectMock).not.toHaveBeenCalled()
  })

  it('short-circuits event_type=session.completed to an empty page without querying usage_events', async () => {
    const res = await GET(makeRequest('?event_type=session.completed'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ events: [], next_cursor: null })
    expect(usageEventsSelectMock).not.toHaveBeenCalled()
  })

  it('queries usage_events filtered by partner_account_id and test_mode=false, and reconstructs the §7.3 payload shape + delivery_status', async () => {
    const row = {
      id: 'ue-1',
      occurred_at: '2026-07-13T00:00:00.000Z',
      webhook_dispatch_log: {
        payload: {
          event_id: 'evt-1',
          event_type: 'usage.voice_minute',
          clio_session_ref: 'session-1',
          partner_reference: 'hartford',
          quantity: 2.5,
          unit: 'minutes',
          generation_type: null,
          occurred_at: '2026-07-13T00:00:00.000Z',
          dispatched_at: '2026-07-13T00:00:01.000Z',
          test_mode: false,
        },
        delivery_status: 'delivered',
      },
    }
    const { builder, calls } = makeQueryBuilder({ data: [row], error: null })
    usageEventsSelectMock.mockReturnValue(builder)

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.events).toEqual([
      {
        event_id: 'evt-1',
        event_type: 'usage.voice_minute',
        clio_session_ref: 'session-1',
        partner_reference: 'hartford',
        quantity: 2.5,
        unit: 'minutes',
        generation_type: null,
        occurred_at: '2026-07-13T00:00:00.000Z',
        dispatched_at: '2026-07-13T00:00:01.000Z',
        test_mode: false,
        delivery_status: 'delivered',
      },
    ])
    expect(json.next_cursor).toBeNull()

    const eqCalls = calls.filter((c) => c.method === 'eq')
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['partner_account_id', 'acct-1'] })
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['test_mode', false] })
  })

  it('maps event_type=usage.llm_generation_call to the three usage_events.event_type values', async () => {
    const { builder, calls } = makeQueryBuilder({ data: [], error: null })
    usageEventsSelectMock.mockReturnValue(builder)

    await GET(makeRequest('?event_type=usage.llm_generation_call'))

    const inCall = calls.find((c) => c.method === 'in')
    expect(inCall?.args).toEqual(['event_type', ['llm_generation_topic', 'llm_generation_content', 'llm_generation_prerequisite']])
  })

  it('returns a non-null next_cursor when a full page is returned, encoding occurred_at|id', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: `ue-${i}`,
      occurred_at: `2026-07-13T00:00:${String(i).padStart(2, '0')}.000Z`,
      webhook_dispatch_log: {
        payload: {
          event_id: `evt-${i}`,
          event_type: 'usage.voice_minute',
          clio_session_ref: null,
          partner_reference: null,
          quantity: 1,
          unit: 'minutes',
          generation_type: null,
          occurred_at: `2026-07-13T00:00:${String(i).padStart(2, '0')}.000Z`,
          dispatched_at: `2026-07-13T00:00:${String(i).padStart(2, '0')}.000Z`,
          test_mode: false,
        },
        delivery_status: 'delivered',
      },
    }))
    const { builder } = makeQueryBuilder({ data: rows, error: null })
    usageEventsSelectMock.mockReturnValue(builder)

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(json.next_cursor).not.toBeNull()
    const decoded = Buffer.from(json.next_cursor, 'base64').toString('utf8')
    expect(decoded).toBe('2026-07-13T00:00:99.000Z|ue-99')
  })

  it('returns a 500 error envelope when the query fails', async () => {
    const { builder } = makeQueryBuilder({ data: null, error: { message: 'db unreachable' } })
    usageEventsSelectMock.mockReturnValue(builder)

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error.code).toBe('internal_error')
  })

  it('handles a usage_events row whose webhook_dispatch_log join is null without throwing', async () => {
    const row = { id: 'ue-orphan', occurred_at: '2026-07-13T00:00:00.000Z', webhook_dispatch_log: null }
    const { builder } = makeQueryBuilder({ data: [row], error: null })
    usageEventsSelectMock.mockReturnValue(builder)

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.events).toEqual([{ delivery_status: null }])
  })
})
