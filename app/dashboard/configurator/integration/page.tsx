import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPartnerAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { NoPartnerAccounts } from '../_shared'
import IntegrationClient from './IntegrationClient'

/**
 * /dashboard/configurator/integration — B2B-06 (Requirement Doc Section
 * 4.C). Follows `domain/page.tsx` exactly: Clerk `auth()` gate,
 * `getPartnerAccountsForClerkUser`, `<NoPartnerAccounts />` if empty, the
 * standard wizard entry-point redirect if onboarding isn't complete yet.
 */
export default async function IntegrationConfigPage({ searchParams }: { searchParams: { partner_account_id?: string } }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const accounts = await getPartnerAccountsForClerkUser(userId)
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

  return <IntegrationClient accounts={accounts} activePartnerAccountId={activeId} />
}
