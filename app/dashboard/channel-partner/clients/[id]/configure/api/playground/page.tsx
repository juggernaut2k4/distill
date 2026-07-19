import { redirect } from 'next/navigation'
import { requireChannelPartnerClientAccess } from '@/lib/partner/auth'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import PlaygroundClient from '@/app/dashboard/configurator/api/playground/PlaygroundClient'

/**
 * /dashboard/channel-partner/clients/[id]/configure/api/playground —
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §6.13). Mirrors
 * `/dashboard/configurator/api/playground/page.tsx`, with
 * `requireChannelPartnerClientAccess` in place of
 * `getConfiguratorAccountsForClerkUser`, a single-element `accounts` array,
 * and `basePath` passed to `PlaygroundClient`. No `onboarding_completed_at`
 * wizard-redirect gate (§6.13 — deliberate omission, matches the sibling
 * pages in this route tree).
 */
export default async function ClientPlaygroundPage({ params }: { params: { id: string } }) {
  const access = await requireChannelPartnerClientAccess(params.id)
  if (access.error) redirect('/dashboard/channel-partner/clients')

  const accounts: AdminPartnerAccount[] = [{ id: access.client.id, name: access.client.name, account_kind: 'partner' }]

  return (
    <PlaygroundClient
      accounts={accounts}
      activePartnerAccountId={access.client.id}
      basePath={`/dashboard/channel-partner/clients/${params.id}/configure`}
    />
  )
}
