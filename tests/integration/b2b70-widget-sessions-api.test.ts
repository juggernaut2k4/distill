import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-70 v2.0 (docs/specs/B2B-70-requirement-document.md §6.3/§7) — integration tests for
 * POST /api/partner/v1/widget-sessions covering the new content-source resolution step (not
 * previously required under v1.1's container model). Follows the established convention from
 * tests/integration/partner-wallet-api.test.ts: mock `@/lib/partner/auth`, `@/lib/supabase`, and the
 * other imported collaborators, import the route handler directly, call it with a constructed
 * NextRequest.
 */

const authMock = vi.fn()
vi.mock('@/lib/partner/auth', () => ({
  requirePartnerApiKey: (...args: unknown[]) => authMock(...args),
}))

const getContentSourceMock = vi.fn()
vi.mock('@/lib/partner/content-sources', () => ({
  getContentSource: (...args: unknown[]) => getContentSourceMock(...args),
}))

const assertUrlSafeMock = vi.fn()
vi.mock('@/lib/partner/ssrf', () => ({
  assertUrlSafe: (...args: unknown[]) => assertUrlSafeMock(...args),
}))

vi.mock('@/lib/content/transition-markers', () => ({
  generateTransitionMarkers: (pages: unknown[]) => pages.map(() => 'MARKER'),
}))

const resolveWalletGateMock = vi.fn()
vi.mock('@/lib/partner/wallet-gate', () => ({
  resolveWalletGate: (...args: unknown[]) => resolveWalletGateMock(...args),
}))

const insertedSessionSelectSingleMock = vi.fn()
const traceLogInsertMock = vi.fn(async () => ({ error: null }))
const partnerAccountsSelectMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_sessions') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({ single: insertedSessionSelectSingleMock })),
          })),
        }
      }
      if (table === 'partner_session_trace_logs') {
        return { insert: traceLogInsertMock }
      }
      if (table === 'partner_accounts') {
        return { select: partnerAccountsSelectMock }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

import { POST } from '@/app/api/partner/v1/widget-sessions/route'

const RESELLER_ID = '99999999-9999-4999-8999-999999999999'
const CONTENT_SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const PAGE = { url: 'https://content.partner.example.com/1.html', media_type: 'html' as const, transition_trigger: 'after page one' }

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/partner/v1/widget-sessions', {
    method: 'POST',
    headers: { authorization: 'Bearer clio_live_sk_valid', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    content_pages: [PAGE],
    content_source_id: CONTENT_SOURCE_ID,
    end_user_name: 'Arun',
    reseller_id: RESELLER_ID,
    ...overrides,
  }
}

describe('POST /api/partner/v1/widget-sessions — content-source resolution (§6.3 step 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ partnerAccountId: RESELLER_ID, apiKeyId: 'key-1', clientId: null, mode: 'live', accountKind: 'partner', error: null })
    assertUrlSafeMock.mockResolvedValue({ ok: true })
  })

  it('returns 422 content_source_not_found when getContentSource resolves null', async () => {
    getContentSourceMock.mockResolvedValue(null)

    const res = await POST(makeRequest(validBody()))
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error.code).toBe('content_source_not_found')
    expect(assertUrlSafeMock).not.toHaveBeenCalled()
  })

  it("returns 422 content_source_auth_type_not_supported when auth_type is 'presigned_url'", async () => {
    getContentSourceMock.mockResolvedValue({ authType: 'presigned_url' })

    const res = await POST(makeRequest(validBody()))
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error.code).toBe('content_source_auth_type_not_supported')
  })

  it("returns 422 content_source_auth_type_not_supported when auth_type is 'mtls'", async () => {
    getContentSourceMock.mockResolvedValue({ authType: 'mtls' })

    const res = await POST(makeRequest(validBody()))
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error.code).toBe('content_source_auth_type_not_supported')
  })

  it('returns 422 content_source_url_rejected when a page URL fails assertUrlSafe, before any session row is created', async () => {
    getContentSourceMock.mockResolvedValue({ authType: 'none' })
    assertUrlSafeMock.mockResolvedValue({ ok: false, reason: 'host is an internal/reserved IP address' })

    const res = await POST(makeRequest(validBody()))
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error.code).toBe('content_source_url_rejected')
    expect(json.error.rejected_index).toBe(0)
    expect(insertedSessionSelectSingleMock).not.toHaveBeenCalled()
  })

  it('creates a widget_active session and returns 201 when content-source + URL checks pass and the wallet gate is ok', async () => {
    getContentSourceMock.mockResolvedValue({ authType: 'none' })
    insertedSessionSelectSingleMock.mockResolvedValue({ data: { id: 'session-1' }, error: null })
    resolveWalletGateMock.mockResolvedValue({ status: 'ok', availableMinutes: null, affordableMinutes: null })

    const res = await POST(makeRequest(validBody()))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.status).toBe('widget_active')
    expect(json.clio_session_ref).toBe('session-1')
    expect(json.render_url).toContain('session-1')
  })
})
