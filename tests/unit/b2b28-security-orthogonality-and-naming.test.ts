import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §7) — the brief's own
 * explicit non-regression assertions: security orthogonality (AT-22-26) and
 * the §6.14 naming-collision fix landing correctly with zero
 * identifier/route/schema drift (AT-29/30).
 */

// ─── AT-22/AT-9e-equivalent — requirePartnerAdmin is a pure function of
// account_kind + membership, never of provenance. A row created via this
// brief's invite-accept flow (account_kind='partner', owning_channel_partner_id=NULL)
// is byte-identical in shape to a self-serve-era direct-partner row, so this
// reuses the exact same code path lib/partner/auth.ts already had — zero new
// branches added by this brief. ───────────────────────────────────────────
const authState: {
  membershipRow: { id: string } | null
  accountRow: { id: string; name?: string; status?: string; account_kind?: string } | null
} = { membershipRow: null, accountRow: null }

const mockClerkAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockClerkAuth(),
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_admin_users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: authState.membershipRow })),
              })),
              // getPartnerAccountsForClerkUser's own single-eq('clerk_user_id') query shape
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve({ data: authState.membershipRow ? [{ partner_account_id: authState.accountRow?.id }] : [] }).then(resolve),
            })),
          })),
        }
      }
      if (table === 'partner_accounts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: authState.accountRow })),
              then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: authState.accountRow ? [authState.accountRow] : [] }).then(resolve),
            })),
            in: vi.fn(() => Promise.resolve({ data: authState.accountRow ? [authState.accountRow] : [] })),
          })),
        }
      }
      throw new Error(`Unexpected table in mock: ${table}`)
    }),
  })),
}))

import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getConfiguratorAccountsForClerkUser } from '@/lib/partner/admin-accounts'

describe('AT-22 — requirePartnerAdmin treats an invite-created direct-partner row identically to any other account_kind=partner row', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClerkAuth.mockReturnValue({ userId: 'clerk-user-1' })
  })

  it('succeeds for a row with account_kind=partner, owning_channel_partner_id=null (the exact shape /partner-invite/accept produces)', async () => {
    authState.membershipRow = { id: 'membership-1' }
    authState.accountRow = { id: 'acct-invited-1', status: 'active', account_kind: 'partner' }

    const result = await requirePartnerAdmin('acct-invited-1')

    expect(result.error).toBeNull()
    expect(result.clerkUserId).toBe('clerk-user-1')
  })
})

describe('AT-23 — getConfiguratorAccountsForClerkUser includes an invite-created row, filters only by account_kind', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes an account_kind=partner row regardless of how it was created', async () => {
    authState.membershipRow = { id: 'membership-1' }
    authState.accountRow = { id: 'acct-invited-1', name: 'Invited Co', account_kind: 'partner' as const }

    const accounts = await getConfiguratorAccountsForClerkUser('clerk-user-1')

    expect(accounts.some((a) => a.id === 'acct-invited-1')).toBe(true)
  })

  it('excludes a channel_partner-kind row — the one and only account_kind filter, unaffected by this brief', async () => {
    authState.membershipRow = { id: 'membership-1' }
    authState.accountRow = { id: 'acct-sales-1', name: 'Sales Co', account_kind: 'channel_partner' as const }

    const accounts = await getConfiguratorAccountsForClerkUser('clerk-user-1')

    expect(accounts.some((a) => a.id === 'acct-sales-1')).toBe(false)
  })
})

// ─── AT-25 — a sales-partner's own session hitting the super-admin
// sales-partners API directly gets 403 via requireSuperAdmin, not a
// screen-content omission. ─────────────────────────────────────────────────
describe('AT-25 — /api/admin/sales-partners* routes 403 a non-super-admin caller', () => {
  const requireSuperAdminMock = vi.fn()
  vi.doMock('@/lib/internal-admin/auth', () => ({
    requireSuperAdmin: () => requireSuperAdminMock(),
  }))

  beforeEach(() => {
    vi.resetModules()
    requireSuperAdminMock.mockReset()
  })

  it('GET /api/admin/sales-partners returns the requireSuperAdmin 403 unchanged', async () => {
    vi.doMock('@/lib/internal-admin/auth', () => ({
      requireSuperAdmin: vi.fn(() =>
        Promise.resolve({
          role: null,
          clerkUserId: null,
          internalAdminUserId: null,
          scopedPartnerAccountIds: null,
          error: new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Super-admin access required.' } }), { status: 403 }),
        })
      ),
    }))
    const { GET } = await import('@/app/api/admin/sales-partners/route')
    const res = await GET()
    expect((res as Response).status).toBe(403)
  })

  it('GET /api/admin/sales-partners/[id] returns the requireSuperAdmin 403 unchanged', async () => {
    vi.doMock('@/lib/internal-admin/auth', () => ({
      requireSuperAdmin: vi.fn(() =>
        Promise.resolve({
          role: null,
          clerkUserId: null,
          internalAdminUserId: null,
          scopedPartnerAccountIds: null,
          error: new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Super-admin access required.' } }), { status: 403 }),
        })
      ),
    }))
    const { GET } = await import('@/app/api/admin/sales-partners/[id]/route')
    const res = await GET(new Request('http://localhost/api/admin/sales-partners/acct-1') as never, { params: { id: 'acct-1' } })
    expect((res as Response).status).toBe(403)
  })
})

