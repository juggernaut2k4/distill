import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getConfiguratorAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { NoPartnerAccounts } from './_shared'
import { getBillingHealth } from './_billing-health'
import { VISIBLE_SECTIONS, type ConfiguratorSection } from '@/lib/partner/configurator-status'
import ConfiguratorSurface from './ConfiguratorSurface'

/**
 * /dashboard/configurator — B2B-20 unified Configurator surface. Clerk-
 * authenticated, partner-admin-only. Renders the single left-nav + panel
 * `ConfiguratorSurface` for BOTH first-run setup and ongoing editing (the
 * forced-linear wizard redirect and the separate card-grid Home are removed —
 * B2B-20 §3, §12).
 */

type PanelSection = ConfiguratorSection | 'go_live' | 'dashboard'

// B2B-23 §6.1 — narrowed to only the currently-visible sections + go_live.
// B2B-24 §12 — 'dashboard' added; it is now also the fallback default when
// `?section=` is absent/invalid (see initialSection below). Any `?section=`
// value outside this list (including every hidden section's key) is treated
// as absent → the default-section rule below applies. This is the entire
// mechanism behind the deep-link-to-a-hidden-section fallback (§4.4) — no
// separate "hidden section" branch is needed.
const VALID_SECTIONS: PanelSection[] = [...VISIBLE_SECTIONS, 'go_live', 'dashboard']

export default async function ConfiguratorHomePage({
  searchParams,
}: {
  searchParams: { partner_account_id?: string; section?: string; welcome?: string; funded?: string }
}) {
  const { userId, sessionClaims } = auth()
  if (!userId) redirect('/sign-in')

  let accounts = await getConfiguratorAccountsForClerkUser(userId)

  // B2B-06 Section 9 — Clerk-redirect race mitigation (unchanged). A brand-new
  // self-serve signup can land here before the async webhooks have created the
  // partner_accounts/partner_admin_users rows. Retry once, briefly, only for a
  // plausibly-just-signed-up session (age < 60s).
  if (accounts.length === 0) {
    const sessionAgeSeconds = typeof sessionClaims?.iat === 'number'
      ? Math.floor(Date.now() / 1000) - sessionClaims.iat
      : Infinity
    if (sessionAgeSeconds < 60) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      accounts = await getConfiguratorAccountsForClerkUser(userId)
    }
  }

  if (accounts.length === 0) return <NoPartnerAccounts />

  const activeId = searchParams.partner_account_id && accounts.some((a) => a.id === searchParams.partner_account_id)
    ? searchParams.partner_account_id
    : accounts[0].id

  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('onboarding_completed_at')
    .eq('id', activeId)
    .single()

  const isLive = !!account?.onboarding_completed_at
  const onboardingCompletedAt = (account?.onboarding_completed_at as string | null) ?? null

  // Resolve the default section (§3, updated B2B-24 §4.6/§12). An explicit,
  // valid `?section=` always wins. Otherwise every partner — brand-new,
  // returning-not-live, or live — lands on Dashboard (Option A). The prior
  // isLive/first-incomplete branching (and the getConfiguratorStatus() call
  // that existed only to support it) is removed: the Dashboard panel
  // computes its own "what's next" CTA client-side from the `status`
  // ConfiguratorSurface already fetches, so no server-side status read is
  // needed just to pick a landing section anymore. A `?section=` naming a
  // hidden section falls outside VALID_SECTIONS and is treated identically
  // to an absent/invalid value — no error, transparently resolved here.
  const requested = searchParams.section as PanelSection | undefined
  const initialSection: PanelSection =
    requested && VALID_SECTIONS.includes(requested) ? requested : 'dashboard'

  const billingHealth = await getBillingHealth(activeId)

  return (
    <ConfiguratorSurface
      accounts={accounts}
      activePartnerAccountId={activeId}
      billingHealth={billingHealth}
      isLive={isLive}
      onboardingCompletedAt={onboardingCompletedAt}
      initialSection={initialSection}
    />
  )
}
