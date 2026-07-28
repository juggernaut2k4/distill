import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-43 Fix 3 — covers partnerTrialStuckSessionBackstopSweep (inngest/partner-trial-cutoff.ts).
 *
 * Background: the ONLY thing that arms a test-mode session's cutoff timer is a single
 * fire-and-forget `inngest.send('clio/partner-trial.started')` call in
 * app/api/partner/v1/sessions/route.ts — no retry, no DB flag marking "cutoff armed." If that event
 * is ever silently dropped (confirmed to have happened at least once, 2026-07-27), nothing else in
 * the codebase ever recovers the session. This sweep finds `partner_sessions` rows stuck in
 * `'requested'`/`'bot_active'`, `test_mode=true`, with `updated_at` older than the 60-minute ceiling,
 * and force-completes them via the same leave-bot/consume-minutes/mark-session-completed/
 * record-billable-events sequence `partnerTrialCutoffJob` runs on a normal cutoff.
 *
 * Mocking convention mirrors tests/unit/b2b37-partner-session-insights-guard-and-backstop.test.ts:
 * `@/lib/supabase`'s createSupabaseAdminClient is mocked with an in-memory fixture table, and the
 * Inngest function's real `.fn` (from `inngest.createFunction`) is invoked directly with a fake
 * `step.run` that just calls through — no real Inngest runtime involved.
 */

interface FakeSession {
  id: string
  partner_account_id: string
  provider_bot_id: string | null
  status: string
  test_mode: boolean
  updated_at: string
}

