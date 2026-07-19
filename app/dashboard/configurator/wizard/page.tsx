import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getConfiguratorAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { NoPartnerAccounts } from '../_shared'

/**
 * /dashboard/configurator/wizard — B2B-20 §3, §12. The forced-linear onboarding
 * wizard is retired and unified into `/dashboard/configurator`. This route now
 * redirects any bookmarked/deep link into the unified surface, preserving
 * `partner_account_id` (AC #18). The old `WizardClient` is reduced to a
 * redirect stub (recoverable in git), not deleted.
 */
export default async function WizardPage({ searchParams }: { searchParams: { partner_account_id?: string } }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const accounts = await getConfiguratorAccountsForClerkUser(userId)
  if (accounts.length === 0) return <NoPartnerAccounts />

  const activeId = searchParams.partner_account_id && accounts.some((a) => a.id === searchParams.partner_account_id)
    ? searchParams.partner_account_id
    : accounts[0].id

  redirect(`/dashboard/configurator?partner_account_id=${activeId}`)
}
