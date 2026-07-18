import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPartnerAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { NoPartnerAccounts } from '../_shared'
import { getBillingHealth } from '../_billing-health'
import KnownBugsClient from './KnownBugsClient'

/**
 * /dashboard/configurator/known-bugs — B2B-22 Requirement Doc §6.6, mirrors
 * `app/dashboard/configurator/api/page.tsx`'s exact shape: Clerk `auth()` gate,
 * `getPartnerAccountsForClerkUser`, `<NoPartnerAccounts />` if empty, the standard wizard
 * entry-point redirect if onboarding isn't complete yet, then a read-only billing-health read for
 * the non-blocking banner. No new page shape invented.
 */
export default async function KnownBugsPage({ searchParams }: { searchParams: { partner_account_id?: string } }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const accounts = await getPartnerAccountsForClerkUser(userId)
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

  return <KnownBugsClient accounts={accounts} activePartnerAccountId={activeId} billingHealth={billingHealth} />
}
