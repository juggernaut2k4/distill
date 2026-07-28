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
// B2B-38 AT-8/AT-10 — mockResolvedValueOnce a Postgres 23505 (unique-violation) shape for the
// idempotent-replay tests, so the type must allow both the success shape and the conflict shape.
const insertSingleMock = vi.fn<() => Promise<{ data: { id: string } | null; error: { code: string; message: string } | null }>>(() =>
  Promise.resolve({ data: { id: 'session-ref-123' }, error: null })
)
const sessionsSelectMock = vi.fn()

// B2B-38 (docs/specs/B2B-38-requirement-document.md §6.5) — the new partner_session_trace_logs
// insert, fired immediately after a genuinely new partner_sessions row is created. Best-effort —
// tests assert on `traceLogInsertedRows`, not on this mock's return value.
const traceLogInsertedRows: Record<string, unknown>[] = []
const traceLogInsertMock = vi.fn((row: Record<string, unknown>) => {
  traceLogInsertedRows.push(row)
  return Promise.resolve({ error: null })
})
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

// B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.5) — the client_id ownership
// lookup on partner_accounts (`.eq('id', client_id).eq('owning_channel_partner_id', ...)`). Defaults
// to "not found" (null); individual tests override via mockResolvedValueOnce for the valid/owned case.
const clientOwnershipMaybeSingleMock = vi.fn(() => Promise.resolve<{ data: { id: string } | null }>({ data: null }))

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
      if (table === 'partner_accounts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({ maybeSingle: clientOwnershipMaybeSingleMock })),
            })),
          })),
        }
      }
      if (table === 'partner_session_trace_logs') {
        return { insert: vi.fn((row: Record<string, unknown>) => traceLogInsertMock(row)) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

import { POST } from '@/app/api/partner/v1/sessions/route'
import { GET as getSessionStatus } from '@/app/api/partner/v1/sessions/[clio_session_ref]/route'

// B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.2) — end_user_name is now required on
// every request. Injected as a default here (unless the caller's own body already sets one, e.g.
// the dedicated "end_user_name required" tests below that omit or blank it) so every pre-existing
// test in this file keeps validating its original scenario rather than failing on an unrelated
// missing field — the same discipline used for demo-meeting-route.test.ts / demo-dispatch-route.test.ts.
//
// B2B-38 (docs/specs/B2B-38-requirement-document.md §6.2/§6.5) — reseller_id is now mandatory and
// validated to exactly equal auth.partnerAccountId. Defaulted here to '11111111-1111-4111-8111-111111111111' — the
// partnerAccountId every pre-existing test in this file authenticates as UNLESS it explicitly
// authenticates as a different account (the 3 channel_partner tests using '22222222-2222-4222-8222-222222222222', which supply
// their own explicit reseller_id in their body). Same discipline as end_user_name above.
function makeRequest(body: Record<string, unknown>, authHeader = 'Bearer clio_live_sk_valid') {
  const withName = 'end_user_name' in body ? body : { end_user_name: 'Arun', ...body }
  const merged = 'reseller_id' in withName ? withName : { reseller_id: '11111111-1111-4111-8111-111111111111', ...withName }
  return new NextRequest('http://localhost:3000/api/partner/v1/sessions', {
    method: 'POST',
    headers: { authorization: authHeader, 'content-type': 'application/json' },
    body: JSON.stringify(merged),
  })
}

describe('POST /api/partner/v1/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedRows.length = 0
    traceLogInsertedRows.length = 0
    insertSingleMock.mockResolvedValue({ data: { id: 'session-ref-123' }, error: null })
    clientOwnershipMaybeSingleMock.mockResolvedValue({ data: null })
  })

  it('rejects with 401 and never touches the database when auth fails', async () => {
    authMock.mockResolvedValue({ error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))

    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  it('returns 422 when neither partner_topic_ref nor content_ref is present', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', mode: 'live', error: null })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij' }))

    expect(res.status).toBe(422)
    expect(insertedRows).toHaveLength(0)
  })

  it('returns 422 for an invalid meeting_url', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', mode: 'live', error: null })

    const res = await POST(makeRequest({ meeting_url: 'not-a-url', partner_topic_ref: 'ai-101' }))
    expect(res.status).toBe(422)
  })

  it('on success: inserts a partner_sessions row, dispatches the bot, and returns 201 with clio_session_ref + render_url', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
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
      partner_account_id: '11111111-1111-4111-8111-111111111111',
      partner_api_key_id: 'key-1',
      test_mode: false,
      partner_topic_ref: 'ai-101',
      partner_reference: 'hartford',
    })
  })

  it('a test-mode key sets test_mode: true on the created session', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', mode: 'test', error: null })
    dispatchMock.mockResolvedValue({ status: 'bot_active' })

    await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', content_ref: '3f9a1c22-1234-4321-aaaa-111122223333' }))

    expect(insertedRows[0]).toMatchObject({ test_mode: true })
  })

  it('still returns 201 with status bot_dispatch_failed (not a 5xx) when the meeting-bot vendor call fails — the row remains queryable', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
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
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
    walletMaybeSingleMock.mockResolvedValueOnce({ data: null })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
    const json = await res.json()

    expect(res.status).toBe(402)
    expect(json.error.code).toBe('funding_required')
    expect(dispatchMock).not.toHaveBeenCalled()
    expect(sessionsUpdateMock).toHaveBeenCalledWith({ status: 'failed', end_reason: 'funding_required' })
  })

  it('rejects a live-mode request with 402 funding_required when a wallet row exists but has no payment method on file', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
    walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: null } })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
    const json = await res.json()

    expect(res.status).toBe(402)
    expect(json.error.code).toBe('funding_required')
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  // NOTE (B2B-27, 2026-07-19): this test's original premise ("unfunded — must not matter in test
  // mode", asserting a bare `{ data: null }` wallet still dispatches in test mode) is superseded by
  // the approved B2B-27 Requirement Document Section 7, which requires exactly that condition (no
  // partner_wallets row, test mode) to now return 402 card_required — see the dedicated card-on-file
  // tests below. Updated in place (not deleted) to keep covering this test's real remaining intent:
  // the live-mode-only funding_required/balance_usd concept still doesn't apply to test mode once the
  // new card-on-file prerequisite is satisfied.
  it('does not apply the live-mode funding_required/balance_usd guardrail to a test-mode request once a card is on file', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'test', error: null })
    dispatchMock.mockResolvedValue({ status: 'bot_active' })
    // Card on file (satisfies B2B-27's new gate), but no funding_mechanism/balance_usd at all —
    // the live-mode-only funding/balance concept must still not matter in test mode.
    walletMaybeSingleMock.mockResolvedValueOnce({
      data: { trial_minutes_used: 0, test_minutes_balance: 0, stripe_default_payment_method_id: 'pm_card_on_file' },
    })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))

    expect(res.status).toBe(201)
    expect(dispatchMock).toHaveBeenCalled()
  })

  // B2B-27 — card-on-file gate (docs/specs/B2B-27-requirement-document.md Section 7 acceptance tests).
  it('rejects a test-mode request with 402 card_required when no partner_wallets row exists, and never dispatches the bot', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'test', error: null })
    walletMaybeSingleMock.mockResolvedValueOnce({ data: null })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
    const json = await res.json()

    expect(res.status).toBe(402)
    expect(json.error.code).toBe('card_required')
    expect(dispatchMock).not.toHaveBeenCalled()
    expect(sessionsUpdateMock).toHaveBeenCalledWith({ status: 'failed', end_reason: 'card_required' })
  })

  it('rejects a test-mode request with 402 card_required even with a full, fresh 20-minute trial allowance and no card on file', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'test', error: null })
    walletMaybeSingleMock.mockResolvedValueOnce({
      data: { trial_minutes_used: 0, test_minutes_balance: 0, stripe_default_payment_method_id: null },
    })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
    const json = await res.json()

    expect(res.status).toBe(402)
    expect(json.error.code).toBe('card_required')
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('proceeds normally (201, bot dispatched) for a test-mode request when a card is on file, with full trial minutes remaining', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'test', error: null })
    dispatchMock.mockResolvedValue({ status: 'bot_active' })
    walletMaybeSingleMock.mockResolvedValueOnce({
      data: { trial_minutes_used: 0, test_minutes_balance: 0, stripe_default_payment_method_id: 'pm_card_on_file' },
    })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.status).toBe('bot_active')
    expect(dispatchMock).toHaveBeenCalled()
  })

  it('returns 402 trial_exhausted (not card_required) when a card is on file but the trial+test-block allowance is used up', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'test', error: null })
    walletMaybeSingleMock.mockResolvedValueOnce({
      data: { trial_minutes_used: 20, test_minutes_balance: 0, stripe_default_payment_method_id: 'pm_card_on_file' },
    })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
    const json = await res.json()

    expect(res.status).toBe(402)
    expect(json.error.code).toBe('trial_exhausted')
    expect(dispatchMock).not.toHaveBeenCalled()
    expect(sessionsUpdateMock).toHaveBeenCalledWith({ status: 'failed', end_reason: 'trial_exhausted' })
  })

  it('leaves live-mode dispatch completely unaffected by the card-on-file gate either way (test-mode-only check)', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
    dispatchMock.mockResolvedValue({ status: 'bot_active' })
    // live-mode reads stripe_default_payment_method_id via its own B2B-06 guardrail, not the
    // B2B-27 test-mode gate — this wallet has a card on file so the existing live-mode path proceeds.
    walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.status).toBe('bot_active')
    expect(json.error).toBeUndefined()
  })

  // B2B-06 v1.1 — end-to-end write-path test for an OAuth2-authenticated session-create call
  // (the CEO's 2026-07-15 blocking-gap finding: this route previously NOT NULL-violated on every
  // OAuth2-authenticated call because it always wrote partner_api_key_id unconditionally).
  it('an OAuth2-authenticated (clientId-only) request writes partner_oauth_client_id and leaves partner_api_key_id null', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: null, clientId: 'oauth-client-row-1', mode: 'live', error: null })
    dispatchMock.mockResolvedValue({ status: 'bot_active' })
    walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

    const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))

    expect(res.status).toBe(201)
    expect(insertedRows[0]).toMatchObject({
      partner_account_id: '11111111-1111-4111-8111-111111111111',
      partner_api_key_id: null,
      partner_oauth_client_id: 'oauth-client-row-1',
    })
    expect(dispatchMock).toHaveBeenCalled()
  })

  // B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.5, §7 Acceptance Tests) —
  // client_id gating: required + validated for channel_partner (reseller) callers only; a direct
  // partner ('partner') caller is completely unaffected, zero regression.
  describe('client_id gating (B2B-34 Piece 2)', () => {
    it('422s with client_id_required for a channel_partner caller who omits client_id, no row created', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '22222222-2222-4222-8222-222222222222', apiKeyId: 'key-1', clientId: null, mode: 'live', accountKind: 'channel_partner', error: null })

      const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101', reseller_id: '22222222-2222-4222-8222-222222222222' }))
      const json = await res.json()

      expect(res.status).toBe(422)
      expect(json.error.code).toBe('client_id_required')
      expect(insertedRows).toHaveLength(0)
      expect(dispatchMock).not.toHaveBeenCalled()
    })

    it('422s with invalid_client_id for a channel_partner caller whose client_id belongs to a different reseller (or does not exist), no row created', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '22222222-2222-4222-8222-222222222222', apiKeyId: 'key-1', clientId: null, mode: 'live', accountKind: 'channel_partner', error: null })
      clientOwnershipMaybeSingleMock.mockResolvedValueOnce({ data: null })

      const res = await POST(
        makeRequest({
          meeting_url: 'https://meet.google.com/abc-defg-hij',
          partner_topic_ref: 'ai-101',
          client_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          reseller_id: '22222222-2222-4222-8222-222222222222',
        })
      )
      const json = await res.json()

      expect(res.status).toBe(422)
      expect(json.error.code).toBe('invalid_client_id')
      expect(insertedRows).toHaveLength(0)
      expect(dispatchMock).not.toHaveBeenCalled()
    })

    it('succeeds and sets end_client_id when a channel_partner caller supplies a valid, owned client_id', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '22222222-2222-4222-8222-222222222222', apiKeyId: 'key-1', clientId: null, mode: 'live', accountKind: 'channel_partner', error: null })
      clientOwnershipMaybeSingleMock.mockResolvedValueOnce({ data: { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' } })
      dispatchMock.mockResolvedValue({ status: 'bot_active' })
      walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

      const res = await POST(
        makeRequest({
          meeting_url: 'https://meet.google.com/abc-defg-hij',
          partner_topic_ref: 'ai-101',
          client_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          reseller_id: '22222222-2222-4222-8222-222222222222',
        })
      )

      expect(res.status).toBe(201)
      expect(insertedRows[0]).toMatchObject({
        partner_account_id: '22222222-2222-4222-8222-222222222222',
        end_client_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      })
    })

    it('a direct-partner (account_kind=partner) caller with no client_id succeeds exactly as today — zero regression', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', accountKind: 'partner', error: null })
      dispatchMock.mockResolvedValue({ status: 'bot_active' })
      walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

      const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))

      expect(res.status).toBe(201)
      expect(insertedRows[0]).toMatchObject({ partner_account_id: '11111111-1111-4111-8111-111111111111', end_client_id: null })
      expect(dispatchMock).toHaveBeenCalled()
    })
  })

  // B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.2/§6.6/§7 AT-3) — end_user_name
  // (required) and end_user_industry (optional) threaded through to the inserted row.
  describe('end_user_name / end_user_industry (B2B-36 F4)', () => {
    // These two tests must send a body with end_user_name genuinely absent, so they bypass
    // makeRequest()'s auto-injected default (which exists to keep every OTHER pre-existing test
    // in this file passing without a `end_user_name` addition of its own).
    it('AT-3: 422s with a Zod validation error referencing end_user_name when it is omitted', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', mode: 'live', error: null })

      const req = new NextRequest('http://localhost:3000/api/partner/v1/sessions', {
        method: 'POST',
        headers: { authorization: 'Bearer clio_live_sk_valid', 'content-type': 'application/json' },
        body: JSON.stringify({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }),
      })
      const res = await POST(req)
      const json = await res.json()

      expect(res.status).toBe(422)
      expect(json.details.fieldErrors.end_user_name).toBeDefined()
      expect(insertedRows).toHaveLength(0)
    })

    it('422s when end_user_name is an empty string', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', mode: 'live', error: null })

      const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101', end_user_name: '' }))

      expect(res.status).toBe(422)
      expect(insertedRows).toHaveLength(0)
    })

    it('inserts end_user_name and end_user_industry on the created row when both are supplied', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
      dispatchMock.mockResolvedValue({ status: 'bot_active' })
      walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

      const res = await POST(
        makeRequest({
          meeting_url: 'https://meet.google.com/abc-defg-hij',
          partner_topic_ref: 'ai-101',
          end_user_name: 'Arun',
          end_user_industry: 'healthcare',
        })
      )

      expect(res.status).toBe(201)
      expect(insertedRows[0]).toMatchObject({ end_user_name: 'Arun', end_user_industry: 'healthcare' })
    })

    it('inserts end_user_industry as null when omitted', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
      dispatchMock.mockResolvedValue({ status: 'bot_active' })
      walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

      const res = await POST(
        makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101', end_user_name: 'Arun' })
      )

      expect(res.status).toBe(201)
      expect(insertedRows[0]).toMatchObject({ end_user_name: 'Arun', end_user_industry: null })
    })
  })

  // B2B-38 (docs/specs/B2B-38-requirement-document.md §6.2/§6.5/§7) — reseller_id
  // mandatory/mismatch, reseller_unique_id idempotent replay, and the new
  // partner_session_trace_logs write.
  describe('reseller_id / reseller_unique_id (B2B-38)', () => {
    // AT-1 — a plain request (no reseller_unique_id) creates a partner_session_trace_logs row with
    // reseller_id/partner_account_id matching and end_client_id/reseller_unique_id null.
    it('AT-1: inserts a partner_session_trace_logs row on success, with reseller_id/partner_account_id matching and optional fields null', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
      dispatchMock.mockResolvedValue({ status: 'bot_active' })
      walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

      const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))

      expect(res.status).toBe(201)
      expect(traceLogInsertedRows).toHaveLength(1)
      expect(traceLogInsertedRows[0]).toMatchObject({
        clio_session_ref: 'session-ref-123',
        partner_account_id: '11111111-1111-4111-8111-111111111111',
        reseller_id: '11111111-1111-4111-8111-111111111111',
        end_client_id: null,
        reseller_unique_id: null,
      })
    })

    // AT-2 — omitted entirely fails Zod's own required-field validation first (the generic 422),
    // never reaching the new invalid_reseller_id code.
    it('AT-2: returns the existing generic 422 (not invalid_reseller_id) when reseller_id is omitted entirely', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', mode: 'live', error: null })

      const req = new NextRequest('http://localhost:3000/api/partner/v1/sessions', {
        method: 'POST',
        headers: { authorization: 'Bearer clio_live_sk_valid', 'content-type': 'application/json' },
        body: JSON.stringify({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101', end_user_name: 'Arun' }),
      })
      const res = await POST(req)
      const json = await res.json()

      expect(res.status).toBe(422)
      expect(json.error).toBe('Validation failed')
      expect(json.details.fieldErrors.reseller_id).toBeDefined()
      expect(insertedRows).toHaveLength(0)
      expect(traceLogInsertedRows).toHaveLength(0)
    })

    // AT-3 — present but mismatched → 422 invalid_reseller_id, no partner_sessions row, no trace log row.
    it('AT-3: returns 422 invalid_reseller_id when reseller_id does not match auth.partnerAccountId, no rows created', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', mode: 'live', error: null })

      const res = await POST(
        makeRequest({
          meeting_url: 'https://meet.google.com/abc-defg-hij',
          partner_topic_ref: 'ai-101',
          reseller_id: '99999999-9999-4999-8999-999999999999', // well-formed UUID, but not auth.partnerAccountId
        })
      )
      const json = await res.json()

      expect(res.status).toBe(422)
      expect(json.error.code).toBe('invalid_reseller_id')
      expect(insertedRows).toHaveLength(0)
      expect(traceLogInsertedRows).toHaveLength(0)
      expect(dispatchMock).not.toHaveBeenCalled()
    })

    // AT-6 — no reseller_unique_id → no idempotency applies, two independent rows.
    it('AT-6: two calls with no reseller_unique_id create two independent partner_sessions rows', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
      dispatchMock.mockResolvedValue({ status: 'bot_active' })
      walletMaybeSingleMock.mockResolvedValue({ data: { stripe_default_payment_method_id: 'pm_123' } })
      insertSingleMock
        .mockResolvedValueOnce({ data: { id: 'session-ref-A' }, error: null })
        .mockResolvedValueOnce({ data: { id: 'session-ref-B' }, error: null })

      const res1 = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
      const res2 = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
      const json1 = await res1.json()
      const json2 = await res2.json()

      expect(insertedRows).toHaveLength(2)
      expect(json1.clio_session_ref).toBe('session-ref-A')
      expect(json2.clio_session_ref).toBe('session-ref-B')
      expect(dispatchMock).toHaveBeenCalledTimes(2)
    })

    // AT-7 — a fresh reseller_unique_id returns 201 with the value echoed back, and it's written to
    // the inserted row.
    it('AT-7: a fresh reseller_unique_id returns 201 with the value echoed back in the response', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
      dispatchMock.mockResolvedValue({ status: 'bot_active' })
      walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

      const res = await POST(
        makeRequest({
          meeting_url: 'https://meet.google.com/abc-defg-hij',
          partner_topic_ref: 'ai-101',
          reseller_unique_id: 'order-48213',
        })
      )
      const json = await res.json()

      expect(res.status).toBe(201)
      expect(json.reseller_unique_id).toBe('order-48213')
      expect(insertedRows[0]).toMatchObject({ reseller_unique_id: 'order-48213' })
      expect(traceLogInsertedRows[0]).toMatchObject({ reseller_unique_id: 'order-48213' })
    })

    // AT-8 — a replay with the SAME reseller_id + reseller_unique_id returns the ORIGINAL session's
    // response; dispatchMeetingBot() is not called a second time; no second partner_sessions row.
    it('AT-8: replaying the same reseller_id + reseller_unique_id returns the original response, no second dispatch, no second row', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
      dispatchMock.mockResolvedValue({ status: 'bot_active' })
      walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })
      insertSingleMock.mockResolvedValueOnce({ data: { id: 'session-ref-A' }, error: null })
      // Second insert attempt hits the partial unique index — Postgres unique-violation.
      insertSingleMock.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
      sessionsSelectMock.mockReturnValueOnce({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: { id: 'session-ref-A', status: 'bot_active' } })) })),
        })),
      })

      const res1 = await POST(
        makeRequest({
          meeting_url: 'https://meet.google.com/abc-defg-hij',
          partner_topic_ref: 'ai-101',
          reseller_unique_id: 'order-48213',
        })
      )
      const res2 = await POST(
        makeRequest({
          meeting_url: 'https://meet.google.com/abc-defg-hij',
          partner_topic_ref: 'ai-101',
          reseller_unique_id: 'order-48213',
        })
      )
      const json1 = await res1.json()
      const json2 = await res2.json()

      expect(res1.status).toBe(201)
      expect(res2.status).toBe(201)
      expect(json2.clio_session_ref).toBe(json1.clio_session_ref)
      expect(json2.render_url).toBe(json1.render_url)
      expect(json2.status).toBe(json1.status)
      expect(insertedRows).toHaveLength(2) // both insert ATTEMPTS are recorded by this mock; only 1 succeeded
      expect(dispatchMock).toHaveBeenCalledTimes(1)
      expect(traceLogInsertedRows).toHaveLength(1) // trace log only written for the genuinely-new row
    })

    // AT-9 — uniqueness is scoped per-reseller: two different resellers reusing the identical
    // reseller_unique_id each get their own independent session.
    it('AT-9: two different resellers sending the identical reseller_unique_id each create an independent session', async () => {
      dispatchMock.mockResolvedValue({ status: 'bot_active' })
      walletMaybeSingleMock.mockResolvedValue({ data: { stripe_default_payment_method_id: 'pm_123' } })
      insertSingleMock
        .mockResolvedValueOnce({ data: { id: 'session-ref-A' }, error: null })
        .mockResolvedValueOnce({ data: { id: 'session-ref-B' }, error: null })

      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
      const res1 = await POST(
        makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101', reseller_unique_id: 'shared-id' })
      )

      authMock.mockResolvedValue({ partnerAccountId: '33333333-3333-4333-8333-333333333333', apiKeyId: 'key-2', clientId: null, mode: 'live', error: null })
      const res2 = await POST(
        makeRequest({
          meeting_url: 'https://meet.google.com/abc-defg-hij',
          partner_topic_ref: 'ai-101',
          reseller_unique_id: 'shared-id',
          reseller_id: '33333333-3333-4333-8333-333333333333',
        })
      )

      const json1 = await res1.json()
      const json2 = await res2.json()

      expect(res1.status).toBe(201)
      expect(res2.status).toBe(201)
      expect(json1.clio_session_ref).toBe('session-ref-A')
      expect(json2.clio_session_ref).toBe('session-ref-B')
      expect(insertedRows).toHaveLength(2)
      expect(dispatchMock).toHaveBeenCalledTimes(2)
    })

    // AT-10 — a replay reusing an existing reseller_unique_id but with a genuinely different
    // meeting_url returns the ORIGINAL session's response unchanged; the differing meeting_url is
    // not applied.
    it('AT-10: a replay with a different meeting_url returns the original response unchanged', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
      dispatchMock.mockResolvedValue({ status: 'bot_active' })
      walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })
      insertSingleMock.mockResolvedValueOnce({ data: { id: 'session-ref-A' }, error: null })
      insertSingleMock.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
      sessionsSelectMock.mockReturnValueOnce({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: { id: 'session-ref-A', status: 'bot_active' } })) })),
        })),
      })

      const res1 = await POST(
        makeRequest({
          meeting_url: 'https://meet.google.com/abc-defg-hij',
          partner_topic_ref: 'ai-101',
          reseller_unique_id: 'order-48213',
        })
      )
      const res2 = await POST(
        makeRequest({
          meeting_url: 'https://meet.google.com/completely-different-meeting',
          partner_topic_ref: 'ai-101',
          reseller_unique_id: 'order-48213',
        })
      )
      const json1 = await res1.json()
      const json2 = await res2.json()

      expect(res2.status).toBe(201)
      expect(json2.clio_session_ref).toBe(json1.clio_session_ref)
      expect(dispatchMock).toHaveBeenCalledTimes(1)
      // The second (differing) meeting_url was never used for a dispatch call.
      expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ meetingUrl: 'https://meet.google.com/completely-different-meeting' }))
    })

    // AT-12 — a session created WITHOUT reseller_unique_id has the key entirely absent (not
    // present-as-null) from the response JSON.
    it('AT-12: reseller_unique_id key is entirely absent from the response when not sent', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', clientId: null, mode: 'live', error: null })
      dispatchMock.mockResolvedValue({ status: 'bot_active' })
      walletMaybeSingleMock.mockResolvedValueOnce({ data: { stripe_default_payment_method_id: 'pm_123' } })

      const res = await POST(makeRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', partner_topic_ref: 'ai-101' }))
      const json = await res.json()

      expect(res.status).toBe(201)
      expect('reseller_unique_id' in json).toBe(false)
    })
  })
})