// ─── AT-29/AT-30 — the §6.14 naming-collision fix (B2B-28): TeamClient.tsx's
// rendered copy changes, everything else (route paths, state identifiers, DB
// values) stays byte-identical AT THAT TIME. B2B-34 Piece 5 (this file's own
// requirement doc, Part A §0.4) is the deferred follow-up B2B-28 explicitly
// named and scheduled: it now renames the underlying route paths, state/
// handler identifiers, and DB value from the `sales_partner` token to
// `internal_staff`, while keeping TeamClient.tsx's *rendered* copy unchanged.
// These AT-30 assertions are updated accordingly to assert the NEW paths/
// identifiers; the AT-29 rendered-copy assertions are untouched since no
// visible text changed. The migration-084-content assertion also stays
// unchanged — migration 084's file is never edited in place; the rename
// happens via the new, additive migration 094. ─────────────────────────────
describe('AT-29/AT-30 — TeamClient.tsx naming-collision fix is copy-only (B2B-28), identifiers renamed by B2B-34 Part A', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../app/dashboard/admin/team/TeamClient.tsx'),
    'utf8'
  )

  it('renders "Internal sales staff" for the panel heading, subtitle, form heading, and loading/error/empty states (AT-29)', () => {
    expect(source).toContain('Internal sales staff')
    expect(source).toContain('invite internal sales staff scoped to specific partner accounts')
    expect(source).toContain('Invite internal sales staff')
    expect(source).toContain('Loading internal sales staff…')
    expect(source).toContain('Couldn&apos;t load internal sales staff. Try refreshing.')
    expect(source).toContain('No internal sales staff yet.')
  })

  it('no longer renders the bare heading "Sales-partners" as JSX text content (AT-29)', () => {
    expect(source).not.toMatch(/>Sales-partners</)
  })

  it('uses the B2B-34-renamed route paths /api/admin/team/internal-staff* (AT-30)', () => {
    expect(source).toContain("fetch('/api/admin/team/internal-staff')")
    expect(source).toContain("fetch('/api/admin/team/internal-staff', {")
    expect(source).toContain('fetch(`/api/admin/team/internal-staff/${id}`')
    expect(source).toContain('fetch(`/api/admin/team/internal-staff/${id}/resend-invite`')
    expect(source).toContain('fetch(`/api/admin/team/internal-staff/${row.id}`')
  })

  it('no longer references the pre-B2B-34 /api/admin/team/sales-partners* route paths (AT-30)', () => {
    expect(source).not.toContain('/api/admin/team/sales-partners')
  })

  it('uses the B2B-34-renamed state variable/handler identifiers (AT-30)', () => {
    for (const identifier of [
      'internalStaff',
      'internalStaffLoading',
      'internalStaffError',
      'loadInternalStaff',
      'handleSendInvite',
      'handleResendInvite',
      'handleToggleInternalStaffStatus',
    ]) {
      expect(source).toContain(identifier)
    }
  })

  it('no longer references the pre-B2B-34 salesPartners-family identifiers (AT-30)', () => {
    for (const identifier of ['salesPartners', 'salesPartnersLoading', 'salesPartnersError', 'loadSalesPartners', 'handleToggleSalesPartnerStatus']) {
      expect(source).not.toContain(identifier)
    }
  })

  it('never edits migration 084\'s own file content in place (AT-30, source-level confirmation)', () => {
    const migration084 = fs.readFileSync(
      path.resolve(__dirname, '../../supabase/migrations/084_b2b21_internal_admin_identity.sql'),
      'utf8'
    )
    // Confirms migration 084 itself is untouched — B2B-28 shipped its own
    // migration (088) and never edited 084's file contents; B2B-34 Part A's
    // rename happens via the new, additive migration 094, not by editing 084.
    expect(migration084).toMatch(/role\s+TEXT NOT NULL CHECK \(role IN \('super_admin', 'sales_partner'\)\)/)
  })

  it('migration 094 performs the B2B-34 Part A rename (constraint, table, indexes, RLS policy)', () => {
    const migration094 = fs.readFileSync(
      path.resolve(__dirname, '../../supabase/migrations/094_b2b34_internal_staff_rename.sql'),
      'utf8'
    )
    expect(migration094).toMatch(/CHECK \(role IN \('super_admin', 'internal_staff'\)\)/)
    expect(migration094).toContain('ALTER TABLE sales_partner_assignments RENAME TO internal_staff_assignments')
  })
})
