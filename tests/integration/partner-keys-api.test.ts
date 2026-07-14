import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * B2B-02 integration tests for /api/admin/partner-keys (issuance) and
 * /api/admin/partner-keys/:id (revocation) — Clerk-authenticated only,
 * per docs/specs/B2B-02-requirement-document.md Section 7's acceptance
 * criteria around the partner_admin_users membership gate and the
 * one-time-only full-key response.
 */

const requirePartnerAdminMock = vi.fn()
vi.mock('@/lib/partner/auth', () => ({
  requirePartnerAdmin: (...args: unknown[]) => requirePartnerAdminMock(...args),
}))

const mockClerkAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockClerkAuth(),
}))

const insertedKeys: Record<string, unknown>[] = []
let keyRowForDelete: { id: string; partner_account_id: string; status: string; revoked_at: string | null } | null = null
let membershipForDelete: { id: string } | null = null
const updateSpy = vi.fn((_patch?: Record<string, unknown>) => Promise.resolve({ error: null }))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_api_keys') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            insertedKeys.push(row)
            return {
              select: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: { id: 'new-key-id', mode: row.mode, label: row.label }, error: null })),
              })),
            }
          }),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: keyRowForDelete })),
            })),
          })),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: vi.fn(() => {
              updateSpy(patch)
              return Promise.resolve({ error: null })
            }),
          })),
        }
      }
      if (table === 'partner_admin_users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: membershipForDelete })),
              })),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

import { POST as createKey } from '@/app/api/admin/partner-keys/route'
import { DELETE as revokeKey } from '@/app/api/admin/partner-keys/[id]/route'

describe('POST /api/admin/partner-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedKeys.length = 0
  })

  it('returns 403 when the caller has no partner_admin_users row for the target account', async () => {
    requirePartnerAdminMock.mockResolvedValue({ error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) })

    const req = new NextRequest('http://localhost:3000/api/admin/partner-keys', {
      method: 'POST',
      body: JSON.stringify({ partner_account_id: '3f9a1c22-1234-4321-aaaa-111122223333', mode: 'live' }),
    })
    const res = await createKey(req)

    expect(res.status).toBe(403)
    expect(insertedKeys).toHaveLength(0)
  })

  it('issues a key and returns the full plaintext value exactly once', async () => {
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'admin-1', error: null })

    const req = new NextRequest('http://localhost:3000/api/admin/partner-keys', {
      method: 'POST',
      body: JSON.stringify({ partner_account_id: '3f9a1c22-1234-4321-aaaa-111122223333', mode: 'live', label: 'Production' }),
    })
    const res = await createKey(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.key).toMatch(/^clio_live_sk_[a-f0-9]{48}$/)
    expect(json.key_prefix).toBe(json.key.slice(0, 20))
    expect(insertedKeys[0]).not.toHaveProperty('key') // only key_hash/key_prefix are ever persisted
    expect(insertedKeys[0]).toHaveProperty('key_hash')
  })

  it('returns 400 on an invalid body (bad partner_account_id / mode)', async () => {
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'admin-1', error: null })
    const req = new NextRequest('http://localhost:3000/api/admin/partner-keys', {
      method: 'POST',
      body: JSON.stringify({ partner_account_id: 'not-a-uuid', mode: 'nonsense' }),
    })
    const res = await createKey(req)
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/admin/partner-keys/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    keyRowForDelete = null
    membershipForDelete = null
  })

  it('returns 401 when there is no Clerk session', async () => {
    mockClerkAuth.mockReturnValue({ userId: null })
    const res = await revokeKey(new NextRequest('http://localhost:3000/api/admin/partner-keys/key-1', { method: 'DELETE' }), {
      params: { id: 'key-1' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 (not 403) when the key exists but the caller does not administer its partner account', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'clerk-user-1' })
    keyRowForDelete = { id: 'key-1', partner_account_id: 'acct-1', status: 'active', revoked_at: null }
    membershipForDelete = null // no membership row

    const res = await revokeKey(new NextRequest('http://localhost:3000/api/admin/partner-keys/key-1', { method: 'DELETE' }), {
      params: { id: 'key-1' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 for a key that does not exist at all', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'clerk-user-1' })
    keyRowForDelete = null

    const res = await revokeKey(new NextRequest('http://localhost:3000/api/admin/partner-keys/missing', { method: 'DELETE' }), {
      params: { id: 'missing' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 409 (idempotent) with the existing state when the key is already revoked', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'clerk-user-1' })
    keyRowForDelete = { id: 'key-1', partner_account_id: 'acct-1', status: 'revoked', revoked_at: '2026-07-01T00:00:00Z' }
    membershipForDelete = { id: 'membership-1' }

    const res = await revokeKey(new NextRequest('http://localhost:3000/api/admin/partner-keys/key-1', { method: 'DELETE' }), {
      params: { id: 'key-1' },
    })
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toEqual({ id: 'key-1', status: 'revoked', revoked_at: '2026-07-01T00:00:00Z' })
  })

  it('revokes an active key and returns 200', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'clerk-user-1' })
    keyRowForDelete = { id: 'key-1', partner_account_id: 'acct-1', status: 'active', revoked_at: null }
    membershipForDelete = { id: 'membership-1' }

    const res = await revokeKey(new NextRequest('http://localhost:3000/api/admin/partner-keys/key-1', { method: 'DELETE' }), {
      params: { id: 'key-1' },
    })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.status).toBe('revoked')
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'revoked' }))
  })
})
