import { redirect } from 'next/navigation'
import { requireChannelPartnerClientAccess } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getBillingHealth } from '@/app/dashboard/configurator/_billing-health'
import { VISIBLE_SECTIONS, type ConfiguratorSection } from '@/lib/partner/configurator-status'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import ConfiguratorSurface from '@/app/dashboard/configurator/ConfiguratorSurface'

/**
 * /dashboard/channel-partner/clients/[id]/configure — B2B-29
 * (docs/specs/B2B-29-requirement-document.md §6.13). Mirrors
 * `/dashboard/configurator/page.tsx` structurally, with two differences:
 * (1) auth is `requireChannelPartnerClientAccess(params.id)` instead of
 * `getConfiguratorAccountsForClerkUser`; (2) the resolved `accounts` array
 * passed to `ConfiguratorSurface` is a single-element array built from the
 * resolved client, and `ConfiguratorSurface` receives
 * `basePath`/`navLabel="Configure"` so every internal nav link, back-link,
 * and Stripe-return stays inside this client-scoped route tree.
 *
 * Deliberately NOT replicated here: the `onboarding_completed_at`-gated
 * wizard redirect the sibling pages (api/docs/known-bugs) still carry — the
 * main `/dashboard/configurator/page.tsx` itself already dropped this
 * redirect under B2B-20, and reusing it here would gate navigation on
 * `onboarding_completed_at` for a client account, violating this brief's own
 * Known Constraint ("gate is on usage, never navigation").
 */

type PanelSection = ConfiguratorSection | 'go_live' | 'dashboard'

const VALID_SECTIONS: PanelSection[] = [...VISIBLE_SECTIONS, 'go_live', 'dashboard']

export default async function ClientConfigurePage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { section?: string }
}) {
  const access = await requireChannelPartnerClientAccess(params.id)
  // §6.13 — 403/not-yours (or no session) → back to the client list, no
  // separate error page needed for a client-facing internal tool.
  if (access.error) redirect('/dashboard/channel-partner/clients')

  const accounts: AdminPartnerAccount[] = [{ id: access.client.id, name: access.client.name, account_kind: 'partner' }]

  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('onboarding_completed_at')
    .eq('id', access.client.id)
    .maybeSingle()

  const isLive = !!account?.onboarding_completed_at
  const onboardingCompletedAt = (account?.onboarding_completed_at as string | null) ?? null

  const requested = searchParams.section as PanelSection | undefined
  const initialSection: PanelSection = requested && VALID_SECTIONS.includes(requested) ? requested : 'dashboard'

  const billingHealth = await getBillingHealth(access.client.id)

  return (
    <ConfiguratorSurface
      accounts={accounts}
      activePartnerAccountId={access.client.id}
      billingHealth={billingHealth}
      isLive={isLive}
      onboardingCompletedAt={onboardingCompletedAt}
      initialSection={initialSection}
      basePath={`/dashboard/channel-partner/clients/${params.id}/configure`}
      navLabel="Configure"
    />
  )
}
