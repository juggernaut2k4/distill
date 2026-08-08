import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-76 §1.3 (item 3) — covers the max-call-duration half of
 * partnerTrialStuckSessionBackstopSweep (inngest/partner-trial-cutoff.ts), merged into the existing
 * sweep rather than a second parallel cron (see MAX_WIDGET_CALL_DURATION_MS's own JSDoc in that file
 * for why — in short, a second cron on the identical every-15-minutes schedule querying a
 * functionally-overlapping condition would race this one and could double-force-complete a session).
 *
 * Same mocking convention as tests/unit/b2b43-stuck-session-backstop-sweep.test.ts and
 * tests/unit/b2b70-widget-active-backstop.test.ts (both updated alongside this file to the same
 * generic chainable query-builder mock, since the sweep now runs two differently-shaped queries
 * against partner_sessions in one step).
 */

interface FakeSession {
  id: string
  partner_account_id: string
  provider_bot_id: string | null
  status: string
  test_mode: boolean
  updated_at: string
  created_at: string
  delivery_channel?: string
}

let sessionsById: Record<string, FakeSession> = {}
let walletsByAccount: Record<string, { trial_minutes_used: number; test_minutes_balance: number }> = {}
let sessionUpdates: Record<string, Record<string, unknown>> = {}
let rpcCalls: { fn: string; args: Record<string, unknown> }[] = []