let sessionsById: Record<string, FakeSession> = {}
let walletsByAccount: Record<string, { trial_minutes_used: number; test_minutes_balance: number }> = {}
let sessionUpdates: Record<string, Record<string, unknown>> = {}
let rpcCalls: { fn: string; args: Record<string, unknown> }[] = []

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'partner_sessions') {
        return {
          select: (_cols: string) => ({
            in: (_col: string, statuses: string[]) => ({
              eq: (_col2: string, testModeVal: boolean) => ({
                lt: async (_col3: string, cutoffIso: string) => {
                  const rows = Object.values(sessionsById).filter(
                    (s) => statuses.includes(s.status) && s.test_mode === testModeVal && s.updated_at < cutoffIso
                  )
                  return {
                    data: rows.map((s) => ({ id: s.id, partner_account_id: s.partner_account_id, provider_bot_id: s.provider_bot_id })),
                    error: null,
                  }
                },
              }),
            }),
          }),
          update: (fields: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              sessionUpdates[id] = fields
              if (sessionsById[id]) {
                sessionsById[id] = { ...sessionsById[id], ...(fields as Partial<FakeSession>) }
              }
              return { error: null }
            },
          }),
        }
      }
      if (table === 'partner_wallets') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, accountId: string) => ({
              maybeSingle: async () => ({ data: walletsByAccount[accountId] ?? null, error: null }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table in test mock: ${table}`)
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return { error: null }
    },
  }),
}))

const deleteBotMock = vi.fn()
vi.mock('@/lib/meeting-bot/provider', () => ({
  getMeetingBotProvider: () => ({ deleteBot: (...args: unknown[]) => deleteBotMock(...args) }),
}))

const recordBillableEventMock = vi.fn()
vi.mock('@/lib/partner/webhooks', () => ({
  recordBillableEvent: (...args: unknown[]) => recordBillableEventMock(...args),
}))

const emitPartnerSessionEndedEventMock = vi.fn()
vi.mock('@/lib/partner/live-render', () => ({
  emitPartnerSessionEndedEvent: (...args: unknown[]) => emitPartnerSessionEndedEventMock(...args),
}))

import { partnerTrialStuckSessionBackstopSweep } from '@/inngest/partner-trial-cutoff'

function handlerOf(fn: unknown): (args: unknown) => Promise<unknown> {
  return (fn as { fn: (args: unknown) => Promise<unknown> }).fn
}

const fakeStep = () => ({
  run: async <T>(_id: string, cb: () => Promise<T> | T) => cb(),
})

const HOURS_AGO = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString()
const MINUTES_AGO = (n: number) => new Date(Date.now() - n * 60 * 1000).toISOString()

describe('partnerTrialStuckSessionBackstopSweep — B2B-43 Fix 3', () => {
  beforeEach(() => {
    sessionsById = {}
    walletsByAccount = {}
    sessionUpdates = {}
    rpcCalls = []
    deleteBotMock.mockReset()
    recordBillableEventMock.mockReset()
    emitPartnerSessionEndedEventMock.mockReset()
  })

  it('force-completes a stuck test_mode session older than the 60-minute ceiling', async () => {
    sessionsById.stuck1 = {
      id: 'stuck1',
      partner_account_id: 'acct1',
      provider_bot_id: 'bot-1',
      status: 'bot_active',
      test_mode: true,
      updated_at: HOURS_AGO(2),
    }
    walletsByAccount.acct1 = { trial_minutes_used: 5, test_minutes_balance: 0 }

    const result = await handlerOf(partnerTrialStuckSessionBackstopSweep)({ step: fakeStep() })

    expect(result).toEqual({ checked: 1, recovered: 1, failed: 0 })
    expect(sessionUpdates.stuck1).toMatchObject({ status: 'completed', end_reason: 'trial_limit_reached' })
    expect(deleteBotMock).toHaveBeenCalledWith('bot-1')
    expect(emitPartnerSessionEndedEventMock).toHaveBeenCalledWith('stuck1')
    // usage.voice_minute + session.completed, mirroring the normal cutoff job's own two-call pattern.
    expect(recordBillableEventMock).toHaveBeenCalledTimes(2)
    expect(recordBillableEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'usage.voice_minute', clioSessionRef: 'stuck1', quantity: 15, testMode: true })
    )
    expect(rpcCalls).toContainEqual({ fn: 'consume_trial_and_test_minutes', args: { p_partner_account_id: 'acct1', p_minutes: 15 } })
  })

  it('leaves a test_mode session younger than the ceiling alone', async () => {
    sessionsById.young1 = {
      id: 'young1',
      partner_account_id: 'acct1',
      provider_bot_id: 'bot-2',
      status: 'bot_active',
      test_mode: true,
      updated_at: MINUTES_AGO(10),
    }

    const result = await handlerOf(partnerTrialStuckSessionBackstopSweep)({ step: fakeStep() })

    expect(result).toEqual({ checked: 0, recovered: 0, failed: 0 })
    expect(sessionUpdates.young1).toBeUndefined()
    expect(deleteBotMock).not.toHaveBeenCalled()
  })

  it('leaves a non-test_mode (live) session alone regardless of age — out of scope per the brief', async () => {
    sessionsById.live1 = {
      id: 'live1',
      partner_account_id: 'acct2',
      provider_bot_id: 'bot-3',
      status: 'bot_active',
      test_mode: false,
      updated_at: HOURS_AGO(5),
    }

    const result = await handlerOf(partnerTrialStuckSessionBackstopSweep)({ step: fakeStep() })

    expect(result).toEqual({ checked: 0, recovered: 0, failed: 0 })
    expect(sessionUpdates.live1).toBeUndefined()
    expect(deleteBotMock).not.toHaveBeenCalled()
  })

  it('never touches a session already in a terminal status (completed/failed)', async () => {
    sessionsById.done1 = {
      id: 'done1',
      partner_account_id: 'acct3',
      provider_bot_id: 'bot-4',
      status: 'completed',
      test_mode: true,
      updated_at: HOURS_AGO(3),
    }
    sessionsById.failed1 = {
      id: 'failed1',
      partner_account_id: 'acct3',
      provider_bot_id: 'bot-5',
      status: 'failed',
      test_mode: true,
      updated_at: HOURS_AGO(3),
    }

    const result = await handlerOf(partnerTrialStuckSessionBackstopSweep)({ step: fakeStep() })

    expect(result).toEqual({ checked: 0, recovered: 0, failed: 0 })
    expect(sessionUpdates.done1).toBeUndefined()
    expect(sessionUpdates.failed1).toBeUndefined()
    expect(deleteBotMock).not.toHaveBeenCalled()
  })
})
