import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * RTV-01 — Fail-Closed Live-Transcript Relay Pre-Flight Gate.
 *
 * Covers the server-side half of the gate that's actually unit-testable
 * without a live Hume connection: POST /api/sessions/relay-blocked's
 * auth-fail-closed behavior (AC-9) and its reschedule-specific write shape
 * (AC-5 / AC-6 — no ended_at, no duration_mins, no deduct_minutes call, no
 * `disconnected` audit event; a relay-blocked session is "un-started," not
 * "completed").
 *
 * Mirrors the mocking approach already used in
 * tests/integration/audit-event-api.test.ts: a hand-rolled Supabase mock
 * capturing every `.update()` call by table, so the write shape can be
 * asserted directly, plus the REAL verifyAuditToken (from
 * lib/session-billing.ts) so the auth check under test is the genuine
 * constant-time comparison, not a stub.
 */

const REAL_TOKEN = 'the-real-per-session-relay-token'

interface UpdateCall {
  table: string
  payload: Record<string, unknown>
  eqField: string
  eqValue: unknown
}

let wsRow: { session_id: string | null; audit_token: string | null; bot_id: string | null } | null = null
let updateCalls: UpdateCall[] = []

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: wsRow, error: null })),
        })),
      })),
      update: vi.fn((payload: Record<string, unknown>) => ({
        eq: vi.fn((eqField: string, eqValue: unknown) => {
          updateCalls.push({ table, payload, eqField, eqValue })
          return Promise.resolve({ data: null, error: null })
        }),
      })),
    })),
  })),
}))

const deleteBotMock = vi.fn(() => Promise.resolve())
vi.mock('@/lib/meeting-bot/provider', () => ({
  getMeetingBotProvider: vi.fn(() => ({ deleteBot: deleteBotMock })),
}))

