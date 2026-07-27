import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-34 Piece 1 (docs/specs/B2B-34-requirement-document.md Part C §6.3/§6.4). Covers the
 * learner_insight schema/extraction change to inngest/partner-session-insights-extractor.ts:
 * PartnerInsightsExtractionSchema's shape (replacing psychology_keywords), and the
 * messageLines.length===0 short-circuit's empty-transcript → learner_insight: null resolution.
 *
 * ANTHROPIC_API_KEY/HUME_API_KEY are pinned to placeholders BEFORE the module under test is
 * imported (isPlaceholder/anthropic are computed once at module load), exercising the mock-guard
 * path rather than attempting any real network call from a unit test — mirrors
 * tests/unit/hume-action-item-extractor.test.ts's own established convention. No real Hume/Anthropic
 * call is ever made by this file.
 */
process.env.ANTHROPIC_API_KEY = 'PLACEHOLDER_TEST_KEY'
// Deliberately NOT prefixed with PLACEHOLDER_ (extractInsightsForPartnerSession's own configured-key
// check would otherwise throw before ever reaching fetchAllTranscriptEvents, which this file mocks —
// no real Hume call is made regardless of this value).
process.env.HUME_API_KEY = 'test-hume-key-not-real'

// ─── Mock state ──────────────────────────────────────────────────────────

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
let upsertWrites: Array<Record<string, unknown>> = []

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
          // B2B-37 §6.3 — upsert(...).select(...) now mirrors the atomic-claim shape the real code
          // chains onto the upsert (INSERT ... ON CONFLICT DO NOTHING RETURNING semantics). Both
          // tests in this file start with no existing row, so the row is always freshly inserted here
          // and `.select()` always returns the one inserted row — never the empty/claimed-by-another
          // case, which is covered separately in tests/unit/b2b37-partner-session-insights-guard-and-backstop.test.ts.
          upsert: (row: Record<string, unknown>) => ({
            select: async (_cols?: string) => {
              upsertWrites.push(row)
              const sessionId = row.partner_session_id as string
              const alreadyExisted = !!insightsBySession[sessionId]
              if (!alreadyExisted) {
                insightsBySession[sessionId] = {
                  extraction_status: (row.extraction_status as FakeInsightsRow['extraction_status']) ?? 'pending',
                  attempt_count: 0,
                }
              }
              return { data: alreadyExisted ? [] : [{ extraction_status: 'pending' }], error: null }
            },
          }),
          update: (fields: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              updateWrites.push({ sessionId: val, fields })
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

import { extractInsightsForPartnerSession, PartnerInsightsExtractionSchema } from '@/inngest/partner-session-insights-extractor'

// ─── extractInsightsForPartnerSession — the empty-transcript → learner_insight: null case (§6.4) ──

describe('extractInsightsForPartnerSession — learner_insight resolution', () => {
  beforeEach(() => {
    partnerSessionsById = {}
    insightsBySession = {}
    updateWrites = []
    upsertWrites = []
    fetchAllTranscriptEventsMock.mockReset()
    recordInsightsReadyEventMock.mockReset()
  })

  it('§6.4: zero transcript lines → extraction_status "success_empty" and learner_insight written as null (not a fabricated object), without calling Claude', async () => {
    partnerSessionsById.ps1 = {
      id: 'ps1',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-1',
      test_mode: false,
      partner_reference: 'claude-ai',
      end_client_id: null,
    }
    fetchAllTranscriptEventsMock.mockResolvedValue([{ type: 'CHAT_METADATA' }]) // no USER_MESSAGE/AGENT_MESSAGE events

    const result = await extractInsightsForPartnerSession('ps1')

    expect(result).toEqual({ status: 'success_empty' })
    const lastWrite = updateWrites[updateWrites.length - 1]
    expect(lastWrite.fields.extraction_status).toBe('success_empty')
    expect(lastWrite.fields.learner_insight).toBeNull()
    expect(lastWrite.fields.action_items).toEqual([])
    expect(lastWrite.fields.glitches).toEqual([])
    // The old field must never be written by this path.
    expect(lastWrite.fields).not.toHaveProperty('psychology_keywords')
  })

  it('§6.3: real transcript content (mock Claude path) writes the full learner_insight object, not psychology_keywords', async () => {
    partnerSessionsById.ps2 = {
      id: 'ps2',
      partner_account_id: 'acct1',
      hume_chat_id: 'chat-2',
      test_mode: false,
      partner_reference: 'claude-ai',
      end_client_id: null,
    }
    fetchAllTranscriptEventsMock.mockResolvedValue([
      { type: 'USER_MESSAGE', message_text: 'What does pricing look like for a mid-size team?' },
      { type: 'AGENT_MESSAGE', message_text: 'Pricing scales with seats — happy to walk through tiers.' },
    ])

    const result = await extractInsightsForPartnerSession('ps2')

    expect(result.status).toBe('success') // mock extraction returns non-empty action_items/glitches
    const lastWrite = updateWrites[updateWrites.length - 1]
    expect(lastWrite.fields.learner_insight).toBeTruthy()
    const learnerInsight = lastWrite.fields.learner_insight as {
      summary: string
      topics_of_interest: string[]
      engagement_style: string
      suggested_next_topics: string[]
    }
    expect(typeof learnerInsight.summary).toBe('string')
    expect(learnerInsight.summary.length).toBeGreaterThan(0)
    expect(Array.isArray(learnerInsight.topics_of_interest)).toBe(true)
    expect(typeof learnerInsight.engagement_style).toBe('string')
    expect(Array.isArray(learnerInsight.suggested_next_topics)).toBe(true)
    expect(lastWrite.fields).not.toHaveProperty('psychology_keywords')
  })
})

// ─── PartnerInsightsExtractionSchema — AC (§ Success Criteria) schema validation gate ──────────────

describe('PartnerInsightsExtractionSchema — learner_insight shape (B2B-34 Piece 1)', () => {
  const validLearnerInsight = {
    summary: 'This person is weighing build-vs-buy and wants concrete cost comparisons.',
    topics_of_interest: ['pricing tiers', 'integration timeline'],
    engagement_style: 'Asks pointed, comparison-driven questions.',
    suggested_next_topics: ['ROI case study', 'implementation FAQ'],
  }

  it('accepts a well-formed response with action_items, glitches, and the full learner_insight shape', () => {
    const parsed = PartnerInsightsExtractionSchema.safeParse({
      action_items: [{ text: 'Follow up with legal by Monday.' }],
      glitches: [],
      learner_insight: validLearnerInsight,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects the old psychology_keywords shape (learner_insight is required and missing)', () => {
    const parsed = PartnerInsightsExtractionSchema.safeParse({
      action_items: [],
      glitches: [],
      psychology_keywords: ['hesitant', 'time-pressured'],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects learner_insight missing a required field (engagement_style)', () => {
    const parsed = PartnerInsightsExtractionSchema.safeParse({
      action_items: [],
      glitches: [],
      learner_insight: {
        summary: 'x',
        topics_of_interest: [],
        suggested_next_topics: [],
      },
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a learner_insight.topics_of_interest that is not an array of strings', () => {
    const parsed = PartnerInsightsExtractionSchema.safeParse({
      action_items: [],
      glitches: [],
      learner_insight: { ...validLearnerInsight, topics_of_interest: 'pricing tiers' },
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an empty-string summary (min(1) constraint)', () => {
    const parsed = PartnerInsightsExtractionSchema.safeParse({
      action_items: [],
      glitches: [],
      learner_insight: { ...validLearnerInsight, summary: '' },
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts empty topics_of_interest/suggested_next_topics arrays (valid, expected when nothing applies)', () => {
    const parsed = PartnerInsightsExtractionSchema.safeParse({
      action_items: [],
      glitches: [],
      learner_insight: { ...validLearnerInsight, topics_of_interest: [], suggested_next_topics: [] },
    })
    expect(parsed.success).toBe(true)
  })
})
