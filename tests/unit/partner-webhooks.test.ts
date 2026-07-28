import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

/**
 * B2B-04 — self-returning chain stub for `billing_rate_versions`, used by
 * applyWalletDecrement()'s resolveEffectiveRate() query. No rate is
 * configured in these B2B-02-era tests, so this always resolves `null` at
 * the terminal `.maybeSingle()` regardless of which/how-many chained
 * methods (`.eq`/`.is`/`.lte`/`.or`/`.order`/`.limit`) are called first —
 * applyWalletDecrement then marks the usage_events row unbilled and returns
 * without touching the wallet, exactly like a real "no rate configured yet"
 * event type. Defined via vi.hoisted() so it's available inside the hoisted
 * vi.mock() factory below.
 */
const { noRateChain } = vi.hoisted(() => ({
  noRateChain: (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      lte: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: null }),
    }
    return chain
  },
}))

// B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.5) — the end_client_id
// resolution lookup on partner_sessions, run whenever clioSessionRef is set. Defaults to null;
// individual tests override via mockResolvedValueOnce.
const partnerSessionsMaybeSingleMock = vi.fn(() => Promise.resolve<{ data: { end_client_id: string | null } | null }>({ data: null }))

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
        return {
          insert: vi.fn(() => ({
            select: () => ({ single: () => Promise.resolve({ data: { id: 'usage-event-1' }, error: null }) }),
          })),
        }
      }
      if (table === 'billing_rate_versions') {
        return noRateChain()
      }
      if (table === 'partner_sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: partnerSessionsMaybeSingleMock })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

import { recordBillableEvent, attemptDispatch, recordInsightsReadyEvent, type DueDispatchRow } from '@/lib/partner/webhooks'

describe('recordBillableEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.accountRow = { id: 'acct-1', outbound_signing_secret: 'secret-123' }
    partnerSessionsMaybeSingleMock.mockResolvedValue({ data: null })
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
        if (table === 'partner_sessions') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }
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
          return {
            insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'usage-event-1' }, error: null }) }) }),
          }
        }
        if (table === 'billing_rate_versions') {
          return noRateChain()
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
          return {
            insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'usage-event-1' }, error: null }) }) }),
          }
        }
        if (table === 'billing_rate_versions') {
          return noRateChain()
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
    const usageEventsInsertMock = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'usage-event-1' }, error: null }) }),
    }))
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
        if (table === 'billing_rate_versions') {
          return noRateChain()
        }
        if (table === 'partner_sessions') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { end_client_id: 'client-1' } }) }) }) }
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
        // B2B-34 Piece 2 — resolved from partner_sessions.end_client_id, threaded onto usage_events.
        end_client_id: 'client-1',
      })
    )
  })

  it('maps an llm_generation_call event + generationType to the usage_events event_type domain', async () => {
    const usageEventsInsertMock = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'usage-event-1' }, error: null }) }),
    }))
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
        if (table === 'billing_rate_versions') {
          return noRateChain()
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
    const usageEventsInsertMock = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'usage-event-1' }, error: null }) }),
    }))
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
        if (table === 'partner_sessions') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }
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
          return {
            insert: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: null, error: { message: 'relation "usage_events" does not exist' } }),
              }),
            }),
          }
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

  // B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.5, §7 Acceptance Tests).
  it('resolves end_client_id from the originating partner_sessions row and includes it on the payload', async () => {
    partnerSessionsMaybeSingleMock.mockResolvedValueOnce({ data: { end_client_id: 'end-client-42' } })

    let capturedPayload: Record<string, unknown> | null = null
    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    ;(createSupabaseAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'partner_accounts') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.accountRow }) }) }) }
        }
        if (table === 'usage_events') {
          return { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'usage-event-1' }, error: null }) }) }) }
        }
        if (table === 'billing_rate_versions') {
          return noRateChain()
        }
        if (table === 'partner_sessions') {
          return { select: () => ({ eq: () => ({ maybeSingle: partnerSessionsMaybeSingleMock }) }) }
        }
        return {
          upsert: (row: Record<string, unknown>) => {
            capturedPayload = row.payload as Record<string, unknown>
            return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'dl-1' } }) }) }
          },
        }
      },
    })

    await recordBillableEvent({
      partnerAccountId: 'acct-1',
      eventType: 'usage.voice_minute',
      clioSessionRef: 'session-1',
      quantity: 1,
      unit: 'minutes',
    })

    expect(capturedPayload!.end_client_id).toBe('end-client-42')
  })

  it('leaves end_client_id null when no clioSessionRef is provided (no partner_sessions lookup)', async () => {
    let capturedPayload: Record<string, unknown> | null = null
    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    ;(createSupabaseAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'partner_accounts') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.accountRow }) }) }) }
        }
        if (table === 'usage_events') {
          return { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'usage-event-1' }, error: null }) }) }) }
        }
        if (table === 'billing_rate_versions') {
          return noRateChain()
        }
        if (table === 'partner_sessions') {
          throw new Error('partner_sessions should never be queried when clioSessionRef is absent')
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

    expect(capturedPayload!.end_client_id).toBeNull()
  })
})

