import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getChannelPartnerAccountForClerkUser } from '@/lib/partner/admin-accounts'
import { ChannelPartnerShell, NoChannelPartnerAccount } from '../_shared'
import SettingsClient from './SettingsClient'

/**
 * /dashboard/channel-partner/settings — B2B-29 (docs/specs/B2B-29-requirement-document.md
 * §4). Company info + Payment for the sales-partner's own account. Same gate
 * shape as every other `/dashboard/channel-partner/*` page: Clerk `auth()`,
 * `getChannelPartnerAccountForClerkUser`, `<NoChannelPartnerAccount />` if
 * none.
 */
export default async function ChannelPartnerSettingsPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const account = await getChannelPartnerAccountForClerkUser(userId)
  if (!account) return <NoChannelPartnerAccount />

  return (
    <ChannelPartnerShell companyName={account.name} active="settings">
      <SettingsClient />
    </ChannelPartnerShell>
  )
}
