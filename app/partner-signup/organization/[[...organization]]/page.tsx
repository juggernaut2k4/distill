'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CreateOrganization, useAuth } from '@clerk/nextjs'

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
 *
 * Signed-out guard (found 2026-07-17): `<CreateOrganization>` renders
 * nothing at all — no prompt, no redirect — for a visitor with no active
 * Clerk session (e.g. a stale bookmark, or landing here directly rather
 * than via `/partner-signup`'s post-signup redirect). Send them to sign
 * in first, same destination pattern as every other auth-gated route in
 * this app, then straight back here.
 *
 * Catch-all route (found 2026-07-17, same bug class as `/partner-signup`
 * itself): `<CreateOrganization>` is a multi-step Clerk component that
 * needs to own every sub-path under its mount point for its own internal
 * navigation, same as `<SignUp>`. The original single fixed route (no
 * catch-all segment) caused a real, reproduced-live symptom: after
 * successfully creating an organization, the component re-rendered the
 * create-organization form instead of completing, because its internal
 * post-creation navigation had nowhere valid to land. Moved to
 * `[[...organization]]`, matching the same fix already applied to
 * `/partner-signup`.
 */
export default function PartnerSignUpOrganizationPage() {
  const { isLoaded, isSignedIn } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace('/sign-in?redirect_url=/partner-signup/organization')
    }
  }, [isLoaded, isSignedIn, router])

  if (!isLoaded || !isSignedIn) {
    return <div className="min-h-screen bg-void" />
  }

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
