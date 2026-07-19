import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getChannelPartnerAccountForClerkUser } from '@/lib/partner/admin-accounts'
import { ChannelPartnerShell, NoChannelPartnerAccount } from '../_shared'
import ClientsClient from './ClientsClient'

/**
 * /dashboard/channel-partner/clients — B2B-26 Clients screen
 * (docs/specs/B2B-26-requirement-document.md §4). `?action=add` deep-links
 * the inline "Add client" form open on arrival (mirrors B2B-24's own
 * `?section=` deep-link pattern for quick-nav tiles).
 */
export default async function ChannelPartnerClientsPage({ searchParams }: { searchParams: { action?: string } }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const account = await getChannelPartnerAccountForClerkUser(userId)
  if (!account) return <NoChannelPartnerAccount />

  return (
    <ChannelPartnerShell companyName={account.name} active="clients">
      <ClientsClient initialFormOpen={searchParams.action === 'add'} />
    </ChannelPartnerShell>
  )
}
