import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §6.2). Tests for
 * `requireShowcaseAccess()` — the gate for every
 * `/api/channel-partner/showcase/*` route. Mocking convention mirrors
 * `tests/unit/partner-auth.test.ts`.
 */

const state: {
  membershipRows: { partner_account_id: string }[]
  accountRows: { id: string; name: string; account_kind: string; showcase_access_enabled?: boolean }[]
} = { membershipRows: [], accountRows: [] }

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_admin_users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: state.membershipRows })),
          })),
        }
      }
      if (table === 'partner_accounts') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ data: state.accountRows })),
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.accountRows[0] ?? null })),
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

import { requireShowcaseAccess } from '@/lib/partner/auth'

describe('requireShowcaseAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.membershipRows = []
    state.accountRows = []
  })

  it('401s with no Clerk session at all', async () => {
    mockClerkAuth.mockReturnValue({ userId: null })
    const result = await requireShowcaseAccess()
    expect(result.error?.status).toBe(401)
    expect(result.partnerAccountId).toBeNull()
  })

  it('403s a Clerk user with no channel_partner membership', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user-1' })
    state.membershipRows = []
    const result = await requireShowcaseAccess()
    expect(result.error?.status).toBe(403)
  })

  it('blocks a genuine channel-partner admin who is NOT allowlisted (showcase_access_enabled=false)', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user-1' })
    state.membershipRows = [{ partner_account_id: 'acct-1' }]
    state.accountRows = [{ id: 'acct-1', name: 'Acme', account_kind: 'channel_partner', showcase_access_enabled: false }]
    const result = await requireShowcaseAccess()
    expect(result.error?.status).toBe(403)
    expect(result.partnerAccountId).toBeNull()
  })

  it('blocks a channel-partner admin with the column NULL/undefined (treated as not-enabled)', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user-1' })
    state.membershipRows = [{ partner_account_id: 'acct-1' }]
    state.accountRows = [{ id: 'acct-1', name: 'Acme', account_kind: 'channel_partner' }]
    const result = await requireShowcaseAccess()
    expect(result.error?.status).toBe(403)
  })

  it('admits an allowlisted channel-partner admin (showcase_access_enabled=true)', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user-1' })
    state.membershipRows = [{ partner_account_id: 'acct-1' }]
    state.accountRows = [{ id: 'acct-1', name: 'Acme', account_kind: 'channel_partner', showcase_access_enabled: true }]
    const result = await requireShowcaseAccess()
    expect(result.error).toBeNull()
    expect(result.partnerAccountId).toBe('acct-1')
    expect(result.clerkUserId).toBe('user-1')
  })
})
