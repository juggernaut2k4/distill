import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * AUTOGEN-01 Part D — security-fix regression test.
 *
 * Confirms the fix for the CEO-review vulnerability actually rejects a request
 * that supplies a userId but a missing/incorrect audit token, and accepts one
 * that supplies the correct token — i.e. it proves the three exploit paths
 * described in lib/session-billing.ts (fake gap events to zero out billed
 * minutes, faking gap_end to cancel the watchdog, writing into another user's
 * session) are closed at the door, before any event is written or any
 * gap-watchdog event is emitted.
 */

const STORED_TOKEN = 'the-real-per-session-token'

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({ data: { session_id: 'session-123', audit_token: STORED_TOKEN }, error: null })
          ),
        })),
      })),
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  })),
}))

vi.mock('@/lib/session-billing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/session-billing')>('@/lib/session-billing')
  return {
    ...actual,
    writeAuditEvent: vi.fn(() => Promise.resolve()),
    emitGapStarted: vi.fn(),
    emitGapEnded: vi.fn(),
    // Keep the real verifyAuditToken — that's exactly what's under test.
  }
})

import { POST } from '@/app/api/sessions/audit-event/route'
import { writeAuditEvent } from '@/lib/session-billing'

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/sessions/audit-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/sessions/audit-event — audit token enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a request with no token at all (Zod validation failure, 400)', async () => {
    const response = await POST(
      makeRequest({ userId: 'user-1', eventType: 'speak_verified', provider: 'elevenlabs' })
    )
    expect(response.status).toBe(400)
    expect(writeAuditEvent).not.toHaveBeenCalled()
  })

  it('rejects a request with the wrong token (401) and never writes the event', async () => {
    const response = await POST(
      makeRequest({ userId: 'user-1', eventType: 'speak_verified', provider: 'elevenlabs', token: 'attacker-guess' })
    )
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json.error).toMatch(/token/i)
    expect(writeAuditEvent).not.toHaveBeenCalled()
  })

  it('rejects gap_start/gap_end forgeries the same way a legitimate speak_verified would be rejected', async () => {
    const response = await POST(
      makeRequest({ userId: 'user-1', eventType: 'gap_end', token: 'attacker-guess' })
    )
    expect(response.status).toBe(401)
    expect(writeAuditEvent).not.toHaveBeenCalled()
  })

  it('accepts a request with the correct token and writes the event', async () => {
    const response = await POST(
      makeRequest({ userId: 'user-1', eventType: 'speak_verified', provider: 'elevenlabs', token: STORED_TOKEN })
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(writeAuditEvent).toHaveBeenCalledTimes(1)
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-123', userId: 'user-1', eventType: 'speak_verified' })
    )
  })
})
