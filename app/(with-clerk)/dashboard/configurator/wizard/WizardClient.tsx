'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'

/**
 * B2B-20 §12 — the forced-linear onboarding wizard is retired and unified into
 * `/dashboard/configurator` (`ConfiguratorSurface`). Its former linear shell,
 * `StepIndicator`, and `advance` logic are removed; its `PaymentStep` and
 * `GoLiveStep` were extracted into `PaymentConfigClient` and `GoLivePanel`
 * respectively BEFORE this reduction (build guardrail: extract-and-verify,
 * then reduce — never delete outright, recoverable in git).
 *
 * The route's own `page.tsx` already server-redirects into the unified surface;
 * this component is retained as a thin client-side redirect stub so any residual
 * render path still lands on the surface rather than a blank page.
 */
export default function WizardClient({
  activePartnerAccountId,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
}) {
  const router = useRouter()

  useEffect(() => {
    router.replace(`/dashboard/configurator?partner_account_id=${activePartnerAccountId}`)
  }, [router, activePartnerAccountId])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#080808]">
      <p className="text-sm text-[#94A3B8]">Redirecting to your Configurator…</p>
    </div>
  )
}
