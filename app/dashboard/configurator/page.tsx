import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPartnerAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { NoPartnerAccounts } from './_shared'
import { getBillingHealth } from './_billing-health'
import HomeClient from './HomeClient'

/**
 * /dashboard/configurator — Configurator Home (Requirement Doc Section 4.A.0).
 * Clerk-authenticated, partner-admin-only.
 */
export default async function ConfiguratorHomePage({
  searchParams,
}: {
  searchParams: { partner_account_id?: string; welcome?: string }
}) {
  const { userId, sessionClaims } = auth()
  if (!userId) redirect('/sign-in')

  let accounts = await getPartnerAccountsForClerkUser(userId)

  // B2B-06 Section 9 — Clerk-redirect race mitigation. A brand-new self-serve
  // signup can land here before the async organization.created/
  // organizationMembership.created webhooks have created the partner_accounts/
  // partner_admin_users rows. Retry once, after a short delay, but only for a
  // session that's plausibly "just came from signup" (proxied by session age
  // < 60s) — a long-lived session with genuinely zero accounts must not incur
  // an extra 2s delay on every load.
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

  // B2B-05 wizard entry-point redirect (Requirement Doc Section 13.3, architecture.md §14.7.4).
  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('onboarding_completed_at')
    .eq('id', activeId)
    .single()

  if (!account?.onboarding_completed_at) {
    redirect(`/dashboard/configurator/wizard?partner_account_id=${activeId}`)
  }

  const billingHealth = await getBillingHealth(activeId)

  return <HomeClient accounts={accounts} activePartnerAccountId={activeId} billingHealth={billingHealth} />
}
