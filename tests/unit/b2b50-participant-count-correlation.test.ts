import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-50 (docs/specs/B2B-50-requirement-document.md §6.4-6.7, §13.3) — covers AT-6, AT-7, AT-8,
 * AT-12: the `participant_events.join_leave` branch inside `handlePartnerSessionEvent()`
 * (app/api/attendee/webhook/route.ts). Drives the route's exported `POST` handler directly — the
 * only exported symbol — since `handlePartnerSessionEvent` itself is not exported (first dedicated
 * test file for this route, per the requirement doc's own note that none existed before this brief).
 *
 * All external calls (Supabase, Inngest) are mocked — no real network calls. The webhook's signature
 * check is skipped automatically in these tests since ATTENDEE_WEBHOOK_SECRET is unset in the test
 * env (the route's own documented MOCK/soft-verify behavior).
 */

function webhookRequest(body: unknown) {
  return new NextRequest('https://test.hello-clio.com/api/attendee/webhook', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const PARTNER_SESSION_ID = '11111111-1111-1111-1111-111111111111'
const PARTNER_ACCOUNT_ID = 'acct-1'

function joinLeaveEvent(eventType: string, participantName: string) {
  return {
    idempotency_key: 'idem-1',
    bot_id: 'bot-1',
    bot_metadata: { user_id: PARTNER_SESSION_ID },
    trigger: 'participant_events.join_leave',
    data: { event_type: eventType, participant_name: participantName },
  }
}

function baseSupabaseMock(opts: {
  partnerSessionRow: Record<string, unknown> | null
  rpcImpl: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  updateSpy?: (payload: Record<string, unknown>) => void
}) {
  return {
    createSupabaseAdminClient: () => ({
      from: (table: string) => {
        if (table === 'walkthrough_state') {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }
        }
        if (table === 'partner_sessions') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.partnerSessionRow }) }) }),
            update: (payload: Record<string, unknown>) => {
              opts.updateSpy?.(payload)
              return { eq: async () => ({ error: null }) }
            },
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
      rpc: opts.rpcImpl,
    }),
  }
}

