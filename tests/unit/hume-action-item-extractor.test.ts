import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * HUME-NATIVE-02 Part B — coverage for the shared, idempotent
 * extractActionItemsForSession() core and formatTranscriptLines(). Mirrors
 * this codebase's established testing boundary for Inngest cron/event
 * functions (see tests/unit/rtv03-tracker.test.ts's own comment): the
 * business logic is unit tested directly; the real Inngest step/cron
 * plumbing (humeActionItemExtractor / humeActionItemBackstopSweep) is a
 * manual/QA acceptance test, not simulated here.
 *
 * ANTHROPIC_API_KEY is pinned to a placeholder BEFORE the module under test
 * is imported, since isPlaceholder/anthropic are computed once at module
 * load — this makes every test deterministic regardless of what's in the
 * ambient shell environment, and exercises the mock-guard path (mirroring
 * lib/templates/generator.ts's own convention) rather than attempting a real
 * network call from a unit test.
 */
process.env.ANTHROPIC_API_KEY = 'PLACEHOLDER_TEST_KEY'

// ─── Mock state ──────────────────────────────────────────────────────────

interface FakeSession {
  id: string
  user_id: string
  hume_chat_id: string | null
}

interface FakeActionItemRow {
  extraction_status: 'pending' | 'success' | 'success_empty' | 'failed'
  attempt_count: number
}

let sessionsById: Record<string, FakeSession | undefined> = {}
let actionItemsBySession: Record<string, FakeActionItemRow | undefined> = {}
let updateWrites: Array<{ sessionId: string; fields: Record<string, unknown> }> = []
let upsertWrites: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'sessions') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: sessionsById[val] ?? null, error: null }),
            }),
          }),
        }
      }

      if (table === 'session_action_items') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: actionItemsBySession[val] ?? null, error: null }),
            }),
          }),
          upsert: async (row: Record<string, unknown>) => {
            upsertWrites.push(row)
            const sessionId = row.session_id as string
            if (!actionItemsBySession[sessionId]) {
              actionItemsBySession[sessionId] = {
                extraction_status: (row.extraction_status as FakeActionItemRow['extraction_status']) ?? 'pending',
                attempt_count: (row.attempt_count as number) ?? 0,
              }
            }
            return { error: null }
          },
          update: (fields: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              updateWrites.push({ sessionId: val, fields })
              const prior = actionItemsBySession[val] ?? { extraction_status: 'pending', attempt_count: 0 }
              actionItemsBySession[val] = {
                extraction_status: (fields.extraction_status as FakeActionItemRow['extraction_status']) ?? prior.extraction_status,
                attempt_count: (fields.attempt_count as number) ?? prior.attempt_count,
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

const getHumeSessionDetailsMock = vi.fn()
vi.mock('@/lib/voice/hume-native/session-details', () => ({
  getHumeSessionDetails: (...args: unknown[]) => getHumeSessionDetailsMock(...args),
}))

import { extractActionItemsForSession, formatTranscriptLines, ExtractionSchema } from '@/inngest/hume-action-item-extractor'

// ─── formatTranscriptLines ───────────────────────────────────────────────

describe('formatTranscriptLines', () => {
  it('filters to USER_MESSAGE/AGENT_MESSAGE and formats as User:/Clio: lines, in order', () => {
    const events = [
      { type: 'USER_MESSAGE', message_text: 'Hello Clio' },
      { type: 'AGENT_MESSAGE', message_text: 'Hi there' },
      { type: 'TOOL_CALL', message_text: 'should be ignored' },
    ]
    expect(formatTranscriptLines(events)).toEqual(['User: Hello Clio', 'Clio: Hi there'])
  })

  it('falls back to message.content and text fields when message_text is absent', () => {
    const events = [
      { type: 'USER_MESSAGE', message: { content: 'via message.content' } },
      { type: 'AGENT_MESSAGE', text: 'via text field' },
    ]
    expect(formatTranscriptLines(events)).toEqual(['User: via message.content', 'Clio: via text field'])
  })

  it('skips message-type events with blank/unresolvable text', () => {
    const events = [
      { type: 'USER_MESSAGE', message_text: '   ' },
      { type: 'AGENT_MESSAGE' },
    ]
    expect(formatTranscriptLines(events)).toEqual([])
  })

  it('returns [] for empty or malformed input without throwing', () => {
    expect(formatTranscriptLines([])).toEqual([])
    expect(formatTranscriptLines([null, 42, {}] as unknown[])).toEqual([])
  })
})

// ─── extractActionItemsForSession ────────────────────────────────────────

describe('extractActionItemsForSession', () => {
  beforeEach(() => {
    sessionsById = {}
    actionItemsBySession = {}
    updateWrites = []
    upsertWrites = []
    getHumeSessionDetailsMock.mockReset()
  })

  it('AC3: reaches a terminal "success" status when the transcript has a clear commitment (mock extraction path, ANTHROPIC_API_KEY pinned to a placeholder)', async () => {
    sessionsById.s1 = { id: 's1', user_id: 'u1', hume_chat_id: 'chat-1' }
    getHumeSessionDetailsMock.mockResolvedValue({
      sessionId: 's1',
      source: 'live',
      configSnapshot: {},
      transcriptEvents: [
        { type: 'USER_MESSAGE', message_text: "I'll review the vendor's SOC 2 report before Friday." },
        { type: 'AGENT_MESSAGE', message_text: 'Great, sounds like a solid plan.' },
      ],
      humeConfigId: 'cfg1',
      humeChatId: 'chat-1',
      archivedAt: null,
    })

    const result = await extractActionItemsForSession('s1')

    expect(result.status).toBe('success')
    expect(actionItemsBySession.s1?.extraction_status).toBe('success')

    const lastWrite = updateWrites[updateWrites.length - 1]
    expect(lastWrite.fields.action_items).toBeInstanceOf(Array)
    expect((lastWrite.fields.action_items as unknown[]).length).toBeGreaterThan(0)
    // Mock-data marker must be present so this is never confused with a real result (spec Section 8).
    expect(lastWrite.fields.error_message).toContain('[MOCK]')
    expect(lastWrite.fields.transcript_event_count).toBe(2)
  })

  it('AC4: writes "success_empty" (not "failed") for a transcript with no USER_MESSAGE/AGENT_MESSAGE events, without calling Claude', async () => {
    sessionsById.s2 = { id: 's2', user_id: 'u2', hume_chat_id: 'chat-2' }
    getHumeSessionDetailsMock.mockResolvedValue({
      sessionId: 's2',
      source: 'live',
      configSnapshot: {},
      transcriptEvents: [{ type: 'CHAT_METADATA' }],
      humeConfigId: 'cfg2',
      humeChatId: 'chat-2',
      archivedAt: null,
    })

    const result = await extractActionItemsForSession('s2')

    expect(result).toEqual({ status: 'success_empty' })
    expect(actionItemsBySession.s2?.extraction_status).toBe('success_empty')
    const lastWrite = updateWrites[updateWrites.length - 1]
    expect(lastWrite.fields.action_items).toEqual([])
    expect(lastWrite.fields.glitches).toEqual([])
  })

  it('AC5: throws (does not write a terminal status) when the transcript is not yet available, so the caller can retry', async () => {
    sessionsById.s3 = { id: 's3', user_id: 'u3', hume_chat_id: 'chat-3' }
    getHumeSessionDetailsMock.mockResolvedValue({
      sessionId: 's3',
      source: 'live',
      configSnapshot: {},
      transcriptEvents: [],
      humeConfigId: 'cfg3',
      humeChatId: 'chat-3',
      archivedAt: null,
      transcriptFetchError: 'not yet available',
    })

    await expect(extractActionItemsForSession('s3')).rejects.toThrow(/Transcript fetch failed/)
    // Left as 'pending' (from the idempotency guard's insert) — no terminal write on this throw.
    expect(actionItemsBySession.s3?.extraction_status).toBe('pending')
    expect(updateWrites).toHaveLength(0)
  })

  it('AC6a: idempotency guard no-ops (no Hume call) once extraction already reached "success"', async () => {
    sessionsById.s4 = { id: 's4', user_id: 'u4', hume_chat_id: 'chat-4' }
    actionItemsBySession.s4 = { extraction_status: 'success', attempt_count: 1 }

    const result = await extractActionItemsForSession('s4')

    expect(result).toEqual({ status: 'already_terminal', priorStatus: 'success' })
    expect(getHumeSessionDetailsMock).not.toHaveBeenCalled()
  })

  it('AC6b: idempotency guard no-ops once a failed extraction has hit the 3-attempt ceiling', async () => {
    sessionsById.s5 = { id: 's5', user_id: 'u5', hume_chat_id: 'chat-5' }
    actionItemsBySession.s5 = { extraction_status: 'failed', attempt_count: 3 }

    const result = await extractActionItemsForSession('s5')

    expect(result).toEqual({ status: 'already_terminal', priorStatus: 'failed' })
    expect(getHumeSessionDetailsMock).not.toHaveBeenCalled()
  })

  it('retries (proceeds) when a prior failed attempt still has attempts remaining', async () => {
    sessionsById.s6 = { id: 's6', user_id: 'u6', hume_chat_id: 'chat-6' }
    actionItemsBySession.s6 = { extraction_status: 'failed', attempt_count: 1 }
    getHumeSessionDetailsMock.mockResolvedValue({
      sessionId: 's6',
      source: 'live',
      configSnapshot: {},
      transcriptEvents: [],
      humeConfigId: 'cfg6',
      humeChatId: 'chat-6',
      archivedAt: null,
    })

    const result = await extractActionItemsForSession('s6')

    expect(result).toEqual({ status: 'success_empty' })
    expect(getHumeSessionDetailsMock).toHaveBeenCalledTimes(1)
  })

  it('throws a clear error when the session itself cannot be resolved', async () => {
    await expect(extractActionItemsForSession('missing-session')).rejects.toThrow(/No session found/)
  })

})

// ─── ExtractionSchema (AC7 — schema-invalid Claude output must be rejected) ──
// callClaudeForExtraction() itself isn't exported (its real-call branch needs
// the module-level ANTHROPIC_API_KEY pinned at import time, so it can't be
// toggled per-test) — but its Zod validation gate is the exact mechanism
// spec Section 4 step 5 relies on to guarantee "no malformed action_items/
// glitches data is ever written." Testing the schema directly covers that
// gate precisely.
describe('ExtractionSchema — AC7 schema validation gate', () => {
  it('accepts a well-formed response with both arrays populated', () => {
    const parsed = ExtractionSchema.safeParse({
      action_items: [{ text: 'Follow up with legal by Monday.' }],
      glitches: [{ type: 'repetition', description: 'Clio repeated the pricing explanation twice.' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts both arrays empty (the valid success_empty-triggering shape)', () => {
    const parsed = ExtractionSchema.safeParse({ action_items: [], glitches: [] })
    expect(parsed.success).toBe(true)
  })

  it('rejects a glitch with an unrecognized type', () => {
    const parsed = ExtractionSchema.safeParse({
      action_items: [],
      glitches: [{ type: 'not_a_real_type', description: 'x' }],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a response missing the glitches array entirely', () => {
    const parsed = ExtractionSchema.safeParse({ action_items: [] })
    expect(parsed.success).toBe(false)
  })

  it('rejects an action item with a non-string text field', () => {
    const parsed = ExtractionSchema.safeParse({
      action_items: [{ text: 12345 }],
      glitches: [],
    })
    expect(parsed.success).toBe(false)
  })
})
