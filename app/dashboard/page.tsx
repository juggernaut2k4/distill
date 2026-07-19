import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPartnerAccountsForClerkUser } from '@/lib/partner/admin-accounts'

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §6.9) — smart router.
 * Resolves the signed-in Clerk user's membership(s) and sends a
 * `channel_partner`-kind admin to their own dashboard, everyone else
 * (direct partners, zero-membership users) to the Configurator exactly as
 * before — byte-identical end destination to the pre-B2B-26 unconditional
 * redirect for every existing user population.
 */
export default async function DashboardPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const accounts = await getPartnerAccountsForClerkUser(userId)
  if (accounts.some((a) => a.account_kind === 'channel_partner')) {
    redirect('/dashboard/channel-partner')
  }
  redirect('/dashboard/configurator')
}
