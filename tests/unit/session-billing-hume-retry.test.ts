import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * HUME-DURATION-02 — coverage for the delay/retry path added to
 * finalizeHumeNativeBilling() in lib/session-billing.ts. The existing
 * tests/unit/session-billing.test.ts covers computeBilledMinutes and
 * verifyAuditToken but does not exercise this function at all.
 *
 * Uses fake timers so the 3s/4s delays resolve instantly instead of making
 * the suite slow.
 */

let sessionRow: { hume_native_enabled: boolean; hume_chat_id: string | null } | null = null

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: sessionRow, error: null })),
        })),
      })),
    })),
  })),
}))

const fetchHumeChatDuration = vi.fn()
vi.mock('@/lib/voice/hume-native/session-details', () => ({
  fetchHumeChatDuration: (...args: unknown[]) => fetchHumeChatDuration(...args),
}))

import { finalizeHumeNativeBilling } from '@/lib/session-billing'

describe('finalizeHumeNativeBilling — HUME-DURATION-02 retry path', () => {
  beforeEach(() => {
    sessionRow = null
    fetchHumeChatDuration.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function run(params: Parameters<typeof finalizeHumeNativeBilling>[0]) {
    const promise = finalizeHumeNativeBilling(params)
    // Advance past both possible delays (3s + 4s) regardless of which path is taken.
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(4000)
    return promise
  }

  it('succeeds on the first attempt after the initial 3s wait, with no retry', async () => {
    fetchHumeChatDuration.mockResolvedValueOnce({ ok: true, durationSeconds: 125 })

    const result = await run({ sessionId: 's1', humeNativeEnabled: true, humeChatId: 'chat-1' })

    expect(fetchHumeChatDuration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      source: 'hume',
      minutesUsed: 3, // ceil(125/60)
      durationSeconds: 125,
      retryUsed: false,
      totalWaitMs: 3000,
    })
  })

  it('retries exactly once after a missing_timestamps failure, and succeeds on the retry', async () => {
    fetchHumeChatDuration
      .mockResolvedValueOnce({ ok: false, reason: 'missing_timestamps' })
      .mockResolvedValueOnce({ ok: true, durationSeconds: 90 })

    const result = await run({ sessionId: 's2', humeNativeEnabled: true, humeChatId: 'chat-2' })

    expect(fetchHumeChatDuration).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      source: 'hume',
      minutesUsed: 2,
      durationSeconds: 90,
      retryUsed: true,
      totalWaitMs: 7000,
    })
  })

  it('does NOT retry on a non-missing_timestamps failure (e.g. http_500) — falls back immediately', async () => {
    fetchHumeChatDuration.mockResolvedValueOnce({ ok: false, reason: 'http_500' })

    const result = await run({ sessionId: 's3', humeNativeEnabled: true, humeChatId: 'chat-3' })

    expect(fetchHumeChatDuration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      source: 'fallback',
      reason: 'http_500',
      retryUsed: false,
      totalWaitMs: 3000,
    })
  })

  it('falls back after the retry also fails, with retryUsed=true and totalWaitMs=7000', async () => {
    fetchHumeChatDuration
      .mockResolvedValueOnce({ ok: false, reason: 'missing_timestamps' })
      .mockResolvedValueOnce({ ok: false, reason: 'missing_timestamps' })

    const result = await run({ sessionId: 's4', humeNativeEnabled: true, humeChatId: 'chat-4' })

    expect(fetchHumeChatDuration).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      source: 'fallback',
      reason: 'missing_timestamps',
      retryUsed: true,
      totalWaitMs: 7000,
    })
  })

  it('returns not_applicable without ever calling fetchHumeChatDuration or waiting', async () => {
    const result = await finalizeHumeNativeBilling({
      sessionId: 's5',
      humeNativeEnabled: false,
      humeChatId: null,
    })

    expect(fetchHumeChatDuration).not.toHaveBeenCalled()
    expect(result).toEqual({ source: 'not_applicable' })
  })

  it('falls back immediately with no_hume_chat_id when hume_native_enabled but no chat id — never calls fetchHumeChatDuration', async () => {
    const result = await finalizeHumeNativeBilling({
      sessionId: 's6',
      humeNativeEnabled: true,
      humeChatId: null,
    })

    expect(fetchHumeChatDuration).not.toHaveBeenCalled()
    expect(result).toEqual({
      source: 'fallback',
      reason: 'no_hume_chat_id',
      retryUsed: false,
      totalWaitMs: 0,
    })
  })
})
