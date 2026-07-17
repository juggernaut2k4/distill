import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-10 / B2B-11 — tests for app/api/attendee/webhook/route.ts's extension
 * to correlate and handle events for partner-dispatched bots.
 * See docs/specs/B2B-10-requirement-document.md Section 7 and
 * docs/specs/B2B-11-requirement-document.md Section 7 for the exact
 * acceptance-test lists this file implements.
 *
 * Covers:
 *  - B2C regression: the existing walkthrough_state switch is unaffected,
 *    and the new partner_sessions lookup is never attempted on a B2C hit.
 *  - Partner-event correlation via bot_metadata.user_id -> partner_sessions.id.
 *  - `ended` as a no-op when the client-side path already completed the session.
 *  - `ended` as the fallback completer when it didn't.
 *  - `fatal_error` billing + status='failed'.
 *  - `transcript.update` no-op (no DB write, no handleSessionEnd call).
 *  - `joined_recording` confirmatory-only (no DB write).
 *  - No-match fallback: neither table matches -> 200 { ok: true }, no throw.
 *  - B2B-11: `participant_events.join_leave` sets the join-greeting flag
 *    (previously a no-op, per B2B-10's own documented deferral).
 */

interface PartnerSessionRowShape {
  id: string
  partner_account_id: string
  status: string
  test_mode: boolean
  updated_at: string
  attendee_joined_at?: string | null
}

const state: {
  walkthroughRow: Record<string, unknown> | null
  partnerSessionRow: PartnerSessionRowShape | null
  themeConfigRow: Record<string, unknown> | null
  fromCalls: string[]
  walkthroughUpdateCalls: Array<Record<string, unknown>>
  partnerSessionUpdateCalls: Array<Record<string, unknown>>
} = {
  walkthroughRow: null,
  partnerSessionRow: null,
  themeConfigRow: null,
  fromCalls: [],
  walkthroughUpdateCalls: [],
  partnerSessionUpdateCalls: [],
}

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      state.fromCalls.push(table)

      if (table === 'walkthrough_state') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({ data: state.walkthroughRow })),
            })),
          })),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: vi.fn(() => {
              state.walkthroughUpdateCalls.push(patch)
              return Promise.resolve({ error: null })
            }),
          })),
        }
      }

      if (table === 'partner_sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.partnerSessionRow })),
            })),
          })),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: vi.fn(() => {
              state.partnerSessionUpdateCalls.push(patch)
              return Promise.resolve({ error: null })
            }),
          })),
        }
      }

      // B2B-11 — getThemeConfig() reads this table for the bot-name-skip
      // check in the join_leave branch (app/api/attendee/webhook/route.ts).
      if (table === 'partner_theme_config') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.themeConfigRow })),
            })),
          })),
        }
      }

      if (table === 'sessions' || table === 'users' || table === 'user_session_context') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: null })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ error: null })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

vi.mock('@/lib/session-ai', () => ({
  analyzeTranscription: vi.fn(() =>
    Promise.resolve({ sentiment: 'neutral', intent: 'other', isComplex: false, extractedQuestion: null })
  ),
}))

vi.mock('@/lib/user-context', () => ({
  getOrCreateContext: vi.fn(() => Promise.resolve({ communicationStyle: 'direct', engagementLevel: 'high' })),
  updateSentiment: vi.fn(() => Promise.resolve()),
  addUnresolvedQuestion: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/inngest/client', () => ({
  inngest: { send: vi.fn(() => Promise.resolve()) },
}))

const handleSessionEndMock = vi.fn((..._args: unknown[]) => Promise.resolve())
vi.mock('@/lib/partner/live-render', () => ({
  handleSessionEnd: (...args: unknown[]) => handleSessionEndMock(...args),
}))

import { POST } from '@/app/api/attendee/webhook/route'

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/attendee/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function partnerEvent(userId: string, trigger: string, data: Record<string, unknown>) {
  return {
    idempotency_key: 'idem-1',
    bot_id: 'bot-abc',
    bot_metadata: { user_id: userId },
    trigger,
    data,
  }
}

