import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-37 (docs/specs/B2B-37-requirement-document.md §6.2/§7) — verifies that
 * `clio/partner-session.ended` is reliably emitted from all 3 call sites that
 * collapse the 4 real partner-session completion paths:
 *   1. handleSessionEnd() (lib/partner/live-render.ts) — covers both the normal
 *      client-disconnect end-session route AND the Attendee-webhook
 *      fatal_error fallback, since both call this one function.
 *   2. inngest/partner-live-cutoff.ts's mark-session-completed step.
 *   3. inngest/partner-trial-cutoff.ts's mark-session-completed step.
 *
 * All external calls (Supabase, Inngest, the meeting-bot provider, Hume) are
 * mocked — no real network calls. For the two cutoff-cron Inngest functions,
 * this drives the raw handler directly via the InngestFunction instance's
 * `.fn` property (confirmed present on the SDK's returned object) with a fake
 * `step` whose `run()` executes the callback immediately and `sleep()`
 * resolves immediately — the same technique used implicitly by this repo's
 * "no harness for step.sleep/step.run" precedent (tests/unit/partner-live-
 * cutoff.test.ts) for the *tiered loop's pure decision logic*; here it is
 * applied narrowly, only to reach the trivial, already-mocked-dependency
 * `mark-session-completed` step, not to exercise the full adaptive-cutoff
 * timing behavior (that remains covered by the existing pure-function tests).
 */

// ─── Shared fake step — step.run executes immediately, step.sleep resolves immediately ──
function fakeStep() {
  return {
    run: async <T>(_id: string, fn: () => Promise<T> | T) => fn(),
    sleep: async (_id: string, _duration: string) => {},
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 1. handleSessionEnd() — fast path (covers end-session route + Attendee fallback)
// ══════════════════════════════════════════════════════════════════════════

describe('handleSessionEnd() emits clio/partner-session.ended (B2B-37 §6.2 call site A)', () => {
  const sendMock = vi.fn(async (..._args: unknown[]) => Promise.resolve())

  beforeEach(() => {
    vi.resetModules()
    sendMock.mockClear()
  })

  it('testMode:false — emits clio/partner-session.ended IN ADDITION TO the existing clio/partner-live.ended', async () => {
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    }))
    vi.doMock('@/lib/partner/webhooks', () => ({
      recordBillableEvent: vi.fn(async () => ({ dispatchLogId: 'log-1' })),
    }))

    const { handleSessionEnd } = await import('@/lib/partner/live-render')
    await handleSessionEnd('session-1', 'acct-1', 0, false)

    const eventNames = sendMock.mock.calls.map((c) => (c[0] as { name: string }).name)
    expect(eventNames).toContain('clio/partner-live.ended')
    expect(eventNames).toContain('clio/partner-session.ended')

    const sessionEndedCall = sendMock.mock.calls.find((c) => (c[0] as { name: string }).name === 'clio/partner-session.ended')
    expect(sessionEndedCall?.[0]).toEqual({
      name: 'clio/partner-session.ended',
      data: { partnerSessionId: 'session-1' },
    })
  })

  it('testMode:true — emits clio/partner-session.ended IN ADDITION TO the existing clio/partner-trial.ended', async () => {
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    }))
    vi.doMock('@/lib/partner/webhooks', () => ({
      recordBillableEvent: vi.fn(async () => ({ dispatchLogId: 'log-1' })),
    }))

    const { handleSessionEnd } = await import('@/lib/partner/live-render')
    await handleSessionEnd('session-2', 'acct-1', 0, true)

    const eventNames = sendMock.mock.calls.map((c) => (c[0] as { name: string }).name)
    expect(eventNames).toContain('clio/partner-trial.ended')
    expect(eventNames).toContain('clio/partner-session.ended')
  })

  it("targetStatus:'failed' (Attendee-webhook fatal_error fallback) — still emits clio/partner-session.ended; status value does not gate the emission", async () => {
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    }))
    vi.doMock('@/lib/partner/webhooks', () => ({
      recordBillableEvent: vi.fn(async () => ({ dispatchLogId: 'log-1' })),
    }))

    const { handleSessionEnd } = await import('@/lib/partner/live-render')
    await handleSessionEnd('session-3', 'acct-1', 0, false, 'failed', 'attendee_receipt')

    const sessionEndedCall = sendMock.mock.calls.find((c) => (c[0] as { name: string }).name === 'clio/partner-session.ended')
    expect(sessionEndedCall?.[0]).toEqual({
      name: 'clio/partner-session.ended',
      data: { partnerSessionId: 'session-3' },
    })
  })

  it('emitPartnerSessionEndedEvent: a failed inngest.send() is caught and logged, never thrown, never blocks the caller', async () => {
    const failingSend = vi.fn(async () => Promise.reject(new Error('inngest unavailable')))
    vi.doMock('@/inngest/client', () => ({ inngest: { send: failingSend } }))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { emitPartnerSessionEndedEvent } = await import('@/lib/partner/live-render')

    expect(() => emitPartnerSessionEndedEvent('session-4')).not.toThrow()
    // Allow the rejected promise's .catch() to run.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('clio/partner-session.ended emit failed'),
      expect.any(Error)
    )
    consoleErrorSpy.mockRestore()
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 2. partner-trial-cutoff.ts — mark-session-completed step (call site C)
// ══════════════════════════════════════════════════════════════════════════

describe('partner-trial-cutoff mark-session-completed emits clio/partner-session.ended (B2B-37 §6.2 call site C)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('emits clio/partner-session.ended with the correct partnerSessionId after marking the session completed', async () => {
    const emitMock = vi.fn()
    vi.doMock('@/lib/partner/live-render', () => ({ emitPartnerSessionEndedEvent: emitMock }))
    vi.doMock('@/inngest/client', () => ({
      inngest: {
        createFunction: (_opts: unknown, fn: unknown) => ({ fn }),
        send: vi.fn(async () => Promise.resolve()),
      },
    }))
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: (table: string) => {
          if (table === 'partner_sessions') {
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: 'in_progress' } }) }) }),
              update: () => ({ eq: async () => ({ error: null }) }),
            }
          }
          throw new Error(`unexpected table ${table}`)
        },
        rpc: async () => ({ error: null }),
      }),
    }))
    vi.doMock('@/lib/meeting-bot/provider', () => ({
      getMeetingBotProvider: () => ({ deleteBot: vi.fn(async () => {}) }),
    }))
    vi.doMock('@/lib/partner/webhooks', () => ({
      recordBillableEvent: vi.fn(async () => ({ dispatchLogId: 'log-1' })),
    }))

    const { partnerTrialCutoffJob } = await import('@/inngest/partner-trial-cutoff')
    const handler = (partnerTrialCutoffJob as unknown as { fn: (args: unknown) => Promise<unknown> }).fn

    await handler({
      event: {
        data: {
          clioSessionRef: 'trial-session-1',
          partnerAccountId: 'acct-1',
          providerBotId: 'bot-1',
          availableMinutes: 10,
        },
      },
      step: fakeStep(),
    })

    expect(emitMock).toHaveBeenCalledWith('trial-session-1')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 3. partner-live-cutoff.ts — mark-session-completed step (call site B)