describe('GET /api/partner/v1/sessions/:clio_session_ref', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 for a malformed ref without querying the database', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', mode: 'live', error: null })

    const req = new NextRequest('http://localhost:3000/api/partner/v1/sessions/not-a-uuid', {
      headers: { authorization: 'Bearer clio_live_sk_valid' },
    })
    const res = await getSessionStatus(req, { params: { clio_session_ref: 'not-a-uuid' } })
    expect(res.status).toBe(404)
    expect(sessionsSelectMock).not.toHaveBeenCalled()
  })

  it('never exposes provider_bot_id, provider_name, or meeting_url in the response shape', async () => {
    authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', mode: 'live', error: null })
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

  // AT-13 (docs/specs/B2B-38-requirement-document.md §6.10/§7) — reseller_unique_id is included
  // when the session was created with one, and absent otherwise.
  describe('reseller_unique_id (B2B-38 AT-13)', () => {
    it('includes reseller_unique_id matching what was sent on creation', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', mode: 'live', error: null })
      sessionsSelectMock.mockReturnValue({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({
                data: {
                  id: 'session-ref-123',
                  status: 'bot_active',
                  created_at: '2026-07-13T00:00:00Z',
                  ended_at: null,
                  reseller_unique_id: 'order-48213',
                },
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
      expect(json.reseller_unique_id).toBe('order-48213')
    })

    it('omits reseller_unique_id (not present-as-null) for a session created without one', async () => {
      authMock.mockResolvedValue({ partnerAccountId: '11111111-1111-4111-8111-111111111111', apiKeyId: 'key-1', mode: 'live', error: null })
      sessionsSelectMock.mockReturnValue({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({
                data: {
                  id: 'session-ref-123',
                  status: 'bot_active',
                  created_at: '2026-07-13T00:00:00Z',
                  ended_at: null,
                  reseller_unique_id: null,
                },
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
      expect('reseller_unique_id' in json).toBe(false)
    })
  })
})