describe('participant_events.join_leave — active_participant_count correlation (B2B-50 AT-6/7/8/12)', () => {
  const sendMock = vi.fn(async (..._args: unknown[]) => Promise.resolve())

  beforeEach(() => {
    vi.resetModules()
    sendMock.mockClear()
    delete process.env.ATTENDEE_WEBHOOK_SECRET
  })

  it('AT-6: participant_joined + non-bot name increments active_participant_count via the RPC', async () => {
    const rpcImpl = vi.fn(async (name: string) => {
      if (name === 'increment_active_participant_count') {
        return { data: { active_participant_count: 1 }, error: null }
      }
      return { data: null, error: null }
    })
    vi.doMock('@/lib/supabase', () => baseSupabaseMock({
      partnerSessionRow: {
        id: PARTNER_SESSION_ID, partner_account_id: PARTNER_ACCOUNT_ID, status: 'bot_active',
        test_mode: false, updated_at: new Date().toISOString(), attendee_joined_at: null, provider_bot_id: 'bot-1',
      },
      rpcImpl,
    }))
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/partner/theme', () => ({ getThemeConfig: vi.fn(async () => ({ assistantDisplayName: 'Clio' })) }))
    vi.doMock('@/lib/session-ai', () => ({ analyzeTranscription: vi.fn() }))
    vi.doMock('@/lib/user-context', () => ({ getOrCreateContext: vi.fn(), updateSentiment: vi.fn(), addUnresolvedQuestion: vi.fn() }))

    const { POST } = await import('@/app/api/attendee/webhook/route')
    await POST(webhookRequest(joinLeaveEvent('participant_joined', 'Jane Doe')))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpcImpl).toHaveBeenCalledWith('increment_active_participant_count', { p_session_id: PARTNER_SESSION_ID })
  })

  it('AT-7: a non-participant_joined event decrements active_participant_count by exactly 1 via the RPC', async () => {
    const rpcImpl = vi.fn(async (name: string) => {
      if (name === 'decrement_active_participant_count') {
        return { data: { active_participant_count: 1 }, error: null }
      }
      return { data: null, error: null }
    })
    vi.doMock('@/lib/supabase', () => baseSupabaseMock({
      partnerSessionRow: {
        id: PARTNER_SESSION_ID, partner_account_id: PARTNER_ACCOUNT_ID, status: 'bot_active',
        test_mode: false, updated_at: new Date().toISOString(), attendee_joined_at: null, provider_bot_id: 'bot-1',
      },
      rpcImpl,
    }))
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/partner/theme', () => ({ getThemeConfig: vi.fn(async () => ({ assistantDisplayName: 'Clio' })) }))
    vi.doMock('@/lib/session-ai', () => ({ analyzeTranscription: vi.fn() }))
    vi.doMock('@/lib/user-context', () => ({ getOrCreateContext: vi.fn(), updateSentiment: vi.fn(), addUnresolvedQuestion: vi.fn() }))

    const { POST } = await import('@/app/api/attendee/webhook/route')
    await POST(webhookRequest(joinLeaveEvent('participant_left', 'Jane Doe')))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpcImpl).toHaveBeenCalledWith('decrement_active_participant_count', { p_session_id: PARTNER_SESSION_ID })
  })

  it('AT-8: decrement reaching 0 on a non-terminal session emits exactly one clio/partner-session.participants-empty event', async () => {
    const rpcImpl = vi.fn(async (name: string) => {
      if (name === 'decrement_active_participant_count') {
        return { data: { active_participant_count: 0 }, error: null }
      }
      return { data: null, error: null }
    })
    vi.doMock('@/lib/supabase', () => baseSupabaseMock({
      partnerSessionRow: {
        id: PARTNER_SESSION_ID, partner_account_id: PARTNER_ACCOUNT_ID, status: 'bot_active',
        test_mode: false, updated_at: new Date().toISOString(), attendee_joined_at: null, provider_bot_id: 'bot-1',
      },
      rpcImpl,
    }))
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/partner/theme', () => ({ getThemeConfig: vi.fn(async () => ({ assistantDisplayName: 'Clio' })) }))
    vi.doMock('@/lib/session-ai', () => ({ analyzeTranscription: vi.fn() }))
    vi.doMock('@/lib/user-context', () => ({ getOrCreateContext: vi.fn(), updateSentiment: vi.fn(), addUnresolvedQuestion: vi.fn() }))

    const { POST } = await import('@/app/api/attendee/webhook/route')
    await POST(webhookRequest(joinLeaveEvent('participant_left', 'Jane Doe')))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const emptyEventCalls = sendMock.mock.calls.filter((c) => (c[0] as { name: string }).name === 'clio/partner-session.participants-empty')
    expect(emptyEventCalls).toHaveLength(1)
    expect(emptyEventCalls[0][0]).toEqual({
      name: 'clio/partner-session.participants-empty',
      data: { clioSessionRef: PARTNER_SESSION_ID, partnerAccountId: PARTNER_ACCOUNT_ID },
    })
  })

  it('AT-8 (negative): decrement NOT reaching 0 never emits the participants-empty event', async () => {
    const rpcImpl = vi.fn(async (name: string) => {
      if (name === 'decrement_active_participant_count') {
        return { data: { active_participant_count: 1 }, error: null }
      }
      return { data: null, error: null }
    })
    vi.doMock('@/lib/supabase', () => baseSupabaseMock({
      partnerSessionRow: {
        id: PARTNER_SESSION_ID, partner_account_id: PARTNER_ACCOUNT_ID, status: 'bot_active',
        test_mode: false, updated_at: new Date().toISOString(), attendee_joined_at: null, provider_bot_id: 'bot-1',
      },
      rpcImpl,
    }))
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/partner/theme', () => ({ getThemeConfig: vi.fn(async () => ({ assistantDisplayName: 'Clio' })) }))
    vi.doMock('@/lib/session-ai', () => ({ analyzeTranscription: vi.fn() }))
    vi.doMock('@/lib/user-context', () => ({ getOrCreateContext: vi.fn(), updateSentiment: vi.fn(), addUnresolvedQuestion: vi.fn() }))

    const { POST } = await import('@/app/api/attendee/webhook/route')
    await POST(webhookRequest(joinLeaveEvent('participant_left', 'Jane Doe')))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const emptyEventCalls = sendMock.mock.calls.filter((c) => (c[0] as { name: string }).name === 'clio/partner-session.participants-empty')
    expect(emptyEventCalls).toHaveLength(0)
  })

  it('AT-12: a participant_name matching the configured assistantDisplayName is never counted (join branch — no increment RPC call)', async () => {
    const rpcImpl = vi.fn(async () => ({ data: null, error: null }))
    vi.doMock('@/lib/supabase', () => baseSupabaseMock({
      partnerSessionRow: {
        id: PARTNER_SESSION_ID, partner_account_id: PARTNER_ACCOUNT_ID, status: 'bot_active',
        test_mode: false, updated_at: new Date().toISOString(), attendee_joined_at: null, provider_bot_id: 'bot-1',
      },
      rpcImpl,
    }))
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/partner/theme', () => ({ getThemeConfig: vi.fn(async () => ({ assistantDisplayName: 'Ava' })) }))
    vi.doMock('@/lib/session-ai', () => ({ analyzeTranscription: vi.fn() }))
    vi.doMock('@/lib/user-context', () => ({ getOrCreateContext: vi.fn(), updateSentiment: vi.fn(), addUnresolvedQuestion: vi.fn() }))

    const { POST } = await import('@/app/api/attendee/webhook/route')
    await POST(webhookRequest(joinLeaveEvent('participant_joined', 'Ava')))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpcImpl).not.toHaveBeenCalledWith('increment_active_participant_count', expect.anything())
  })

  it('AT-12: a participant_name matching the configured assistantDisplayName is never counted (inferred-leave branch — no decrement RPC call)', async () => {
    const rpcImpl = vi.fn(async () => ({ data: null, error: null }))
    vi.doMock('@/lib/supabase', () => baseSupabaseMock({
      partnerSessionRow: {
        id: PARTNER_SESSION_ID, partner_account_id: PARTNER_ACCOUNT_ID, status: 'bot_active',
        test_mode: false, updated_at: new Date().toISOString(), attendee_joined_at: null, provider_bot_id: 'bot-1',
      },
      rpcImpl,
    }))
    vi.doMock('@/inngest/client', () => ({ inngest: { send: sendMock } }))
    vi.doMock('@/lib/partner/theme', () => ({ getThemeConfig: vi.fn(async () => ({ assistantDisplayName: 'Ava' })) }))
    vi.doMock('@/lib/session-ai', () => ({ analyzeTranscription: vi.fn() }))
    vi.doMock('@/lib/user-context', () => ({ getOrCreateContext: vi.fn(), updateSentiment: vi.fn(), addUnresolvedQuestion: vi.fn() }))

    const { POST } = await import('@/app/api/attendee/webhook/route')
    await POST(webhookRequest(joinLeaveEvent('participant_left', 'Ava')))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpcImpl).not.toHaveBeenCalledWith('decrement_active_participant_count', expect.anything())
  })
})
