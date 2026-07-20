import { redirect } from 'next/navigation'
import { requireChannelPartnerClientAccess } from '@/lib/partner/auth'
import { getBillingHealth } from '@/app/dashboard/configurator/_billing-health'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import KnownBugsClient from '@/app/dashboard/configurator/known-bugs/KnownBugsClient'

/**
 * /dashboard/channel-partner/clients/[id]/configure/known-bugs — B2B-29
 * (docs/specs/B2B-29-requirement-document.md §6.13, §9). Mirrors
 * `/dashboard/configurator/known-bugs/page.tsx`, with
 * `requireChannelPartnerClientAccess` in place of
 * `getConfiguratorAccountsForClerkUser`, a single-element `accounts` array.
 * `KnownBugsClient` correctly shows the CLIENT's own known-bugs data (not the
 * sales-partner's) via `activePartnerAccountId`. No `onboarding_completed_at`
 * wizard-redirect gate (§6.13 — deliberate omission).
 *
 * Hotfix (2026-07-19/20, live-tested by Arun): `basePath`/`navLabel` ARE
 * required here after all — the original claim that `KnownBugsClient` "needs
 * no basePath prop" checked only for hardcoded literals inside that
 * component, and missed that it renders `<ConfiguratorNavShell>` without
 * forwarding them, which silently fell back to that shared component's own
 * unscoped defaults for the nav bar's Configurator/API/Docs links.
 */
export default async function ClientKnownBugsPage({ params }: { params: { id: string } }) {
  const access = await requireChannelPartnerClientAccess(params.id)
  if (access.error) redirect('/dashboard/channel-partner/clients')

  const accounts: AdminPartnerAccount[] = [{ id: access.client.id, name: access.client.name, account_kind: 'partner' }]
  const billingHealth = await getBillingHealth(access.client.id)

  return (
    <KnownBugsClient
      accounts={accounts}
      activePartnerAccountId={access.client.id}
      billingHealth={billingHealth}
      basePath={`/dashboard/channel-partner/clients/${params.id}/configure`}
      navLabel="Configure"
    />
  )
}
