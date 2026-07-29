import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-40 (docs/specs/B2B-40-requirement-document.md §13) — first test file
 * covering app/dashboard/page.tsx's router logic. Follows this codebase's
 * established Vitest convention for testing server-side auth/routing logic
 * by mocking @clerk/nextjs/server and the relevant lib module directly (same
 * pattern as tests/unit/b2b28-security-orthogonality-and-naming.test.ts,
 * which mocks `auth` from @clerk/nextjs/server and @/lib/supabase to drive
 * requirePartnerAdmin() through its branches).
 */

const mockClerkAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockClerkAuth(),
  currentUser: vi.fn(),
}))

const mockResolveInternalAdmin = vi.fn()
vi.mock('@/lib/internal-admin/auth', () => ({
  resolveInternalAdmin: () => mockResolveInternalAdmin(),
}))

const mockGetPartnerAccountsForClerkUser = vi.fn()
vi.mock('@/lib/partner/admin-accounts', () => ({
  getPartnerAccountsForClerkUser: (userId: string) => mockGetPartnerAccountsForClerkUser(userId),
}))

// next/navigation's redirect() throws in the real Next.js runtime — mock it to
// throw a distinguishable sentinel so the test can assert which path fired
// without needing a full Next.js server render.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))

describe('B2B-40 — app/dashboard/page.tsx router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('AT-1: super_admin with no channel_partner membership redirects to /dashboard/admin', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user_super' })
    mockResolveInternalAdmin.mockResolvedValue({ role: 'super_admin', error: null })
    mockGetPartnerAccountsForClerkUser.mockResolvedValue([])
    const { default: DashboardPage } = await import('@/app/(with-clerk)/dashboard/page')
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/dashboard/admin')
    expect(mockGetPartnerAccountsForClerkUser).not.toHaveBeenCalled()
  })

  it('AT-2: super_admin WITH a channel_partner membership still redirects to /dashboard/admin, not /dashboard/channel-partner', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user_super' })
    mockResolveInternalAdmin.mockResolvedValue({ role: 'super_admin', error: null })
    mockGetPartnerAccountsForClerkUser.mockResolvedValue([{ account_kind: 'channel_partner' }])
    const { default: DashboardPage } = await import('@/app/(with-clerk)/dashboard/page')
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/dashboard/admin')
    // short-circuits before membership check is ever reached
    expect(mockGetPartnerAccountsForClerkUser).not.toHaveBeenCalled()
  })

  it('AT-3 (regression): channel_partner membership, role: internal_staff (no super_admin), redirects to /dashboard/channel-partner unchanged', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user_reseller' })
    mockResolveInternalAdmin.mockResolvedValue({ role: 'internal_staff', error: null })
    mockGetPartnerAccountsForClerkUser.mockResolvedValue([{ account_kind: 'channel_partner' }])
    const { default: DashboardPage } = await import('@/app/(with-clerk)/dashboard/page')
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/dashboard/channel-partner')
  })

  it('AT-3 (regression): channel_partner membership, role: null with error (no super_admin row at all), redirects to /dashboard/channel-partner unchanged', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user_reseller2' })
    mockResolveInternalAdmin.mockResolvedValue({ role: null, error: {} })
    mockGetPartnerAccountsForClerkUser.mockResolvedValue([{ account_kind: 'channel_partner' }])
    const { default: DashboardPage } = await import('@/app/(with-clerk)/dashboard/page')
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/dashboard/channel-partner')
  })

  it('AT-4 (regression): zero memberships, no super_admin, redirects to /dashboard/configurator unchanged', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user_plain' })
    mockResolveInternalAdmin.mockResolvedValue({ role: null, error: {} })
    mockGetPartnerAccountsForClerkUser.mockResolvedValue([])
    const { default: DashboardPage } = await import('@/app/(with-clerk)/dashboard/page')
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/dashboard/configurator')
  })

  it('AT-8: no Clerk session redirects to /sign-in before any lookup', async () => {
    mockClerkAuth.mockReturnValue({ userId: null })
    const { default: DashboardPage } = await import('@/app/(with-clerk)/dashboard/page')
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/sign-in')
    expect(mockResolveInternalAdmin).not.toHaveBeenCalled()
    expect(mockGetPartnerAccountsForClerkUser).not.toHaveBeenCalled()
  })
})
