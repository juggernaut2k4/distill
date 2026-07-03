import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * AUTOGEN-01 Part D — AC-D3 (zero minutes without speak_verified) and AC-D6
 * (gap subtraction) coverage for lib/session-billing.ts's computeBilledMinutes,
 * plus a bonus test for the audit-token security fix (verifyAuditToken).
 */

// Mutable per-test fixture for the audit log rows returned by the mocked
// Supabase client — set inside each test before calling computeBilledMinutes.
let auditRows: Array<{
  event_type: string
  occurred_at: string
  voice_provider: string | null
  metadata: Record<string, unknown>
}> = []

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
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
      // Not exercised by the tests below, but present so any accidental extra
      // call doesn't throw with "cannot read property of undefined".
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
            single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
        upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
        update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
      }
    }),
  })),
}))

import { computeBilledMinutes, verifyAuditToken } from '@/lib/session-billing'

describe('computeBilledMinutes', () => {
  beforeEach(() => {
    auditRows = []
  })

  // AC-D3: a session that never reaches speak_verified bills exactly 0 minutes.
  it('bills 0 minutes when the audit log never contains a speak_verified row', async () => {
    auditRows = [
      { event_type: 'bot_joined', occurred_at: '2024-01-01T00:00:00.000Z', voice_provider: null, metadata: {} },
      { event_type: 'voice_connect_attempt', occurred_at: '2024-01-01T00:00:05.000Z', voice_provider: 'elevenlabs', metadata: {} },
      { event_type: 'disconnected', occurred_at: '2024-01-01T00:05:00.000Z', voice_provider: null, metadata: {} },
    ]

    const result = await computeBilledMinutes('session-never-verified')

    expect(result.minutesUsed).toBe(0)
    expect(result.reachedSpeakVerified).toBe(false)
    expect(result.gapDurationMs).toBe(0)
  })

  it('bills 0 minutes for an audit log containing no rows at all', async () => {
    auditRows = []
    const result = await computeBilledMinutes('session-empty')
    expect(result).toEqual({ minutesUsed: 0, reachedSpeakVerified: false, gapDurationMs: 0 })
  })

  // AC-D6: a gap (disconnect + reconnect) is excluded from billed minutes.
  it('subtracts a closed gap_start/gap_end pair from billed minutes', async () => {
    auditRows = [
      { event_type: 'speak_verified', occurred_at: '2024-01-01T00:00:00.000Z', voice_provider: 'elevenlabs', metadata: {} },
      { event_type: 'gap_start', occurred_at: '2024-01-01T00:01:00.000Z', voice_provider: null, metadata: {} },
      { event_type: 'gap_end', occurred_at: '2024-01-01T00:02:00.000Z', voice_provider: null, metadata: {} },
      { event_type: 'disconnected', occurred_at: '2024-01-01T00:05:00.000Z', voice_provider: null, metadata: {} },
    ]

    const result = await computeBilledMinutes('session-with-gap')

    // Wall time speak_verified -> disconnected = 5 minutes; gap = 1 minute.
    // Billed = 5 - 1 = 4 minutes exactly.
    expect(result.reachedSpeakVerified).toBe(true)
    expect(result.gapDurationMs).toBe(60_000)
    expect(result.minutesUsed).toBe(4)
  })

  it('treats an unclosed trailing gap_start as extending to disconnectedAt (never billed)', async () => {
    auditRows = [
      { event_type: 'speak_verified', occurred_at: '2024-01-01T00:00:00.000Z', voice_provider: 'hume', metadata: {} },
      { event_type: 'gap_start', occurred_at: '2024-01-01T00:03:00.000Z', voice_provider: null, metadata: {} },
      // No gap_end — the gap is still "open" when disconnected fires.
      { event_type: 'disconnected', occurred_at: '2024-01-01T00:05:00.000Z', voice_provider: null, metadata: {} },
    ]

    const result = await computeBilledMinutes('session-open-gap')

    // 5 minutes wall time, last 2 minutes are an unresolved gap -> billed = 3 min.
    expect(result.gapDurationMs).toBe(2 * 60_000)
    expect(result.minutesUsed).toBe(3)
  })
})

describe('verifyAuditToken (security fix regression coverage)', () => {
  it('rejects when no token is provided', () => {
    expect(verifyAuditToken(undefined, 'stored-token')).toBe(false)
    expect(verifyAuditToken(null, 'stored-token')).toBe(false)
    expect(verifyAuditToken('', 'stored-token')).toBe(false)
  })

  it('rejects when no token is stored (no active session for this user)', () => {
    expect(verifyAuditToken('some-token', null)).toBe(false)
    expect(verifyAuditToken('some-token', undefined)).toBe(false)
  })

  it('rejects a mismatched token', () => {
    expect(verifyAuditToken('attacker-guess', 'the-real-token')).toBe(false)
  })

  it('rejects a token of different length without throwing', () => {
    expect(() => verifyAuditToken('short', 'a-much-longer-real-token-value')).not.toThrow()
    expect(verifyAuditToken('short', 'a-much-longer-real-token-value')).toBe(false)
  })

  it('accepts an exact match', () => {
    expect(verifyAuditToken('matching-token-123', 'matching-token-123')).toBe(true)
  })
})
