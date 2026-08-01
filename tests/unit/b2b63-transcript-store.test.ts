import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-63 (docs/specs/B2B-63-requirement-document.md §13) — unit tests for
 * lib/voice/openai-realtime-transcript-store.ts. Credentials are left as placeholders (no
 * UPSTASH_REDIS_REST_URL/TOKEN set) for the placeholder-branch tests; a separate suite below sets
 * real-looking credentials and mocks the @upstash/redis client directly to exercise the
 * real-credentials code paths, including the one intentional non-swallowed throw
 * (getStoredTranscriptTurns' read failure).
 */

describe('openai-realtime-transcript-store — placeholder-credentials branch (no real Upstash configured)', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it('appendTranscriptTurn logs and no-ops without throwing', async () => {
    const { appendTranscriptTurn } = await import('@/lib/voice/openai-realtime-transcript-store')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(appendTranscriptTurn('sess-1', 'user', 'hello')).resolves.toBeUndefined()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[MOCK'))
    logSpy.mockRestore()
  })

  it('getStoredTranscriptTurns returns [] rather than throwing', async () => {
    const { getStoredTranscriptTurns } = await import('@/lib/voice/openai-realtime-transcript-store')
    await expect(getStoredTranscriptTurns('sess-1')).resolves.toEqual([])
  })

  it('deleteStoredTranscript resolves without throwing', async () => {
    const { deleteStoredTranscript } = await import('@/lib/voice/openai-realtime-transcript-store')
    await expect(deleteStoredTranscript('sess-1')).resolves.toBeUndefined()
  })
})

describe('openai-realtime-transcript-store — real-credentials branch (mocked @upstash/redis client)', () => {
  const rpushMock = vi.fn()
  const expireMock = vi.fn()
  const execMock = vi.fn()
  const lrangeMock = vi.fn()
  const delMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    process.env.UPSTASH_REDIS_REST_URL = 'https://real-looking-url.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'real-looking-token'
    rpushMock.mockReset()
    expireMock.mockReset()
    execMock.mockReset()
    lrangeMock.mockReset()
    delMock.mockReset()

    vi.doMock('@upstash/redis', () => ({
      Redis: {
        fromEnv: () => ({
          pipeline: () => ({
            rpush: (...args: unknown[]) => {
              rpushMock(...args)
              return { expire: (...eArgs: unknown[]) => { expireMock(...eArgs); return { exec: execMock } } }
            },
          }),
          lrange: (...args: unknown[]) => lrangeMock(...args),
          del: (...args: unknown[]) => delMock(...args),
        }),
      },
    }))
  })

  it('appendTranscriptTurn calls rpush + expire + exec with the right key and turn shape', async () => {
    execMock.mockResolvedValue(undefined)
    const { appendTranscriptTurn } = await import('@/lib/voice/openai-realtime-transcript-store')

    await appendTranscriptTurn('sess-abc', 'ai', 'Let’s talk about pricing.')

    expect(rpushMock).toHaveBeenCalledWith(
      'voice-transcript:sess-abc',
      expect.objectContaining({ source: 'ai', text: 'Let’s talk about pricing.' })
    )
    expect(expireMock).toHaveBeenCalledWith('voice-transcript:sess-abc', 60 * 60 * 24)
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  it('appendTranscriptTurn catches and swallows a thrown Redis-client error (never rejects)', async () => {
    execMock.mockRejectedValue(new Error('upstash unavailable'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { appendTranscriptTurn } = await import('@/lib/voice/openai-realtime-transcript-store')

    await expect(appendTranscriptTurn('sess-abc', 'user', 'hi')).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('getStoredTranscriptTurns reads back via lrange(key, 0, -1) and returns the turns in order', async () => {
    const turns = [
      { source: 'user', text: 'first', at: 1 },
      { source: 'ai', text: 'second', at: 2 },
    ]
    lrangeMock.mockResolvedValue(turns)
    const { getStoredTranscriptTurns } = await import('@/lib/voice/openai-realtime-transcript-store')

    const result = await getStoredTranscriptTurns('sess-abc')

    expect(lrangeMock).toHaveBeenCalledWith('voice-transcript:sess-abc', 0, -1)
    expect(result).toEqual(turns)
  })

  it('getStoredTranscriptTurns returns [] when lrange resolves null/undefined (missing key)', async () => {
    lrangeMock.mockResolvedValue(null)
    const { getStoredTranscriptTurns } = await import('@/lib/voice/openai-realtime-transcript-store')
    await expect(getStoredTranscriptTurns('sess-missing')).resolves.toEqual([])
  })

  it('getStoredTranscriptTurns does NOT swallow a genuine client-level exception — it propagates (Requirement Doc §8)', async () => {
    lrangeMock.mockRejectedValue(new Error('real upstash outage'))
    const { getStoredTranscriptTurns } = await import('@/lib/voice/openai-realtime-transcript-store')
    await expect(getStoredTranscriptTurns('sess-abc')).rejects.toThrow('real upstash outage')
  })

  it('deleteStoredTranscript calls del(key) and swallows a thrown error', async () => {
    delMock.mockResolvedValueOnce(1)
    const { deleteStoredTranscript } = await import('@/lib/voice/openai-realtime-transcript-store')
    await deleteStoredTranscript('sess-abc')
    expect(delMock).toHaveBeenCalledWith('voice-transcript:sess-abc')

    delMock.mockRejectedValueOnce(new Error('delete failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(deleteStoredTranscript('sess-abc')).resolves.toBeUndefined()
    errorSpy.mockRestore()
  })
})

describe('formatOpenAITranscriptLines — mirrors formatTranscriptLines()\'s exact labeling', () => {
  it('empty array input produces []', async () => {
    const { formatOpenAITranscriptLines } = await import('@/lib/voice/openai-realtime-transcript-store')
    expect(formatOpenAITranscriptLines([])).toEqual([])
  })

  it('labels source: "user" as "User:" and source: "ai" as "Clio:"', async () => {
    const { formatOpenAITranscriptLines } = await import('@/lib/voice/openai-realtime-transcript-store')
    const lines = formatOpenAITranscriptLines([
      { source: 'user', text: 'What is my score?', at: 1 },
      { source: 'ai', text: 'Great question.', at: 2 },
    ])
    expect(lines).toEqual(['User: What is my score?', 'Clio: Great question.'])
  })

  it('skips blank/whitespace-only text entries', async () => {
    const { formatOpenAITranscriptLines } = await import('@/lib/voice/openai-realtime-transcript-store')
    const lines = formatOpenAITranscriptLines([
      { source: 'user', text: '   ', at: 1 },
      { source: 'ai', text: 'Real content.', at: 2 },
      { source: 'user', text: '', at: 3 },
    ])
    expect(lines).toEqual(['Clio: Real content.'])
  })

  it('preserves input order', async () => {
    const { formatOpenAITranscriptLines } = await import('@/lib/voice/openai-realtime-transcript-store')
    const lines = formatOpenAITranscriptLines([
      { source: 'user', text: 'one', at: 1 },
      { source: 'ai', text: 'two', at: 2 },
      { source: 'user', text: 'three', at: 3 },
    ])
    expect(lines).toEqual(['User: one', 'Clio: two', 'User: three'])
  })
})
