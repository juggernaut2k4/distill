import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-70 (docs/specs/B2B-70-requirement-document.md §6.11) — covers the one-line addition to
 * partnerTrialStuckSessionBackstopSweep (inngest/partner-trial-cutoff.ts): 'widget_active' added to
 * the sweep's status filter, so an abandoned widget tab (closed without the pagehide beacon firing)
 * is recovered the same way a stuck meeting-bot session already is.
 *
 * A new file, not an edit to tests/unit/b2b43-stuck-session-backstop-sweep.test.ts (that file's own
 * mock already handles an arbitrary `statuses` array generically and needs no change — this file
 * exercises the new 'widget_active' case specifically, same mocking convention).
 */

interface FakeSession {
  id: string
  partner_account_id: string
  provider_bot_id: string | null
  status: string
  test_mode: boolean
  updated_at: string
  // B2B-76 §1.3 (item 3) — optional; unset in every fixture in this file, so the new merged
  // max-duration query (filters on delivery_channel + created_at) never matches these rows.
  delivery_channel?: string
  created_at?: string
}

let sessionsById: Record<string, FakeSession> = {}
let walletsByAccount: Record<string, { trial_minutes_used: number; test_minutes_balance: number }> = {}
let sessionUpdates: Record<string, Record<string, unknown>> = {}

// B2B-76 §1.3 — same generic chainable query-builder mock as
// tests/unit/b2b43-stuck-session-backstop-sweep.test.ts (see that file's comment for why this
// replaced the old narrow `.in().eq().lt()`-only shape).
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
    rpc: async () => ({ error: null }),
  }),
}))

const deleteBotMock = vi.fn()
vi.mock('@/lib/meeting-bot/provider', () => ({
  getMeetingBotProvider: () => ({ deleteBot: (...args: unknown[]) => deleteBotMock(...args) }),
}))

vi.mock('@/lib/partner/webhooks', () => ({ recordBillableEvent: vi.fn() }))
vi.mock('@/lib/partner/live-render', () => ({ emitPartnerSessionEndedEvent: vi.fn() }))

import { partnerTrialStuckSessionBackstopSweep } from '@/inngest/partner-trial-cutoff'

function handlerOf(fn: unknown): (args: unknown) => Promise<unknown> {
  return (fn as { fn: (args: unknown) => Promise<unknown> }).fn
}

const fakeStep = () => ({ run: async <T>(_id: string, cb: () => Promise<T> | T) => cb() })

const HOURS_AGO = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString()
const MINUTES_AGO = (n: number) => new Date(Date.now() - n * 60 * 1000).toISOString()

describe("partnerTrialStuckSessionBackstopSweep — 'widget_active' (B2B-70 §6.11)", () => {
  beforeEach(() => {
    sessionsById = {}
    walletsByAccount = {}
    sessionUpdates = {}
    deleteBotMock.mockReset()
  })

  it('force-completes a stuck widget_active session past the ceiling — provider_bot_id is null, so leave-bot no-ops', async () => {
    sessionsById.widget1 = {
      id: 'widget1',
      partner_account_id: 'acct-widget',
      provider_bot_id: null,
      status: 'widget_active',
      test_mode: true,
      updated_at: HOURS_AGO(2),
    }
    walletsByAccount['acct-widget'] = { trial_minutes_used: 0, test_minutes_balance: 0 }

    const result = await handlerOf(partnerTrialStuckSessionBackstopSweep)({ step: fakeStep() })

    expect(result).toEqual({ checked: 1, recovered: 1, failed: 0 })
    expect(sessionUpdates.widget1).toMatchObject({ status: 'completed', end_reason: 'trial_limit_reached' })
    expect(deleteBotMock).not.toHaveBeenCalled()
  })

  it('leaves a widget_active session younger than the ceiling alone', async () => {
    sessionsById.widget2 = {
      id: 'widget2',
      partner_account_id: 'acct-widget',
      provider_bot_id: null,
      status: 'widget_active',
      test_mode: true,
      updated_at: MINUTES_AGO(5),
    }

    const result = await handlerOf(partnerTrialStuckSessionBackstopSweep)({ step: fakeStep() })

    expect(result).toEqual({ checked: 0, recovered: 0, failed: 0 })
    expect(sessionUpdates.widget2).toBeUndefined()
  })
})
