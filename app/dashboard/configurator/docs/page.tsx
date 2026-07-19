import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getConfiguratorAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { NoPartnerAccounts } from '../_shared'
import { getBillingHealth } from '../_billing-health'
import DocsClient from './DocsClient'

/**
 * /dashboard/configurator/docs — B2B-16 (Requirement Doc Section 4.4), a new
 * hand-authored documentation surface. Same gate shape as every other
 * Configurator route: Clerk `auth()`, `getPartnerAccountsForClerkUser`,
 * `<NoPartnerAccounts />` if empty, the standard wizard entry-point redirect if
 * onboarding isn't complete yet, then a read-only billing-health read for the
 * non-blocking banner.
 */
export default async function DocsPage({ searchParams }: { searchParams: { partner_account_id?: string } }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const accounts = await getConfiguratorAccountsForClerkUser(userId)
  if (accounts.length === 0) return <NoPartnerAccounts />

  const activeId = searchParams.partner_account_id && accounts.some((a) => a.id === searchParams.partner_account_id)
    ? searchParams.partner_account_id
    : accounts[0].id

  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('onboarding_completed_at')
    .eq('id', activeId)
    .single()

  if (!account?.onboarding_completed_at) {
    redirect(`/dashboard/configurator/wizard?partner_account_id=${activeId}`)
  }

  const billingHealth = await getBillingHealth(activeId)

  return <DocsClient accounts={accounts} activePartnerAccountId={activeId} billingHealth={billingHealth} />
}
