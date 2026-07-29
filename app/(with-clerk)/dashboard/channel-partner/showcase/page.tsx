import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getChannelPartnerAccountForClerkUser } from '@/lib/partner/admin-accounts'
import { getShowcaseAccessEnabled } from '@/lib/partner/auth'
import { ChannelPartnerShell, NoChannelPartnerAccount } from '../_shared'
import { ShowcaseSubNav } from './_shared'
import ShowcaseContentClient from './ShowcaseContentClient'

/**
 * /dashboard/channel-partner/showcase — B2B-31 (docs/specs/
 * B2B-31-requirement-document.md §4), Content tab (default). Same page-level
 * gate shape as every other `/dashboard/channel-partner/*` page (Clerk
 * `auth()`, `getChannelPartnerAccountForClerkUser`,
 * `<NoChannelPartnerAccount />`), plus the new `showcase_access_enabled`
 * check — a non-allowlisted admin is redirected straight back to the
 * dashboard and never sees this page render (E-3/AT-1). Page components
 * can't return a `NextResponse` (only JSX or `redirect()`), so this reads
 * `getShowcaseAccessEnabled` directly rather than via `requireShowcaseAccess`
 * (that function is for the `/api/channel-partner/showcase/*` route tree).
 */
export default async function ShowcaseContentPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const account = await getChannelPartnerAccountForClerkUser(userId)
  if (!account) return <NoChannelPartnerAccount />

  const showcaseEnabled = await getShowcaseAccessEnabled(account.id)
  if (!showcaseEnabled) redirect('/dashboard/channel-partner')

  return (
    <ChannelPartnerShell companyName={account.name} active="showcase" showShowcaseTab={true}>
      <ShowcaseSubNav active="content" />
      <ShowcaseContentClient />
    </ChannelPartnerShell>
  )
}
