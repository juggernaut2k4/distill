import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-70 v2.0 (docs/specs/B2B-70-requirement-document.md §6.4/§7) — "no leftovers" content-purge
 * mechanism added to inngest/partner-session-insights-extractor.ts. Covers both triggers
 * (successful/empty extraction in extractInsightsForPartnerSession, permanent failure in
 * markInsightsExtractionFailed) AND the negative case proving the purge never fires for a
 * meeting-bot session — the explicit scope boundary from Section 10.
 *
 * Mocking convention mirrors tests/unit/partner-session-insights-learner-insight.test.ts: pin
 * ANTHROPIC_API_KEY/HUME_API_KEY to placeholders before importing the module under test (exercises
 * the mock-guard path, no real network call), mock @/lib/supabase with an in-memory fixture, mock
 * @/lib/voice/hume-native/session-details and @/lib/partner/webhooks.
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
  reseller_unique_id: string | null
  hume_config_id: string | null
  voice_provider: string | null
  delivery_channel: 'widget' | 'meeting_bot'
}

interface FakeInsightsRow {
  extraction_status: 'pending' | 'success' | 'success_empty' | 'failed'
  attempt_count: number
}

let partnerSessionsById: Record<string, FakePartnerSession | undefined> = {}
let insightsBySession: Record<string, FakeInsightsRow | undefined> = {}
let partnerSessionsUpdateWrites: Array<{ sessionId: string; fields: Record<string, unknown> }> = []

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'partner_sessions') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              limit: async () => {
                const row = partnerSessionsById[val] ?? null
                return { data: row ? [row] : [], error: null }
              },
            }),
          }),
          update: (fields: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              partnerSessionsUpdateWrites.push({ sessionId: val, fields })
              return { error: null }
            },
          }),
        }
      }

      if (table === 'partner_session_insights') {
        return {
          select: (cols?: string) => ({
            eq: (_col: string, val: string) => ({
              limit: async () => {
                const insightsRow = insightsBySession[val] ?? null
                if (!insightsRow) return { data: [], error: null }
                // markInsightsExtractionFailed's own select embeds partner_sessions!inner(...) — the
                // real query returns those columns nested under `partner_sessions`. Detect that shape
                // by checking whether the cols string requests the embed.
                if (cols?.includes('partner_sessions!inner')) {
                  const session = partnerSessionsById[val]
                  return {
                    data: [
                      {
                        attempt_count: insightsRow.attempt_count,
                        partner_account_id: session?.partner_account_id ?? null,
                        partner_sessions: session
                          ? {
                              test_mode: session.test_mode,
                              partner_reference: session.partner_reference,
                              end_client_id: session.end_client_id,
                              reseller_unique_id: session.reseller_unique_id,
                              hume_config_id: session.hume_config_id,
                              delivery_channel: session.delivery_channel,
                            }
                          : null,
                      },
                    ],
                    error: null,
                  }
                }
                return { data: [insightsRow], error: null }
              },
            }),
          }),
          upsert: (row: Record<string, unknown>) => ({
            select: async () => {
              const sessionId = row.partner_session_id as string
              const alreadyExisted = !!insightsBySession[sessionId]
              if (!alreadyExisted) {
                insightsBySession[sessionId] = { extraction_status: 'pending', attempt_count: 0 }
              }
              return { data: alreadyExisted ? [] : [{ extraction_status: 'pending' }], error: null }
            },
          }),
          update: (fields: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              const prior = insightsBySession[val] ?? { extraction_status: 'pending', attempt_count: 0 }
              insightsBySession[val] = {
                extraction_status: (fields.extraction_status as FakeInsightsRow['extraction_status']) ?? prior.extraction_status,
                attempt_count: (fields.attempt_count as number | undefined) ?? prior.attempt_count,
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

vi.mock('@/lib/demo/performance-config', () => ({
  getDemoPerformanceAppendEnabled: async () => false,
}))

import { extractInsightsForPartnerSession, markInsightsExtractionFailed } from '@/inngest/partner-session-insights-extractor'

describe('Content-purge — successful/empty extraction (Trigger 1, §6.4)', () => {
  beforeEach(() => {
    partnerSessionsById = {}
    insightsBySession = {}
    partnerSessionsUpdateWrites = []
    fetchAllTranscriptEventsMock.mockReset()
    recordInsightsReadyEventMock.mockReset()
  })

  it('nulls content_pages/content_to_explain/content_title/content_subtitle/assembled_prompt_snapshot for a widget session after a successful (empty) extraction', async () => {
    partnerSessionsById.widget1 = {
      id: 'widget1',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-1',
      test_mode: false,
      partner_reference: 'claude-ai',
      end_client_id: null,
      reseller_unique_id: null,
      hume_config_id: null,
      voice_provider: null,
      delivery_channel: 'widget',
    }
    fetchAllTranscriptEventsMock.mockResolvedValue([{ type: 'CHAT_METADATA' }]) // no message events -> success_empty

    const result = await extractInsightsForPartnerSession('widget1')

    expect(result).toEqual({ status: 'success_empty' })
    const purgeWrite = partnerSessionsUpdateWrites.find((w) => w.sessionId === 'widget1')
    expect(purgeWrite).toBeDefined()
    expect(purgeWrite?.fields).toEqual({
      content_pages: null,
      content_to_explain: null,
      content_title: null,
      content_subtitle: null,
      assembled_prompt_snapshot: null,
    })
    // The purge write happens only after findings were recorded.
    expect(recordInsightsReadyEventMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT purge a meeting-bot session after the same successful extraction (scope boundary, §10)', async () => {
    partnerSessionsById.meeting1 = {
      id: 'meeting1',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-2',
      test_mode: false,
      partner_reference: 'claude-ai',
      end_client_id: null,
      reseller_unique_id: null,
      hume_config_id: null,
      voice_provider: null,
      delivery_channel: 'meeting_bot',
    }
    fetchAllTranscriptEventsMock.mockResolvedValue([{ type: 'CHAT_METADATA' }])

    const result = await extractInsightsForPartnerSession('meeting1')

    expect(result).toEqual({ status: 'success_empty' })
    expect(partnerSessionsUpdateWrites.find((w) => w.sessionId === 'meeting1')).toBeUndefined()
  })
})

describe('Content-purge — permanent extraction failure (Trigger 2, §6.4)', () => {
  beforeEach(() => {
    partnerSessionsById = {}
    insightsBySession = {}
    partnerSessionsUpdateWrites = []
    recordInsightsReadyEventMock.mockReset()
  })

  it('nulls the same content columns for a widget session on the 3rd (permanent) failure', async () => {
    partnerSessionsById.widget2 = {
      id: 'widget2',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-3',
      test_mode: true,
      partner_reference: 'claude-ai',
      end_client_id: null,
      reseller_unique_id: null,
      hume_config_id: null,
      voice_provider: null,
      delivery_channel: 'widget',
    }
    insightsBySession.widget2 = { extraction_status: 'failed', attempt_count: 2 }

    await markInsightsExtractionFailed('widget2', 'transcript fetch timed out')

    expect(recordInsightsReadyEventMock).toHaveBeenCalledTimes(1)
    const purgeWrite = partnerSessionsUpdateWrites.find((w) => w.sessionId === 'widget2')
    expect(purgeWrite).toBeDefined()
    expect(purgeWrite?.fields).toEqual({
      content_pages: null,
      content_to_explain: null,
      content_title: null,
      content_subtitle: null,
      assembled_prompt_snapshot: null,
    })
  })

  it('does NOT purge a meeting-bot session on its 3rd (permanent) failure', async () => {
    partnerSessionsById.meeting2 = {
      id: 'meeting2',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-4',
      test_mode: true,
      partner_reference: 'claude-ai',
      end_client_id: null,
      reseller_unique_id: null,
      hume_config_id: null,
      voice_provider: null,
      delivery_channel: 'meeting_bot',
    }
    insightsBySession.meeting2 = { extraction_status: 'failed', attempt_count: 2 }

    await markInsightsExtractionFailed('meeting2', 'transcript fetch timed out')

    expect(recordInsightsReadyEventMock).toHaveBeenCalledTimes(1)
    expect(partnerSessionsUpdateWrites.find((w) => w.sessionId === 'meeting2')).toBeUndefined()
  })

  it('does not purge or notify before the 3rd failure (attempt_count still below threshold)', async () => {
    partnerSessionsById.widget3 = {
      id: 'widget3',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-5',
      test_mode: true,
      partner_reference: 'claude-ai',
      end_client_id: null,
      reseller_unique_id: null,
      hume_config_id: null,
      voice_provider: null,
      delivery_channel: 'widget',
    }
    insightsBySession.widget3 = { extraction_status: 'failed', attempt_count: 0 }

    await markInsightsExtractionFailed('widget3', 'transient error')

    expect(recordInsightsReadyEventMock).not.toHaveBeenCalled()
    expect(partnerSessionsUpdateWrites.find((w) => w.sessionId === 'widget3')).toBeUndefined()
  })
})
