import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 10a, §6.8, AT-13, AT-14). Covers
 * `POST /api/test-harness/dispatch/[topicId]` — a thin server-to-server proxy that must relay the
 * real `POST /api/partner/v1/sessions` response verbatim, both for success and for a real error
 * (AT-13). AT-14 (a failed dispatch never touches authored topic/screen data) holds structurally
 * here: this route contains no write call to `test_harness_topics`/`test_harness_screens` at all —
 * it only reads (via the mocked `assembleTestHarnessPayload`) and proxies outward.
 */

vi.mock('@/lib/test-harness/payload', () => ({
  assembleTestHarnessPayload: vi.fn(),
  TestHarnessTopicNotFoundError: class TestHarnessTopicNotFoundError extends Error {},
}))

import { assembleTestHarnessPayload } from '@/lib/test-harness/payload'
import { POST } from '@/app/api/test-harness/dispatch/[topicId]/route'

function dispatchRequest(body: unknown) {
  return new NextRequest('https://test.hello-clio.com/api/test-harness/dispatch/topic-1', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/test-harness/dispatch/[topicId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://hello-clio.com'
    process.env.TEST_HARNESS_PARTNER_API_KEY = 'clio_test_sk_fixture'
    ;(assembleTestHarnessPayload as ReturnType<typeof vi.fn>).mockResolvedValue({
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      content_pages: [],
      content_source_id: 'src-1',
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  it('400s before any upstream call when meeting_url is missing/malformed', async () => {
    const res = await POST(dispatchRequest({ meeting_url: 'not-a-url' }), { params: { topicId: 'topic-1' } })
    expect(res.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('AT-13: relays a real 201 success response verbatim', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: '9e2a4f11-8b3c-4d21-9a77-1c8f2e5b6a90', status: 'bot_active', render_url: 'https://hello-clio.com/partner-render/9e2a4f11' }),
    })

    const res = await POST(dispatchRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij' }), { params: { topicId: 'topic-1' } })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body).toEqual({ clio_session_ref: '9e2a4f11-8b3c-4d21-9a77-1c8f2e5b6a90', status: 'bot_active', render_url: 'https://hello-clio.com/partner-render/9e2a4f11' })

    // The real key is used server-side to call the real endpoint, and is never present in the response relayed to the browser.
    const [calledUrl, calledInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(calledUrl)).toBe('https://hello-clio.com/api/partner/v1/sessions')
    expect((calledInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer clio_test_sk_fixture' })
  })

  it('AT-13: relays a real error response (e.g. balance_exhausted) verbatim, status and body', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 402,
      json: async () => ({ error: { code: 'balance_exhausted', message: "Your Clio balance cannot cover this session's expected duration." } }),
    })

    const res = await POST(dispatchRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij' }), { params: { topicId: 'topic-1' } })
    const body = await res.json()

    expect(res.status).toBe(402)
    expect(body.error.code).toBe('balance_exhausted')
  })

  it('502s with a distinct message when the upstream call itself fails (network error, not a real endpoint error)', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))

    const res = await POST(dispatchRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij' }), { params: { topicId: 'topic-1' } })
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error.code).toBe('upstream_unreachable')
  })
})
