import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-02 — tests for lib/partner/webhooks.ts: `recordBillableEvent` (Section
 * 7.3's exact payload shape, including the session.completed
 * not-billable branch) and the dispatch worker's delivered/retry/exhausted
 * state machine (Section 7.2's 5-attempt backoff schedule).
 */

const state: {
  accountRow: { id: string; outbound_signing_secret: string | null } | null
} = { accountRow: null }

const upsertSelectMock = vi.fn(() => Promise.resolve({ data: { id: 'dispatch-log-1' }, error: null }))
const updateEqMock = vi.fn((_patch?: Record<string, unknown>) => Promise.resolve({ error: null }))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_accounts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.accountRow })),
            })),
          })),
        }
      }
      if (table === 'webhook_dispatch_log') {
        return {
          upsert: vi.fn(() => ({
            select: vi.fn(() => ({ maybeSingle: upsertSelectMock })),
          })),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: vi.fn(() => updateEqMock(patch)),
          })),
        }
      }
      if (table === 'usage_events') {
        return { insert: vi.fn(() => Promise.resolve({ error: null })) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

import { recordBillableEvent, attemptDispatch, type DueDispatchRow } from '@/lib/partner/webhooks'

describe('recordBillableEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.accountRow = { id: 'acct-1', outbound_signing_secret: 'secret-123' }
  })

  it('returns an error when the partner account cannot be found', async () => {
    state.accountRow = null
    const result = await recordBillableEvent({ partnerAccountId: 'missing', eventType: 'usage.voice_minute', quantity: 1, unit: 'minutes' })
    expect('error' in result).toBe(true)
  })

  it('records a usage.voice_minute event and returns the dispatch log id', async () => {
    const result = await recordBillableEvent({
      partnerAccountId: 'acct-1',
      eventType: 'usage.voice_minute',
      clioSessionRef: 'session-1',
      partnerReference: 'hartford',
      quantity: 1.5,
      unit: 'minutes',
      testMode: false,
    })
    expect('dispatchLogId' in result).toBe(true)
  })

  it('nulls quantity/unit/generation_type for the non-billable session.completed event', async () => {
    // Capture the upsert payload via a fresh mock on this call.
    let capturedPayload: Record<string, unknown> | null = null
    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    ;(createSupabaseAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'partner_accounts') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.accountRow }) }) }) }
        }
        return {
          upsert: (row: Record<string, unknown>) => {
            capturedPayload = row.payload as Record<string, unknown>
            return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'dl-1' } }) }) }
          },
        }
      },
    })

    await recordBillableEvent({ partnerAccountId: 'acct-1', eventType: 'session.completed', clioSessionRef: 'session-1' })

    expect(capturedPayload).not.toBeNull()
    expect(capturedPayload!.quantity).toBeNull()
    expect(capturedPayload!.unit).toBeNull()
    expect(capturedPayload!.generation_type).toBeNull()
    expect(capturedPayload!.event_type).toBe('session.completed')
  })

  it('always includes a test_mode boolean on the payload (edge case: test-key usage must be filterable)', async () => {
    let capturedPayload: Record<string, unknown> | null = null
    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    ;(createSupabaseAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'partner_accounts') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.accountRow }) }) }) }
        }
        if (table === 'usage_events') {
          return { insert: () => Promise.resolve({ error: null }) }
        }
        return {
          upsert: (row: Record<string, unknown>) => {
            capturedPayload = row.payload as Record<string, unknown>
            return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'dl-1' } }) }) }
          },
        }
      },
    })

    await recordBillableEvent({ partnerAccountId: 'acct-1', eventType: 'usage.voice_minute', quantity: 2, unit: 'minutes', testMode: true })

    expect(capturedPayload!.test_mode).toBe(true)
  })

  it('given no partner_reference, the payload field is null, never omitted or empty string', async () => {
    let capturedPayload: Record<string, unknown> | null = null
    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    ;(createSupabaseAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'partner_accounts') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.accountRow }) }) }) }
        }
        if (table === 'usage_events') {
          return { insert: () => Promise.resolve({ error: null }) }
        }
        return {
          upsert: (row: Record<string, unknown>) => {
            capturedPayload = row.payload as Record<string, unknown>
            return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'dl-1' } }) }) }
          },
        }
      },
    })

    await recordBillableEvent({ partnerAccountId: 'acct-1', eventType: 'usage.voice_minute', quantity: 1, unit: 'minutes' })

    expect('partner_reference' in capturedPayload!).toBe(true)
    expect(capturedPayload!.partner_reference).toBeNull()
  })

  it('F-01 Resolution A: always inserts a usage_events row for a billable event, unconditionally (no feature flag)', async () => {
    const usageEventsInsertMock = vi.fn(() => Promise.resolve({ error: null }))
    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    ;(createSupabaseAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'partner_accounts') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.accountRow }) }) }) }
        }
        if (table === 'webhook_dispatch_log') {
          return { upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'dl-1' } }) }) }) }
        }
        if (table === 'usage_events') {
          return { insert: usageEventsInsertMock }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    })

    delete process.env.PARTNER_USAGE_LEDGER_ENABLED

    const result = await recordBillableEvent({
      partnerAccountId: 'acct-1',
      eventType: 'usage.voice_minute',
      clioSessionRef: 'session-1',
      quantity: 2.5,
      unit: 'minutes',
    })

    expect('dispatchLogId' in result).toBe(true)
    expect(usageEventsInsertMock).toHaveBeenCalledTimes(1)
    expect(usageEventsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        partner_account_id: 'acct-1',
        event_type: 'voice_minute',
        quantity: 2.5,
        clio_session_ref: 'session-1',
        webhook_dispatch_log_id: 'dl-1',
        test_mode: false,
      })
    )
  })

  it('maps an llm_generation_call event + generationType to the usage_events event_type domain', async () => {
    const usageEventsInsertMock = vi.fn(() => Promise.resolve({ error: null }))
    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    ;(createSupabaseAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'partner_accounts') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.accountRow }) }) }) }
        }
        if (table === 'webhook_dispatch_log') {
          return { upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'dl-2' } }) }) }) }
        }
        if (table === 'usage_events') {
          return { insert: usageEventsInsertMock }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    })

    await recordBillableEvent({
      partnerAccountId: 'acct-1',
      eventType: 'usage.llm_generation_call',
      generationType: 'content',
      quantity: 1,
      unit: 'calls',
    })

    expect(usageEventsInsertMock).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'llm_generation_content', quantity: 1 }))
  })

  it('never inserts into usage_events for the non-billable session.completed event', async () => {
    const usageEventsInsertMock = vi.fn(() => Promise.resolve({ error: null }))
    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    ;(createSupabaseAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'partner_accounts') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.accountRow }) }) }) }
        }
        if (table === 'webhook_dispatch_log') {
          return { upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'dl-3' } }) }) }) }
        }
        if (table === 'usage_events') {
          return { insert: usageEventsInsertMock }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    })

    const result = await recordBillableEvent({ partnerAccountId: 'acct-1', eventType: 'session.completed', clioSessionRef: 'session-1' })

    expect('dispatchLogId' in result).toBe(true)
    expect(usageEventsInsertMock).not.toHaveBeenCalled()
  })

  it('surfaces a failed usage_events insert as a real error, not a silently swallowed one', async () => {
    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    ;(createSupabaseAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'partner_accounts') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.accountRow }) }) }) }
        }
        if (table === 'webhook_dispatch_log') {
          return { upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'dl-4' } }) }) }) }
        }
        if (table === 'usage_events') {
          return { insert: () => Promise.resolve({ error: { message: 'relation "usage_events" does not exist' } }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    })

    const result = await recordBillableEvent({
      partnerAccountId: 'acct-1',
      eventType: 'usage.voice_minute',
      quantity: 1,
      unit: 'minutes',
    })

    expect('error' in result).toBe(true)
    expect((result as { error: string }).error).toBe('relation "usage_events" does not exist')
  })
})

