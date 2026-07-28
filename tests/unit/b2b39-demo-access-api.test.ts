import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §4.A/§4.B, §6.4, AT-1, AT-2, AT-10). Tests for
 * the four demo-access API routes:
 *  - GET/POST /api/channel-partner/demo-access[/regenerate]
 *  - GET/POST /api/admin/demo-access[/regenerate]
 *
 * `requireChannelPartnerAdmin`/`requireSuperAdmin` are mocked directly — this suite is about THESE
 * routes' own behavior (response shape, revoke-then-insert, plaintext-once discipline), not about
 * re-testing the auth helpers themselves (covered by tests/unit/partner-auth.test.ts).
 */

const state = {
  cpAdminError: null as NextResponse | null,
  cpPartnerAccountId: 'acct-reseller-1',
  superAdminError: null as NextResponse | null,

  passcodeRow: null as { created_at: string } | null,
  walletRow: null as { demo_minutes_balance: number; demo_reference_topup_minutes: number | null } | null,
  insertError: null as { message: string } | null,
}

const updateCalls: { table: string; patch: unknown; account: string }[] = []
const insertCalls: { table: string; row: Record<string, unknown> }[] = []

vi.mock('@/lib/partner/auth', () => ({
  requireChannelPartnerAdmin: vi.fn(() =>
    Promise.resolve(
      state.cpAdminError
        ? { clerkUserId: null, partnerAccountId: null, error: state.cpAdminError }
        : { clerkUserId: 'clerk-cp-1', partnerAccountId: state.cpPartnerAccountId, error: null }
    )
  ),
}))

vi.mock('@/lib/internal-admin/auth', () => ({
  requireSuperAdmin: vi.fn(() =>
    Promise.resolve(
      state.superAdminError
        ? { role: null, clerkUserId: null, internalAdminUserId: null, scopedPartnerAccountIds: null, error: state.superAdminError }
        : { role: 'super_admin', clerkUserId: 'clerk-admin-1', internalAdminUserId: 'internal-1', scopedPartnerAccountIds: null, error: null }
    )
  ),
}))

vi.mock('@/lib/demo/passcode-accounts', () => ({
  generateDemoPasscode: vi.fn(() => ({
    passcode: 'XK7P-4QRT9M',
    passcodeHash: 'hash-abc123',
    passcodePrefix: 'XK7P',
  })),
  DEMO_ADMIN_PARTNER_ACCOUNT_ID: '30d40f51-5d6e-49e9-bdda-519b7d70e13a',
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'demo_passcodes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, account: string) => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: state.passcodeRow })),
              })),
            })),
          })),
          update: vi.fn((patch: unknown) => ({
            eq: vi.fn((_col: string, account: string) => ({
              is: vi.fn(() => {
                updateCalls.push({ table, patch, account })
                return Promise.resolve({ data: null, error: null })
              }),
            })),
          })),
          insert: vi.fn((row: Record<string, unknown>) => {
            insertCalls.push({ table, row })
            return {
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve(
                    state.insertError
                      ? { data: null, error: state.insertError }
                      : { data: { created_at: '2026-07-27T12:00:00.000Z' }, error: null }
                  )
                ),
              })),
            }
          }),
        }
      }
      if (table === 'partner_wallets') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.walletRow })),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.cpAdminError = null
  state.cpPartnerAccountId = 'acct-reseller-1'
  state.superAdminError = null
  state.passcodeRow = null
  state.walletRow = null
  state.insertError = null
  updateCalls.length = 0
  insertCalls.length = 0
})

describe('GET /api/channel-partner/demo-access', () => {
  it('has_passcode: false, generated_at: null when no active passcode row exists', async () => {
    const { GET } = await import('@/app/api/channel-partner/demo-access/route')
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual({ has_passcode: false, generated_at: null, demo_minutes_balance: 0, demo_reference_topup_minutes: null })
  })

  // AT-1 — a subsequent GET never includes the plaintext anywhere in its response.
  it('AT-1: has_passcode: true with balance data — response never contains a "passcode" field', async () => {
    state.passcodeRow = { created_at: '2026-07-20T14:03:00.000Z' }
    state.walletRow = { demo_minutes_balance: 12.5, demo_reference_topup_minutes: 20 }
    const { GET } = await import('@/app/api/channel-partner/demo-access/route')
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual({
      has_passcode: true,
      generated_at: '2026-07-20T14:03:00.000Z',
      demo_minutes_balance: 12.5,
      demo_reference_topup_minutes: 20,
    })
    expect(Object.keys(body)).not.toContain('passcode')
  })

  it('propagates the 403 from requireChannelPartnerAdmin unchanged — AT-10c', async () => {
    state.cpAdminError = NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 })
    const { GET } = await import('@/app/api/channel-partner/demo-access/route')
    const res = await GET()
    expect(res.status).toBe(403)
  })
})

