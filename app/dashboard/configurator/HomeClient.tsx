'use client'

import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import type { BillingHealth } from './_shared'
import ConfiguratorSurface from './ConfiguratorSurface'

/**
 * B2B-20 — the former post-go-live card-grid Home is retired and unified into
 * `ConfiguratorSurface` (§1, §12). This file is intentionally reduced to a thin
 * delegating stub rather than deleted (build guardrail: reduce, don't purge —
 * recoverable in git). `page.tsx` renders `ConfiguratorSurface` directly and no
 * longer imports this; the delegation exists only so any residual import keeps
 * working. A Home import implies a live partner, so it defaults to `isLive` +
 * the Questionnaire section.
 */
export default function HomeClient({
  accounts,
  activePartnerAccountId,
  billingHealth,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  billingHealth: BillingHealth
}) {
  return (
    <ConfiguratorSurface
      accounts={accounts}
      activePartnerAccountId={activePartnerAccountId}
      billingHealth={billingHealth}
      isLive
      onboardingCompletedAt={null}
      initialSection="questionnaire"
    />
  )
}
