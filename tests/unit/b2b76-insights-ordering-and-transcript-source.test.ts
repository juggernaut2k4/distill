import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-76 — covers items 1 and 4:
 *
 *  1. §1.1 (item 1) — the idempotency-guard-before-hume_chat_id-null-check ordering fix in
 *     extractInsightsForPartnerSession() (inngest/partner-session-insights-extractor.ts). A session
 *     that never reached onConnect (hume_chat_id is null) must get a REAL partner_session_insights
 *     row (not zero rows) before the function throws, so markInsightsExtractionFailed() has
 *     something to mark 'failed' instead of silently no-op'ing.
 *
 *  2. §1.4 (item 4) — the ElevenLabs-native-transcript-first, Redis-fallback branch, and the new
 *     `transcript_source` column write.
 *
 * Mocking convention mirrors tests/unit/b2b37-partner-session-insights-guard-and-backstop.test.ts —
 * a fresh file (not an edit to that one) because this exercises genuinely new code paths that file's
 * existing fixtures don't cover, same convention as tests/unit/b2b70-widget-active-backstop.test.ts
 * being a fresh file alongside tests/unit/b2b43-stuck-session-backstop-sweep.test.ts.
 */
process.env.ANTHROPIC_API_KEY = 'PLACEHOLDER_TEST_KEY'
process.env.HUME_API_KEY = 'test-hume-key-not-real'

interface FakePartnerSession {
  id: string
  partner_account_id: string
  hume_chat_id: string | null
  test_mode: boolean
  partner_reference: string | null
  end_client_id: string | null
  voice_provider?: 'hume' | 'openai_realtime' | 'elevenlabs' | null
}

interface FakeInsightsRow {
  extraction_status: 'pending' | 'success' | 'success_empty' | 'failed'
  attempt_count: number
  error_message?: string | null
  transcript_source?: string | null
}

let partnerSessionsById: Record<string, FakePartnerSession | undefined> = {}
let insightsBySession: Record<string, FakeInsightsRow | undefined> = {}

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'partner_sessions') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              limit: async () => ({ data: partnerSessionsById[val] ? [partnerSessionsById[val]] : [], error: null }),
            }),
          }),
        }
      }

      if (table === 'partner_session_insights') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              limit: async () => ({ data: insightsBySession[val] ? [insightsBySession[val]] : [], error: null }),
            }),
          }),
          upsert: (row: Record<string, unknown>) => ({
            select: async () => {
              const sessionId = row.partner_session_id as string
              if (insightsBySession[sessionId]) {
                return { data: [], error: null }
              }
              insightsBySession[sessionId] = {
                extraction_status: (row.extraction_status as FakeInsightsRow['extraction_status']) ?? 'pending',
                attempt_count: 0,
              }
              return { data: [{ extraction_status: 'pending' }], error: null }
            },
          }),
          update: (fields: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              const prior = insightsBySession[val] ?? { extraction_status: 'pending', attempt_count: 0 }
              insightsBySession[val] = {
                extraction_status: (fields.extraction_status as FakeInsightsRow['extraction_status']) ?? prior.extraction_status,
                attempt_count: fields.attempt_count !== undefined ? (fields.attempt_count as number) : prior.attempt_count,
                error_message: fields.error_message !== undefined ? (fields.error_message as string | null) : prior.error_message,
                transcript_source: fields.transcript_source !== undefined ? (fields.transcript_source as string | null) : prior.transcript_source,
              }
              return { error: null }
            },
          }),
        }
      }

      throw new Error(`Unexpected table in test mock: ${table}`)
    },
  }),
}))

const fetchAllTranscriptEventsMock = vi.fn()
vi.mock('@/lib/voice/hume-native/session-details', () => ({
  fetchAllTranscriptEvents: (...args: unknown[]) => fetchAllTranscriptEventsMock(...args),
}))

const recordInsightsReadyEventMock = vi.fn()
vi.mock('@/lib/partner/webhooks', () => ({
  recordInsightsReadyEvent: (...args: unknown[]) => recordInsightsReadyEventMock(...args),
}))

