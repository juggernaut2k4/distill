import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §6.7, AT-4, AT-7, AT-9). Tests for
 * inngest/demo-dispatch-minutes-consumer.ts — the Inngest listener on the existing
 * clio/partner-session.ended event that consumes demo_minutes_balance for demo dispatches only.
 *
 * Same `handlerOf()`/`fakeStep()` convention as tests/unit/partner-session-trace-log.test.ts (no
 * harness exists in this repo for driving step.run declaratively otherwise).
 */

function handlerOf(fn: unknown): (args: unknown) => Promise<unknown> {
  return (fn as { fn: (args: unknown) => Promise<unknown> }).fn
}

const fakeStep = () => ({
  run: async <T>(_id: string, cb: () => Promise<T> | T) => cb(),
})

describe('demoDispatchMinutesConsumer', () => {
  let demoDispatchRow: { id: string; billed_partner_account_id: string } | null
  let partnerSessionsRow: { created_at: string; ended_at: string | null } | null
  let demoDispatchUpdatePayload: Record<string, unknown> | null
  let consumeDemoMinutesArgs: Record<string, unknown> | null
  let consumeDemoMinutesResult: { data: number | null; error: { message: string } | null }
  let checkDemoLowBalanceCalls: [string, number, string][]

  beforeEach(() => {
    vi.resetModules()
    demoDispatchRow = null
    partnerSessionsRow = null
    demoDispatchUpdatePayload = null
    consumeDemoMinutesArgs = null
    consumeDemoMinutesResult = { data: 10, error: null }
    checkDemoLowBalanceCalls = []

    vi.doMock('@/lib/partner/webhooks', () => ({
      checkDemoLowBalanceAndAlert: (accountId: string, balance: number, path: string) => {
        checkDemoLowBalanceCalls.push([accountId, balance, path])
        return Promise.resolve()
      },
    }))

    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: (table: string) => {
          if (table === 'demo_dispatches') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: demoDispatchRow, error: null }),
                }),
              }),
              update: (patch: Record<string, unknown>) => ({
                eq: async () => {
                  demoDispatchUpdatePayload = patch
                  return { error: null }
                },
              }),
            }
          }
          if (table === 'partner_sessions') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: partnerSessionsRow, error: null }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
        rpc: (fn: string, args: Record<string, unknown>) => {
          if (fn === 'consume_demo_minutes') {
            consumeDemoMinutesArgs = args
            return Promise.resolve(consumeDemoMinutesResult)
          }
          throw new Error(`Unexpected rpc: ${fn}`)
        },
      }),
    }))
  })

  it('skips (no-op) when the event carries no partnerSessionId', async () => {
    const { demoDispatchMinutesConsumer } = await import('@/inngest/demo-dispatch-minutes-consumer')
    const result = await handlerOf(demoDispatchMinutesConsumer)({ event: { data: {} }, step: fakeStep() })
    expect(result).toEqual({ status: 'skipped', reason: 'missing_partner_session_id' })
  })

  it('AT-9-supporting: skips (no-op, never touches demo_minutes_balance) for a REAL partner session with no demo_dispatches row — the common case', async () => {
    demoDispatchRow = null
    const { demoDispatchMinutesConsumer } = await import('@/inngest/demo-dispatch-minutes-consumer')
    const result = await handlerOf(demoDispatchMinutesConsumer)({
      event: { data: { partnerSessionId: 'real-session-1' } },
      step: fakeStep(),
    })
    expect(result).toEqual({ status: 'skipped', reason: 'not_a_demo_dispatch' })
    expect(consumeDemoMinutesArgs).toBeNull()
  })

  // AT-4 — a demo session that ran for N minutes decrements demo_minutes_balance by N via
  // consume_demo_minutes, never touching trial_minutes_used/test_minutes_balance (this function
  // never reads/writes those columns at all — confirmed by the mock only exposing
  // demo_dispatches/partner_sessions/consume_demo_minutes).
  it('AT-4: consumes duration-minutes via consume_demo_minutes for the resolved billed account', async () => {
    demoDispatchRow = { id: 'dispatch-1', billed_partner_account_id: 'acct-reseller-1' }
    partnerSessionsRow = { created_at: '2026-07-27T10:00:00.000Z', ended_at: '2026-07-27T10:12:00.000Z' } // 12 minutes
    const { demoDispatchMinutesConsumer } = await import('@/inngest/demo-dispatch-minutes-consumer')
    const result = await handlerOf(demoDispatchMinutesConsumer)({
      event: { data: { partnerSessionId: 'demo-session-1' } },
      step: fakeStep(),
    })
    expect(consumeDemoMinutesArgs).toEqual({ p_partner_account_id: 'acct-reseller-1', p_minutes: 12 })
    expect(demoDispatchUpdatePayload).toEqual({ demo_minutes_consumed: 12 })
    expect(result).toMatchObject({ status: 'consumed', durationMinutes: 12 })
  })

  it('calls checkDemoLowBalanceAndAlert with the reseller dashboard path for a non-admin billed account', async () => {
    demoDispatchRow = { id: 'dispatch-1', billed_partner_account_id: 'acct-reseller-1' }
    partnerSessionsRow = { created_at: '2026-07-27T10:00:00.000Z', ended_at: '2026-07-27T10:05:00.000Z' }
    consumeDemoMinutesResult = { data: 3, error: null }
    const { demoDispatchMinutesConsumer } = await import('@/inngest/demo-dispatch-minutes-consumer')
    await handlerOf(demoDispatchMinutesConsumer)({ event: { data: { partnerSessionId: 'demo-session-2' } }, step: fakeStep() })
    expect(checkDemoLowBalanceCalls).toEqual([['acct-reseller-1', 3, '/dashboard/channel-partner/settings']])
  })

  it('calls checkDemoLowBalanceAndAlert with the admin dashboard path for the "Clio Internal — Public Demo" sentinel account', async () => {
    demoDispatchRow = { id: 'dispatch-1', billed_partner_account_id: '30d40f51-5d6e-49e9-bdda-519b7d70e13a' }
    partnerSessionsRow = { created_at: '2026-07-27T10:00:00.000Z', ended_at: '2026-07-27T10:05:00.000Z' }
    const { demoDispatchMinutesConsumer } = await import('@/inngest/demo-dispatch-minutes-consumer')
    await handlerOf(demoDispatchMinutesConsumer)({ event: { data: { partnerSessionId: 'demo-session-3' } }, step: fakeStep() })
    expect(checkDemoLowBalanceCalls[0][2]).toBe('/dashboard/admin/sales-partners')
  })

  it('does not call consume_demo_minutes (or the low-balance check) when duration is 0 (session never ended)', async () => {
    demoDispatchRow = { id: 'dispatch-1', billed_partner_account_id: 'acct-reseller-1' }
    partnerSessionsRow = { created_at: '2026-07-27T10:00:00.000Z', ended_at: null }
    const { demoDispatchMinutesConsumer } = await import('@/inngest/demo-dispatch-minutes-consumer')
    await handlerOf(demoDispatchMinutesConsumer)({ event: { data: { partnerSessionId: 'demo-session-4' } }, step: fakeStep() })
    expect(consumeDemoMinutesArgs).toBeNull()
    expect(checkDemoLowBalanceCalls).toHaveLength(0)
  })

  it('logs and does not throw when consume_demo_minutes RPC fails (never blocks/retries indefinitely — the low-balance check is skipped)', async () => {
    demoDispatchRow = { id: 'dispatch-1', billed_partner_account_id: 'acct-reseller-1' }
    partnerSessionsRow = { created_at: '2026-07-27T10:00:00.000Z', ended_at: '2026-07-27T10:05:00.000Z' }
    consumeDemoMinutesResult = { data: null, error: { message: 'rpc failed' } }
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { demoDispatchMinutesConsumer } = await import('@/inngest/demo-dispatch-minutes-consumer')
    const result = await handlerOf(demoDispatchMinutesConsumer)({ event: { data: { partnerSessionId: 'demo-session-5' } }, step: fakeStep() })
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(checkDemoLowBalanceCalls).toHaveLength(0)
    expect(demoDispatchUpdatePayload).toBeNull() // record-consumed step never reached
    expect(result).toMatchObject({ status: 'consumed' })
    consoleErrorSpy.mockRestore()
  })
})
