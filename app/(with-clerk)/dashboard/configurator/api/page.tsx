import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getConfiguratorAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { getBillingHealth } from '../_billing-health'
import ApiClient from './ApiClient'

/**
 * /dashboard/configurator/api — B2B-16 (Requirement Doc Section 4.3), split out
 * of the former `developer/` page. Follows `topics/page.tsx`'s Clerk `auth()`
 * gate, but does NOT require a real reseller-account membership — or a
 * completed onboarding wizard — the way every other Configurator screen does.
 *
 * Per Arun's direct instruction (2026-08-10): this page is pure reference
 * documentation plus a playground that only ever executes with a credential
 * the visitor pastes in themselves — nothing account-specific or sensitive is
 * ever displayed here. Since every hello-clio registration is already
 * admin-approved, any signed-in Clerk user should be able to view it, not
 * only users with a `partner_admin_users` row.
 *
 * Deliberately DOES NOT run the B2B-05 wizard entry-point redirect every
 * other Configurator screen has (Requirement Doc Section 13.3,
 * architecture.md §14.7.4) — a real regression found live: an admin whose
 * own accounts have `onboarding_completed_at: null` (true for Clio's two
 * internal accounts) got bounced straight to the onboarding wizard instead
 * of ever seeing the docs, since that check ran unconditionally for anyone
 * with at least one real account. This page has no dependency on any
 * account's onboarding state at all, so the check is skipped entirely
 * rather than conditionally bypassed.
 *
 * A user with zero real accounts gets `accounts: []` (the account-switcher
 * in the shell simply renders nothing) and an inert, always-`healthy`
 * billing-health banner state rather than a real per-account read.
 */
export default async function ApiPage({ searchParams }: { searchParams: { partner_account_id?: string } }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const accounts = await getConfiguratorAccountsForClerkUser(userId)

  if (accounts.length === 0) {
    return (
      <ApiClient
        accounts={[]}
        activePartnerAccountId=""
        billingHealth={{ state: 'healthy', balance_usd: null, next_billing_date: null }}
      />
    )
  }

  const activeId = searchParams.partner_account_id && accounts.some((a) => a.id === searchParams.partner_account_id)
    ? searchParams.partner_account_id
    : accounts[0].id

  const billingHealth = await getBillingHealth(activeId)

  return <ApiClient accounts={accounts} activePartnerAccountId={activeId} billingHealth={billingHealth} />
}
