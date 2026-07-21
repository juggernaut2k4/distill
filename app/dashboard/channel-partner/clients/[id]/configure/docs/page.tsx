import { redirect } from 'next/navigation'
import { requireChannelPartnerClientAccess } from '@/lib/partner/auth'
import { getBillingHealth } from '@/app/dashboard/configurator/_billing-health'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import DocsClient from '@/app/dashboard/configurator/docs/DocsClient'

/**
 * /dashboard/channel-partner/clients/[id]/configure/docs — B2B-29
 * (docs/specs/B2B-29-requirement-document.md §6.13). Mirrors
 * `/dashboard/configurator/docs/page.tsx`, with
 * `requireChannelPartnerClientAccess` in place of
 * `getConfiguratorAccountsForClerkUser`, a single-element `accounts` array,
 * and `basePath` passed to `DocsClient`. No `onboarding_completed_at`
 * wizard-redirect gate (§6.13 — deliberate omission).
 */
export default async function ClientDocsPage({ params }: { params: { id: string } }) {
  const access = await requireChannelPartnerClientAccess(params.id)
  if (access.error) redirect('/dashboard/channel-partner/clients')

  const accounts: AdminPartnerAccount[] = [{ id: access.client.id, name: access.client.name, account_kind: 'partner' }]
  const billingHealth = await getBillingHealth(access.client.id)

  return (
    <DocsClient
      accounts={accounts}
      activePartnerAccountId={access.client.id}
      billingHealth={billingHealth}
      basePath={`/dashboard/channel-partner/clients/${params.id}/configure`}
      navLabel="Configure"
    />
  )
}
