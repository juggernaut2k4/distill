import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getConfiguratorAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { NoPartnerAccounts } from '../_shared'

/**
 * /dashboard/configurator/integration — B2B-20 §9, §12. The standalone section route is
 * retired; the section is now hosted inside the unified left-nav surface. This
 * page redirects into `/dashboard/configurator?section=integration`, preserving old deep
 * links and `partner_account_id`.
 */
export default async function IntegrationRedirectPage({ searchParams }: { searchParams: { partner_account_id?: string } }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const accounts = await getConfiguratorAccountsForClerkUser(userId)
  if (accounts.length === 0) return <NoPartnerAccounts />

  const activeId = searchParams.partner_account_id && accounts.some((a) => a.id === searchParams.partner_account_id)
    ? searchParams.partner_account_id
    : accounts[0].id

  redirect(`/dashboard/configurator?partner_account_id=${activeId}&section=integration`)
}
