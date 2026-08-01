import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

/**
 * B2B-64 (docs/specs/B2B-64-requirement-document.md §7/§12) — Option 2 session-creation guard.
 * `isTemplateModeEnabled()` is tested directly (pure, env-var-based). The route's new branch is
 * tested by mocking auth + Supabase just enough to prove the guard rejects BEFORE any database
 * call is ever made for a disabled-guard Option-2 request (i.e. genuinely "no row created, no
 * cost incurred"), and that it does NOT short-circuit Option-1 requests or a guard explicitly
 * re-enabled — without needing to mock the full downstream dispatch/billing flow, which predates
 * and is unmodified by this change.
 */

describe('isTemplateModeEnabled', () => {
  const ORIGINAL = process.env.TEMPLATE_MODE_SESSIONS_ENABLED
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.TEMPLATE_MODE_SESSIONS_ENABLED
    else process.env.TEMPLATE_MODE_SESSIONS_ENABLED = ORIGINAL
  })

  it('defaults to false (disabled) when unset', async () => {
    delete process.env.TEMPLATE_MODE_SESSIONS_ENABLED
    vi.resetModules()
    const { isTemplateModeEnabled } = await import('@/lib/partner/session-schema')
    expect(isTemplateModeEnabled()).toBe(false)
  })

  it('is true only for the exact string "true"', async () => {
    process.env.TEMPLATE_MODE_SESSIONS_ENABLED = 'true'
    vi.resetModules()
    const { isTemplateModeEnabled } = await import('@/lib/partner/session-schema')
    expect(isTemplateModeEnabled()).toBe(true)
  })

  it.each(['TRUE', '1', 'yes', '', 'True', 'false'])('treats %j as disabled (strict equality, no truthy-string leniency)', async (value) => {
    process.env.TEMPLATE_MODE_SESSIONS_ENABLED = value
    vi.resetModules()
    const { isTemplateModeEnabled } = await import('@/lib/partner/session-schema')
    expect(isTemplateModeEnabled()).toBe(false)
  })
})

describe('CreateSessionSchema — dual-mode request (both content_pages and partner_topic_ref) fails Zod refine before the new guard is ever reached', () => {
  it('rejects at the schema layer with the generic Validation-failed shape, independent of the guard', async () => {
    const { CreateSessionSchema } = await import('@/lib/partner/session-schema')
    const result = CreateSessionSchema.safeParse({
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      reseller_id: '22222222-2222-2222-2222-222222222222',
      end_user_name: 'Jordan Lee',
      partner_topic_ref: 'onboarding-101',
      content_pages: [{ url: 'https://x.example.com/1.html', media_type: 'html', transition_trigger: 'after page one' }],
      content_source_id: '11111111-1111-1111-1111-111111111111',
    })
    expect(result.success).toBe(false)
  })
})

