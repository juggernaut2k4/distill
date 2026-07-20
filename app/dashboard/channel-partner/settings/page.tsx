import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getChannelPartnerAccountForClerkUser } from '@/lib/partner/admin-accounts'
import { getShowcaseAccessEnabled } from '@/lib/partner/auth'
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

  const showShowcaseTab = await getShowcaseAccessEnabled(account.id)

  return (
    <ChannelPartnerShell companyName={account.name} active="settings" showShowcaseTab={showShowcaseTab}>
      <SettingsClient />
    </ChannelPartnerShell>
  )
}
