import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-65 (docs/specs/B2B-65-requirement-document.md §6.3/§7). Covers the ONE new field
 * (`demo_performance_visible`) added to extractInsightsForPartnerSession()'s pre-existing terminal
 * `.update()` call. Mirrors tests/unit/partner-session-insights-learner-insight.test.ts's own mock
 * shape for `partner_sessions`/`partner_session_insights`, plus a mock for the new
 * getDemoPerformanceAppendEnabled() toggle-read helper.
 *
 * Acceptance criteria covered (§7):
 * - toggle ON + demo session + success -> demo_performance_visible: true
 * - toggle OFF + demo session + success -> demo_performance_visible: false (and stays false forever
 *   — this file only tests the single write; permanence itself is a property of "only written
 *   once, ever" which the idempotency guard already covers elsewhere, not re-tested here)
 * - real (non-demo) session, toggle ON, success -> demo_performance_visible: false always
 * - demo session, toggle ON, but extraction result is nonetheless 'success_empty' -> still true
 *   (success_empty is a real, successful extraction, just with an empty transcript)
 */
process.env.ANTHROPIC_API_KEY = 'PLACEHOLDER_TEST_KEY'
process.env.HUME_API_KEY = 'test-hume-key-not-real'
process.env.DEMO_PARTNER_ACCOUNT_ID = 'demo-acct-id'

interface FakePartnerSession {
  id: string
  partner_account_id: string
  hume_chat_id: string | null
  test_mode: boolean
  partner_reference: string | null
  end_client_id: string | null
}

interface FakeInsightsRow {
  extraction_status: 'pending' | 'success' | 'success_empty' | 'failed'
  attempt_count: number
}

let partnerSessionsById: Record<string, FakePartnerSession | undefined> = {}
let insightsBySession: Record<string, FakeInsightsRow | undefined> = {}
let updateWrites: Array<{ sessionId: string; fields: Record<string, unknown> }> = []

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
              updateWrites.push({ sessionId: val, fields })
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

const getDemoPerformanceAppendEnabledMock = vi.fn()
vi.mock('@/lib/demo/performance-config', () => ({
  getDemoPerformanceAppendEnabled: () => getDemoPerformanceAppendEnabledMock(),
}))

import { extractInsightsForPartnerSession } from '@/inngest/partner-session-insights-extractor'

function seedSession(id: string, overrides: Partial<FakePartnerSession> = {}) {
  partnerSessionsById[id] = {
    id,
    partner_account_id: 'real-partner-acct',
    hume_chat_id: `chat-${id}`,
    test_mode: false,
    partner_reference: 'claude-ai',
    end_client_id: null,
    ...overrides,
  }
}

describe('extractInsightsForPartnerSession — demo_performance_visible (B2B-65)', () => {
  beforeEach(() => {
    partnerSessionsById = {}
    insightsBySession = {}
    updateWrites = []
    fetchAllTranscriptEventsMock.mockReset()
    recordInsightsReadyEventMock.mockReset()
    getDemoPerformanceAppendEnabledMock.mockReset()
    fetchAllTranscriptEventsMock.mockResolvedValue([
      { type: 'USER_MESSAGE', message_text: 'What does pricing look like?' },
      { type: 'AGENT_MESSAGE', message_text: 'Happy to walk through tiers.' },
    ])
  })

  it('demo session + toggle ON + successful extraction -> demo_performance_visible: true', async () => {
    seedSession('ps-demo-on', { partner_account_id: 'demo-acct-id' })
    getDemoPerformanceAppendEnabledMock.mockResolvedValue(true)

    await extractInsightsForPartnerSession('ps-demo-on')

    const lastWrite = updateWrites[updateWrites.length - 1]
    expect(lastWrite.fields.demo_performance_visible).toBe(true)
  })

  it('demo session + toggle OFF + successful extraction -> demo_performance_visible: false', async () => {
    seedSession('ps-demo-off', { partner_account_id: 'demo-acct-id' })
    getDemoPerformanceAppendEnabledMock.mockResolvedValue(false)

    await extractInsightsForPartnerSession('ps-demo-off')

    const lastWrite = updateWrites[updateWrites.length - 1]
    expect(lastWrite.fields.demo_performance_visible).toBe(false)
  })

  it('real (non-demo) partner session + toggle ON + successful extraction -> demo_performance_visible: false always (never gated by, or affects, the real-partner path)', async () => {
    seedSession('ps-real', { partner_account_id: 'real-partner-acct' })
    getDemoPerformanceAppendEnabledMock.mockResolvedValue(true)

    await extractInsightsForPartnerSession('ps-real')

    const lastWrite = updateWrites[updateWrites.length - 1]
    expect(lastWrite.fields.demo_performance_visible).toBe(false)
    // The toggle read is irrelevant for a real session, but even if called, must never gate
    // extraction itself — confirmed the write still fully succeeds regardless.
    expect(lastWrite.fields.extraction_status).toBe('success')
  })

  it('demo session + toggle ON + success_empty (empty transcript, still a real successful extraction) -> demo_performance_visible: true', async () => {
    seedSession('ps-demo-empty', { partner_account_id: 'demo-acct-id' })
    getDemoPerformanceAppendEnabledMock.mockResolvedValue(true)
    fetchAllTranscriptEventsMock.mockResolvedValue([{ type: 'CHAT_METADATA' }]) // no message events -> success_empty

    await extractInsightsForPartnerSession('ps-demo-empty')

    const lastWrite = updateWrites[updateWrites.length - 1]
    expect(lastWrite.fields.extraction_status).toBe('success_empty')
    expect(lastWrite.fields.demo_performance_visible).toBe(true)
  })

  it('demo session + toggle ON, but DEMO_PARTNER_ACCOUNT_ID is unset -> demo_performance_visible: false (never crashes on a missing env var)', async () => {
    const original = process.env.DEMO_PARTNER_ACCOUNT_ID
    delete process.env.DEMO_PARTNER_ACCOUNT_ID
    seedSession('ps-no-env', { partner_account_id: 'demo-acct-id' })
    getDemoPerformanceAppendEnabledMock.mockResolvedValue(true)

    await extractInsightsForPartnerSession('ps-no-env')

    const lastWrite = updateWrites[updateWrites.length - 1]
    expect(lastWrite.fields.demo_performance_visible).toBe(false)
    process.env.DEMO_PARTNER_ACCOUNT_ID = original
  })
})