const getStoredTranscriptTurnsMock = vi.fn()
const deleteStoredTranscriptMock = vi.fn()
vi.mock('@/lib/voice/openai-realtime-transcript-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/voice/openai-realtime-transcript-store')>(
    '@/lib/voice/openai-realtime-transcript-store'
  )
  return {
    ...actual,
    getStoredTranscriptTurns: (...args: unknown[]) => getStoredTranscriptTurnsMock(...args),
    deleteStoredTranscript: (...args: unknown[]) => deleteStoredTranscriptMock(...args),
  }
})

const fetchElevenLabsNativeTranscriptMock = vi.fn()
vi.mock('@/lib/voice/elevenlabs-native-transcript', () => ({
  fetchElevenLabsNativeTranscript: (...args: unknown[]) => fetchElevenLabsNativeTranscriptMock(...args),
}))

import {
  extractInsightsForPartnerSession,
  partnerSessionInsightsExtractor,
} from '@/inngest/partner-session-insights-extractor'

function handlerOf(fn: unknown): (args: unknown) => Promise<unknown> {
  return (fn as { fn: (args: unknown) => Promise<unknown> }).fn
}
const fakeStep = () => ({ run: async <T>(_id: string, cb: () => Promise<T> | T) => cb() })

describe('extractInsightsForPartnerSession — B2B-76 §1.1 (item 1): guard runs before hume_chat_id null check', () => {
  beforeEach(() => {
    partnerSessionsById = {}
    insightsBySession = {}
    fetchAllTranscriptEventsMock.mockReset()
    recordInsightsReadyEventMock.mockReset()
    fetchElevenLabsNativeTranscriptMock.mockReset()
  })

  it('a session with hume_chat_id=null gets a REAL partner_session_insights row before throwing (not zero rows)', async () => {
    partnerSessionsById.ps_nochat = {
      id: 'ps_nochat',
      partner_account_id: 'acct1',
      hume_chat_id: null,
      test_mode: true,
      partner_reference: null,
      end_client_id: null,
    }

    expect(insightsBySession.ps_nochat).toBeUndefined() // sanity: no row exists yet

    await expect(extractInsightsForPartnerSession('ps_nochat')).rejects.toThrow('no_provider_session_id')

    // The guard's upsert ran BEFORE the throw — a real row now exists.
    expect(insightsBySession.ps_nochat).toBeDefined()
    expect(insightsBySession.ps_nochat?.extraction_status).toBe('pending')
  })

  it('end-to-end via the fast-path Inngest function: the outer catch marks the row failed with a clear reason, instead of no-op-ing on a missing row', async () => {
    partnerSessionsById.ps_nochat2 = {
      id: 'ps_nochat2',
      partner_account_id: 'acct1',
      hume_chat_id: null,
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
    }

    const result = await handlerOf(partnerSessionInsightsExtractor)({
      event: { data: { partnerSessionId: 'ps_nochat2' } },
      step: fakeStep(),
    })

    expect(result).toMatchObject({ status: 'failed' })
    // Before the B2B-76 fix, this row would never have existed (markInsightsExtractionFailed's
    // `if (!current) return` no-op) — now it does, and carries a real, greppable reason.
    expect(insightsBySession.ps_nochat2).toBeDefined()
    expect(insightsBySession.ps_nochat2?.extraction_status).toBe('failed')
    expect(insightsBySession.ps_nochat2?.attempt_count).toBe(1)
    expect(insightsBySession.ps_nochat2?.error_message).toContain('no_provider_session_id')
  })

  it('a session WITH hume_chat_id is completely unaffected by the reordering (regression)', async () => {
    partnerSessionsById.ps_hume = {
      id: 'ps_hume',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-1',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
    }
    fetchAllTranscriptEventsMock.mockResolvedValue([{ type: 'USER_MESSAGE', message_text: 'Hello' }])

    const result = await extractInsightsForPartnerSession('ps_hume')

    expect(result.status).not.toBe('failed')
    expect(fetchAllTranscriptEventsMock).toHaveBeenCalledTimes(1)
  })
})

