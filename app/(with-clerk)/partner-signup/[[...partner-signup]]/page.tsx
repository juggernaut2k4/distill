'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SignUp, useAuth } from '@clerk/nextjs'
import { Loader2 } from 'lucide-react'

/**
 * B2B-25 — `/partner-signup` (docs/specs/B2B-25-requirement-document.md §4).
 * Replaces the old two-step Clerk `<SignUp>` → `<CreateOrganization>` flow.
 *
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §4, §6.6) — the
 * pre-signup 'capture' step (a Clio-owned "Company name" form rendered before
 * Clerk mounts) is REMOVED entirely. Company info is now collected
 * post-signup from the dashboard (`/dashboard/channel-partner/settings`).
 * `Step` shrinks from 4 states to 3. On mount: an already-signed-in visitor
 * auto-fires `submitClaim()` immediately (no click); a signed-out visitor
 * goes straight to `signup` (Clerk `<SignUp>`), also with no click.
 *
 * State 1 ('signup') — Clerk's `<SignUp>`, mounted immediately for a signed-
 *   out visitor, no interstitial of any kind above it.
 * State 1b ('claiming' / 'claim-error') — an already-signed-in visitor (e.g.
 *   one who reached this page via `/sign-in`'s built-in "Sign up" link)
 *   skips Clerk's `<SignUp>` entirely and calls the authenticated claim
 *   route instead, automatically on mount.
 * State 2 — post-signup landing on `/dashboard/channel-partner`, handled
 *   outside this page.
 *
 * Hotfix (2026-07-20, live-tested by Arun): `<SignUp>`'s `forceRedirectUrl`
 * now points back to `/partner-signup` itself, not straight to
 * `/dashboard/channel-partner`. Clerk applies the `unsafeMetadata` prop via
 * `signUp.create()`, which only fires for the email/password strategy — an
 * OAuth (Google) signup goes through `authenticateWithRedirect` instead, so
 * the `user.created` webhook never saw `signup_intent: 'partner'` and no
 * account was created, landing the user on a dead-end "You don't administer
 * a sales-partner account" page. Redirecting back here re-triggers State 1b's
 * existing `submitClaim()` on mount for every signup path (OAuth or
 * email/password), which reuses the idempotent authenticated claim route
 * instead of depending on webhook metadata timing at all.
 *
 * Catch-all route: unchanged reasoning from the prior version of this file —
 * Clerk's `<SignUp>` needs to own every sub-path under its mount point for
 * its own internal step navigation (e.g. `/partner-signup/verify-email-address`).
 *
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4) — the "Do you manage
 * multiple clients?" Yes/No toggle B2B-26 added is REMOVED entirely. Direct
 * partners are now invite-only via `/partner-invite/accept`; every completed
 * `/partner-signup` signup unconditionally produces `account_kind='channel_partner'`
 * and lands on `/dashboard/channel-partner`. State 1b's redirect ternary is
 * KEPT — it is now the only way a signed-in visitor who already administers a
 * direct-partner account (self-serve-era or invite-created) reaches
 * `/dashboard/configurator` from this page (non-regression, §4/§9 Edge Case).
 */

type Step = 'signup' | 'claiming' | 'claim-error'

const clerkAppearance = {
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
}

export default function PartnerSignUpPage() {
  const { isLoaded, isSignedIn } = useAuth()
  const router = useRouter()
  const [step, setStep] = useState<Step>('signup')

  async function submitClaim() {
    setStep('claiming')
    try {
      const res = await fetch('/api/partner-signup/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) {
        setStep('claim-error')
        return
      }
      // B2B-26 §4 State 2b/§9 Edge Case 2, re-verified by B2B-28 §4 and
      // B2B-29 §6.6 — the redirect destination is taken from the API
      // response's accountKind, never from a local toggle: an already-
      // existing account's real kind always wins. This is now the ONLY way a
      // signed-in /partner-signup visitor ever reaches /dashboard/configurator.
      router.push(data.accountKind === 'channel_partner' ? '/dashboard/channel-partner' : '/dashboard/configurator')
    } catch {
      setStep('claim-error')
    }
  }

  // B2B-29 §4/§6.6 — auto-fires on mount, no click required: an
  // already-signed-in visitor claims immediately, a signed-out visitor goes
  // straight to Clerk's <SignUp>.
  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn) {
      void submitClaim()
    } else {
      setStep('signup')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn])

  // Page-load gate — mirrors the !isLoaded guard idiom this app already uses
  // for auth-dependent renders.
  if (!isLoaded) {
    return <div className="min-h-screen bg-void" />
  }

  if (step === 'signup') {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <SignUp
          forceRedirectUrl="/partner-signup"
          unsafeMetadata={{
            signup_intent: 'partner',
          }}
          appearance={clerkAppearance}
        />
      </div>
    )
  }

  return (
    <div
      className="min-h-screen bg-void flex items-center justify-center"
      style={{ padding: 'clamp(1rem, 5vw, 2rem)' }}
    >
      <div className="max-w-sm w-full bg-[#111111] border border-[#222222] rounded-xl p-6">
        {step === 'claiming' && (
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-white" />
            <h1 className="text-xl font-semibold text-white">Setting up your account...</h1>
          </div>
        )}

        {step === 'claim-error' && (
          <div>
            <p className="text-[#EF4444] text-sm">Something went wrong setting up your account.</p>
            <button
              onClick={() => void submitClaim()}
              className="mt-4 w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
