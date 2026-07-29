import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getConfiguratorAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { NoPartnerAccounts } from '../_shared'
import { getBillingHealth } from '../_billing-health'
import ApiClient from './ApiClient'

/**
 * /dashboard/configurator/api — B2B-16 (Requirement Doc Section 4.3), split out
 * of the former `developer/` page. Follows `topics/page.tsx` exactly: Clerk
 * `auth()` gate, `getPartnerAccountsForClerkUser`, `<NoPartnerAccounts />` if
 * empty, the standard wizard entry-point redirect if onboarding isn't complete
 * yet, then a read-only billing-health read for the non-blocking banner.
 */
export default async function ApiPage({ searchParams }: { searchParams: { partner_account_id?: string } }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const accounts = await getConfiguratorAccountsForClerkUser(userId)
  if (accounts.length === 0) return <NoPartnerAccounts />

  const activeId = searchParams.partner_account_id && accounts.some((a) => a.id === searchParams.partner_account_id)
    ? searchParams.partner_account_id
    : accounts[0].id

  // B2B-05 wizard entry-point redirect (Requirement Doc Section 13.3, architecture.md §14.7.4) —
  // same convention every other Configurator screen follows.
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

  return <ApiClient accounts={accounts} activePartnerAccountId={activeId} billingHealth={billingHealth} />
}
