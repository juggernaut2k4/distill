import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getChannelPartnerAccountForClerkUser } from '@/lib/partner/admin-accounts'
import { getShowcaseAccessEnabled } from '@/lib/partner/auth'
import { listClientsForChannelPartner } from '@/lib/partner/clients'
import { ChannelPartnerShell, NoChannelPartnerAccount } from '../_shared'
import DeveloperClient from './DeveloperClient'

/**
 * /dashboard/channel-partner/developer — B2B-78 §4.B / B2B-79 §4. One shared page, four tabs
 * (Passcodes, API Keys, Bot Voices, Domain — B2B-79 owns the Domain tab's own spec in full, this
 * page only reserves its place in the shared nav/tab-bar per B2B-78 §4.B).
 *
 * Same gate shape as every other `/dashboard/channel-partner/*` page: Clerk `auth()`,
 * `getChannelPartnerAccountForClerkUser`, `<NoChannelPartnerAccount />` if none.
 */
export default async function ChannelPartnerDeveloperPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const account = await getChannelPartnerAccountForClerkUser(userId)
  if (!account) return <NoChannelPartnerAccount />

  const [showShowcaseTab, clients] = await Promise.all([
    getShowcaseAccessEnabled(account.id),
    listClientsForChannelPartner(account.id),
  ])

  return (
    <ChannelPartnerShell companyName={account.name} active="developer" showShowcaseTab={showShowcaseTab}>
      <DeveloperClient clients={clients.filter((c) => !c.is_self_client).map((c) => ({ id: c.id, name: c.name }))} />
    </ChannelPartnerShell>
  )
}
