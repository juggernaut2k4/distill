import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-38 (docs/specs/B2B-38-requirement-document.md §6.7/§7) — tests for
 * inngest/partner-session-trace-log.ts's two functions:
 *  - partnerSessionTraceLogFinalizer (AT-15, AT-17) — finalizes a partner_session_trace_logs row on
 *    the clio/partner-session.ended event.
 *  - partnerSessionTraceLogPurge (AT-18) — 60-day full-row DELETE via RPC.
 *
 * Drives each function's step.run body directly via the `.fn` handler property Inngest attaches to
 * every createFunction() result — same established convention as
 * tests/unit/b2b37-partner-session-ended-emission.test.ts / b2b37-partner-session-insights-guard-
 * and-backstop.test.ts's own `handlerOf()` helper (no harness exists in this repo for driving
 * step.sleep/step.run declaratively; this is the precedent for functions that DO need their body
 * exercised, as opposed to the pure-function-extraction convention used by files like
 * partner-live-cutoff.test.ts for functions with more complex tiered logic).
 */

function handlerOf(fn: unknown): (args: unknown) => Promise<unknown> {
  return (fn as { fn: (args: unknown) => Promise<unknown> }).fn
}

const fakeStep = () => ({
  run: async <T>(_id: string, cb: () => Promise<T> | T) => cb(),
})

