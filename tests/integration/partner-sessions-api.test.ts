import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * B2B-02 integration tests for POST /api/partner/v1/sessions and
 * GET /api/partner/v1/sessions/:clio_session_ref — the session-initiation
 * contract's acceptance criteria (docs/specs/B2B-02-requirement-document.md
 * Section 7). Auth (lib/partner/auth.ts) and meeting-bot dispatch
 * (lib/partner/session-init.ts) are unit-tested independently elsewhere;
 * here they're mocked so this file exercises the route's own logic: request
 * validation, the insert-then-dispatch sequence, and response shaping.
 */

const authMock = vi.fn()
vi.mock('@/lib/partner/auth', () => ({
  requirePartnerApiKey: (...args: unknown[]) => authMock(...args),
}))

const dispatchMock = vi.fn()
vi.mock('@/lib/partner/session-init', () => ({
  dispatchMeetingBot: (...args: unknown[]) => dispatchMock(...args),
}))

const insertedRows: Record<string, unknown>[] = []
const insertSingleMock = vi.fn(() => Promise.resolve({ data: { id: 'session-ref-123' }, error: null }))
const sessionsSelectMock = vi.fn()
// B2B-08 — gate-check read on partner_wallets (test-mode requests only). Also read by the B2B-06
// live-mode funding guardrail (stripe_default_payment_method_id). Defaults to "no wallet row yet"
// (null), which the B2B-08 gate logic treats as trial_minutes_used=0/test_minutes_balance=0 — a
// fresh 20-minute allowance, matching Requirement Doc Section 7's "brand-new account" acceptance
// test — and which the B2B-06 guardrail treats as unfunded (fail-closed). Individual tests can
// override via mockResolvedValueOnce for the exhausted-allowance / funded-wallet cases.
const walletMaybeSingleMock = vi.fn(() =>
  Promise.resolve<{ data: { trial_minutes_used?: number; test_minutes_balance?: number; stripe_default_payment_method_id?: string | null } | null }>(
    { data: null }
  )
)
const sessionsUpdateMock = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) }))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_sessions') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            insertedRows.push(row)
            return { select: vi.fn(() => ({ single: insertSingleMock })) }
          }),
          select: sessionsSelectMock,
          update: sessionsUpdateMock,
        }
      }
      if (table === 'partner_wallets') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: walletMaybeSingleMock })) })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

import { POST } from '@/app/api/partner/v1/sessions/route'
import { GET as getSessionStatus } from '@/app/api/partner/v1/sessions/[clio_session_ref]/route'

