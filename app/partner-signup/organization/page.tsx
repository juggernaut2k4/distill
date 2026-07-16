'use client'

import { CreateOrganization } from '@clerk/nextjs'

/**
 * B2B-06 — `/partner-signup/organization` (Requirement Doc Section 4.A,
 * Screen state 2). Second step of the self-serve partner signup wrapper:
 * same dark-void styling/appearance precedent as `/partner-signup`, reused
 * verbatim. Once the Clerk Organization is created, Clerk's own client
 * redirects to `/dashboard/configurator` — this document adds no new
 * redirect logic of its own; B2B-05's existing, unmodified wizard
 * entry-point redirect (`app/dashboard/configurator/page.tsx`) takes over
 * from there (Section 4.A, Screen state 2's own finding).
 *
 * Screen state 3 (webhook-landing race, `<NoPartnerAccounts />` on
 * `/dashboard/configurator`) is a known, expected transient state per
 * Section 9 — no handling is added on this page itself.
 */
export default function PartnerSignUpOrganizationPage() {
  return (
    <div className="min-h-screen bg-void flex items-center justify-center">
      <CreateOrganization
        afterCreateOrganizationUrl="/dashboard/configurator"
        appearance={{
          variables: {
            colorBackground: '#111111',
            colorText: '#ffffff',
            colorPrimary: '#7C3AED',
            colorInputBackground: '#1A1A1A',
            colorInputText: '#ffffff',
          },
          elements: {
            socialButtonsBlockButton: '!bg-white !text-gray-900 !border !border-gray-300 hover:!bg-gray-100 hover:!text-gray-900',
            socialButtonsBlockButtonText: '!text-gray-900 !font-medium',
            socialButtonsBlockButtonArrow: '!text-gray-900',
          },
        }}
      />
    </div>
  )
}