// B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.3, §7 Acceptance Tests) — the
// webhook fix: partner_reference is threaded through as the real value (was hardcoded null), and
// end_client_id is added as a new, additive, NON-hashed field.
describe('recordInsightsReadyEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.accountRow = { id: 'acct-1', outbound_signing_secret: 'secret-123' }
    // Deterministic `now`/`occurred_at` across calls within a test — canonicalHashInput() includes
    // occurred_at, so the hash-comparison tests below need it held constant across both calls to
    // isolate what's actually varying (partner_reference vs. end_client_id).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function captureUpsertedRow(params: {
    partnerReference: string | null
    endClientId: string | null
    extractionStatus?: 'success' | 'success_empty' | 'failed'
    // B2B-38 (docs/specs/B2B-38-requirement-document.md §6.8) — new required params, defaulted to
    // null here so every pre-existing call site in this file keeps validating its original scenario.
    resellerUniqueId?: string | null
    humeConfigId?: string | null
  }): Promise<Record<string, unknown>> {
    let capturedRow: Record<string, unknown> | null = null
    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    ;(createSupabaseAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'partner_accounts') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.accountRow }) }) }) }
        }
        if (table === 'webhook_dispatch_log') {
          return {
            upsert: (row: Record<string, unknown>) => {
              capturedRow = row
              return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'dl-1' } }) }) }
            },
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    })

    await recordInsightsReadyEvent({
      partnerSessionId: 'session-1',
      partnerAccountId: 'acct-1',
      extractionStatus: params.extractionStatus ?? 'success',
      testMode: false,
      partnerReference: params.partnerReference,
      endClientId: params.endClientId,
      resellerUniqueId: params.resellerUniqueId ?? null,
      humeConfigId: params.humeConfigId ?? null,
    })

    if (!capturedRow) throw new Error('webhook_dispatch_log.upsert was never called')
    return capturedRow
  }

  it('delivers the real partner_reference on the payload, not a hardcoded null (closes the pre-existing bug)', async () => {
    const row = await captureUpsertedRow({ partnerReference: 'hartford-topic-slug', endClientId: null })
    const payload = row.payload as Record<string, unknown>
    expect(payload.partner_reference).toBe('hartford-topic-slug')
  })

  it('still delivers null partner_reference when the partner genuinely never set one', async () => {
    const row = await captureUpsertedRow({ partnerReference: null, endClientId: null })
    const payload = row.payload as Record<string, unknown>
    expect(payload.partner_reference).toBeNull()
  })

  it('includes end_client_id on the payload, matching partner_sessions.end_client_id for the session', async () => {
    const row = await captureUpsertedRow({ partnerReference: null, endClientId: 'end-client-99' })
    const payload = row.payload as Record<string, unknown>
    expect(payload.end_client_id).toBe('end-client-99')
  })

  it('the idempotency hash changes when partner_reference changes (it IS part of the hash input)', async () => {
    const rowA = await captureUpsertedRow({ partnerReference: 'ref-a', endClientId: null })
    const rowB = await captureUpsertedRow({ partnerReference: 'ref-b', endClientId: null })
    expect(rowA.payload_hash).not.toBe(rowB.payload_hash)
  })

  it('the idempotency hash is UNAFFECTED by end_client_id (it is NOT part of the hash input, additive-only like extraction_status)', async () => {
    const rowA = await captureUpsertedRow({ partnerReference: 'same-ref', endClientId: 'client-a' })
    const rowB = await captureUpsertedRow({ partnerReference: 'same-ref', endClientId: 'client-b' })
    expect(rowA.payload_hash).toBe(rowB.payload_hash)
  })

  // B2B-38 (docs/specs/B2B-38-requirement-document.md §6.8/§7 AT-14) — reseller_id/reseller_unique_id/
  // hume_config_id on the session.insights_ready reference payload.
  it('AT-14: includes reseller_id (== partnerAccountId), reseller_unique_id, and hume_config_id on the payload', async () => {
    const row = await captureUpsertedRow({
      partnerReference: null,
      endClientId: 'end-client-99',
      resellerUniqueId: 'order-48213',
      humeConfigId: 'hume-cfg-abc',
    })
    const payload = row.payload as Record<string, unknown>
    expect(payload.reseller_id).toBe('acct-1')
    expect(payload.reseller_unique_id).toBe('order-48213')
    expect(payload.hume_config_id).toBe('hume-cfg-abc')
  })

  it('AT-14: reseller_unique_id/hume_config_id are null (not omitted) when the session has none', async () => {
    const row = await captureUpsertedRow({ partnerReference: null, endClientId: null })
    const payload = row.payload as Record<string, unknown>
    expect('reseller_unique_id' in payload).toBe(true)
    expect(payload.reseller_unique_id).toBeNull()
    expect('hume_config_id' in payload).toBe(true)
    expect(payload.hume_config_id).toBeNull()
  })

  it('AT-14: the idempotency hash is UNAFFECTED by reseller_unique_id/hume_config_id (not part of the hash input)', async () => {
    const rowA = await captureUpsertedRow({ partnerReference: 'same-ref', endClientId: null, resellerUniqueId: 'order-a', humeConfigId: 'cfg-a' })
    const rowB = await captureUpsertedRow({ partnerReference: 'same-ref', endClientId: null, resellerUniqueId: 'order-b', humeConfigId: 'cfg-b' })
    expect(rowA.payload_hash).toBe(rowB.payload_hash)
  })
})