function makeRequest(body: unknown, authHeader = 'Bearer clio_live_sk_valid') {
  return new NextRequest('http://localhost:3000/api/partner/v1/sessions', {
    method: 'POST',
    headers: { authorization: authHeader, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/partner/v1/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedRows.length = 0
    insertSingleMock.mockResolvedValue({ data: { id: 'session-ref-123' }, error: null })
  })

  it('rejects with 401 and never touches the database when auth fails', async () => {
    authMock.mockResolvedValue({ error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))

    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  it('returns 422 when neither partner_topic_ref nor content_ref is present', async () => {
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', mode: 'live', error: null })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij' }))

    expect(res.status).toBe(422)
    expect(insertedRows).toHaveLength(0)
  })

  it('returns 422 for an invalid meeting_url', async () => {
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', mode: 'live', error: null })

    const res = await POST(makeRequest({ meeting_url: 'not-a-url', partner_topic_ref: 'ai-101' }))
    expect(res.status).toBe(422)
  })

  it('on success: inserts a partner_sessions row, dispatches the bot, and returns 201 with clio_session_ref + render_url', async () => {
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
    dispatchMock.mockResolvedValue({ status: 'bot_active' })
    // B2B-06 — live-mode funding guardrail: this account has a payment method on file.
    walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

    const res = await POST(
      makeRequest({
        meeting_url: 'https://meet.google.com/abc-defg-hij',
        partner_topic_ref: 'ai-101',
        partner_reference: 'hartford',
      })
    )
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.clio_session_ref).toBe('session-ref-123')
    expect(json.status).toBe('bot_active')
    expect(json.render_url).toContain('/partner-render/session-ref-123')
    expect(json.error).toBeUndefined()

    expect(insertedRows[0]).toMatchObject({
      partner_account_id: 'acct-1',
      partner_api_key_id: 'key-1',
      test_mode: false,
      partner_topic_ref: 'ai-101',
      partner_reference: 'hartford',
    })
  })

  it('a test-mode key sets test_mode: true on the created session', async () => {
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', mode: 'test', error: null })
    dispatchMock.mockResolvedValue({ status: 'bot_active' })

    await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', content_ref: '3f9a1c22-1234-4321-aaaa-111122223333' }))

    expect(insertedRows[0]).toMatchObject({ test_mode: true })
  })

  it('still returns 201 with status bot_dispatch_failed (not a 5xx) when the meeting-bot vendor call fails — the row remains queryable', async () => {
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
    dispatchMock.mockResolvedValue({ status: 'bot_dispatch_failed', error: 'vendor unreachable' })
    // B2B-06 — live-mode funding guardrail: this account has a payment method on file.
    walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.status).toBe('bot_dispatch_failed')
    expect(json.error).toBe('vendor unreachable')
  })

  // B2B-06 — funding guardrail (docs/specs/B2B-06-requirement-document.md Section 7 acceptance tests).
  it('rejects a live-mode request with 402 funding_required when no partner_wallets row exists, and never dispatches the bot', async () => {
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
    walletMaybeSingleMock.mockResolvedValueOnce({ data: null })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
    const json = await res.json()

    expect(res.status).toBe(402)
    expect(json.error.code).toBe('funding_required')
    expect(dispatchMock).not.toHaveBeenCalled()
    expect(sessionsUpdateMock).toHaveBeenCalledWith({ status: 'failed', end_reason: 'funding_required' })
  })

  it('rejects a live-mode request with 402 funding_required when a wallet row exists but has no payment method on file', async () => {
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
    walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: null } })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
    const json = await res.json()

    expect(res.status).toBe(402)
    expect(json.error.code).toBe('funding_required')
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('never evaluates the funding guardrail for a test-mode request, regardless of wallet funding state', async () => {
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', clientId: null, mode: 'test', error: null })
    dispatchMock.mockResolvedValue({ status: 'bot_active' })
    walletMaybeSingleMock.mockResolvedValueOnce({ data: null }) // unfunded — must not matter in test mode

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))

    expect(res.status).toBe(201)
    expect(dispatchMock).toHaveBeenCalled()
  })

  // B2B-06 v1.1 — end-to-end write-path test for an OAuth2-authenticated session-create call
  // (the CEO's 2026-07-15 blocking-gap finding: this route previously NOT NULL-violated on every
  // OAuth2-authenticated call because it always wrote partner_api_key_id unconditionally).
  it('an OAuth2-authenticated (clientId-only) request writes partner_oauth_client_id and leaves partner_api_key_id null', async () => {
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: null, clientId: 'oauth-client-row-1', mode: 'live', error: null })
    dispatchMock.mockResolvedValue({ status: 'bot_active' })
    walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))

    expect(res.status).toBe(201)
    expect(insertedRows[0]).toMatchObject({
      partner_account_id: 'acct-1',
      partner_api_key_id: null,
      partner_oauth_client_id: 'oauth-client-row-1',
    })
    expect(dispatchMock).toHaveBeenCalled()
  })
})

describe('GET /api/partner/v1/sessions/:clio_session_ref', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 for a malformed ref without querying the database', async () => {
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', mode: 'live', error: null })

    const req = new NextRequest('http://localhost:3000/api/partner/v1/sessions/not-a-uuid', {
      headers: { authorization: 'Bearer clio_live_sk_valid' },
    })
    const res = await getSessionStatus(req, { params: { clio_session_ref: 'not-a-uuid' } })
    expect(res.status).toBe(404)
    expect(sessionsSelectMock).not.toHaveBeenCalled()
  })

  it('never exposes provider_bot_id, provider_name, or meeting_url in the response shape', async () => {
    authMock.mockResolvedValue({ partnerAccountId: 'acct-1', apiKeyId: 'key-1', mode: 'live', error: null })
    sessionsSelectMock.mockReturnValue({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({
              data: { id: 'session-ref-123', status: 'bot_active', created_at: '2026-07-13T00:00:00Z', ended_at: null },
            })
          ),
        })),
      })),
    })

    const ref = '3f9a1c22-1234-4321-aaaa-111122223333'
    const req = new NextRequest(`http://localhost:3000/api/partner/v1/sessions/${ref}`, {
      headers: { authorization: 'Bearer clio_live_sk_valid' },
    })
    const res = await getSessionStatus(req, { params: { clio_session_ref: ref } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ clio_session_ref: 'session-ref-123', status: 'bot_active', created_at: '2026-07-13T00:00:00Z', ended_at: null })
    expect(json.provider_bot_id).toBeUndefined()
    expect(json.provider_name).toBeUndefined()
    expect(json.meeting_url).toBeUndefined()
  })
})
