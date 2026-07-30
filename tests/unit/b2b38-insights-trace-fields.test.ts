import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-38 (docs/specs/B2B-38-requirement-document.md §6.9/§7 AT-19) — covers the TS-side write path
 * that feeds the fanout_glitch_instances() Postgres trigger (migration 099): extractInsights
 * ForPartnerSession() must read reseller_unique_id/hume_config_id off partner_sessions and thread
 * them into the partner_session_insights upsert.
 *
 * B2B-53 update: hume_config_id was removed from the outbound reseller webhook payload entirely
 * (lib/partner/webhooks.ts's WebhookPayload no longer has the field), so it is no longer threaded
 * into recordInsightsReadyEvent() from either call site below — only reseller_unique_id still is.
 * hume_config_id is still resolved/written to partner_session_insights for the unrelated
 * fanout_glitch_instances() trigger purpose described above.
 *
 * The trigger's own fan-out behavior (glitch_instances receiving reseller_id/end_client_id/
 * reseller_unique_id/hume_config_id, and AT-20's "does not re-fire on the daily JSONB purge rewrite"
 * guard) is pure SQL and has no test harness in this repo — migration 082's own original
 * fanout_glitch_instances() trigger (B2B-17) has no Vitest coverage either, for the same reason (no
 * live Postgres in the unit-test environment). Verified instead by direct migration/code review; see
 * the B2B-38 dev report for the exact verification performed.
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
}

let partnerSessionsById: Record<string, FakePartnerSession | undefined> = {}
let insightsBySession: Record<string, Record<string, unknown> | undefined> = {}
let capturedUpsertRow: Record<string, unknown> | null = null

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'partner_sessions') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: partnerSessionsById[val] ?? null, error: null }),
            }),
          }),
        }
      }

      if (table === 'partner_session_insights') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: insightsBySession[val] ?? null, error: null }),
            }),
          }),
          upsert: (row: Record<string, unknown>) => ({
            select: async () => {
              capturedUpsertRow = row
              const sessionId = row.partner_session_id as string
              if (insightsBySession[sessionId]) return { data: [], error: null }
              insightsBySession[sessionId] = row
              return { data: [{ extraction_status: 'pending' }], error: null }
            },
          }),
          update: (fields: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              insightsBySession[val] = { ...(insightsBySession[val] ?? {}), ...fields }
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

import { extractInsightsForPartnerSession, markInsightsExtractionFailed } from '@/inngest/partner-session-insights-extractor'

describe('AT-19 write path — extractInsightsForPartnerSession threads reseller_unique_id/hume_config_id', () => {
  beforeEach(() => {
    partnerSessionsById = {}
    insightsBySession = {}
    capturedUpsertRow = null
    fetchAllTranscriptEventsMock.mockReset()
    fetchAllTranscriptEventsMock.mockResolvedValue([
      { type: 'USER_MESSAGE', message_text: 'What does pricing look like?' },
      { type: 'AGENT_MESSAGE', message_text: 'Happy to walk through tiers.' },
    ])
    recordInsightsReadyEventMock.mockReset()
  })

  it('writes reseller_unique_id and hume_config_id onto the partner_session_insights upsert row', async () => {
    partnerSessionsById.ps1 = {
      id: 'ps1',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-1',
      test_mode: false,
      partner_reference: null,
      end_client_id: 'end-client-1',
      reseller_unique_id: 'order-48213',
      hume_config_id: 'hume-cfg-abc',
    }

    await extractInsightsForPartnerSession('ps1')

    expect(capturedUpsertRow).toMatchObject({
      end_client_id: 'end-client-1',
      reseller_unique_id: 'order-48213',
      hume_config_id: 'hume-cfg-abc',
    })
  })

  it('threads reseller_unique_id through to recordInsightsReadyEvent', async () => {
    partnerSessionsById.ps2 = {
      id: 'ps2',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-2',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      reseller_unique_id: 'order-xyz',
      hume_config_id: 'hume-cfg-xyz',
    }

    await extractInsightsForPartnerSession('ps2')

    expect(recordInsightsReadyEventMock).toHaveBeenCalledWith(expect.objectContaining({ resellerUniqueId: 'order-xyz' }))
    // B2B-53 — hume_config_id was removed from the outbound reseller webhook payload; it must no
    // longer be threaded through to recordInsightsReadyEvent(), even though it's still resolved off
    // partner_sessions above for the (unrelated) partner_session_insights upsert in the test above.
    const callArgs = recordInsightsReadyEventMock.mock.calls[0][0] as Record<string, unknown>
    expect('humeConfigId' in callArgs).toBe(false)
  })

  it('writes null for reseller_unique_id/hume_config_id when the session has neither', async () => {
    partnerSessionsById.ps3 = {
      id: 'ps3',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-3',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      reseller_unique_id: null,
      hume_config_id: null,
    }

    await extractInsightsForPartnerSession('ps3')

    expect(capturedUpsertRow).toMatchObject({ reseller_unique_id: null, hume_config_id: null })
  })
})

describe('AT-19 write path — markInsightsExtractionFailed threads reseller_unique_id/hume_config_id via its FK embed', () => {
  beforeEach(() => {
    partnerSessionsById = {}
    insightsBySession = {}
    recordInsightsReadyEventMock.mockReset()
  })

  it('threads the embedded session.reseller_unique_id/hume_config_id through to recordInsightsReadyEvent on the 3rd failed attempt', async () => {
    // Simulate a partner_session_insights row already at attempt_count 2, with the FK-embedded
    // partner_sessions object markInsightsExtractionFailed()'s own select produces.
    vi.resetModules()
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: (table: string) => {
          if (table === 'partner_session_insights') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      attempt_count: 2,
                      partner_account_id: 'acct1',
                      partner_sessions: {
                        test_mode: false,
                        partner_reference: null,
                        end_client_id: 'end-client-9',
                        reseller_unique_id: 'order-failed-case',
                        hume_config_id: 'hume-cfg-failed-case',
                      },
                    },
                  }),
                }),
              }),
              update: () => ({ eq: async () => ({ error: null }) }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      }),
    }))
    vi.doMock('@/lib/voice/hume-native/session-details', () => ({ fetchAllTranscriptEvents: vi.fn() }))
    const localRecordInsightsReadyEventMock = vi.fn()
    vi.doMock('@/lib/partner/webhooks', () => ({ recordInsightsReadyEvent: localRecordInsightsReadyEventMock }))

    const { markInsightsExtractionFailed: freshMarkFailed } = await import('@/inngest/partner-session-insights-extractor')
    await freshMarkFailed('ps-failed', 'some retryable error')

    expect(localRecordInsightsReadyEventMock).toHaveBeenCalledWith(expect.objectContaining({ resellerUniqueId: 'order-failed-case' }))
    // B2B-53 — hume_config_id was removed from the outbound reseller webhook payload; it must no
    // longer be threaded through to recordInsightsReadyEvent(), even though it's still resolved via
    // the FK embed above (now unused dead data in that select, kept for minimal-footprint diff risk).
    const callArgs = localRecordInsightsReadyEventMock.mock.calls[0][0] as Record<string, unknown>
    expect('humeConfigId' in callArgs).toBe(false)
  })
})