describe('attemptDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  function makeRow(overrides: Partial<DueDispatchRow> = {}): DueDispatchRow {
    return {
      id: 'dl-1',
      partner_account_id: 'acct-1',
      event_type: 'usage.voice_minute',
      payload: {
        event_id: 'evt-1',
        event_type: 'usage.voice_minute',
        clio_session_ref: 'session-1',
        partner_reference: null,
        quantity: 1,
        unit: 'minutes',
        generation_type: null,
        occurred_at: new Date().toISOString(),
        dispatched_at: new Date().toISOString(),
        test_mode: false,
      },
      signature: 't=123,v1=abc',
      retry_count: 0,
      outbound_base_url: 'https://partner.example.com/api',
      ...overrides,
    }
  }

  it('skips delivery when the partner has no outbound_base_url configured (does not increment retry_count)', async () => {
    const outcome = await attemptDispatch(makeRow({ outbound_base_url: null }))
    expect(outcome).toBe('skipped_no_endpoint')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('marks delivered on a 2xx response and sends the Clio-Signature header', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 })

    const outcome = await attemptDispatch(makeRow())
    expect(outcome).toBe('delivered')

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toBe('https://partner.example.com/api/webhooks/usage')
    expect((init.headers as Record<string, string>)['Clio-Signature']).toBe('t=123,v1=abc')
  })

  it('schedules a retry (not exhausted) on the first failed attempt', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 })

    const outcome = await attemptDispatch(makeRow({ retry_count: 0 }))
    expect(outcome).toBe('retrying')
    expect(updateEqMock).toHaveBeenCalledWith(expect.objectContaining({ delivery_status: 'pending', retry_count: 1 }))
  })

  it('marks exhausted after the 5th failed attempt', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 })

    const outcome = await attemptDispatch(makeRow({ retry_count: 4 }))
    expect(outcome).toBe('exhausted')
    expect(updateEqMock).toHaveBeenCalledWith(expect.objectContaining({ delivery_status: 'exhausted', retry_count: 5 }))
  })

  it('treats a network throw the same as a failed HTTP response (retrying, never crashes)', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))

    const outcome = await attemptDispatch(makeRow({ retry_count: 0 }))
    expect(outcome).toBe('retrying')
  })
})
