import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPartnerAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { NoPartnerAccounts } from '../_shared'
import WizardClient from './WizardClient'

/**
 * /dashboard/configurator/wizard — onboarding wizard shell (Requirement Doc
 * Section 13.4.A, architecture.md §14.7.4). Inverse of every other
 * Configurator page's entry-point check: unreachable once
 * `onboarding_completed_at` is set (Section 13.6).
 */
export default async function WizardPage({ searchParams }: { searchParams: { partner_account_id?: string } }) {
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

  if (account?.onboarding_completed_at) {
    redirect(`/dashboard/configurator?partner_account_id=${activeId}`)
  }

  return <WizardClient accounts={accounts} activePartnerAccountId={activeId} />
}
