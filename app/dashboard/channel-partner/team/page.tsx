import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getChannelPartnerAccountForClerkUser } from '@/lib/partner/admin-accounts'
import { getShowcaseAccessEnabled } from '@/lib/partner/auth'
import { ChannelPartnerShell, NoChannelPartnerAccount } from '../_shared'
import TeamClient from './TeamClient'

/**
 * /dashboard/channel-partner/team — B2B-26 Team screen
 * (docs/specs/B2B-26-requirement-document.md §4). `?action=invite`
 * deep-links the inline "Invite a team member" form open on arrival.
 *
 * NOTE — this is a new file, distinct from and not importing
 * `app/dashboard/admin/team/TeamClient.tsx` (different directory, zero
 * shared code beyond the `_shared.tsx` design tokens both already import),
 * per the spec's explicit instruction.
 */
export default async function ChannelPartnerTeamPage({ searchParams }: { searchParams: { action?: string } }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const account = await getChannelPartnerAccountForClerkUser(userId)
  if (!account) return <NoChannelPartnerAccount />

  const showShowcaseTab = await getShowcaseAccessEnabled(account.id)

  return (
    <ChannelPartnerShell companyName={account.name} active="team" showShowcaseTab={showShowcaseTab}>
      <TeamClient initialFormOpen={searchParams.action === 'invite'} />
    </ChannelPartnerShell>
  )
}
