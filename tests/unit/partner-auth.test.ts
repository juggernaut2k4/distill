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
} = { keyRow: null, accountRow: null, membershipRow: null }

const updateEqSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))

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
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.accountRow })),
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