// ══════════════════════════════════════════════════════════════════════════

describe('partner-live-cutoff mark-session-completed emits clio/partner-session.ended (B2B-37 §6.2 call site B)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('emits clio/partner-session.ended with the correct partnerSessionId (ungated / below-80% path)', async () => {
    const emitMock = vi.fn()
    vi.doMock('@/lib/partner/live-render', () => ({ emitPartnerSessionEndedEvent: emitMock }))
    vi.doMock('@/inngest/client', () => ({
      inngest: {
        createFunction: (_opts: unknown, fn: unknown) => ({ fn }),
        send: vi.fn(async () => Promise.resolve()),
      },
    }))
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: (table: string) => {
          if (table === 'partner_wallets') {
            // low_balance_alert_fired_at: null -> ungated path, byte-for-byte existing behavior
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { low_balance_alert_fired_at: null }, error: null }) }) }) }
          }
          if (table === 'partner_sessions') {
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: 'in_progress' } }) }) }),
              update: () => ({ eq: async () => ({ error: null }) }),
            }
          }
          throw new Error(`unexpected table ${table}`)
        },
      }),
    }))
    vi.doMock('@/lib/meeting-bot/provider', () => ({
      getMeetingBotProvider: () => ({ deleteBot: vi.fn(async () => {}) }),
    }))
    vi.doMock('@/lib/partner/webhooks', () => ({
      recordBillableEvent: vi.fn(async () => ({ dispatchLogId: 'log-1' })),
    }))
    vi.doMock('@/lib/voice/hume-native/session-details', () => ({
      fetchHumeChatDuration: vi.fn(async () => ({ ok: false, reason: 'not_used_on_ungated_path' })),
    }))

    const { partnerLiveCutoffJob } = await import('@/inngest/partner-live-cutoff')
    const handler = (partnerLiveCutoffJob as unknown as { fn: (args: unknown) => Promise<unknown> }).fn

    await handler({
      event: {
        data: {
          clioSessionRef: 'live-session-1',
          partnerAccountId: 'acct-1',
          providerBotId: 'bot-1',
          affordableMinutes: 5,
        },
      },
      step: fakeStep(),
    })

    expect(emitMock).toHaveBeenCalledWith('live-session-1')
  })
})
