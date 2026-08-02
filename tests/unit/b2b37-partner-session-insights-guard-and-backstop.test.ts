import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-37 (docs/specs/B2B-37-requirement-document.md §6.3/§6.4/§7) — covers:
 *  1. runInsightsIdempotencyGuard()'s existing terminal short-circuit (regression — unchanged by
 *     this brief, verified through extractInsightsForPartnerSession() since the guard itself is not
 *     exported, mirroring tests/unit/partner-session-insights-learner-insight.test.ts's own
 *     established mocking convention for this file).
 *  2. The NEW atomic-claim race fix: two near-simultaneous callers both reaching the "no existing
 *     row" branch — exactly one gets a non-empty insertedRows array and proceeds to extraction
 *     (one Anthropic/mock call, one recordInsightsReadyEvent call), the other gets an empty array
 *     and short-circuits with `claimed_by_concurrent_run`.
 *  3. partnerSessionInsightsBackstopSweep's find-eligible-sessions step now logs-then-throws on a
 *     Supabase query error for both of its queries, instead of silently degrading to an empty
 *     candidate list.
 *
 * ANTHROPIC_API_KEY is pinned to a placeholder BEFORE the module under test is imported (the
 * module's isPlaceholder/anthropic consts are computed once at load time), exercising the mock-guard
 * extraction path — no real Anthropic call is ever made. Same convention as the sibling
 * learner-insight test file.
 */
process.env.ANTHROPIC_API_KEY = 'PLACEHOLDER_TEST_KEY'
process.env.HUME_API_KEY = 'test-hume-key-not-real'

// ─── Mock state for the guard/extraction tests ──────────────────────────────

interface FakePartnerSession {
  id: string
  partner_account_id: string
  hume_chat_id: string | null
  test_mode: boolean
  partner_reference: string | null
  end_client_id: string | null
  // 2026-08-01 — undefined/null means hume (every pre-existing test session), matching migration
  // 106's own default. Only set explicitly in the openai_realtime-specific test below.
  voice_provider?: 'hume' | 'openai_realtime' | null
}

interface FakeInsightsRow {
  extraction_status: 'pending' | 'success' | 'success_empty' | 'failed'
  attempt_count: number
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
          // B2B-37 §6.3 — upsert(...).select(...) simulates Postgres's INSERT ... ON CONFLICT DO
          // NOTHING RETURNING atomicity: the synchronous check-and-set below runs to completion
          // before either "concurrent" caller's next await, so exactly one of two interleaved calls
          // for the same partner_session_id observes an empty row not-yet-present and wins the claim.
          upsert: (row: Record<string, unknown>) => ({
            select: async (_cols?: string) => {
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
                attempt_count: prior.attempt_count,
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

// B2B-63 — mocked so tests control exactly what Redis "returns" without needing real Upstash
// credentials. formatOpenAITranscriptLines is the real function (pure, no I/O) so its actual
// speaker-labeling logic is exercised, not just a stub.
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

import {
  extractInsightsForPartnerSession,
  partnerSessionInsightsBackstopSweep,
} from '@/inngest/partner-session-insights-extractor'

describe('runInsightsIdempotencyGuard — terminal short-circuit (regression, unchanged by B2B-37)', () => {
  beforeEach(() => {
    partnerSessionsById = {}
    insightsBySession = {}
    fetchAllTranscriptEventsMock.mockReset()
    recordInsightsReadyEventMock.mockReset()
  })

  it("existing row with extraction_status 'success' short-circuits with already_terminal and makes zero transcript/Anthropic calls", async () => {
    partnerSessionsById.ps1 = {
      id: 'ps1',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-1',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
    }
    insightsBySession.ps1 = { extraction_status: 'success', attempt_count: 0 }

    const result = await extractInsightsForPartnerSession('ps1')

    expect(result).toEqual({ status: 'already_terminal' })
    expect(fetchAllTranscriptEventsMock).not.toHaveBeenCalled()
    expect(recordInsightsReadyEventMock).not.toHaveBeenCalled()
  })
})

describe('extractInsightsForPartnerSession — B2B-63 voice_provider branch (Redis for OpenAI, Hume API unchanged for everyone else)', () => {
  beforeEach(() => {
    partnerSessionsById = {}
    insightsBySession = {}
    fetchAllTranscriptEventsMock.mockReset()
    recordInsightsReadyEventMock.mockReset()
    getStoredTranscriptTurnsMock.mockReset()
    deleteStoredTranscriptMock.mockReset()
  })

  it('an OpenAI Realtime session reads from Redis, never calls Hume\'s transcript API, and produces a real extraction result', async () => {
    partnerSessionsById.ps_openai = {
      id: 'ps_openai',
      partner_account_id: 'acct1',
      hume_chat_id: 'sess_someOpenAiSessionId', // real shape: not a Hume UUID — irrelevant now, never used for this provider
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      voice_provider: 'openai_realtime',
    }
    getStoredTranscriptTurnsMock.mockResolvedValue([
      { source: 'user', text: 'What does pricing look like?', at: 1 },
      { source: 'ai', text: 'Happy to walk through tiers.', at: 2 },
    ])

    const result = await extractInsightsForPartnerSession('ps_openai')

    expect(fetchAllTranscriptEventsMock).not.toHaveBeenCalled()
    expect(getStoredTranscriptTurnsMock).toHaveBeenCalledWith('ps_openai')
    expect(result.status).not.toBe('failed')
    expect(recordInsightsReadyEventMock).toHaveBeenCalledTimes(1)
  })

  it('an OpenAI session with zero captured turns resolves to success_empty, not a thrown error (covers both a genuinely silent call and a template-mode session that was never captured)', async () => {
    partnerSessionsById.ps_openai_empty = {
      id: 'ps_openai_empty',
      partner_account_id: 'acct1',
      hume_chat_id: 'sess_empty',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      voice_provider: 'openai_realtime',
    }
    getStoredTranscriptTurnsMock.mockResolvedValue([])

    const result = await extractInsightsForPartnerSession('ps_openai_empty')

    expect(result.status).toBe('success_empty')
    expect(insightsBySession.ps_openai_empty?.extraction_status).toBe('success_empty')
  })

  it('deleteStoredTranscript is NOT called after a successful OpenAI extraction (temporarily disabled 2026-08-01 for conversation-quality debugging — see extractor\'s own doc comment; revert together with the 30-min TTL in openai-realtime-transcript-store.ts)', async () => {
    partnerSessionsById.ps_openai_del = {
      id: 'ps_openai_del',
      partner_account_id: 'acct1',
      hume_chat_id: 'sess_del',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      voice_provider: 'openai_realtime',
    }
    getStoredTranscriptTurnsMock.mockResolvedValue([{ source: 'user', text: 'Hello', at: 1 }])

    await extractInsightsForPartnerSession('ps_openai_del')

    expect(deleteStoredTranscriptMock).not.toHaveBeenCalled()
  })

  it('deleteStoredTranscript is never called for a Hume-provider session', async () => {
    partnerSessionsById.ps_hume_nodel = {
      id: 'ps_hume_nodel',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-hume-nodel',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      voice_provider: 'hume',
    }
    fetchAllTranscriptEventsMock.mockResolvedValue([
      { type: 'USER_MESSAGE', message_text: 'Hello' },
    ])

    await extractInsightsForPartnerSession('ps_hume_nodel')

    expect(deleteStoredTranscriptMock).not.toHaveBeenCalled()
    expect(getStoredTranscriptTurnsMock).not.toHaveBeenCalled()
  })

  it('voice_provider undefined/null (every pre-existing session) is unaffected — still calls Hume\'s transcript API as before, never touches Redis', async () => {
    partnerSessionsById.ps_hume = {
      id: 'ps_hume',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-hume-1',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      // voice_provider omitted entirely — matches every session created before migration 106
    }
    fetchAllTranscriptEventsMock.mockResolvedValue([
      { type: 'USER_MESSAGE', message_text: 'What does pricing look like?' },
      { type: 'AGENT_MESSAGE', message_text: 'Happy to walk through tiers.' },
    ])

    await extractInsightsForPartnerSession('ps_hume')
    expect(fetchAllTranscriptEventsMock).toHaveBeenCalledTimes(1)
    expect(getStoredTranscriptTurnsMock).not.toHaveBeenCalled()
  })
})

describe('runInsightsIdempotencyGuard — B2B-37 atomic-claim concurrent-insert race fix', () => {
  beforeEach(() => {
    partnerSessionsById = {}
    insightsBySession = {}
    fetchAllTranscriptEventsMock.mockReset()
    fetchAllTranscriptEventsMock.mockResolvedValue([
      { type: 'USER_MESSAGE', message_text: 'What does pricing look like?' },
      { type: 'AGENT_MESSAGE', message_text: 'Happy to walk through tiers.' },
    ])
    recordInsightsReadyEventMock.mockReset()
  })

  it('two near-simultaneous invocations for the same session: exactly one proceeds to extraction, the other short-circuits with claimed_by_concurrent_run — one Anthropic/mock call, one recordInsightsReadyEvent call total', async () => {
    partnerSessionsById.ps_race = {
      id: 'ps_race',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-race',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
    }

    const [resultA, resultB] = await Promise.all([
      extractInsightsForPartnerSession('ps_race'),
      extractInsightsForPartnerSession('ps_race'),
    ])

    const statuses = [resultA.status, resultB.status].sort()
    // One winner proceeds through extraction (mock-guard path returns 'success' since action_items
    // is non-empty for the mock data), the other is claimed_by_concurrent_run.
    expect(statuses).toContain('claimed_by_concurrent_run')
    expect(statuses.filter((s) => s !== 'claimed_by_concurrent_run')).toHaveLength(1)

    // Exactly one call reached the transcript fetch / Claude mock path.
    expect(fetchAllTranscriptEventsMock).toHaveBeenCalledTimes(1)
    // Exactly one call reached the final webhook-ready dispatch.
    expect(recordInsightsReadyEventMock).toHaveBeenCalledTimes(1)
  })
})

describe('partnerSessionInsightsBackstopSweep — B2B-37 §6.4 log-then-throw on query error', () => {
  function handlerOf(fn: unknown): (args: unknown) => Promise<unknown> {
    return (fn as { fn: (args: unknown) => Promise<unknown> }).fn
  }

  const fakeStep = () => ({
    run: async <T>(_id: string, cb: () => Promise<T> | T) => cb(),
  })

  it('candidates query error: logs then throws (does not silently return an empty candidate list)', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: (table: string) => {
          if (table === 'partner_sessions') {
            return {
              select: () => ({
                eq: () => ({
                  not: () => ({
                    lt: () => ({
                      not: async () => ({ data: null, error: { message: 'connection reset' } }),
                    }),
                  }),
                }),
              }),
            }
          }
          throw new Error(`unexpected table ${table}`)
        },
      }),
    }))
    vi.doMock('@/lib/voice/hume-native/session-details', () => ({ fetchAllTranscriptEvents: vi.fn() }))
    vi.doMock('@/lib/partner/webhooks', () => ({ recordInsightsReadyEvent: vi.fn() }))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { partnerSessionInsightsBackstopSweep: sweep } = await import('@/inngest/partner-session-insights-extractor')

    await expect(
      handlerOf(sweep)({ step: fakeStep() })
    ).rejects.toThrow('Backstop sweep candidate query failed')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to query eligible candidates'),
      expect.anything()
    )
    consoleErrorSpy.mockRestore()
  })

  it('existing-rows query error (candidates non-empty): logs then throws', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: (table: string) => {
          if (table === 'partner_sessions') {
            return {
              select: () => ({
                eq: () => ({
                  not: () => ({
                    lt: () => ({
                      not: async () => ({ data: [{ id: 'sess-1' }], error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'partner_session_insights') {
            return {
              select: () => ({
                in: async () => ({ data: null, error: { message: 'permission denied' } }),
              }),
            }
          }
          throw new Error(`unexpected table ${table}`)
        },
      }),
    }))
    vi.doMock('@/lib/voice/hume-native/session-details', () => ({ fetchAllTranscriptEvents: vi.fn() }))
    vi.doMock('@/lib/partner/webhooks', () => ({ recordInsightsReadyEvent: vi.fn() }))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { partnerSessionInsightsBackstopSweep: sweep } = await import('@/inngest/partner-session-insights-extractor')

    await expect(
      handlerOf(sweep)({ step: fakeStep() })
    ).rejects.toThrow('Backstop sweep existing-rows query failed')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to query existing extraction rows'),
      expect.anything()
    )
    consoleErrorSpy.mockRestore()
  })
})
