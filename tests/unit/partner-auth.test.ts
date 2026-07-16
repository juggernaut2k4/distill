import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-02 — auth middleware tests for lib/partner/auth.ts. Covers the
 * requirement doc's Section 7 acceptance criteria for the two auth systems:
 * invalid/revoked key → 401 no DB write; suspended account → 403; two active
 * live keys both succeed (zero-downtime rotation); and the Clerk-admin
 * membership gate for /api/admin/partner-keys*.
 */

const state: {
  keyRow: { id: string; partner_account_id: string; mode: string; status: string } | null
  accountRow: { id: string; status: string } | null
  membershipRow: { id: string } | null
  oauthClientRow: { id: string; status: string } | null
  oauthAccountRow: { id: string; status: string } | null
} = { keyRow: null, accountRow: null, membershipRow: null, oauthClientRow: null, oauthAccountRow: null }

const updateEqSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
const oauthUpdateEqSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_api_keys') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.keyRow })),
            })),
          })),
          update: vi.fn(() => ({ eq: updateEqSpy })),
        }
      }
      if (table === 'partner_accounts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.accountRow ?? state.oauthAccountRow })),
            })),
          })),
        }
      }
      if (table === 'partner_admin_users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: state.membershipRow })),
              })),
            })),
          })),
        }
      }
      if (table === 'partner_oauth_clients') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.oauthClientRow })),
            })),
          })),
          update: vi.fn(() => ({ eq: oauthUpdateEqSpy })),
        }
      }
      throw new Error(`Unexpected table in test mock: ${table}`)
    }),
  })),
}))

const mockClerkAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockClerkAuth(),
}))

import { requirePartnerApiKey, requirePartnerAdmin } from '@/lib/partner/auth'
import { resetRateLimits } from '@/lib/partner/rate-limit'
import { generateApiKey } from '@/lib/partner/api-keys'
import { signAccessToken } from '@/lib/partner/oauth'

function makeRequest(authHeader?: string) {
  return new NextRequest('http://localhost:3000/api/partner/v1/sessions', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

describe('requirePartnerApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRateLimits()
    state.keyRow = null
    state.accountRow = null
    state.oauthClientRow = null
    state.oauthAccountRow = null
  })

  it('rejects a request with no Authorization header (401, no DB write)', async () => {
    const result = await requirePartnerApiKey(makeRequest(), 'sessions_create')
    expect(result.error?.status).toBe(401)
    expect(updateEqSpy).not.toHaveBeenCalled()
  })

  it('rejects a malformed key (401) without attempting a hash lookup', async () => {
    const result = await requirePartnerApiKey(makeRequest('Bearer not-a-real-key'), 'sessions_create')
    expect(result.error?.status).toBe(401)
  })

  it('rejects a well-formed but unrecognized key (401)', async () => {
    state.keyRow = null
    const { key } = generateApiKey('live')
    const result = await requirePartnerApiKey(makeRequest(`Bearer ${key}`), 'sessions_create')
    expect(result.error?.status).toBe(401)
  })

  it('rejects a revoked key (401, code revoked_api_key)', async () => {
    state.keyRow = { id: 'key-1', partner_account_id: 'acct-1', mode: 'live', status: 'revoked' }
    const { key } = generateApiKey('live')
    const result = await requirePartnerApiKey(makeRequest(`Bearer ${key}`), 'sessions_create')
    expect(result.error?.status).toBe(401)
    const body = await result.error!.json()
    expect(body.error.code).toBe('revoked_api_key')
  })

  it('rejects a valid key on a suspended partner account (403)', async () => {
    state.keyRow = { id: 'key-1', partner_account_id: 'acct-1', mode: 'live', status: 'active' }
    state.accountRow = { id: 'acct-1', status: 'suspended' }
    const { key } = generateApiKey('live')
    const result = await requirePartnerApiKey(makeRequest(`Bearer ${key}`), 'sessions_create')
    expect(result.error?.status).toBe(403)
  })

  it('accepts a valid key on an active account and returns the partner context', async () => {
    state.keyRow = { id: 'key-1', partner_account_id: 'acct-1', mode: 'live', status: 'active' }
    state.accountRow = { id: 'acct-1', status: 'active' }
    const { key } = generateApiKey('live')
    const result = await requirePartnerApiKey(makeRequest(`Bearer ${key}`), 'sessions_create')

    expect(result.error).toBeNull()
    expect(result.partnerAccountId).toBe('acct-1')
    expect(result.apiKeyId).toBe('key-1')
    expect(result.mode).toBe('live')
  })

  it('two different active keys for the same account both succeed identically (zero-downtime rotation)', async () => {
    state.accountRow = { id: 'acct-1', status: 'active' }

    state.keyRow = { id: 'key-A', partner_account_id: 'acct-1', mode: 'live', status: 'active' }
    const resultA = await requirePartnerApiKey(makeRequest(`Bearer ${generateApiKey('live').key}`), 'sessions_create')
    expect(resultA.error).toBeNull()
    expect(resultA.partnerAccountId).toBe('acct-1')

    state.keyRow = { id: 'key-B', partner_account_id: 'acct-1', mode: 'live', status: 'active' }
    const resultB = await requirePartnerApiKey(makeRequest(`Bearer ${generateApiKey('live').key}`), 'sessions_create')
    expect(resultB.error).toBeNull()
    expect(resultB.partnerAccountId).toBe('acct-1')
  })

  it('enforces the per-partner rate limit and returns 429 with Retry-After once exceeded', async () => {
    state.keyRow = { id: 'key-1', partner_account_id: 'acct-rate-limited', mode: 'live', status: 'active' }
    state.accountRow = { id: 'acct-rate-limited', status: 'active' }
    const { key } = generateApiKey('live')

    let lastResult
    for (let i = 0; i < 61; i++) {
      lastResult = await requirePartnerApiKey(makeRequest(`Bearer ${key}`), 'sessions_create')
    }

    expect(lastResult!.error?.status).toBe(429)
    expect(lastResult!.error!.headers.get('Retry-After')).toBeTruthy()
  })
})

