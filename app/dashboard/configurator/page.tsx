import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPartnerAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { NoPartnerAccounts } from './_shared'
import { getBillingHealth } from './_billing-health'
import { getConfiguratorStatus, type ConfiguratorSection } from '@/lib/partner/configurator-status'
import ConfiguratorSurface from './ConfiguratorSurface'

/**
 * /dashboard/configurator — B2B-20 unified Configurator surface. Clerk-
 * authenticated, partner-admin-only. Renders the single left-nav + panel
 * `ConfiguratorSurface` for BOTH first-run setup and ongoing editing (the
 * forced-linear wizard redirect and the separate card-grid Home are removed —
 * B2B-20 §3, §12).
 */

type PanelSection = ConfiguratorSection | 'go_live'

const VALID_SECTIONS: PanelSection[] = [
  'questionnaire',
  'topics',
  'content',
  'visualization',
  'domain',
  'integration',
  'payment',
  'go_live',
]

// Canonical order for the not-yet-live first-incomplete default (§3).
const CANONICAL_ORDER: ConfiguratorSection[] = [
  'questionnaire',
  'topics',
  'content',
  'visualization',
  'domain',
  'integration',
  'payment',
]

export default async function ConfiguratorHomePage({
  searchParams,
}: {
  searchParams: { partner_account_id?: string; section?: string; welcome?: string; funded?: string }
}) {
  const { userId, sessionClaims } = auth()
  if (!userId) redirect('/sign-in')

  let accounts = await getPartnerAccountsForClerkUser(userId)

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
      accounts = await getPartnerAccountsForClerkUser(userId)
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

  // Resolve the default section (§3). An explicit, valid `?section=` always
  // wins. Otherwise: live → Questionnaire (first item); not-live → first
  // incomplete section, or Go Live if everything is already complete.
  const requested = searchParams.section as PanelSection | undefined
  let initialSection: PanelSection
  if (requested && VALID_SECTIONS.includes(requested)) {
    initialSection = requested
  } else if (isLive) {
    initialSection = 'questionnaire'
  } else {
    const status = await getConfiguratorStatus(activeId)
    const firstIncomplete = CANONICAL_ORDER.find((k) => !status[k])
    initialSection = firstIncomplete ?? 'go_live'
  }

  const billingHealth = await getBillingHealth(activeId)

  return (
    <ConfiguratorSurface
      accounts={accounts}
      activePartnerAccountId={activeId}
      billingHealth={billingHealth}
      isLive={isLive}
      initialSection={initialSection}
    />
  )
}