import { POST } from '@/app/api/sessions/relay-blocked/route'

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/sessions/relay-blocked', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/sessions/relay-blocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateCalls = []
    wsRow = { session_id: 'session-abc', audit_token: REAL_TOKEN, bot_id: 'bot-xyz' }
  })

  describe('auth (AC-9 — fail-closed, identical posture to end-call)', () => {
    it('rejects a request with no token field at all (Zod validation failure, 400)', async () => {
      const response = await POST(makeRequest({ userId: 'user-1' }))
      expect(response.status).toBe(400)
      expect(deleteBotMock).not.toHaveBeenCalled()
      expect(updateCalls).toHaveLength(0)
    })

    it('rejects a request with the wrong token (401) and performs no bot deletion, no teardown, no status change', async () => {
      const response = await POST(makeRequest({ userId: 'user-1', token: 'attacker-guess' }))
      const json = await response.json()

      expect(response.status).toBe(401)
      expect(json.error).toMatch(/token/i)
      expect(deleteBotMock).not.toHaveBeenCalled()
      expect(updateCalls).toHaveLength(0)
    })

    it('rejects when no walkthrough_state row exists for the user (no stored token to match) — 401, no side effects', async () => {
      wsRow = null
      const response = await POST(makeRequest({ userId: 'user-1', token: REAL_TOKEN }))
      expect(response.status).toBe(401)
      expect(deleteBotMock).not.toHaveBeenCalled()
      expect(updateCalls).toHaveLength(0)
    })
  })

  describe('success path — reschedule write shape (AC-5 / AC-6)', () => {
    it('returns { ok: true } with the correct token', async () => {
      const response = await POST(makeRequest({ userId: 'user-1', token: REAL_TOKEN }))
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json).toEqual({ ok: true })
    })

    it('deletes the Recall.ai bot via getMeetingBotProvider().deleteBot(botId)', async () => {
      await POST(makeRequest({ userId: 'user-1', token: REAL_TOKEN }))
      expect(deleteBotMock).toHaveBeenCalledTimes(1)
      expect(deleteBotMock).toHaveBeenCalledWith('bot-xyz')
    })

    it('reverts the sessions row to status=scheduled, started_at=null — and writes NO ended_at, NO duration_mins', async () => {
      await POST(makeRequest({ userId: 'user-1', token: REAL_TOKEN }))

      const sessionsUpdate = updateCalls.find((c) => c.table === 'sessions')
      expect(sessionsUpdate).toBeDefined()
      expect(sessionsUpdate?.eqField).toBe('id')
      expect(sessionsUpdate?.eqValue).toBe('session-abc')
      expect(sessionsUpdate?.payload).toEqual({ status: 'scheduled', started_at: null })
      // Explicitly NOT a completion write.
      expect(sessionsUpdate?.payload).not.toHaveProperty('ended_at')
      expect(sessionsUpdate?.payload).not.toHaveProperty('duration_mins')
    })

    it('tears down walkthrough_state with the same shape forceEndSession clears, and rotates audit_token out', async () => {
      await POST(makeRequest({ userId: 'user-1', token: REAL_TOKEN }))

      const wsUpdate = updateCalls.find((c) => c.table === 'walkthrough_state')
      expect(wsUpdate).toBeDefined()
      expect(wsUpdate?.eqField).toBe('user_id')
      expect(wsUpdate?.eqValue).toBe('user-1')
      expect(wsUpdate?.payload).toMatchObject({
        bot_id: null,
        meeting_url: null,
        status: 'idle',
        visual_spec: null,
        topic_title: null,
        topic_id: null,
        sections: null,
        training_scripts: null,
        session_brief: null,
        topic_context: null,
        session_script: null,
        clio_session_context: null,
        current_section_index: 0,
        pending_transcript: null,
        audit_token: null,
      })
    })

    it('never calls the deduct_minutes RPC or any billing/ledger write (route has no supabase.rpc call at all)', async () => {
      // The mocked supabase client above exposes only `from()` — if the route
      // ever called `.rpc(...)` this test's mock would throw (rpc is not a
      // function on the mock), which would fail the test. A clean 200 with
      // ok:true therefore proves no rpc call was attempted.
      const response = await POST(makeRequest({ userId: 'user-1', token: REAL_TOKEN }))
      expect(response.status).toBe(200)
    })
  })

  describe('non-fatal edge cases (Section 8 error states)', () => {
    it('proceeds with the reschedule writes even when bot_id is null (nothing to delete)', async () => {
      wsRow = { session_id: 'session-abc', audit_token: REAL_TOKEN, bot_id: null }
      const response = await POST(makeRequest({ userId: 'user-1', token: REAL_TOKEN }))
      const json = await response.json()

      expect(json).toEqual({ ok: true })
      expect(deleteBotMock).not.toHaveBeenCalled()
      expect(updateCalls.find((c) => c.table === 'sessions')).toBeDefined()
      expect(updateCalls.find((c) => c.table === 'walkthrough_state')).toBeDefined()
    })

    it('skips the sessions write (nothing to revert) but still tears down walkthrough_state when session_id is null', async () => {
      wsRow = { session_id: null, audit_token: REAL_TOKEN, bot_id: 'bot-xyz' }
      const response = await POST(makeRequest({ userId: 'user-1', token: REAL_TOKEN }))
      const json = await response.json()

      expect(json).toEqual({ ok: true })
      expect(updateCalls.find((c) => c.table === 'sessions')).toBeUndefined()
      expect(updateCalls.find((c) => c.table === 'walkthrough_state')).toBeDefined()
    })

    it('does not throw to the caller when deleteBot rejects — still returns ok:true and still performs the writes', async () => {
      deleteBotMock.mockRejectedValueOnce(new Error('Recall.ai API down'))
      const response = await POST(makeRequest({ userId: 'user-1', token: REAL_TOKEN }))
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json).toEqual({ ok: true })
      expect(updateCalls.find((c) => c.table === 'sessions')).toBeDefined()
      expect(updateCalls.find((c) => c.table === 'walkthrough_state')).toBeDefined()
    })

    it('returns a non-fatal 400 (never throws) on an invalid JSON body', async () => {
      const req = new NextRequest('http://localhost:3000/api/sessions/relay-blocked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json',
      })
      const response = await POST(req)
      expect(response.status).toBe(400)
    })
  })
})
