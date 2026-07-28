import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §6.8, AT-7). Tests for
 * checkDemoLowBalanceAndAlert() (lib/partner/webhooks.ts) — the demo-minutes sibling of
 * checkLowBalanceAndAlert(), same race-safe compare-and-set-once-per-cycle mechanics.
 */

const state = {
  walletRow: null as { demo_reference_topup_minutes: number | null } | null,
  compareAndSetWon: true,
  accountRow: { name: 'Acme Reseller' } as { name: string } | null,
  adminUsers: [{ clerk_user_id: 'clerk-1' }] as { clerk_user_id: string }[],
}
const updateCalls: { patch: Record<string, unknown>; account: string }[] = []
const sendDemoLowBalanceAlertEmailCalls: unknown[][] = []

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_wallets') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.walletRow })),
            })),
          })),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: vi.fn((_col: string, account: string) => ({
              is: vi.fn(() => {
                updateCalls.push({ patch, account })
                return {
                  select: vi.fn(() => ({
                    maybeSingle: vi.fn(() => Promise.resolve({ data: state.compareAndSetWon ? { id: 'wallet-1' } : null })),
                  })),
                }
              }),
            })),
          })),
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
            eq: vi.fn(() => Promise.resolve({ data: state.adminUsers })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

vi.mock('@/lib/delivery/email', () => ({
  sendLowBalanceAlertEmail: vi.fn(() => Promise.resolve({ success: true })),
  sendDemoLowBalanceAlertEmail: vi.fn((...args: unknown[]) => {
    sendDemoLowBalanceAlertEmailCalls.push(args)
    return Promise.resolve({ success: true })
  }),
}))

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: () => ({
    users: {
      getUser: (clerkUserId: string) =>
        Promise.resolve({
          primaryEmailAddressId: 'email-1',
          emailAddresses: [{ id: 'email-1', emailAddress: `${clerkUserId}@example.com` }],
        }),
    },
  }),
}))

import { checkDemoLowBalanceAndAlert } from '@/lib/partner/webhooks'

describe('checkDemoLowBalanceAndAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.walletRow = { demo_reference_topup_minutes: 20 }
    state.compareAndSetWon = true
    state.accountRow = { name: 'Acme Reseller' }
    state.adminUsers = [{ clerk_user_id: 'clerk-1' }]
    updateCalls.length = 0
    sendDemoLowBalanceAlertEmailCalls.length = 0
  })

  it('does nothing when there is no funded reference point yet (demo_reference_topup_minutes is null/0)', async () => {
    state.walletRow = { demo_reference_topup_minutes: null }
    await checkDemoLowBalanceAndAlert('acct-1', 3, '/dashboard/channel-partner/settings')
    expect(updateCalls).toHaveLength(0)
    expect(sendDemoLowBalanceAlertEmailCalls).toHaveLength(0)
  })

  it('does nothing when the balance is still above 20% of the reference (not yet 80% consumed)', async () => {
    state.walletRow = { demo_reference_topup_minutes: 20 } // 20% threshold = 4
    await checkDemoLowBalanceAndAlert('acct-1', 5, '/dashboard/channel-partner/settings')
    expect(updateCalls).toHaveLength(0)
    expect(sendDemoLowBalanceAlertEmailCalls).toHaveLength(0)
  })

  // AT-7 — exactly one email fires the first time balance drops to <=20% of reference in a cycle.
  it('AT-7: fires exactly one sendDemoLowBalanceAlertEmail when balance crosses <=20% of reference for the first time', async () => {
    state.walletRow = { demo_reference_topup_minutes: 20 }
    await checkDemoLowBalanceAndAlert('acct-1', 3, '/dashboard/channel-partner/settings')
    expect(updateCalls).toHaveLength(1)
    expect(sendDemoLowBalanceAlertEmailCalls).toHaveLength(1)
    expect(sendDemoLowBalanceAlertEmailCalls[0]).toEqual([
      'clerk-1@example.com',
      'Acme Reseller',
      3,
      20,
      '/dashboard/channel-partner/settings',
    ])
  })

  // AT-7 — race-safe: a second concurrent/later depletion in the same cycle does not fire a second email.
  it('AT-7: does not fire a second email when the compare-and-set has already fired for this cycle', async () => {
    state.compareAndSetWon = false // simulates another concurrent call already having won the CAS
    await checkDemoLowBalanceAndAlert('acct-1', 2, '/dashboard/channel-partner/settings')
    expect(sendDemoLowBalanceAlertEmailCalls).toHaveLength(0)
  })

  it('passes the caller-supplied dashboardPath through to the email function unchanged (admin vs reseller)', async () => {
    await checkDemoLowBalanceAndAlert('30d40f51-5d6e-49e9-bdda-519b7d70e13a', 1, '/dashboard/admin/sales-partners')
    expect(sendDemoLowBalanceAlertEmailCalls[0][4]).toBe('/dashboard/admin/sales-partners')
  })

  it('sends to every partner_admin_users email resolved for the account (multiple admins)', async () => {
    state.adminUsers = [{ clerk_user_id: 'clerk-1' }, { clerk_user_id: 'clerk-2' }]
    await checkDemoLowBalanceAndAlert('acct-1', 1, '/dashboard/channel-partner/settings')
    expect(sendDemoLowBalanceAlertEmailCalls).toHaveLength(2)
  })
})
