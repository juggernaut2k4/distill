import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-33 (docs/specs/B2B-33-requirement-document.md §6.3 + §0a CEO amendment, AT-5 through AT-9,
 * AT-11). Covers POST /api/demo/[slug]/dispatch, including the §0a amendment requiring the same
 * DEMO_MEETING_PASSCODE the Save action uses. Per the spec's Out-of-Scope build-time warning, the
 * outbound call to the real POST /api/partner/v1/sessions endpoint is ALWAYS mocked here — this test
 * suite must never reach the real meeting-bot provider.
 */

const state = {
  row: null as { meeting_url: string; last_dispatch_attempted_at: string | null } | null,
  updated: [] as unknown[],
}

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: state.row })),
        })),
      })),
      update: vi.fn((row: unknown) => {
        state.updated.push(row)
        return { eq: vi.fn(() => Promise.resolve({ data: null, error: null })) }
      }),
    })),
  })),
}))

import { POST } from '@/app/api/demo/[slug]/dispatch/route'

const CORRECT_PASSCODE = 'correct-passcode'

/** `omitPasscode: true` sends `{}` — used to test the missing-passcode case without relying on a
 *  JS default-parameter substitution on an explicit `undefined`, which silently no-ops. */
function dispatchRequest(slug: string, passcode: string = CORRECT_PASSCODE, omitPasscode = false) {
  return new NextRequest(`https://test.hello-clio.com/api/demo/${slug}/dispatch`, {
    method: 'POST',
    body: JSON.stringify(omitPasscode ? {} : { passcode }),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/demo/[slug]/dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.row = null
    state.updated = []
    process.env.NEXT_PUBLIC_APP_URL = 'https://hello-clio.com'
    process.env.DEMO_PARTNER_API_KEY = 'clio_test_sk_demo_fixture'
    process.env.DEMO_CONTENT_SOURCE_ID = 'src-demo-fixture'
    process.env.DEMO_MEETING_PASSCODE = CORRECT_PASSCODE
    vi.stubGlobal('fetch', vi.fn())
  })

  it('§0a: 401s with incorrect_passcode on a wrong passcode, never calling the upstream endpoint', async () => {
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', last_dispatch_attempted_at: null }
    const res = await POST(dispatchRequest('claude-ai', 'wrong'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.error.code).toBe('incorrect_passcode')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('§0a: 401s when no passcode is sent at all', async () => {
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', last_dispatch_attempted_at: null }
    const res = await POST(dispatchRequest('claude-ai', '', true), { params: { slug: 'claude-ai' } })
    expect(res.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('§0a: fails closed (401) when DEMO_MEETING_PASSCODE is unconfigured, even with a matching empty guess', async () => {
    delete process.env.DEMO_MEETING_PASSCODE
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', last_dispatch_attempted_at: null }
    const res = await POST(dispatchRequest('claude-ai', 'anything'), { params: { slug: 'claude-ai' } })
    expect(res.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('404s an unknown slug before any lookup', async () => {
    const res = await POST(dispatchRequest('not-a-real-topic'), { params: { slug: 'not-a-real-topic' } })
    expect(res.status).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('AT: 422s with no_meeting_url when nothing is saved yet, never calling the upstream endpoint', async () => {
    state.row = null
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.error.code).toBe('no_meeting_url')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('AT-7: 429s with rate_limited when the last attempt was under 3 minutes ago', async () => {
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', last_dispatch_attempted_at: new Date(Date.now() - 60_000).toISOString() }
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(429)
    expect(body.error.code).toBe('rate_limited')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('proceeds when the last attempt was more than 3 minutes ago', async () => {
    state.row = {
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      last_dispatch_attempted_at: new Date(Date.now() - 4 * 60_000).toISOString(),
    }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: '9e2a4f11-8b3c-4d21-9a77-1c8f2e5b6a90', status: 'bot_active' }),
    })
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('AT-6: on a real 201 bot_active response, returns { status: "dispatched", clio_session_ref } and never leaks the raw upstream body', async () => {
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: '9e2a4f11-8b3c-4d21-9a77-1c8f2e5b6a90', status: 'bot_active', render_url: 'https://hello-clio.com/partner-render/9e2a4f11' }),
    })
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'dispatched', clio_session_ref: '9e2a4f11-8b3c-4d21-9a77-1c8f2e5b6a90' })
    expect(JSON.stringify(body)).not.toContain('render_url')
  })

  it('AT-8: on a real card_required (402) response, returns a generic 502 message — never the raw code/message', async () => {
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 402,
      json: async () => ({ error: { code: 'card_required', message: 'Add a payment method to start testing.' } }),
    })
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.error.code).toBe('dispatch_failed')
    expect(body.error.message).toBe('Something went wrong starting the bot. Try again in a moment.')
    expect(JSON.stringify(body)).not.toMatch(/card_required|card|trial|balance|Attendee|Recall/i)
  })

  it('502s with the same generic message on a network error calling the upstream endpoint', async () => {
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.error.code).toBe('dispatch_failed')
  })

  it('AT-9: content_pages[] has exactly one entry per chapter, url pointing at the live visual page, deterministic transition_trigger', async () => {
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: 'ref-1', status: 'bot_active' }),
    })
    await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })

    const [calledUrl, calledInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(calledUrl)).toBe('https://hello-clio.com/api/partner/v1/sessions')
    const sentBody = JSON.parse((calledInit as RequestInit).body as string)
    expect(sentBody.content_pages).toHaveLength(5) // claude-ai has 5 chapters
    expect(sentBody.content_pages[0].url).toBe('https://hello-clio.com/demo/claude-ai/visuals/what-is-claude')
    expect(sentBody.content_pages[0].transition_trigger).toBe('Move on once "What Is Claude?" has been fully explained.')
    expect((calledInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer clio_test_sk_demo_fixture' })
  })

  it('assembles 7 content_pages for oop-fundamentals', async () => {
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: 'ref-1', status: 'bot_active' }),
    })
    await POST(dispatchRequest('oop-fundamentals'), { params: { slug: 'oop-fundamentals' } })

    const [, calledInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const sentBody = JSON.parse((calledInit as RequestInit).body as string)
    expect(sentBody.content_pages).toHaveLength(7)
  })
})
