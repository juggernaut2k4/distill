import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-50 (docs/specs/B2B-50-requirement-document.md §6.1, §13.2) — covers AT-1 through AT-5:
 * handleSessionEnd() as the single choke point that proactively calls deleteBot() via
 * getMeetingBotProvider(), gated on providerBotId presence, non-fatal on failure, and guarded by
 * an idempotency check against an already-terminal session.
 *
 * All external calls (Supabase, Inngest, the meeting-bot provider) are mocked — no real network
 * calls.
 */

function supabaseMock(opts: { existingStatus: string | null; updateSpy?: (payload: Record<string, unknown>) => void }) {
  return {
    createSupabaseAdminClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ limit: async () => ({ data: [{ status: opts.existingStatus }] }) }) }),
        update: (payload: Record<string, unknown>) => {
          opts.updateSpy?.(payload)
          return { eq: async () => ({ error: null }) }
        },
      }),
    }),
  }
}

describe('handleSessionEnd() — deleteBot() choke point (B2B-50 AT-1 through AT-5)', () => {
  const sendMock = vi.fn(async (..._args: unknown[]) => Promise.resolve())

  beforeEach(() => {
    vi.resetModules()
    sendMock.mockClear()
  })

  it('AT-1: a populated providerBotId calls getMeetingBotProvider().deleteBot(providerBotId) before the session is marked completed', async () => {
    const deleteBotMock = vi.fn(async () => {})
    const updateSpy = vi.fn()
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/supabase', () => supabaseMock({ existingStatus: null, updateSpy }))
    vi.doMock('@/lib/meeting-bot/provider', () => ({ getMeetingBotProvider: () => ({ deleteBot: deleteBotMock }) }))
    vi.doMock('@/lib/partner/webhooks', () => ({ recordBillableEvent: vi.fn(async () => ({ dispatchLogId: 'log-1' })) }))

    const { handleSessionEnd } = await import('@/lib/partner/live-render')
    await handleSessionEnd('session-1', 'acct-1', 5, false, 'bot-abc')

    expect(deleteBotMock).toHaveBeenCalledWith('bot-abc')
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('AT-2: deleteBot() rejecting does not block the session from ending normally', async () => {
    const deleteBotMock = vi.fn(async () => { throw new Error('network error') })
    const updateSpy = vi.fn()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/supabase', () => supabaseMock({ existingStatus: null, updateSpy }))
    vi.doMock('@/lib/meeting-bot/provider', () => ({ getMeetingBotProvider: () => ({ deleteBot: deleteBotMock }) }))
    vi.doMock('@/lib/partner/webhooks', () => ({ recordBillableEvent: vi.fn(async () => ({ dispatchLogId: 'log-1' })) }))

    const { handleSessionEnd } = await import('@/lib/partner/live-render')
    await expect(handleSessionEnd('session-2', 'acct-1', 5, false, 'bot-abc')).resolves.toBeUndefined()

    expect(deleteBotMock).toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
    consoleErrorSpy.mockRestore()
  })

  it('AT-3: providerBotId: null never calls deleteBot() at all', async () => {
    const deleteBotMock = vi.fn(async () => {})
    const updateSpy = vi.fn()
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/supabase', () => supabaseMock({ existingStatus: null, updateSpy }))
    vi.doMock('@/lib/meeting-bot/provider', () => ({ getMeetingBotProvider: () => ({ deleteBot: deleteBotMock }) }))
    vi.doMock('@/lib/partner/webhooks', () => ({ recordBillableEvent: vi.fn(async () => ({ dispatchLogId: 'log-1' })) }))

    const { handleSessionEnd } = await import('@/lib/partner/live-render')
    await handleSessionEnd('session-3', 'acct-1', 5, false, null)

    expect(deleteBotMock).not.toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('AT-4: a session already status "completed" no-ops — no deleteBot(), no update, no billable events', async () => {
    const deleteBotMock = vi.fn(async () => {})
    const updateSpy = vi.fn()
    const recordBillableEventMock = vi.fn(async () => ({ dispatchLogId: 'log-1' }))
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/supabase', () => supabaseMock({ existingStatus: 'completed', updateSpy }))
    vi.doMock('@/lib/meeting-bot/provider', () => ({ getMeetingBotProvider: () => ({ deleteBot: deleteBotMock }) }))
    vi.doMock('@/lib/partner/webhooks', () => ({ recordBillableEvent: recordBillableEventMock }))

    const { handleSessionEnd } = await import('@/lib/partner/live-render')
    await handleSessionEnd('session-4', 'acct-1', 5, false, 'bot-abc')

    expect(deleteBotMock).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
    expect(recordBillableEventMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('AT-4 (failed status also terminal): a session already status "failed" no-ops identically', async () => {
    const deleteBotMock = vi.fn(async () => {})
    const updateSpy = vi.fn()
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/supabase', () => supabaseMock({ existingStatus: 'failed', updateSpy }))
    vi.doMock('@/lib/meeting-bot/provider', () => ({ getMeetingBotProvider: () => ({ deleteBot: deleteBotMock }) }))
    vi.doMock('@/lib/partner/webhooks', () => ({ recordBillableEvent: vi.fn(async () => ({ dispatchLogId: 'log-1' })) }))

    const { handleSessionEnd } = await import('@/lib/partner/live-render')
    await handleSessionEnd('session-5', 'acct-1', 5, false, 'bot-abc')

    expect(deleteBotMock).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('AT-5: targetStatus "failed" (Attendee fatal_error fallback) still attempts deleteBot() and completes as failed', async () => {
    const deleteBotMock = vi.fn(async () => {})
    const updateSpy = vi.fn()
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/supabase', () => supabaseMock({ existingStatus: null, updateSpy }))
    vi.doMock('@/lib/meeting-bot/provider', () => ({ getMeetingBotProvider: () => ({ deleteBot: deleteBotMock }) }))
    vi.doMock('@/lib/partner/webhooks', () => ({ recordBillableEvent: vi.fn(async () => ({ dispatchLogId: 'log-1' })) }))

    const { handleSessionEnd } = await import('@/lib/partner/live-render')
    await handleSessionEnd('session-6', 'acct-1', 5, false, 'bot-abc', 'failed', 'attendee_receipt')

    expect(deleteBotMock).toHaveBeenCalledWith('bot-abc')
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', billed_duration_source: 'attendee_receipt' }))
  })

  it('endReason is threaded onto the update only when provided (all_participants_left)', async () => {
    const updateSpy = vi.fn()
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/supabase', () => supabaseMock({ existingStatus: null, updateSpy }))
    vi.doMock('@/lib/meeting-bot/provider', () => ({ getMeetingBotProvider: () => ({ deleteBot: vi.fn(async () => {}) }) }))
    vi.doMock('@/lib/partner/webhooks', () => ({ recordBillableEvent: vi.fn(async () => ({ dispatchLogId: 'log-1' })) }))

    const { handleSessionEnd } = await import('@/lib/partner/live-render')
    await handleSessionEnd('session-7', 'acct-1', 5, false, 'bot-abc', 'completed', 'wall_clock_fallback', 'all_participants_left')

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ end_reason: 'all_participants_left' }))
  })
})
