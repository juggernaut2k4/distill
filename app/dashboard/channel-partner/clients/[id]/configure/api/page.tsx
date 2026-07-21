import { redirect } from 'next/navigation'
import { requireChannelPartnerClientAccess } from '@/lib/partner/auth'
import { getBillingHealth } from '@/app/dashboard/configurator/_billing-health'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import ApiClient from '@/app/dashboard/configurator/api/ApiClient'

/**
 * /dashboard/channel-partner/clients/[id]/configure/api — B2B-29
 * (docs/specs/B2B-29-requirement-document.md §6.13). Mirrors
 * `/dashboard/configurator/api/page.tsx`, with `requireChannelPartnerClientAccess`
 * in place of `getConfiguratorAccountsForClerkUser`, a single-element
 * `accounts` array built from the resolved client, and `basePath` passed to
 * `ApiClient`. Deliberately does NOT carry the `onboarding_completed_at`
 * wizard-redirect gate its direct-partner sibling still has (§6.13) — that
 * would gate navigation on a column for a client account, violating this
 * brief's Known Constraint that payment/setup gates usage, never navigation.
 */
export default async function ClientApiPage({ params }: { params: { id: string } }) {
  const access = await requireChannelPartnerClientAccess(params.id)
  if (access.error) redirect('/dashboard/channel-partner/clients')

  const accounts: AdminPartnerAccount[] = [{ id: access.client.id, name: access.client.name, account_kind: 'partner' }]
  const billingHealth = await getBillingHealth(access.client.id)

  return (
    <ApiClient
      accounts={accounts}
      activePartnerAccountId={access.client.id}
      billingHealth={billingHealth}
      basePath={`/dashboard/channel-partner/clients/${params.id}/configure`}
      navLabel="Configure"
    />
  )
}
