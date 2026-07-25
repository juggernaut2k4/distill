import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-34 Piece 1 (docs/specs/B2B-34-requirement-document.md Part C §6.2, Section 7 Acceptance Tests).
 * Covers GET /api/demo/[slug]/performance — session_state resolution against the REAL
 * partner_sessions.status enum (verified live: 'requested' | 'bot_dispatch_failed' | 'bot_active' |
 * 'completed' | 'failed' — migration 071; the spec's own prose used 'active'/'failed' as stand-ins for
 * "still running"/"never succeeded," mapped here onto the actual enum), and duration_minutes
 * resolution via fetchHumeChatDuration() — including that route calling it with the session's own
 * hume_chat_id and never crashing on any of its documented failure modes.
 */

process.env.DEMO_PARTNER_ACCOUNT_ID = 'demo-partner-account-id'

interface FakePartnerSession {
  id: string
  status: string
  hume_chat_id: string | null
  created_at: string
}

interface FakeInsightsRow {
  extraction_status: string
  action_items: { text: string }[] | null
  learner_insight: {
    summary: string
    topics_of_interest: string[]
    engagement_style: string
    suggested_next_topics: string[]
  } | null
}

let sessionRow: FakePartnerSession | null = null
let insightsRow: FakeInsightsRow | null = null

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'partner_sessions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: sessionRow, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }
      }

      if (table === 'partner_session_insights') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: insightsRow, error: null }),
            }),
          }),
        }
      }

      throw new Error(`Unexpected table in test mock: ${table}`)
    },
  }),
}))

const fetchHumeChatDurationMock = vi.fn()
vi.mock('@/lib/voice/hume-native/session-details', () => ({
  fetchHumeChatDuration: (...args: unknown[]) => fetchHumeChatDurationMock(...args),
}))

import { GET } from '@/app/api/demo/[slug]/performance/route'

function getRequest(slug = 'claude-ai') {
  return new NextRequest(`https://test.hello-clio.com/api/demo/${slug}/performance`)
}

