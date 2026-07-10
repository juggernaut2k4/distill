import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * RTV-03 — coverage for the additive, backward-compatible changes to
 * POST /api/sessions/audit-event: the 3 new rtv03_* event types, and the new
 * optional `metadata` field being passed through to writeAuditEvent()
 * unchanged. See requirement-docs/RTV-03-live-position-tracking.md Section
 * 6.3. Existing event types' behavior (no metadata sent -> defaults to {})
 * is the pre-existing test coverage in tests/integration/audit-event-api.test.ts
 * and is not re-asserted here.
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

describe('POST /api/sessions/audit-event — RTV-03 additive metadata field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts rtv03_state_advance with a metadata object and passes it through to writeAuditEvent unchanged', async () => {
    const metadata = {
      from_state: 0,
      to_state: 1,
      matched_word: 'transformer',
      lookahead_depth: 1,
      correction_type: 'normal',
      subtopic_slug: 'genai-basics',
    }
    const response = await POST(
      makeRequest({ userId: 'user-1', eventType: 'rtv03_state_advance', provider: 'hume', token: STORED_TOKEN, metadata })
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(writeAuditEvent).toHaveBeenCalledTimes(1)
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        userId: 'user-1',
        eventType: 'rtv03_state_advance',
        metadata,
      })
    )
  })

  it('accepts rtv03_quick_summary_cue and rtv03_next_topic_cue as valid event types', async () => {
    const r1 = await POST(
      makeRequest({ userId: 'user-1', eventType: 'rtv03_quick_summary_cue', token: STORED_TOKEN, metadata: { state: 1, matched_word: 'transformer', same_signal_as_next_topic_cue: true } })
    )
    expect(r1.status).toBe(200)

    const r2 = await POST(
      makeRequest({ userId: 'user-1', eventType: 'rtv03_next_topic_cue', token: STORED_TOKEN, metadata: { from_state: 0, to_state: 1, matched_word: 'transformer' } })
    )
    expect(r2.status).toBe(200)
    expect(writeAuditEvent).toHaveBeenCalledTimes(2)
  })

  it('rejects an unknown event type (Zod enum validation failure, 400) — the whitelist stays closed', async () => {
    const response = await POST(
      makeRequest({ userId: 'user-1', eventType: 'not_a_real_event_type', token: STORED_TOKEN })
    )
    expect(response.status).toBe(400)
    expect(writeAuditEvent).not.toHaveBeenCalled()
  })

  it('existing event types with no metadata field still default to {} (backward compatible)', async () => {
    const response = await POST(
      makeRequest({ userId: 'user-1', eventType: 'speak_verified', provider: 'hume', token: STORED_TOKEN })
    )
    expect(response.status).toBe(200)
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'speak_verified', metadata: {} })
    )
  })
})
