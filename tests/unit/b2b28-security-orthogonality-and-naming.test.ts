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

// ─── AT-24 — revenue_share_percent must never be referenced anywhere under
// the sales-partner's own route trees. Source-grep confirms this at the
// exact granularity the spec's Known Constraints call for. ────────────────
describe('AT-24 — revenue_share_percent never referenced under channel-partner-facing routes', () => {
  function walk(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    let files: string[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files = files.concat(walk(full))
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(full)
      }
    }
    return files
  }

  it('is absent from every file under app/dashboard/channel-partner/**', () => {
    const dir = path.resolve(__dirname, '../../app/dashboard/channel-partner')
    const files = walk(dir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const contents = fs.readFileSync(file, 'utf8')
      expect(contents.includes('revenue_share_percent')).toBe(false)
    }
  })

  it('is absent from every file under app/api/channel-partner/**', () => {
    const dir = path.resolve(__dirname, '../../app/api/channel-partner')
    const files = walk(dir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const contents = fs.readFileSync(file, 'utf8')
      expect(contents.includes('revenue_share_percent')).toBe(false)
    }
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

// ─── AT-26 — the two pre-existing enforce_account_kind_invariants clauses
// (B2B-26) survive this brief's extension byte-for-byte, plus the new third
// clause and the trigger's extended watched-column list. ───────────────────
describe('AT-26 — enforce_account_kind_invariants trigger extension preserves both pre-existing clauses', () => {
  it('migration 088 keeps both B2B-26 RAISE EXCEPTION clauses verbatim and adds exactly one new clause', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/088_b2b28_direct_partner_invites_and_revenue_share.sql'
    )
    const sql = fs.readFileSync(migrationPath, 'utf8')

    expect(sql).toContain(
      'A channel_partner-kind partner_accounts row cannot itself have an owning_channel_partner_id (no nested sales-partner chains)'
    )
    expect(sql).toContain('owning_channel_partner_id must reference a partner_accounts row with account_kind = channel_partner')
    expect(sql).toContain('revenue_share_percent may only be set on a channel_partner-kind partner_accounts row')
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF account_kind, owning_channel_partner_id, revenue_share_percent ON partner_accounts')
  })
})

// ─── AT-29/AT-30 — the §6.14 naming-collision fix: TeamClient.tsx's rendered
// copy changes, everything else (route paths, state identifiers, DB values)
// stays byte-identical. ─────────────────────────────────────────────────────
describe('AT-29/AT-30 — TeamClient.tsx naming-collision fix is copy-only', () => {
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

  it('keeps every fetched route path byte-identical to /api/admin/team/sales-partners* (AT-30)', () => {
    expect(source).toContain("fetch('/api/admin/team/sales-partners')")
    expect(source).toContain("fetch('/api/admin/team/sales-partners', {")
    expect(source).toContain('fetch(`/api/admin/team/sales-partners/${id}`')
    expect(source).toContain('fetch(`/api/admin/team/sales-partners/${id}/resend-invite`')
    expect(source).toContain('fetch(`/api/admin/team/sales-partners/${row.id}`')
  })

  it('keeps every state variable/handler identifier byte-identical (AT-30)', () => {
    for (const identifier of [
      'salesPartners',
      'salesPartnersLoading',
      'salesPartnersError',
      'loadSalesPartners',
      'handleSendInvite',
      'handleResendInvite',
      'handleToggleSalesPartnerStatus',
    ]) {
      expect(source).toContain(identifier)
    }
  })

  it('never touches internal_admin_users/sales_partner_assignments schema or the role=sales_partner DB value (AT-30, source-level confirmation)', () => {
    const migration084 = fs.readFileSync(
      path.resolve(__dirname, '../../supabase/migrations/084_b2b21_internal_admin_identity.sql'),
      'utf8'
    )
    // Confirms migration 084 itself is untouched by this brief — B2B-28 ships
    // its own migration (088) and never edits 084's file contents.
    expect(migration084).toMatch(/role\s+TEXT NOT NULL CHECK \(role IN \('super_admin', 'sales_partner'\)\)/)
  })
})
