import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * AUTOGEN-01 Part D — AC-D8 coverage note:
 *
 * inngest/voice-gap-watchdog.ts is an Inngest step function (step.sleep +
 * step.run) triggered by an event and cancelled by another event. This repo has
 * no existing harness for driving Inngest functions directly in a unit test
 * (checked tests/ — the only other Inngest touchpoint, feedback-api.test.ts,
 * only asserts that `inngest.send` was called, it doesn't execute a function
 * body). Building a full Inngest test harness is out of scope for this fix.
 *
 * Instead, this file unit-tests forceEndSession() in lib/session-billing.ts —
 * the exact function the watchdog calls once its 30s sleep elapses and it
 * decides the gap is unresolved. This covers the two behaviors AC-D8 actually
 * depends on:
 *   1. Idempotency — if the session already ended (e.g. the user ended it
 *      manually, or a prior watchdog run already force-ended it), forceEndSession
 *      is a safe no-op. This is what makes the watchdog's own
 *      "already completed — skip" check (and the `cancelOn` config) safe even
 *      under race conditions.
 *   2. Force-ending an active session with an open (unresolved) gap correctly
 *      deducts minutes computed strictly from the audit log up to "now" — i.e.
 *      the exact mechanism that bounds unbilled bot-idle time to ~30s per AC-D8,
 *      rather than leaving the session open indefinitely.
 *
 * The 30-second timing itself (step.sleep('wait-30s-gap-threshold', '30s')) is
 * declarative Inngest config, not application logic — nothing to unit-test there
 * beyond reading the literal in inngest/voice-gap-watchdog.ts.
 */

let sessionsTable: { status: string } | null
let auditRows: Array<{ event_type: string; occurred_at: string; voice_provider: string | null; metadata: Record<string, unknown> }>
let deductedMinutes: number | null

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: sessionsTable, error: null })),
            })),
          })),
          update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
        }
      }
      if (table === 'walkthrough_state') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: { bot_id: null }, error: null })),
            })),
          })),
          update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
        }
      }
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({ data: { minutes_balance: 100 }, error: null })),
            })),
          })),
        }
      }
      if (table === 'session_billing_audit_log') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({ data: auditRows, error: null })),
            })),
          })),
          insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
        }
      }
      throw new Error(`Unexpected table in mock: ${table}`)
    }),
    rpc: vi.fn((_fn: string, args: { p_minutes: number }) => {
      deductedMinutes = args.p_minutes
      return Promise.resolve({ data: 100 - args.p_minutes, error: null })
    }),
  })),
}))

vi.mock('@/inngest/client', () => ({
  inngest: { send: vi.fn(() => Promise.resolve()) },
}))

vi.mock('@/lib/meeting-bot/provider', () => ({
  getMeetingBotProvider: vi.fn(() => ({ deleteBot: vi.fn(() => Promise.resolve()) })),
}))

import { forceEndSession } from '@/lib/session-billing'

describe('forceEndSession (used by the AC-D8 voice-gap watchdog)', () => {
  beforeEach(() => {
    sessionsTable = null
    auditRows = []
    deductedMinutes = null
  })

  it('is a no-op when the session is already completed (idempotent under race with the watchdog)', async () => {
    sessionsTable = { status: 'completed' }

    const result = await forceEndSession({ userId: 'user-1', sessionId: 'session-1' })

    expect(result).toEqual({ skipped: true })
    expect(deductedMinutes).toBeNull()
  })

  it('is a no-op when the session does not exist', async () => {
    sessionsTable = null

    const result = await forceEndSession({ userId: 'user-1', sessionId: 'session-missing' })

    expect(result).toEqual({ skipped: true })
  })

  it('force-ends an active session with an unresolved gap, deducting minutes computed up to now', async () => {
    sessionsTable = { status: 'active' }
    const now = Date.now()
    auditRows = [
      { event_type: 'speak_verified', occurred_at: new Date(now - 3 * 60_000).toISOString(), voice_provider: 'hume', metadata: {} },
      // Gap started 30+ seconds ago and never resolved — this is exactly the
      // condition the watchdog force-ends on.
      { event_type: 'gap_start', occurred_at: new Date(now - 31_000).toISOString(), voice_provider: null, metadata: {} },
    ]

    const result = await forceEndSession({ userId: 'user-1', sessionId: 'session-2' })

    expect(result.skipped).toBe(false)
    if (!result.skipped) {
      // 3 minutes of speak_verified->now, minus the trailing open gap (treated as
      // extending to "now" per computeBilledMinutes) — billed time is ~3min minus
      // ~31s of gap, i.e. 3 whole minutes after ceiling (2.48min -> 3).
      expect(result.minutesUsed).toBeGreaterThan(0)
      expect(result.minutesUsed).toBeLessThanOrEqual(3)
    }
    expect(deductedMinutes).toBe(result.skipped ? null : result.minutesUsed)
  })
})