// B2B-38 (docs/specs/B2B-38-requirement-document.md §6.8/§7 AT-14) — recordBillableEvent()'s own
// payload gains the same three trace fields.
describe('recordBillableEvent — B2B-38 trace fields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.accountRow = { id: 'acct-1', outbound_signing_secret: 'secret-123' }
  })

  it('AT-14: includes reseller_id (== partnerAccountId) and resolves reseller_unique_id/hume_config_id from the session row', async () => {
    let capturedPayload: Record<string, unknown> | null = null
    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    ;(createSupabaseAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'partner_accounts') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.accountRow }) }) }) }
        }
        if (table === 'partner_sessions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { end_client_id: 'end-client-99', reseller_unique_id: 'order-48213', hume_config_id: 'hume-cfg-abc' } }),
              }),
            }),
          }
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
    expect(capturedPayload!.reseller_id).toBe('acct-1')
    expect(capturedPayload!.reseller_unique_id).toBe('order-48213')
    expect(capturedPayload!.hume_config_id).toBe('hume-cfg-abc')
  })

  it('AT-14: reseller_id is always populated even with no clioSessionRef (no session lookup needed)', async () => {
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

    await recordBillableEvent({ partnerAccountId: 'acct-1', eventType: 'session.completed' })

    expect(capturedPayload!.reseller_id).toBe('acct-1')
    expect(capturedPayload!.reseller_unique_id).toBeNull()
    expect(capturedPayload!.hume_config_id).toBeNull()
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
      outbound_signing_secret: 'test-signing-secret',
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