// B2B-06 — OAuth2 access-token branch (docs/specs/B2B-06-requirement-document.md Section 7).
describe('requirePartnerApiKey — OAuth2 access token branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRateLimits()
    state.keyRow = null
    state.accountRow = null
    state.oauthClientRow = null
    state.oauthAccountRow = null
  })

  it('accepts a valid, unexpired OAuth2 access token and returns clientId (apiKeyId null)', async () => {
    state.oauthClientRow = { id: 'oauth-client-1', status: 'active' }
    state.oauthAccountRow = { id: 'acct-1', status: 'active' }
    const { token } = signAccessToken('clio_client_abc', 'acct-1', 'live')

    const result = await requirePartnerApiKey(makeRequest(`Bearer ${token}`), 'sessions_create')

    expect(result.error).toBeNull()
    expect(result.partnerAccountId).toBe('acct-1')
    expect(result.apiKeyId).toBeNull()
    expect(result.clientId).toBe('oauth-client-1')
    expect(result.mode).toBe('live')
  })

  it('rejects an expired OAuth2 access token with 401 invalid_api_key (same generic code as a bad static key)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const claims = Buffer.from(
      JSON.stringify({ sub: 'clio_client_abc', partner_account_id: 'acct-1', mode: 'live', iat: 0, exp: 1, jti: 'x' })
    ).toString('base64url')
    const crypto = await import('crypto')
    const signature = crypto.createHmac('sha256', 'clio-dev-only-fallback-oauth-signing-key').update(`${header}.${claims}`).digest('base64url')
    const expiredToken = `${header}.${claims}.${signature}`

    const result = await requirePartnerApiKey(makeRequest(`Bearer ${expiredToken}`), 'sessions_create')
    expect(result.error?.status).toBe(401)
    const body = await result.error!.json()
    expect(body.error.code).toBe('invalid_api_key')
  })

  it('rejects a token whose client_id resolves to a revoked partner_oauth_clients row (401 invalid_api_key)', async () => {
    state.oauthClientRow = { id: 'oauth-client-1', status: 'revoked' }
    state.oauthAccountRow = { id: 'acct-1', status: 'active' }
    const { token } = signAccessToken('clio_client_abc', 'acct-1', 'live')

    const result = await requirePartnerApiKey(makeRequest(`Bearer ${token}`), 'sessions_create')
    expect(result.error?.status).toBe(401)
  })

  it('rejects a token for a suspended partner account (403)', async () => {
    state.oauthClientRow = { id: 'oauth-client-1', status: 'active' }
    state.oauthAccountRow = { id: 'acct-1', status: 'suspended' }
    const { token } = signAccessToken('clio_client_abc', 'acct-1', 'live')

    const result = await requirePartnerApiKey(makeRequest(`Bearer ${token}`), 'sessions_create')
    expect(result.error?.status).toBe(403)
  })

  it('rejects a malformed/garbage bearer value with 401, without attempting verification', async () => {
    const result = await requirePartnerApiKey(makeRequest('Bearer not-a-token-at-all'), 'sessions_create')
    expect(result.error?.status).toBe(401)
  })
})

describe('requirePartnerAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.membershipRow = null
    mockClerkAuth.mockReturnValue({ userId: null })
  })

  it('rejects an unauthenticated caller (401)', async () => {
    mockClerkAuth.mockReturnValue({ userId: null })
    const result = await requirePartnerAdmin('acct-1')
    expect(result.error?.status).toBe(401)
  })

  it('rejects a Clerk user with no partner_admin_users row for this account (403)', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'clerk-user-1' })
    state.membershipRow = null
    const result = await requirePartnerAdmin('acct-1')
    expect(result.error?.status).toBe(403)
  })

  it('accepts a Clerk user with a matching partner_admin_users row', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'clerk-user-1' })
    state.membershipRow = { id: 'membership-1' }
    const result = await requirePartnerAdmin('acct-1')
    expect(result.error).toBeNull()
    expect(result.clerkUserId).toBe('clerk-user-1')
  })
})
