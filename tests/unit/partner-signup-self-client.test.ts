import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.2, §7) — tests for
 * createOrClaimPartnerAccount()'s auto-provisioned "self" client mechanism: every brand-new
 * channel_partner account gets exactly one is_self_client=true row so the reseller can test their
 * own integration immediately; direct-partner ('partner') accounts get none; a failed self-client
 * insert is logged and non-blocking (account creation still succeeds).
 */

const existingAccountsMock = vi.fn((_clerkUserId: string) => Promise.resolve<{ id: string; account_kind: string }[]>([]))
vi.mock('@/lib/partner/admin-accounts', () => ({
  getPartnerAccountsForClerkUser: (clerkUserId: string) => existingAccountsMock(clerkUserId),
}))

const sendWelcomeEmailMock = vi.fn((_email: string, _companyName: string) => Promise.resolve({ success: true }))
vi.mock('@/lib/delivery/email', () => ({
  sendPartnerSignupWelcomeEmail: (email: string, companyName: string) => sendWelcomeEmailMock(email, companyName),
}))

const inngestSendMock = vi.fn((_event: unknown) => Promise.resolve())
vi.mock('@/inngest/client', () => ({
  inngest: { send: (event: unknown) => inngestSendMock(event) },
}))

const state: {
  accountInsertResult: { data: { id: string; account_kind: string } | null; error: { message: string; code?: string } | null }
  adminInsertError: { message: string; code?: string } | null
  selfClientInsertError: { message: string } | null
}
= {
  accountInsertResult: { data: { id: 'acct-1', account_kind: 'channel_partner' }, error: null },
  adminInsertError: null,
  selfClientInsertError: null,
}

const selfClientInsertMock = vi.fn((row: Record<string, unknown>) => Promise.resolve({ error: state.selfClientInsertError, row }))
const capturedSelfClientInserts: Record<string, unknown>[] = []

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_accounts') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            // Distinguish the main account-creation insert (no owning_channel_partner_id) from the
            // self-client insert (has owning_channel_partner_id + is_self_client) by shape.
            if (row.is_self_client) {
              capturedSelfClientInserts.push(row)
              return selfClientInsertMock(row)
            }
            return {
              select: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(state.accountInsertResult)),
              })),
            }
          }),
          delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
        }
      }
      if (table === 'partner_admin_users') {
        return {
          insert: vi.fn(() => Promise.resolve({ error: state.adminInsertError })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

import { createOrClaimPartnerAccount } from '@/lib/partner/signup'

describe('createOrClaimPartnerAccount — self-client auto-provisioning (B2B-34 Piece 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedSelfClientInserts.length = 0
    existingAccountsMock.mockResolvedValue([])
    state.accountInsertResult = { data: { id: 'acct-1', account_kind: 'channel_partner' }, error: null }
    state.adminInsertError = null
    state.selfClientInsertError = null
  })

  it('provisions exactly one is_self_client=true row for a brand-new channel_partner account', async () => {
    const result = await createOrClaimPartnerAccount('clerk-1', 'Acme Reseller', 'owner@acme.example.com', 'channel_partner')

    expect(result.success).toBe(true)
    expect(capturedSelfClientInserts).toHaveLength(1)
    expect(capturedSelfClientInserts[0]).toMatchObject({
      name: 'Self (direct sessions)',
      account_kind: 'partner',
      owning_channel_partner_id: 'acct-1',
      is_self_client: true,
      status: 'active',
    })
  })

  it('does NOT provision a self-client for a direct-partner (account_kind=partner) signup', async () => {
    state.accountInsertResult = { data: { id: 'acct-2', account_kind: 'partner' }, error: null }

    const result = await createOrClaimPartnerAccount('clerk-2', 'Direct Co', 'owner@direct.example.com', 'partner')

    expect(result.success).toBe(true)
    expect(capturedSelfClientInserts).toHaveLength(0)
  })

  it('a failed self-client insert is logged and non-blocking — account creation still succeeds', async () => {
    state.selfClientInsertError = { message: 'unique violation' }
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await createOrClaimPartnerAccount('clerk-3', 'Beta Reseller', 'owner@beta.example.com', 'channel_partner')

    expect(result.success).toBe(true)
    expect(result.partnerAccountId).toBe('acct-1')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to auto-provision self-client'),
      'unique violation'
    )

    consoleErrorSpy.mockRestore()
  })

  it('never attempts self-client provisioning when the caller already administers an account (alreadyMember)', async () => {
    existingAccountsMock.mockResolvedValue([{ id: 'acct-existing', account_kind: 'channel_partner' }])

    const result = await createOrClaimPartnerAccount('clerk-4', 'Existing Co', 'owner@existing.example.com', 'channel_partner')

    expect(result.alreadyMember).toBe(true)
    expect(capturedSelfClientInserts).toHaveLength(0)
  })
})