describe('GET /api/demo/[slug]/performance', () => {
  beforeEach(() => {
    sessionRow = null
    insightsRow = null
    fetchHumeChatDurationMock.mockReset()
    process.env.DEMO_PARTNER_ACCOUNT_ID = 'demo-partner-account-id'
  })

  it('404s an unknown slug', async () => {
    const res = await GET(getRequest('not-a-real-topic'), { params: { slug: 'not-a-real-topic' } })
    expect(res.status).toBe(404)
  })

  it('always returns 200 for a known slug (no HTTP error state for this read-only route)', async () => {
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    expect(res.status).toBe(200)
  })

  it('resolves not_dispatched when DEMO_PARTNER_ACCOUNT_ID is unconfigured/placeholder, without querying Supabase or Hume', async () => {
    process.env.DEMO_PARTNER_ACCOUNT_ID = 'PLACEHOLDER_DEMO_PARTNER_ACCOUNT_ID'
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body).toEqual({ session_state: 'not_dispatched', duration_minutes: null, action_items: null, learner_insight: null })
    expect(fetchHumeChatDurationMock).not.toHaveBeenCalled()
  })

  it('resolves not_dispatched when no partner_sessions row exists for this slug', async () => {
    sessionRow = null
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body.session_state).toBe('not_dispatched')
    expect(body.action_items).toBeNull()
    expect(body.learner_insight).toBeNull()
  })

  it("resolves not_dispatched when status='failed' (pre-dispatch failure)", async () => {
    sessionRow = { id: 's1', status: 'failed', hume_chat_id: null, created_at: '2026-07-23T00:00:00.000Z' }
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body.session_state).toBe('not_dispatched')
  })

  it("resolves not_dispatched when status='bot_dispatch_failed' (the real enum's 'dispatch itself never succeeded' value)", async () => {
    sessionRow = { id: 's1', status: 'bot_dispatch_failed', hume_chat_id: null, created_at: '2026-07-23T00:00:00.000Z' }
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body.session_state).toBe('not_dispatched')
  })

  it("resolves in_progress when status='requested'", async () => {
    sessionRow = { id: 's1', status: 'requested', hume_chat_id: null, created_at: '2026-07-23T00:00:00.000Z' }
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body.session_state).toBe('in_progress')
    expect(body.duration_minutes).toBeNull()
  })

  it("resolves in_progress when status='bot_active' (the real enum's live/dispatched value)", async () => {
    sessionRow = { id: 's1', status: 'bot_active', hume_chat_id: 'chat-1', created_at: '2026-07-23T00:00:00.000Z' }
    fetchHumeChatDurationMock.mockResolvedValue({ ok: false, reason: 'missing_timestamps' })
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body.session_state).toBe('in_progress')
    expect(body.duration_minutes).toBeNull()
    expect(fetchHumeChatDurationMock).toHaveBeenCalledWith('chat-1')
  })

  it("resolves pending_extraction when status='completed' and no partner_session_insights row exists yet", async () => {
    sessionRow = { id: 's1', status: 'completed', hume_chat_id: 'chat-1', created_at: '2026-07-23T00:00:00.000Z' }
    insightsRow = null
    fetchHumeChatDurationMock.mockResolvedValue({ ok: true, durationSeconds: 300 })
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body.session_state).toBe('pending_extraction')
    expect(body.duration_minutes).toBe(5) // duration is independent of session_state
  })

  it("resolves pending_extraction when the insights row exists with extraction_status='pending'", async () => {
    sessionRow = { id: 's1', status: 'completed', hume_chat_id: 'chat-1', created_at: '2026-07-23T00:00:00.000Z' }
    insightsRow = { extraction_status: 'pending', action_items: null, learner_insight: null }
    fetchHumeChatDurationMock.mockResolvedValue({ ok: false, reason: 'timeout' })
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body.session_state).toBe('pending_extraction')
  })

  it("resolves extraction_failed when extraction_status='failed'", async () => {
    sessionRow = { id: 's1', status: 'completed', hume_chat_id: 'chat-1', created_at: '2026-07-23T00:00:00.000Z' }
    insightsRow = { extraction_status: 'failed', action_items: null, learner_insight: null }
    fetchHumeChatDurationMock.mockResolvedValue({ ok: true, durationSeconds: 510 })
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body.session_state).toBe('extraction_failed')
    expect(body.duration_minutes).toBe(8.5) // duration still resolves even when extraction failed
    expect(body.action_items).toBeNull()
    expect(body.learner_insight).toBeNull()
  })

  it("resolves ready with populated fields when extraction_status='success'", async () => {
    sessionRow = { id: 's1', status: 'completed', hume_chat_id: 'chat-1', created_at: '2026-07-23T00:00:00.000Z' }
    insightsRow = {
      extraction_status: 'success',
      action_items: [{ text: 'Review the AI vendor shortlist.' }],
      learner_insight: {
        summary: 'Weighing build-vs-buy.',
        topics_of_interest: ['pricing tiers'],
        engagement_style: 'Asks pointed, comparison-driven questions.',
        suggested_next_topics: ['ROI case study'],
      },
    }
    fetchHumeChatDurationMock.mockResolvedValue({ ok: true, durationSeconds: 510 })
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body).toEqual({
      session_state: 'ready',
      duration_minutes: 8.5,
      action_items: [{ text: 'Review the AI vendor shortlist.' }],
      learner_insight: {
        summary: 'Weighing build-vs-buy.',
        topics_of_interest: ['pricing tiers'],
        engagement_style: 'Asks pointed, comparison-driven questions.',
        suggested_next_topics: ['ROI case study'],
      },
    })
  })

  it("resolves ready with action_items:[] and learner_insight:null when extraction_status='success_empty' (§6.4 empty-transcript case), never an error", async () => {
    sessionRow = { id: 's1', status: 'completed', hume_chat_id: 'chat-1', created_at: '2026-07-23T00:00:00.000Z' }
    insightsRow = { extraction_status: 'success_empty', action_items: [], learner_insight: null }
    fetchHumeChatDurationMock.mockResolvedValue({ ok: true, durationSeconds: 45 })
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.session_state).toBe('ready')
    expect(body.action_items).toEqual([])
    expect(body.learner_insight).toBeNull()
  })

  it('never throws when fetchHumeChatDuration rejects with a network error — falls back to duration_minutes: null', async () => {
    sessionRow = { id: 's1', status: 'bot_active', hume_chat_id: 'chat-1', created_at: '2026-07-23T00:00:00.000Z' }
    fetchHumeChatDurationMock.mockResolvedValue({ ok: false, reason: 'network_error: fetch failed' })
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.duration_minutes).toBeNull()
  })

  it('never calls fetchHumeChatDuration when hume_chat_id is null', async () => {
    sessionRow = { id: 's1', status: 'requested', hume_chat_id: null, created_at: '2026-07-23T00:00:00.000Z' }
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body.duration_minutes).toBeNull()
    expect(fetchHumeChatDurationMock).not.toHaveBeenCalled()
  })

  it('rounds duration to one decimal place', async () => {
    sessionRow = { id: 's1', status: 'completed', hume_chat_id: 'chat-1', created_at: '2026-07-23T00:00:00.000Z' }
    insightsRow = { extraction_status: 'success_empty', action_items: [], learner_insight: null }
    fetchHumeChatDurationMock.mockResolvedValue({ ok: true, durationSeconds: 137 }) // 2.2833... minutes
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body.duration_minutes).toBe(2.3)
  })
})