describe('extractInsightsForPartnerSession — B2B-76 §1.4 (item 4): ElevenLabs native-first, Redis fallback', () => {
  beforeEach(() => {
    partnerSessionsById = {}
    insightsBySession = {}
    fetchAllTranscriptEventsMock.mockReset()
    recordInsightsReadyEventMock.mockReset()
    getStoredTranscriptTurnsMock.mockReset()
    deleteStoredTranscriptMock.mockReset()
    fetchElevenLabsNativeTranscriptMock.mockReset()
  })

  it('native transcript available: uses it, never touches Redis, records transcript_source=elevenlabs_native', async () => {
    partnerSessionsById.ps_el_native = {
      id: 'ps_el_native',
      partner_account_id: 'acct1',
      hume_chat_id: 'conv_native123',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      voice_provider: 'elevenlabs',
    }
    fetchElevenLabsNativeTranscriptMock.mockResolvedValue([
      { source: 'user', text: 'What does pricing look like?', at: 1000 },
      { source: 'ai', text: 'Happy to walk through tiers.', at: 2000 },
    ])

    const result = await extractInsightsForPartnerSession('ps_el_native')

    expect(fetchElevenLabsNativeTranscriptMock).toHaveBeenCalledWith('conv_native123')
    expect(getStoredTranscriptTurnsMock).not.toHaveBeenCalled()
    expect(fetchAllTranscriptEventsMock).not.toHaveBeenCalled()
    expect(result.status).not.toBe('failed')
    expect(insightsBySession.ps_el_native?.transcript_source).toBe('elevenlabs_native')
  })

  it('native transcript unavailable (returns null): falls back to Redis, records transcript_source=redis_live_capture, extraction still succeeds', async () => {
    partnerSessionsById.ps_el_fallback = {
      id: 'ps_el_fallback',
      partner_account_id: 'acct1',
      hume_chat_id: 'conv_fallback456',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      voice_provider: 'elevenlabs',
    }
    fetchElevenLabsNativeTranscriptMock.mockResolvedValue(null)
    getStoredTranscriptTurnsMock.mockResolvedValue([
      { source: 'user', text: 'Redis-captured question', at: 1 },
    ])

    const result = await extractInsightsForPartnerSession('ps_el_fallback')

    expect(fetchElevenLabsNativeTranscriptMock).toHaveBeenCalledWith('conv_fallback456')
    expect(getStoredTranscriptTurnsMock).toHaveBeenCalledWith('ps_el_fallback')
    expect(result.status).not.toBe('failed')
    expect(insightsBySession.ps_el_fallback?.transcript_source).toBe('redis_live_capture')
  })

  it('openai_realtime sessions are unaffected — never call fetchElevenLabsNativeTranscript, transcript_source stays untouched (null)', async () => {
    partnerSessionsById.ps_openai = {
      id: 'ps_openai',
      partner_account_id: 'acct1',
      hume_chat_id: 'sess_openai',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      voice_provider: 'openai_realtime',
    }
    getStoredTranscriptTurnsMock.mockResolvedValue([{ source: 'user', text: 'Hi', at: 1 }])

    await extractInsightsForPartnerSession('ps_openai')

    expect(fetchElevenLabsNativeTranscriptMock).not.toHaveBeenCalled()
    expect(getStoredTranscriptTurnsMock).toHaveBeenCalledWith('ps_openai')
    expect(insightsBySession.ps_openai?.transcript_source).toBeFalsy()
  })

  it('hume sessions are unaffected — never call fetchElevenLabsNativeTranscript', async () => {
    partnerSessionsById.ps_hume2 = {
      id: 'ps_hume2',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-hume-2',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      voice_provider: 'hume',
    }
    fetchAllTranscriptEventsMock.mockResolvedValue([{ type: 'USER_MESSAGE', message_text: 'Hello' }])

    await extractInsightsForPartnerSession('ps_hume2')

    expect(fetchElevenLabsNativeTranscriptMock).not.toHaveBeenCalled()
    expect(insightsBySession.ps_hume2?.transcript_source).toBeFalsy()
  })
})
