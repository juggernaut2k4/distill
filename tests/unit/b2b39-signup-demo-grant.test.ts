import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §6.4, AT-6). Tests for
 * createOrClaimPartnerAccount()'s 20-free-demo-minutes grant, added alongside the existing B2B-34
 * self-client auto-provisioning in the same `channel_partner` block. Mirrors
 * tests/unit/partner-signup-self-client.test.ts's own mock structure, extended with an `rpc` mock.
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
  demoGrantRpcError: { message: string } | null
  demoGrantRpcThrows: boolean
} = {
  accountInsertResult: { data: { id: 'acct-1', account_kind: 'channel_partner' }, error: null },
  adminInsertError: null,
  selfClientInsertError: null,
  demoGrantRpcError: null,
  demoGrantRpcThrows: false,
}

const rpcCalls: { fn: string; args: unknown }[] = []

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_accounts') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            if (row.is_self_client) {
              return Promise.resolve({ error: state.selfClientInsertError })
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
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      if (state.demoGrantRpcThrows) throw new Error('rpc client threw')
      return Promise.resolve({ data: 20, error: state.demoGrantRpcError })
    }),
  })),
}))

import { createOrClaimPartnerAccount } from '@/lib/partner/signup'

describe('createOrClaimPartnerAccount — 20 free demo minutes grant (B2B-39, AT-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpcCalls.length = 0
    existingAccountsMock.mockResolvedValue([])
    state.accountInsertResult = { data: { id: 'acct-1', account_kind: 'channel_partner' }, error: null }
    state.adminInsertError = null
    state.selfClientInsertError = null
    state.demoGrantRpcError = null
    state.demoGrantRpcThrows = false
  })

  it('AT-6: grants exactly 20 demo minutes via credit_demo_minutes_balance for a brand-new channel_partner account', async () => {
    const result = await createOrClaimPartnerAccount('clerk-1', 'Acme Reseller', 'owner@acme.example.com', 'channel_partner')

    expect(result.success).toBe(true)
    expect(rpcCalls).toContainEqual({
      fn: 'credit_demo_minutes_balance',
      args: { p_partner_account_id: 'acct-1', p_minutes: 20 },
    })
  })

  it('does NOT grant demo minutes for a direct-partner (account_kind=partner) signup', async () => {
    state.accountInsertResult = { data: { id: 'acct-2', account_kind: 'partner' }, error: null }

    const result = await createOrClaimPartnerAccount('clerk-2', 'Direct Co', 'owner@direct.example.com', 'partner')

    expect(result.success).toBe(true)
    expect(rpcCalls.find((c) => c.fn === 'credit_demo_minutes_balance')).toBeUndefined()
  })

  it('does not block account creation when the demo-grant RPC returns an error (best-effort/non-blocking)', async () => {
    state.demoGrantRpcError = { message: 'rpc failed' }
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await createOrClaimPartnerAccount('clerk-3', 'Acme Reseller 2', 'owner2@acme.example.com', 'channel_partner')

    expect(result.success).toBe(true)
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('does not block account creation when the demo-grant RPC call itself throws (best-effort/non-blocking)', async () => {
    state.demoGrantRpcThrows = true
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await createOrClaimPartnerAccount('clerk-4', 'Acme Reseller 3', 'owner3@acme.example.com', 'channel_partner')

    expect(result.success).toBe(true)
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('does not grant demo minutes when the account already exists (alreadyMember short-circuit)', async () => {
    existingAccountsMock.mockResolvedValue([{ id: 'acct-existing', account_kind: 'channel_partner' }])

    const result = await createOrClaimPartnerAccount('clerk-5', 'Acme Reseller', 'owner@acme.example.com', 'channel_partner')

    expect(result.alreadyMember).toBe(true)
    expect(rpcCalls.find((c) => c.fn === 'credit_demo_minutes_balance')).toBeUndefined()
  })
})
