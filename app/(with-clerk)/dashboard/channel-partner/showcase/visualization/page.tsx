import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getChannelPartnerAccountForClerkUser } from '@/lib/partner/admin-accounts'
import { getShowcaseAccessEnabled } from '@/lib/partner/auth'
import { ChannelPartnerShell, NoChannelPartnerAccount } from '../../_shared'
import { ShowcaseSubNav } from '../_shared'
import ShowcaseVisualizationClient from './ShowcaseVisualizationClient'

/**
 * /dashboard/channel-partner/showcase/visualization — B2B-31 (docs/specs/
 * B2B-31-requirement-document.md §4), Visualization tab. Same page-level
 * gate as `../page.tsx` (Content tab) — see that file's comment for why this
 * reads `getShowcaseAccessEnabled` directly instead of `requireShowcaseAccess`.
 */
export default async function ShowcaseVisualizationPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const account = await getChannelPartnerAccountForClerkUser(userId)
  if (!account) return <NoChannelPartnerAccount />

  const showcaseEnabled = await getShowcaseAccessEnabled(account.id)
  if (!showcaseEnabled) redirect('/dashboard/channel-partner')

  return (
    <ChannelPartnerShell companyName={account.name} active="showcase" showShowcaseTab={true}>
      <ShowcaseSubNav active="visualization" />
      <ShowcaseVisualizationClient />
    </ChannelPartnerShell>
  )
}
