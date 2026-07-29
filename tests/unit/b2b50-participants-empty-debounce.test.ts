import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-50 (docs/specs/B2B-50-requirement-document.md §6.7, §13.4) — covers AT-9, AT-10, AT-11 for
 * `partnerParticipantsEmptyDebounce` (inngest/partner-participants-empty-debounce.ts). Drives the
 * raw handler via the InngestFunction instance's `.fn` property with a fake `step` (`run` executes
 * immediately, `sleep` resolves immediately) — the same technique
 * tests/unit/b2b37-partner-session-ended-emission.test.ts already uses for the two cutoff jobs.
 */

function fakeStep() {
  return {
    run: async <T>(_id: string, fn: () => Promise<T> | T) => fn(),
    sleep: async (_id: string, _duration: string) => {},
  }
}

const CLIO_SESSION_REF = 'session-empty-1'
const PARTNER_ACCOUNT_ID = 'acct-1'

describe('partnerParticipantsEmptyDebounce (B2B-50 AT-9/AT-10/AT-11)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('AT-9: still empty and non-terminal after the debounce — calls handleSessionEnd with wall_clock_fallback/all_participants_left', async () => {
    const handleSessionEndMock = vi.fn(async () => {})
    const joinedAt = new Date(Date.now() - 5 * 60_000).toISOString()
    vi.doMock('@/lib/partner/live-render', () => ({ handleSessionEnd: handleSessionEndMock }))
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  status: 'bot_active',
                  active_participant_count: 0,
                  provider_bot_id: 'bot-1',
                  test_mode: false,
                  attendee_joined_at: joinedAt,
                  updated_at: joinedAt,
                },
              }),
            }),
          }),
        }),
      }),
    }))

    const { partnerParticipantsEmptyDebounce } = await import('@/inngest/partner-participants-empty-debounce')
    const handler = (partnerParticipantsEmptyDebounce as unknown as { fn: (args: unknown) => Promise<unknown> }).fn

    await handler({
      event: { data: { clioSessionRef: CLIO_SESSION_REF, partnerAccountId: PARTNER_ACCOUNT_ID } },
      step: fakeStep(),
    })

    expect(handleSessionEndMock).toHaveBeenCalledWith(
      CLIO_SESSION_REF,
      PARTNER_ACCOUNT_ID,
      expect.any(Number),
      false,
      'bot-1',
      'completed',
      'wall_clock_fallback',
      'all_participants_left',
    )
  })

  it('AT-10: a participant rejoined before the debounce elapsed — no-ops, handleSessionEnd never called', async () => {
    const handleSessionEndMock = vi.fn(async () => {})
    vi.doMock('@/lib/partner/live-render', () => ({ handleSessionEnd: handleSessionEndMock }))
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  status: 'bot_active',
                  active_participant_count: 1, // rejoined
                  provider_bot_id: 'bot-1',
                  test_mode: false,
                  attendee_joined_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              }),
            }),
          }),
        }),
      }),
    }))

    const { partnerParticipantsEmptyDebounce } = await import('@/inngest/partner-participants-empty-debounce')
    const handler = (partnerParticipantsEmptyDebounce as unknown as { fn: (args: unknown) => Promise<unknown> }).fn

    await handler({
      event: { data: { clioSessionRef: CLIO_SESSION_REF, partnerAccountId: PARTNER_ACCOUNT_ID } },
      step: fakeStep(),
    })

    expect(handleSessionEndMock).not.toHaveBeenCalled()
  })

  it('AT-11: the session already ended some other way (status completed) — no-ops, handleSessionEnd never called', async () => {
    const handleSessionEndMock = vi.fn(async () => {})
    vi.doMock('@/lib/partner/live-render', () => ({ handleSessionEnd: handleSessionEndMock }))
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  status: 'completed',
                  active_participant_count: 0,
                  provider_bot_id: 'bot-1',
                  test_mode: false,
                  attendee_joined_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              }),
            }),
          }),
        }),
      }),
    }))

    const { partnerParticipantsEmptyDebounce } = await import('@/inngest/partner-participants-empty-debounce')
    const handler = (partnerParticipantsEmptyDebounce as unknown as { fn: (args: unknown) => Promise<unknown> }).fn

    await handler({
      event: { data: { clioSessionRef: CLIO_SESSION_REF, partnerAccountId: PARTNER_ACCOUNT_ID } },
      step: fakeStep(),
    })

    expect(handleSessionEndMock).not.toHaveBeenCalled()
  })

  it('AT-11 (session row not found): defensive no-op, never throws', async () => {
    const handleSessionEndMock = vi.fn(async () => {})
    vi.doMock('@/lib/partner/live-render', () => ({ handleSessionEnd: handleSessionEndMock }))
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        }),
      }),
    }))

    const { partnerParticipantsEmptyDebounce } = await import('@/inngest/partner-participants-empty-debounce')
    const handler = (partnerParticipantsEmptyDebounce as unknown as { fn: (args: unknown) => Promise<unknown> }).fn

    await expect(handler({
      event: { data: { clioSessionRef: CLIO_SESSION_REF, partnerAccountId: PARTNER_ACCOUNT_ID } },
      step: fakeStep(),
    })).resolves.toBeUndefined()

    expect(handleSessionEndMock).not.toHaveBeenCalled()
  })
})
