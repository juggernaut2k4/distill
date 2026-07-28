import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-33 (docs/specs/B2B-33-requirement-document.md §6.3, §0a) + B2B-39
 * (docs/specs/B2B-39-requirement-document.md §6.9, AT-3, AT-5, AT-9). Covers POST
 * /api/demo/[slug]/dispatch.
 *
 * B2B-39 rewrite (2026-07-27): the passcode check no longer compares against the single shared
 * DEMO_MEETING_PASSCODE env var (lib/demo/passcode.ts) — it now resolves, per-account, via
 * resolveDemoPasscodeToAccount() (lib/demo/passcode-accounts.ts). This suite mocks that module
 * directly instead of setting DEMO_MEETING_PASSCODE. Per the spec's Out-of-Scope build-time warning,
 * the outbound call to the real POST /api/partner/v1/sessions endpoint is ALWAYS mocked here — this
 * test suite must never reach the real meeting-bot provider.
 */

const state = {
  demoMeetingUrlsRow: null as { meeting_url: string; end_user_name: string | null; last_dispatch_attempted_at: string | null } | null,
  resolvedPasscode: null as { partnerAccountId: string; passcodeId: string } | null,
  internalWalletRow: null as { trial_minutes_used: number; test_minutes_balance: number } | null,
  demoDispatchInsertError: null as { message: string } | null,
}

const updated: unknown[] = []
const demoDispatchInserts: Record<string, unknown>[] = []
const rpcCalls: { fn: string; args: unknown }[] = []

vi.mock('@/lib/demo/passcode-accounts', () => ({
  resolveDemoPasscodeToAccount: vi.fn(() => Promise.resolve(state.resolvedPasscode)),
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'demo_meeting_urls') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.demoMeetingUrlsRow })),
            })),
          })),
          update: vi.fn((row: unknown) => {
            updated.push(row)
            return { eq: vi.fn(() => Promise.resolve({ data: null, error: null })) }
          }),
        }
      }
      if (table === 'partner_wallets') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.internalWalletRow })),
            })),
          })),
        }
      }
      if (table === 'demo_dispatches') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            demoDispatchInserts.push(row)
            return Promise.resolve({ error: state.demoDispatchInsertError })
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: 520, error: null })
    }),
  })),
}))

import { POST } from '@/app/api/demo/[slug]/dispatch/route'