describe('POST /api/attendee/webhook — B2B-10 partner session support', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ATTENDEE_WEBHOOK_SECRET
    state.walkthroughRow = null
    state.partnerSessionRow = null
    state.themeConfigRow = null
    state.fromCalls = []
    state.walkthroughUpdateCalls = []
    state.partnerSessionUpdateCalls = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('B2C regression: an event that matches walkthrough_state runs the existing switch unchanged, and partner_sessions is never queried', async () => {
    state.walkthroughRow = {
      user_id: 'clerk-user-1',
      session_id: 'session-1',
      topic_id: 'topic-1',
      topic_title: 'Understanding LLMs',
    }

    const response = await POST(
      makeRequest(
        partnerEvent('clerk-user-1', 'participant_events.join_leave', {
          participant_name: 'Jane Doe',
          event_type: 'participant_joined',
        })
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    // Existing B2C greeting write still happens, unchanged.
    expect(state.walkthroughUpdateCalls).toHaveLength(1)
    expect(state.walkthroughUpdateCalls[0].pending_transcript).toContain('Hi Jane, welcome!')
    expect(state.walkthroughUpdateCalls[0].pending_transcript).toContain('Understanding LLMs')

    // The new partner_sessions lookup must never be attempted on a B2C hit.
    expect(state.fromCalls).not.toContain('partner_sessions')
    expect(handleSessionEndMock).not.toHaveBeenCalled()
  })

  it('correlates a partner-dispatched bot event to its partner_sessions row via bot_metadata.user_id', async () => {
    state.walkthroughRow = null
    state.partnerSessionRow = {
      id: 'partner-session-1',
      partner_account_id: 'acct-1',
      status: 'bot_active',
      test_mode: false,
      updated_at: new Date().toISOString(),
    }

    const response = await POST(
      makeRequest(partnerEvent('partner-session-1', 'bot.state_change', { new_state: 'joined_recording' }))
    )

    expect(response.status).toBe(200)
    expect(state.fromCalls).toContain('partner_sessions')
  })

  it('bot.state_change/joined_recording is confirmatory-only for a partner session — no DB write, no billing call', async () => {
    state.partnerSessionRow = {
      id: 'partner-session-1',
      partner_account_id: 'acct-1',
      status: 'bot_active',
      test_mode: false,
      updated_at: new Date().toISOString(),
    }

    await POST(makeRequest(partnerEvent('partner-session-1', 'bot.state_change', { new_state: 'joined_recording' })))

    expect(handleSessionEndMock).not.toHaveBeenCalled()
  })

  it('ended is a no-op when the partner session is already completed (client-side path already won)', async () => {
    state.partnerSessionRow = {
      id: 'partner-session-1',
      partner_account_id: 'acct-1',
      status: 'completed',
      test_mode: false,
      updated_at: new Date().toISOString(),
    }

    const response = await POST(
      makeRequest(partnerEvent('partner-session-1', 'bot.state_change', { new_state: 'ended' }))
    )

    expect(response.status).toBe(200)
    expect(handleSessionEndMock).not.toHaveBeenCalled()
  })

  it('ended triggers the fallback completer when the partner session is still bot_active', async () => {
    const fixedNow = new Date('2026-07-15T12:05:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)

    state.partnerSessionRow = {
      id: 'partner-session-1',
      partner_account_id: 'acct-1',
      status: 'bot_active',
      test_mode: true,
      updated_at: '2026-07-15T12:00:00.000Z',
    }

    await POST(makeRequest(partnerEvent('partner-session-1', 'bot.state_change', { new_state: 'ended' })))

    expect(handleSessionEndMock).toHaveBeenCalledTimes(1)
    // B2B-19 (billing gap 2): the event carries no Attendee timestamp and the
    // row has no attendee_joined_at, so billing falls back to webhook-receipt
    // time, labelled 'attendee_receipt' (distinct from a real Attendee value).
    expect(handleSessionEndMock).toHaveBeenCalledWith('partner-session-1', 'acct-1', 5, true, 'completed', 'attendee_receipt')
  })

  it('fatal_error triggers the fallback completer with targetStatus=failed, still billing minutes used', async () => {
    const fixedNow = new Date('2026-07-15T12:05:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)

    state.partnerSessionRow = {
      id: 'partner-session-1',
      partner_account_id: 'acct-1',
      status: 'bot_active',
      test_mode: false,
      updated_at: '2026-07-15T12:00:00.000Z',
    }

    await POST(makeRequest(partnerEvent('partner-session-1', 'bot.state_change', { new_state: 'fatal_error' })))

    expect(handleSessionEndMock).toHaveBeenCalledTimes(1)
    expect(handleSessionEndMock).toHaveBeenCalledWith('partner-session-1', 'acct-1', 5, false, 'failed', 'attendee_receipt')
  })

  // B2B-19 (billing gap 2, AT-11) — when Attendee carries both a join timestamp
  // (on the row) and an end timestamp (on the event), billing uses the real
  // (ended − joined) duration and labels it 'attendee'.
  it('bills the real Attendee (ended − joined) duration, labelled attendee, when both timestamps are present', async () => {
    state.partnerSessionRow = {
      id: 'partner-session-1',
      partner_account_id: 'acct-1',
      status: 'bot_active',
      test_mode: false,
      updated_at: '2026-07-15T12:00:00.000Z',
      attendee_joined_at: '2026-07-15T12:00:00.000Z',
    }

    await POST(
      makeRequest(
        partnerEvent('partner-session-1', 'bot.state_change', {
          new_state: 'ended',
          created_at: '2026-07-15T12:10:00.000Z', // Attendee-provided end timestamp
        })
      )
    )

    expect(handleSessionEndMock).toHaveBeenCalledTimes(1)
    expect(handleSessionEndMock).toHaveBeenCalledWith('partner-session-1', 'acct-1', 10, false, 'completed', 'attendee')
  })

  it('transcript.update is a no-op for a partner session — no DB write, no handleSessionEnd call', async () => {
    state.partnerSessionRow = {
      id: 'partner-session-1',
      partner_account_id: 'acct-1',
      status: 'bot_active',
      test_mode: false,
      updated_at: new Date().toISOString(),
    }

    const response = await POST(
      makeRequest(
        partnerEvent('partner-session-1', 'transcript.update', {
          speaker_name: 'Participant',
          transcription: { transcript: 'This is what the participant said.' },
        })
      )
    )

    expect(response.status).toBe(200)
    expect(handleSessionEndMock).not.toHaveBeenCalled()
    expect(state.walkthroughUpdateCalls).toHaveLength(0)
  })

  // B2B-11 (Requirement Doc Section 6.2/7) — participant_events.join_leave now
  // sets the join-greeting flag instead of only logging (previously a no-op,
  // per B2B-10's own documented deferral — this closes that gap).
  it('participant_events.join_leave sets join_greeting_pending + participant first name for a partner session', async () => {
    state.partnerSessionRow = {
      id: 'partner-session-1',
      partner_account_id: 'acct-1',
      status: 'bot_active',
      test_mode: false,
      updated_at: new Date().toISOString(),
    }
    state.themeConfigRow = null // unconfigured theme -> 'clio' fallback for the bot-name-skip check

    const response = await POST(
      makeRequest(
        partnerEvent('partner-session-1', 'participant_events.join_leave', {
          participant_name: 'Jane End User',
          event_type: 'participant_joined',
        })
      )
    )

    expect(response.status).toBe(200)
    expect(handleSessionEndMock).not.toHaveBeenCalled()
    expect(state.walkthroughUpdateCalls).toHaveLength(0) // no walkthrough_state write for a partner session
    expect(state.partnerSessionUpdateCalls).toHaveLength(1)
    expect(state.partnerSessionUpdateCalls[0]).toEqual({
      join_greeting_pending: true,
      join_greeting_participant_first_name: 'Jane',
    })
  })

  it('participant_events.join_leave skips the bot itself, using the partner-configured assistant display name', async () => {
    state.partnerSessionRow = {
      id: 'partner-session-1',
      partner_account_id: 'acct-1',
      status: 'bot_active',
      test_mode: false,
      updated_at: new Date().toISOString(),
    }
    state.themeConfigRow = { assistant_display_name: 'Aria' }

    const response = await POST(
      makeRequest(
        partnerEvent('partner-session-1', 'participant_events.join_leave', {
          participant_name: 'Aria',
          event_type: 'participant_joined',
        })
      )
    )

    expect(response.status).toBe(200)
    expect(state.partnerSessionUpdateCalls).toHaveLength(0)
  })

  it('participant_events.join_leave is a no-op when event_type is not participant_joined or participant_name is blank', async () => {
    state.partnerSessionRow = {
      id: 'partner-session-1',
      partner_account_id: 'acct-1',
      status: 'bot_active',
      test_mode: false,
      updated_at: new Date().toISOString(),
    }

    const leftResponse = await POST(
      makeRequest(
        partnerEvent('partner-session-1', 'participant_events.join_leave', {
          participant_name: 'Jane End User',
          event_type: 'participant_left',
        })
      )
    )
    expect(leftResponse.status).toBe(200)
    expect(state.partnerSessionUpdateCalls).toHaveLength(0)

    const blankNameResponse = await POST(
      makeRequest(
        partnerEvent('partner-session-1', 'participant_events.join_leave', {
          participant_name: '',
          event_type: 'participant_joined',
        })
      )
    )
    expect(blankNameResponse.status).toBe(200)
    expect(state.partnerSessionUpdateCalls).toHaveLength(0)
  })

  it('returns 200 { ok: true } and takes no action when bot_metadata.user_id matches neither table', async () => {
    state.walkthroughRow = null
    state.partnerSessionRow = null

    const response = await POST(
      makeRequest(partnerEvent('no-such-id', 'bot.state_change', { new_state: 'ended' }))
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(handleSessionEndMock).not.toHaveBeenCalled()
  })
})
