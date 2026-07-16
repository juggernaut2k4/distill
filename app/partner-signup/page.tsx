'use client'

import { SignUp } from '@clerk/nextjs'

/**
 * B2B-06 — `/partner-signup` (Requirement Doc Section 4.A, Screen state 1).
 * Self-serve partner signup wrapper: reuses the exact dark-void styling and
 * `appearance` variables already established by
 * `app/(auth)/sign-up/[[...sign-up]]/page.tsx` (the B2C precedent), per
 * CLAUDE.md's "follow an established precedent rather than invent one when
 * one already exists" instruction. Only `forceRedirectUrl` differs — no new
 * copy is written here; Clerk's own hosted form renders entirely.
 */
export default function PartnerSignUpPage() {
  return (
    <div className="min-h-screen bg-void flex items-center justify-center">
      <SignUp
        forceRedirectUrl="/partner-signup/organization"
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