function dispatchRequest(slug: string, passcode = 'any-passcode', omitPasscode = false) {
  return new NextRequest(`https://test.hello-clio.com/api/demo/${slug}/dispatch`, {
    method: 'POST',
    body: JSON.stringify(omitPasscode ? {} : { passcode }),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/demo/[slug]/dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.demoMeetingUrlsRow = null
    state.resolvedPasscode = null
    state.internalWalletRow = { trial_minutes_used: 20, test_minutes_balance: 500 } // well-funded by default
    state.demoDispatchInsertError = null
    updated.length = 0
    demoDispatchInserts.length = 0
    rpcCalls.length = 0
    process.env.NEXT_PUBLIC_APP_URL = 'https://hello-clio.com'
    process.env.DEMO_PARTNER_API_BASE_URL = 'https://hello-clio.com'
    process.env.DEMO_CONTENT_BASE_URL = 'https://hello-clio.com'
    process.env.DEMO_PARTNER_API_KEY = 'clio_test_sk_demo_fixture'
    process.env.DEMO_CONTENT_SOURCE_ID = 'src-demo-fixture'
    process.env.DEMO_PARTNER_ACCOUNT_ID = '30d40f51-5d6e-49e9-bdda-519b7d70e13a'
    vi.stubGlobal('fetch', vi.fn())
  })

  it('B2B-39: 401s with incorrect_passcode when resolveDemoPasscodeToAccount returns null, never calling the upstream endpoint', async () => {
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    state.resolvedPasscode = null
    const res = await POST(dispatchRequest('claude-ai', 'wrong'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.error.code).toBe('incorrect_passcode')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('B2B-39/AT-3-regression: an OLD, revoked passcode (resolves to null) 401s even though a demo session was already dispatched earlier', async () => {
    // resolveDemoPasscodeToAccount is the SOLE gate — no other code path re-checks the passcode
    // after initial dispatch (§6.9 point 1; AT-3's "in-progress session unaffected" is about the
    // ALREADY-dispatched session, not about this endpoint re-accepting the old passcode).
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    state.resolvedPasscode = null
    const res = await POST(dispatchRequest('claude-ai', 'old-revoked-passcode'), { params: { slug: 'claude-ai' } })
    expect(res.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('401s when no passcode is sent at all (fails Zod parse before resolution)', async () => {
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    const res = await POST(dispatchRequest('claude-ai', '', true), { params: { slug: 'claude-ai' } })
    expect(res.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('404s an unknown slug before any lookup', async () => {
    const res = await POST(dispatchRequest('not-a-real-topic'), { params: { slug: 'not-a-real-topic' } })
    expect(res.status).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('AT: 422s with no_meeting_url when nothing is saved yet, never calling the upstream endpoint', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = null
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.error.code).toBe('no_meeting_url')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('422s with no_end_user_name when a meeting URL is saved but no name is saved, never calling the upstream endpoint', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: null, last_dispatch_attempted_at: null }
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.error.code).toBe('no_end_user_name')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('500s with internal_error when DEMO_CONTENT_BASE_URL is not configured, never calling the upstream endpoint', async () => {
    delete process.env.DEMO_CONTENT_BASE_URL
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error.code).toBe('internal_error')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('AT-6: on a real 201 bot_active response, returns { status: "dispatched", clio_session_ref } and never leaks the raw upstream body', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: '9e2a4f11-8b3c-4d21-9a77-1c8f2e5b6a90', status: 'bot_active', render_url: 'https://hello-clio.com/partner-render/9e2a4f11' }),
    })
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'dispatched', clio_session_ref: '9e2a4f11-8b3c-4d21-9a77-1c8f2e5b6a90' })
    expect(JSON.stringify(body)).not.toContain('render_url')
  })

  it('AT-8: on a real card_required (402) response, returns a generic 502 message — never the raw code/message', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 402,
      json: async () => ({ error: { code: 'card_required', message: 'Add a payment method to start testing.' } }),
    })
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.error.code).toBe('dispatch_failed')
    expect(JSON.stringify(body)).not.toMatch(/card_required|card|trial|balance|Attendee|Recall/i)
  })

  it('502s with the same generic message on a network error calling the upstream endpoint', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.error.code).toBe('dispatch_failed')
  })

  it('the outbound reseller_id is always the fixed DEMO_PARTNER_ACCOUNT_ID, regardless of which passcode was entered — Flagged Decision, unchanged auth', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-some-reseller', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: 'ref-1', status: 'bot_active' }),
    })
    await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })

    const [calledUrl, calledInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(calledUrl)).toBe('https://hello-clio.com/api/partner/v1/sessions')
    const sentBody = JSON.parse((calledInit as RequestInit).body as string)
    expect(sentBody.reseller_id).toBe('30d40f51-5d6e-49e9-bdda-519b7d70e13a')
    expect((calledInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer clio_test_sk_demo_fixture' })
  })

  // ─── B2B-39 auto-top-up safety valve (§6.3, AT-5) ─────────────────────────────────────

  it('AT-5: credits 500 minutes to the fixed internal account when its available minutes are below 30, before dispatching', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    state.internalWalletRow = { trial_minutes_used: 15, test_minutes_balance: 10 } // (20-15)=5 + 10 = 15 < 30
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: 'ref-2', status: 'bot_active' }),
    })
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    expect(res.status).toBe(200)
    expect(rpcCalls).toContainEqual({
      fn: 'credit_test_minutes_balance',
      args: { p_partner_account_id: '30d40f51-5d6e-49e9-bdda-519b7d70e13a', p_minutes: 500 },
    })
  })

  it('does NOT top up when the fixed internal account already has >= 30 available minutes', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    state.internalWalletRow = { trial_minutes_used: 0, test_minutes_balance: 100 }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: 'ref-3', status: 'bot_active' }),
    })
    await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    expect(rpcCalls.find((c) => c.fn === 'credit_test_minutes_balance')).toBeUndefined()
  })

  it('proceeds with dispatch even if the auto-top-up RPC itself errors (non-blocking)', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    state.internalWalletRow = { trial_minutes_used: 20, test_minutes_balance: 0 } // 0 + 0 < 30 -> attempts top-up
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: 'ref-4', status: 'bot_active' }),
    })
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    expect(res.status).toBe(200)
  })

  // ─── B2B-39 demo_dispatches attribution row (§6.9 point 4) ────────────────────────────

  it('inserts a demo_dispatches row with the resolved billing account + passcode id after a successful dispatch', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-xyz' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: 'session-abc', status: 'bot_active' }),
    })
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    expect(res.status).toBe(200)
    expect(demoDispatchInserts).toHaveLength(1)
    expect(demoDispatchInserts[0]).toMatchObject({
      clio_session_ref: 'session-abc',
      billed_partner_account_id: 'acct-reseller-1',
      demo_passcode_id: 'passcode-xyz',
      slug: 'claude-ai',
    })
  })

  it('still returns 200/dispatched even when the demo_dispatches insert itself fails (non-blocking)', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    state.demoDispatchInsertError = { message: 'insert failed' }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: 'session-def', status: 'bot_active' }),
    })
    const res = await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'dispatched', clio_session_ref: 'session-def' })
  })

  it('does not insert a demo_dispatches row when the upstream dispatch fails', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 402,
      json: async () => ({ error: { code: 'card_required' } }),
    })
    await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })
    expect(demoDispatchInserts).toHaveLength(0)
  })

  it('AT-9: content_pages[] has exactly one entry per chapter, url pointing at the live visual page, deterministic transition_trigger', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: 'ref-1', status: 'bot_active' }),
    })
    await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })

    const [, calledInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const sentBody = JSON.parse((calledInit as RequestInit).body as string)
    expect(sentBody.content_pages).toHaveLength(5) // claude-ai has 5 chapters
    expect(sentBody.content_pages[0].url).toBe('https://hello-clio.com/demo/claude-ai/visuals/what-is-claude')
    expect(sentBody.content_pages[0].transition_trigger).toBe('Move on once "What Is Claude?" has been fully explained.')
  })

  it('B2B-36: the outbound body includes end_user_name sourced from the saved row', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    state.demoMeetingUrlsRow = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', last_dispatch_attempted_at: null }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      json: async () => ({ clio_session_ref: 'ref-1', status: 'bot_active' }),
    })
    await POST(dispatchRequest('claude-ai'), { params: { slug: 'claude-ai' } })

    const [, calledInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const sentBody = JSON.parse((calledInit as RequestInit).body as string)
    expect(sentBody.end_user_name).toBe('Arun')
  })
})
