import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchAllTranscriptEvents, HumeSessionDetailsLookupError } from '@/lib/voice/hume-native/session-details'

/**
 * B2B-44 Fix 1 — fetchAllTranscriptEvents() previously called
 * `GET https://api.hume.ai/v0/evi/chats/{chatId}/events?...`, which 404s unconditionally (confirmed
 * live: 100% failure rate across every partner_session_insights row that ever attempted
 * extraction — see the B2B-44 Feature Brief). The fix drops the `/events` suffix and paginates via
 * the chat-metadata endpoint itself (`GET /v0/evi/chats/{chatId}?page_number={n}&page_size=100`),
 * continuing to read `events_page`/`total_pages` from the response exactly as before.
 */

describe('fetchAllTranscriptEvents', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('calls the chat-metadata URL directly, with no /events suffix', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ events_page: [{ type: 'SYSTEM_PROMPT' }], page_number: 0, total_pages: 1 }),
    })

    await fetchAllTranscriptEvents('api-key-123', 'chat-abc')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [calledUrl] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(calledUrl)).toBe('https://api.hume.ai/v0/evi/chats/chat-abc?page_size=100&page_number=0')
    expect(String(calledUrl)).not.toContain('/events')
  })

  it('paginates across multiple pages using page_number/total_pages from the metadata response', async () => {
    ;(fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events_page: [{ id: 'e1' }, { id: 'e2' }], page_number: 0, total_pages: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events_page: [{ id: 'e3' }], page_number: 1, total_pages: 2 }),
      })

    const events = await fetchAllTranscriptEvents('api-key-123', 'chat-abc')

    expect(fetch).toHaveBeenCalledTimes(2)
    const [firstUrl] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const [secondUrl] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    expect(String(firstUrl)).toBe('https://api.hume.ai/v0/evi/chats/chat-abc?page_size=100&page_number=0')
    expect(String(secondUrl)).toBe('https://api.hume.ai/v0/evi/chats/chat-abc?page_size=100&page_number=1')
    expect(events).toEqual([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }])
  })

  it('stops once page_number reaches total_pages, never fetching an extra page', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ events_page: [{ id: 'only' }], page_number: 0, total_pages: 1 }),
    })

    const events = await fetchAllTranscriptEvents('api-key-123', 'chat-abc')

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(events).toEqual([{ id: 'only' }])
  })

  it('throws HumeSessionDetailsLookupError with the non-2xx status on failure (e.g. a real 404)', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"message":"No static resource chats/chat-abc.","path":"/chats/chat-abc"}',
    })

    await expect(fetchAllTranscriptEvents('api-key-123', 'chat-abc')).rejects.toThrow(HumeSessionDetailsLookupError)
  })
})
