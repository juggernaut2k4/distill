import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * B2B-76 §1.4 (item 4) — unit tests for lib/voice/elevenlabs-native-transcript.ts.
 *
 * Covers: credential resolution (mirrors app/api/elevenlabs-token/route.ts's own singleton-row +
 * decryptOutboundToken() pattern), the bounded retry/backoff loop, turn normalization (role/message/
 * time_in_call_secs -> StoredTranscriptTurn's source/text/at), and the hard guarantee that this
 * function NEVER throws — every failure mode resolves to null so the caller
 * (inngest/partner-session-insights-extractor.ts) can fall back to Redis.
 */

const supabaseFromMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: () => ({ from: (...args: unknown[]) => supabaseFromMock(...args) }),
}))

const decryptOutboundTokenMock = vi.fn()
vi.mock('@/lib/partner/crypto', () => ({
  decryptOutboundToken: (...args: unknown[]) => decryptOutboundTokenMock(...args),
}))

function mockConfigRow(ciphertext: string | null) {
  supabaseFromMock.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { elevenlabs_api_key_ciphertext: ciphertext }, error: null }),
      }),
    }),
  })
}

const fetchMock = vi.fn()

describe('fetchElevenLabsNativeTranscript', () => {
  beforeEach(() => {
    vi.resetModules()
    supabaseFromMock.mockReset()
    decryptOutboundTokenMock.mockReset()
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null (never throws) when ElevenLabs credentials are not configured', async () => {
    mockConfigRow(null)
    const { fetchElevenLabsNativeTranscript } = await import('@/lib/voice/elevenlabs-native-transcript')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(fetchElevenLabsNativeTranscript('conv_1')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('returns null when the stored credential fails to decrypt', async () => {
    mockConfigRow('some-ciphertext')
    decryptOutboundTokenMock.mockReturnValue(null)
    const { fetchElevenLabsNativeTranscript } = await import('@/lib/voice/elevenlabs-native-transcript')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(fetchElevenLabsNativeTranscript('conv_1')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('succeeds on the first attempt: calls the confirmed endpoint/header shape and normalizes turns', async () => {
    mockConfigRow('ciphertext')
    decryptOutboundTokenMock.mockReturnValue('real-api-key')
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'done',
        transcript: [
          { role: 'user', time_in_call_secs: 1, message: 'What does pricing look like?' },
          { role: 'agent', time_in_call_secs: 3, message: 'Happy to walk through tiers.' },
        ],
      }),
    })
    const { fetchElevenLabsNativeTranscript } = await import('@/lib/voice/elevenlabs-native-transcript')

    const result = await fetchElevenLabsNativeTranscript('conv_abc123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/convai/conversations/conv_abc123',
      expect.objectContaining({ method: 'GET', headers: { 'xi-api-key': 'real-api-key' }, cache: 'no-store' })
    )
    expect(result).toEqual([
      { source: 'user', text: 'What does pricing look like?', at: 1000 },
      { source: 'ai', text: 'Happy to walk through tiers.', at: 3000 },
    ])
  })

  it('URL-encodes the conversation id', async () => {
    mockConfigRow('ciphertext')
    decryptOutboundTokenMock.mockReturnValue('real-api-key')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ transcript: [{ role: 'user', message: 'hi', time_in_call_secs: 0 }] }) })
    const { fetchElevenLabsNativeTranscript } = await import('@/lib/voice/elevenlabs-native-transcript')

    await fetchElevenLabsNativeTranscript('conv/with weird?chars')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('conv/with weird?chars')),
      expect.anything()
    )
  })

  it('retries with backoff on a non-2xx response, then succeeds on attempt 2, never throws', async () => {
    vi.useFakeTimers()
    mockConfigRow('ciphertext')
    decryptOutboundTokenMock.mockReturnValue('real-api-key')
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found yet' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ transcript: [{ role: 'user', message: 'now ready', time_in_call_secs: 0 }] }) })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fetchElevenLabsNativeTranscript } = await import('@/lib/voice/elevenlabs-native-transcript')

    const promise = fetchElevenLabsNativeTranscript('conv_retry')
    await vi.advanceTimersByTimeAsync(10000)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual([{ source: 'user', text: 'now ready', at: 0 }])
    errorSpy.mockRestore()
  })

  it('exhausts all 3 attempts and returns null (never throws) when transcript never becomes available', async () => {
    vi.useFakeTimers()
    mockConfigRow('ciphertext')
    decryptOutboundTokenMock.mockReturnValue('real-api-key')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'processing', transcript: [] }) })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { fetchElevenLabsNativeTranscript } = await import('@/lib/voice/elevenlabs-native-transcript')

    const promise = fetchElevenLabsNativeTranscript('conv_never_ready')
    await vi.advanceTimersByTimeAsync(15000)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('exhausted'))
    errorSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('a network-level throw on one attempt is caught and retried, not propagated', async () => {
    vi.useFakeTimers()
    mockConfigRow('ciphertext')
    decryptOutboundTokenMock.mockReturnValue('real-api-key')
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ transcript: [{ role: 'agent', message: 'recovered', time_in_call_secs: 0 }] }) })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fetchElevenLabsNativeTranscript } = await import('@/lib/voice/elevenlabs-native-transcript')

    const promise = fetchElevenLabsNativeTranscript('conv_flaky')
    await vi.advanceTimersByTimeAsync(10000)
    const result = await promise

    expect(result).toEqual([{ source: 'ai', text: 'recovered', at: 0 }])
    errorSpy.mockRestore()
  })

  it('filters out turns with empty/whitespace-only message text', async () => {
    mockConfigRow('ciphertext')
    decryptOutboundTokenMock.mockReturnValue('real-api-key')
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        transcript: [
          { role: 'user', message: '   ', time_in_call_secs: 0 },
          { role: 'agent', message: 'real content', time_in_call_secs: 1 },
          { role: 'user', message: null, time_in_call_secs: 2 },
        ],
      }),
    })
    const { fetchElevenLabsNativeTranscript } = await import('@/lib/voice/elevenlabs-native-transcript')

    const result = await fetchElevenLabsNativeTranscript('conv_mixed')

    expect(result).toEqual([{ source: 'ai', text: 'real content', at: 1000 }])
  })
})
