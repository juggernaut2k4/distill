'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SignUp, useAuth } from '@clerk/nextjs'
import { Loader2 } from 'lucide-react'

/**
 * B2B-25 — `/partner-signup` (docs/specs/B2B-25-requirement-document.md §4).
 * Replaces the old two-step Clerk `<SignUp>` → `<CreateOrganization>` flow.
 * Now a single client component with four render branches:
 *
 * State 1 ('capture') — Clio-owned company-name form, rendered before any
 *   Clerk component mounts.
 * State 2 ('signup') — Clerk's `<SignUp>`, unchanged mechanics, with the
 *   captured company name attached via `unsafeMetadata`. Reached only when
 *   the visitor is signed out.
 * State 2b ('claiming' / 'claim-error') — an already-signed-in visitor (e.g.
 *   one who reached this page via `/sign-in`'s built-in "Sign up" link)
 *   skips Clerk's `<SignUp>` entirely and calls the authenticated claim
 *   route instead. Closes the dead-end identified in CEO review (§9 Edge
 *   Case 2).
 * State 3 — post-signup landing on `/dashboard/channel-partner`, handled
 *   outside this page.
 *
 * Catch-all route: unchanged reasoning from the prior version of this file —
 * Clerk's `<SignUp>` needs to own every sub-path under its mount point for
 * its own internal step navigation (e.g. `/partner-signup/verify-email-address`).
 *
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4) — the "Do you manage
 * multiple clients?" Yes/No toggle B2B-26 added is REMOVED entirely (not
 * hardcoded — see the spec's diff-shape reasoning). Direct partners are now
 * invite-only via `/partner-invite/accept`; every completed `/partner-signup`
 * signup unconditionally produces `account_kind='channel_partner'` and lands
 * on `/dashboard/channel-partner`. State 1 is back to byte-identical to
 * B2B-25's original shape. State 2b's redirect ternary is KEPT — it is now
 * the only way a signed-in visitor who already administers a direct-partner
 * account (self-serve-era or invite-created) reaches `/dashboard/configurator`
 * from this page (non-regression, §4/§9 Edge Case).
 */

type Step = 'capture' | 'signup' | 'claiming' | 'claim-error'

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
  const [step, setStep] = useState<Step>('capture')
  const [companyName, setCompanyName] = useState('')
  const [showValidationError, setShowValidationError] = useState(false)

  async function submitClaim() {
    setStep('claiming')
    try {
      const res = await fetch('/api/partner-signup/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: companyName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStep('claim-error')
        return
      }
      // B2B-26 §4 State 2b/§9 Edge Case 2, re-verified by B2B-28 §4 — the
      // redirect destination is taken from the API response's accountKind,
      // never from a local toggle: an already-existing account's real kind
      // always wins. This is now the ONLY way a signed-in /partner-signup
      // visitor ever reaches /dashboard/configurator.
      router.push(data.accountKind === 'channel_partner' ? '/dashboard/channel-partner' : '/dashboard/configurator')
    } catch {
      setStep('claim-error')
    }
  }

  function handleContinue() {
    const trimmed = companyName.trim()
    if (!trimmed) {
      setShowValidationError(true)
      return
    }
    setShowValidationError(false)
    if (isSignedIn) {
      void submitClaim()
    } else {
      setStep('signup')
    }
  }

  // Page-load gate — mirrors the !isLoaded guard idiom this app already uses
  // for auth-dependent renders (previously on the now-deleted
  // /partner-signup/organization page).
  if (!isLoaded) {
    return <div className="min-h-screen bg-void" />
  }

  if (step === 'signup') {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <SignUp
          forceRedirectUrl="/dashboard/channel-partner"
          unsafeMetadata={{
            signup_intent: 'partner',
            company_name: companyName.trim(),
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

        {step === 'capture' && (
          <div>
            <h1 className="text-xl font-semibold text-white">Let&apos;s set up your Clio partner account</h1>

            <div className="mt-4">
              <label htmlFor="company-name" className="block text-[#94A3B8] text-sm font-medium mb-1.5">
                Company name
              </label>
              <input
                id="company-name"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Corp"
                maxLength={200}
                className="w-full bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white placeholder-[#475569] focus:outline-none focus:border-[#7C3AED]"
              />
              {showValidationError && (
                <p className="text-[#EF4444] text-xs mt-1.5">Company name is required.</p>
              )}
            </div>

            <button
              onClick={handleContinue}
              className={`mt-4 w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors ${
                !companyName.trim() ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