describe('partnerSessionTraceLogFinalizer', () => {
  let partnerSessionsRow: { created_at: string; ended_at: string | null; hume_config_id: string | null } | null
  let traceLogUpdatePayload: Record<string, unknown> | null
  let traceLogUpdateEqArg: [string, string] | null

  beforeEach(() => {
    vi.resetModules()
    partnerSessionsRow = null
    traceLogUpdatePayload = null
    traceLogUpdateEqArg = null

    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: (table: string) => {
          if (table === 'partner_sessions') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: partnerSessionsRow, error: null }),
                }),
              }),
            }
          }
          if (table === 'partner_session_trace_logs') {
            return {
              update: (patch: Record<string, unknown>) => ({
                eq: async (col: string, val: string) => {
                  traceLogUpdatePayload = patch
                  traceLogUpdateEqArg = [col, val]
                  return { error: null }
                },
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      }),
    }))
  })

  it('skips (no-op) when the event carries no partnerSessionId', async () => {
    const { partnerSessionTraceLogFinalizer } = await import('@/inngest/partner-session-trace-log')
    const result = await handlerOf(partnerSessionTraceLogFinalizer)({ event: { data: {} }, step: fakeStep() })
    expect(result).toEqual({ status: 'skipped', reason: 'missing_partner_session_id' })
  })

  // AT-17 — duration_seconds equals ended_at - created_at in whole seconds, and ended_at is populated.
  it('AT-17: computes duration_seconds as ended_at - created_at in whole seconds', async () => {
    partnerSessionsRow = { created_at: '2026-07-27T10:00:00.000Z', ended_at: '2026-07-27T10:15:30.000Z', hume_config_id: null }

    const { partnerSessionTraceLogFinalizer } = await import('@/inngest/partner-session-trace-log')
    const result = await handlerOf(partnerSessionTraceLogFinalizer)({
      event: { data: { partnerSessionId: 'session-1' } },
      step: fakeStep(),
    })

    expect(result).toEqual({ status: 'finalized' })
    expect(traceLogUpdateEqArg).toEqual(['clio_session_ref', 'session-1'])
    expect(traceLogUpdatePayload).toMatchObject({ ended_at: '2026-07-27T10:15:30.000Z', duration_seconds: 930 })
  })

  // AT-15 — hume_config_id on the trace log row matches the value written to
  // partner_sessions.hume_config_id at provisioning time.
  it('AT-15: hume_config_id on the finalize update matches partner_sessions.hume_config_id', async () => {
    partnerSessionsRow = { created_at: '2026-07-27T10:00:00.000Z', ended_at: '2026-07-27T10:05:00.000Z', hume_config_id: 'hume-cfg-xyz' }

    const { partnerSessionTraceLogFinalizer } = await import('@/inngest/partner-session-trace-log')
    await handlerOf(partnerSessionTraceLogFinalizer)({ event: { data: { partnerSessionId: 'session-2' } }, step: fakeStep() })

    expect(traceLogUpdatePayload).toMatchObject({ hume_config_id: 'hume-cfg-xyz' })
  })

  // AT-16 — a session whose Hume config provisioning failed has hume_config_id null throughout,
  // with no error thrown.
  it('AT-16: hume_config_id is null (not an error) when provisioning never set one', async () => {
    partnerSessionsRow = { created_at: '2026-07-27T10:00:00.000Z', ended_at: '2026-07-27T10:05:00.000Z', hume_config_id: null }

    const { partnerSessionTraceLogFinalizer } = await import('@/inngest/partner-session-trace-log')
    const result = await handlerOf(partnerSessionTraceLogFinalizer)({
      event: { data: { partnerSessionId: 'session-3' } },
      step: fakeStep(),
    })

    expect(result).toEqual({ status: 'finalized' })
    expect(traceLogUpdatePayload).toMatchObject({ hume_config_id: null })
  })

  it('falls back to the current time for ended_at when partner_sessions.ended_at is still null (defensive — should not normally happen for a terminal-status session)', async () => {
    partnerSessionsRow = { created_at: '2026-07-27T10:00:00.000Z', ended_at: null, hume_config_id: null }

    const { partnerSessionTraceLogFinalizer } = await import('@/inngest/partner-session-trace-log')
    await handlerOf(partnerSessionTraceLogFinalizer)({ event: { data: { partnerSessionId: 'session-4' } }, step: fakeStep() })

    expect(traceLogUpdatePayload?.ended_at).toBeTruthy()
    expect(typeof traceLogUpdatePayload?.duration_seconds).toBe('number')
    expect((traceLogUpdatePayload?.duration_seconds as number) >= 0).toBe(true)
  })

  it('logs and no-ops (does not throw) when the partner_sessions row cannot be read', async () => {
    partnerSessionsRow = null

    const { partnerSessionTraceLogFinalizer } = await import('@/inngest/partner-session-trace-log')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await handlerOf(partnerSessionTraceLogFinalizer)({
      event: { data: { partnerSessionId: 'session-missing' } },
      step: fakeStep(),
    })

    expect(result).toEqual({ status: 'finalized' })
    expect(traceLogUpdatePayload).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

describe('partnerSessionTraceLogPurge', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  // AT-18 — a row older than 60 days is fully deleted (via RPC); a row younger is untouched. Since
  // the actual row-level cutoff logic lives in the Postgres RPC (purge_partner_session_trace_logs,
  // migration 099), this test verifies the TS side: the RPC is called with a cutoff ~60 days in the
  // past, and the function surfaces the RPC's own returned delete count.
  it('AT-18: calls the purge RPC with a cutoff ~60 days in the past and returns the deleted count', async () => {
    let capturedRpcName: string | null = null
    let capturedArgs: Record<string, unknown> | null = null

    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        rpc: (name: string, args: Record<string, unknown>) => {
          capturedRpcName = name
          capturedArgs = args
          return Promise.resolve({ data: 7, error: null })
        },
      }),
    }))

    const { partnerSessionTraceLogPurge } = await import('@/inngest/partner-session-trace-log')
    const before = Date.now()
    const result = await handlerOf(partnerSessionTraceLogPurge)({ step: fakeStep() })
    const after = Date.now()

    expect(capturedRpcName).toBe('purge_partner_session_trace_logs')
    expect(result).toEqual({ purged: 7 })

    const cutoffMs = new Date(capturedArgs!.p_cutoff as string).getTime()
    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000
    // Cutoff should be ~60 days before "now" (allowing test-execution slack either side).
    expect(cutoffMs).toBeGreaterThanOrEqual(before - sixtyDaysMs - 5000)
    expect(cutoffMs).toBeLessThanOrEqual(after - sixtyDaysMs + 5000)
  })

  it('throws (does not silently no-op) when the purge RPC returns an error', async () => {
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        rpc: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }),
      }),
    }))

    const { partnerSessionTraceLogPurge } = await import('@/inngest/partner-session-trace-log')
    await expect(handlerOf(partnerSessionTraceLogPurge)({ step: fakeStep() })).rejects.toThrow('Trace log purge RPC failed')
  })
})
