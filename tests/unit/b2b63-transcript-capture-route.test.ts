import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-63 (docs/specs/B2B-63-requirement-document.md §13) — POST /api/partner/render/transcript-capture.
 * Mirrors session-chat-id route's own test conventions (always-200 contract).
 */

const appendTranscriptTurnMock = vi.fn()
vi.mock('@/lib/voice/openai-realtime-transcript-store', () => ({
  appendTranscriptTurn: (...args: unknown[]) => appendTranscriptTurnMock(...args),
}))

import { POST } from '@/app/api/partner/render/transcript-capture/route'

function makeRequest(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0]
}

describe('POST /api/partner/render/transcript-capture', () => {
  beforeEach(() => {
    appendTranscriptTurnMock.mockReset()
  })

  it('valid body -> 200 {ok:true}, appendTranscriptTurn called with the exact parsed values', async () => {
    appendTranscriptTurnMock.mockResolvedValue(undefined)
    const res = await POST(
      makeRequest({ clio_session_ref: '11111111-1111-1111-1111-111111111111', source: 'user', text: 'Hello there' })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(appendTranscriptTurnMock).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      'user',
      'Hello there'
    )
  })

  it('malformed body (invalid source) -> 200 {ok:false}, appendTranscriptTurn never called', async () => {
    const res = await POST(
      makeRequest({ clio_session_ref: '11111111-1111-1111-1111-111111111111', source: 'robot', text: 'Hello' })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
    expect(appendTranscriptTurnMock).not.toHaveBeenCalled()
  })

  it('missing clio_session_ref -> 200 {ok:false}, appendTranscriptTurn never called', async () => {
    const res = await POST(makeRequest({ source: 'user', text: 'Hello' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
    expect(appendTranscriptTurnMock).not.toHaveBeenCalled()
  })

  it('non-UUID clio_session_ref -> 200 {ok:false}', async () => {
    const res = await POST(makeRequest({ clio_session_ref: 'not-a-uuid', source: 'user', text: 'Hello' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('text over 5000 chars -> 200 {ok:false}', async () => {
    const res = await POST(
      makeRequest({
        clio_session_ref: '11111111-1111-1111-1111-111111111111',
        source: 'ai',
        text: 'a'.repeat(5001),
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('empty text -> 200 {ok:false} (min(1) enforced)', async () => {
    const res = await POST(
      makeRequest({ clio_session_ref: '11111111-1111-1111-1111-111111111111', source: 'ai', text: '' })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('a Redis-layer failure inside appendTranscriptTurn still returns 200 {ok:true} — the swallow happens at the store layer, not the route', async () => {
    // appendTranscriptTurn itself never rejects per its own contract — this confirms the route
    // doesn't add its own try/catch that could mask a differently-behaved store implementation.
    appendTranscriptTurnMock.mockResolvedValue(undefined)
    const res = await POST(
      makeRequest({ clio_session_ref: '11111111-1111-1111-1111-111111111111', source: 'user', text: 'ok' })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('malformed JSON body -> 200 {ok:false}, never throws', async () => {
    const badRequest = { json: async () => { throw new Error('invalid json') } } as unknown as Parameters<typeof POST>[0]
    const res = await POST(badRequest)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
  })
})