function makePartnerSessionsQuery() {
  type Row = FakeSession
  type Filter = (row: Row) => boolean
  function builder(filters: Filter[]): {
    eq: (col: string, val: unknown) => ReturnType<typeof builder>
    in: (col: string, vals: unknown[]) => ReturnType<typeof builder>
    lt: (col: string, val: string) => Promise<{ data: unknown[]; error: null }>
  } {
    return {
      eq: (col, val) => builder([...filters, (row) => (row as unknown as Record<string, unknown>)[col] === val]),
      in: (col, vals) => builder([...filters, (row) => vals.includes((row as unknown as Record<string, unknown>)[col])]),
      lt: async (col, val) => {
        const matched = Object.values(sessionsById).filter(
          (row) => filters.every((f) => f(row)) && ((row as unknown as Record<string, unknown>)[col] as string | undefined) !== undefined && ((row as unknown as Record<string, unknown>)[col] as string) < val
        )
        return {
          data: matched.map((s) => ({ id: s.id, partner_account_id: s.partner_account_id, provider_bot_id: s.provider_bot_id })),
          error: null,
        }
      },
    }
  }
  return { select: (_cols: string) => builder([]) }
}

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'partner_sessions') {
        return {
          ...makePartnerSessionsQuery(),
          update: (fields: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              sessionUpdates[id] = fields
              if (sessionsById[id]) sessionsById[id] = { ...sessionsById[id], ...(fields as Partial<FakeSession>) }
              return { error: null }
            },
          }),
        }
      }
      if (table === 'partner_wallets') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, accountId: string) => ({
              limit: async () => ({ data: walletsByAccount[accountId] ? [walletsByAccount[accountId]] : [], error: null }),
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

const fakeStep = () => ({ run: async <T>(_id: string, cb: () => Promise<T> | T) => cb() })

const HOURS_AGO = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString()
const MINUTES_AGO = (n: number) => new Date(Date.now() - n * 60 * 1000).toISOString()

describe('partnerTrialStuckSessionBackstopSweep — max-call-duration merge (B2B-76 §1.3)', () => {
  beforeEach(() => {
    sessionsById = {}
    walletsByAccount = {}
    sessionUpdates = {}
    rpcCalls = []
    deleteBotMock.mockReset()
    recordBillableEventMock.mockReset()
    emitPartnerSessionEndedEventMock.mockReset()
  })

  it('force-completes a widget_active session whose created_at is over the max-duration ceiling, even though updated_at is recent (an active call, not an abandoned tab)', async () => {
    sessionsById.overrun1 = {
      id: 'overrun1',
      partner_account_id: 'acct1',
      provider_bot_id: null,
      status: 'widget_active',
      test_mode: true,
      delivery_channel: 'widget',
      created_at: HOURS_AGO(2), // call started 2h ago — well past the 60-min ceiling
      updated_at: MINUTES_AGO(1), // but something touched the row 1 minute ago — NOT stale by the old check
    }
    walletsByAccount.acct1 = { trial_minutes_used: 20, test_minutes_balance: 40 }

    const result = await handlerOf(partnerTrialStuckSessionBackstopSweep)({ step: fakeStep() })

    expect(result).toEqual({ checked: 1, recovered: 1, failed: 0 })
    expect(sessionUpdates.overrun1).toMatchObject({ status: 'completed', end_reason: 'trial_limit_reached' })
    expect(recordBillableEventMock).toHaveBeenCalledTimes(2)
  })

  it('leaves a widget_active session under the max-duration ceiling alone', async () => {
    sessionsById.young1 = {
      id: 'young1',
      partner_account_id: 'acct1',
      provider_bot_id: null,
      status: 'widget_active',
      test_mode: true,
      delivery_channel: 'widget',
      created_at: MINUTES_AGO(10),
      updated_at: MINUTES_AGO(10),
    }

    const result = await handlerOf(partnerTrialStuckSessionBackstopSweep)({ step: fakeStep() })

    expect(result).toEqual({ checked: 0, recovered: 0, failed: 0 })
    expect(sessionUpdates.young1).toBeUndefined()
  })

  it('does not force-complete twice a session caught by BOTH the staleness and max-duration conditions (the common case, since both ceilings are 60 minutes and nothing heartbeats updated_at mid-call)', async () => {
    sessionsById.both1 = {
      id: 'both1',
      partner_account_id: 'acct1',
      provider_bot_id: null,
      status: 'widget_active',
      test_mode: true,
      delivery_channel: 'widget',
      created_at: HOURS_AGO(3),
      updated_at: HOURS_AGO(3), // stale AND overrun — matches both queries
    }
    walletsByAccount.acct1 = { trial_minutes_used: 0, test_minutes_balance: 0 }

    const result = await handlerOf(partnerTrialStuckSessionBackstopSweep)({ step: fakeStep() })

    // Deduped to exactly one force-complete, not two.
    expect(result).toEqual({ checked: 1, recovered: 1, failed: 0 })
    expect(recordBillableEventMock).toHaveBeenCalledTimes(2) // usage.voice_minute + session.completed, once each
    expect(rpcCalls).toHaveLength(1) // consume_trial_and_test_minutes called exactly once
  })

  it('leaves a live-mode (test_mode=false) widget session over the max-duration ceiling alone — deliberately out of scope, see BACKLOG.md B2B-76-FF', async () => {
    sessionsById.live1 = {
      id: 'live1',
      partner_account_id: 'acct2',
      provider_bot_id: null,
      status: 'widget_active',
      test_mode: false,
      delivery_channel: 'widget',
      created_at: HOURS_AGO(3),
      updated_at: HOURS_AGO(3),
    }

    const result = await handlerOf(partnerTrialStuckSessionBackstopSweep)({ step: fakeStep() })

    expect(result).toEqual({ checked: 0, recovered: 0, failed: 0 })
    expect(sessionUpdates.live1).toBeUndefined()
  })

  it('leaves a meeting-bot (non-widget) session with an old created_at but a recent updated_at alone — max-duration is widget-channel-only', async () => {
    sessionsById.bot1 = {
      id: 'bot1',
      partner_account_id: 'acct3',
      provider_bot_id: 'bot-x',
      status: 'bot_active',
      test_mode: true,
      delivery_channel: 'meeting_bot',
      created_at: HOURS_AGO(3),
      updated_at: MINUTES_AGO(2), // recent — not stale by the staleness query either
    }

    const result = await handlerOf(partnerTrialStuckSessionBackstopSweep)({ step: fakeStep() })

    expect(result).toEqual({ checked: 0, recovered: 0, failed: 0 })
    expect(sessionUpdates.bot1).toBeUndefined()
  })
})