describe('POST /api/partner/v1/sessions — B2B-64 guard placement', () => {
  const insertMock = vi.fn()
  const fromMock = vi.fn(() => ({
    insert: insertMock,
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
  }))

  beforeEach(() => {
    vi.resetModules()
    insertMock.mockReset()
    insertMock.mockReturnValue({
      select: () => ({ single: async () => ({ data: null, error: { code: 'MOCK_NOT_IMPLEMENTED', message: 'mock insert not implemented beyond guard-placement scope' } }) }),
    })
    fromMock.mockClear()
    vi.doMock('@/lib/partner/auth', () => ({
      requirePartnerApiKey: async () => ({
        error: null,
        partnerAccountId: '22222222-2222-2222-2222-222222222222',
        apiKeyId: 'key-1',
        clientId: null,
        mode: 'test',
        accountKind: 'partner',
      }),
    }))
    vi.doMock('@/lib/supabase', () => ({
      createSupabaseAdminClient: () => ({ from: fromMock }),
    }))
    vi.doMock('@/lib/partner/session-init', () => ({ dispatchMeetingBot: vi.fn() }))
    vi.doMock('@/lib/partner/webhooks', () => ({ resolveEffectiveRate: vi.fn() }))
    vi.doMock('@/lib/partner/content-sources', () => ({ getContentSource: vi.fn() }))
    vi.doMock('@/lib/partner/ssrf', () => ({ assertUrlSafe: vi.fn() }))
    vi.doMock('@/inngest/client', () => ({ inngest: { send: vi.fn() } }))
  })

  function makeRequest(body: unknown) {
    return { json: async () => body } as unknown as Parameters<
      typeof import('@/app/api/partner/v1/sessions/route').POST
    >[0]
  }

  it('guard disabled + Option 2 (partner_topic_ref) request -> 422 content_reference_not_supported, zero database calls (no row created, no cost)', async () => {
    delete process.env.TEMPLATE_MODE_SESSIONS_ENABLED
    const { POST } = await import('@/app/api/partner/v1/sessions/route')

    const res = await POST(
      makeRequest({
        meeting_url: 'https://meet.google.com/abc-defg-hij',
        reseller_id: '22222222-2222-2222-2222-222222222222',
        end_user_name: 'Jordan Lee',
        partner_topic_ref: 'onboarding-101',
      })
    )

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toEqual({
      error: {
        code: 'content_reference_not_supported',
        message: expect.stringContaining('Use inline content (content_pages) instead'),
      },
    })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('guard disabled + Option 2 (content_ref) request -> same 422 content_reference_not_supported', async () => {
    delete process.env.TEMPLATE_MODE_SESSIONS_ENABLED
    const { POST } = await import('@/app/api/partner/v1/sessions/route')

    const res = await POST(
      makeRequest({
        meeting_url: 'https://meet.google.com/abc-defg-hij',
        reseller_id: '22222222-2222-2222-2222-222222222222',
        end_user_name: 'Jordan Lee',
        content_ref: '33333333-3333-3333-3333-333333333333',
      })
    )

    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('content_reference_not_supported')
  })

  it('guard explicitly re-enabled (true) + Option 2 request -> falls through past the guard (does not return content_reference_not_supported)', async () => {
    // Asserts the guard itself doesn't fire, not that the entire unrelated downstream
    // billing/dispatch pipeline succeeds (that pipeline predates and is unmodified by this
    // change) — a fuller success-path integration test would need a much larger mock surface
    // for no additional coverage of what this spec actually changed.
    process.env.TEMPLATE_MODE_SESSIONS_ENABLED = 'true'
    const { POST } = await import('@/app/api/partner/v1/sessions/route')

    const res = await POST(
      makeRequest({
        meeting_url: 'https://meet.google.com/abc-defg-hij',
        reseller_id: '22222222-2222-2222-2222-222222222222',
        end_user_name: 'Jordan Lee',
        partner_topic_ref: 'onboarding-101',
      })
    )

    const body = await res.json().catch(() => null)
    expect(body?.error?.code).not.toBe('content_reference_not_supported')
    expect(fromMock).toHaveBeenCalled() // reached the database layer — proceeded past the guard
    delete process.env.TEMPLATE_MODE_SESSIONS_ENABLED
  })

  it('guard disabled + Option 1 (inline, content_pages) request -> unaffected (never returns content_reference_not_supported)', async () => {
    delete process.env.TEMPLATE_MODE_SESSIONS_ENABLED
    const { POST } = await import('@/app/api/partner/v1/sessions/route')

    const res = await POST(
      makeRequest({
        meeting_url: 'https://meet.google.com/abc-defg-hij',
        reseller_id: '22222222-2222-2222-2222-222222222222',
        end_user_name: 'Jordan Lee',
        content_pages: [{ url: 'https://x.example.com/1.html', media_type: 'html', transition_trigger: 'after page one' }],
        content_source_id: '11111111-1111-1111-1111-111111111111',
      })
    )

    const body = await res.json().catch(() => null)
    // isInline is true, so the B2B-64 guard's condition (!isInline && ...) is false by
    // construction — confirmed here without needing the full content-source/SSRF pipeline
    // (mocked minimally above) to resolve to a real success.
    expect(body?.error?.code).not.toBe('content_reference_not_supported')
  })

  it('dual-mode request (both content_pages and partner_topic_ref) -> the pre-existing generic Zod-validation 422, not content_reference_not_supported', async () => {
    delete process.env.TEMPLATE_MODE_SESSIONS_ENABLED
    const { POST } = await import('@/app/api/partner/v1/sessions/route')

    const res = await POST(
      makeRequest({
        meeting_url: 'https://meet.google.com/abc-defg-hij',
        reseller_id: '22222222-2222-2222-2222-222222222222',
        end_user_name: 'Jordan Lee',
        partner_topic_ref: 'onboarding-101',
        content_pages: [{ url: 'https://x.example.com/1.html', media_type: 'html', transition_trigger: 'after page one' }],
        content_source_id: '11111111-1111-1111-1111-111111111111',
      })
    )

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
    expect(fromMock).not.toHaveBeenCalled()
  })
})