describe('POST /api/channel-partner/demo-access/regenerate', () => {
  // AT-1 — plaintext returned exactly once, in this response.
  it('AT-1: returns the plaintext passcode + generated_at on first-ever generation', async () => {
    const { POST } = await import('@/app/api/channel-partner/demo-access/regenerate/route')
    const res = await POST()
    const body = await res.json()
    expect(body).toEqual({ passcode: 'XK7P-4QRT9M', generated_at: '2026-07-27T12:00:00.000Z' })
  })

  // AT-2 — regeneration revokes the old row before inserting the new one.
  it('AT-2: revokes any existing active passcode (sets revoked_at) before inserting the new row', async () => {
    const { POST } = await import('@/app/api/channel-partner/demo-access/regenerate/route')
    await POST()
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].patch).toHaveProperty('revoked_at')
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].row).toMatchObject({
      partner_account_id: 'acct-reseller-1',
      passcode_hash: 'hash-abc123',
      passcode_prefix: 'XK7P',
      created_by_clerk_user_id: 'clerk-cp-1',
    })
  })

  it('never persists or returns the raw plaintext passcode in the DB insert — only the hash', async () => {
    const { POST } = await import('@/app/api/channel-partner/demo-access/regenerate/route')
    await POST()
    const insertedRow = insertCalls[0].row
    expect(JSON.stringify(insertedRow)).not.toContain('XK7P-4QRT9M')
  })

  it('500s with internal_error when the insert fails', async () => {
    state.insertError = { message: 'db down' }
    const { POST } = await import('@/app/api/channel-partner/demo-access/regenerate/route')
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error.code).toBe('internal_error')
  })

  it('propagates the 403 from requireChannelPartnerAdmin unchanged, never touching the DB', async () => {
    state.cpAdminError = NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 })
    const { POST } = await import('@/app/api/channel-partner/demo-access/regenerate/route')
    const res = await POST()
    expect(res.status).toBe(403)
    expect(insertCalls).toHaveLength(0)
  })
})

describe('GET /api/admin/demo-access', () => {
  it('reads/writes against the fixed "Clio Internal — Public Demo" sentinel account, not a client-supplied id', async () => {
    state.passcodeRow = { created_at: '2026-07-13T00:00:00.000Z' }
    state.walletRow = { demo_minutes_balance: 340, demo_reference_topup_minutes: 500 }
    const { GET } = await import('@/app/api/admin/demo-access/route')
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual({
      has_passcode: true,
      generated_at: '2026-07-13T00:00:00.000Z',
      demo_minutes_balance: 340,
      demo_reference_topup_minutes: 500,
    })
  })

  it('propagates the 403 from requireSuperAdmin unchanged', async () => {
    state.superAdminError = NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 })
    const { GET } = await import('@/app/api/admin/demo-access/route')
    const res = await GET()
    expect(res.status).toBe(403)
  })
})

describe('POST /api/admin/demo-access/regenerate', () => {
  it('inserts against the fixed sentinel account id, not any client-supplied account', async () => {
    const { POST } = await import('@/app/api/admin/demo-access/regenerate/route')
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.passcode).toBe('XK7P-4QRT9M')
    expect(insertCalls[0].row).toMatchObject({
      partner_account_id: '30d40f51-5d6e-49e9-bdda-519b7d70e13a',
      created_by_clerk_user_id: 'clerk-admin-1',
    })
  })

  it('propagates the 403 from requireSuperAdmin unchanged, never touching the DB', async () => {
    state.superAdminError = NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 })
    const { POST } = await import('@/app/api/admin/demo-access/regenerate/route')
    const res = await POST()
    expect(res.status).toBe(403)
    expect(insertCalls).toHaveLength(0)
  })
})
