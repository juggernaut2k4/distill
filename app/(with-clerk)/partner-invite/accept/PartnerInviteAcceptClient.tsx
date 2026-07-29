'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SignUp, useAuth } from '@clerk/nextjs'
import { Loader2 } from 'lucide-react'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4) — drives
 * `/partner-invite/accept`.
 *
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §4, §6.7) — the
 * pre-acceptance 'capture' step (a Clio-owned "Company name" form) is
 * REMOVED entirely, same principle as `/partner-signup`. `Step` shrinks from
 * 7 states to 6: `loading | invalid | signup | claiming | claim-error |
 * already-member`. The `loading` effect's `load()` function, on
 * `data.valid === true`, now itself decides `signup` vs. auto-firing
 * `submitClaim()` based on `isSignedIn` — previously this decision lived in
 * `handleContinue`, now unreachable since there's no button left to wire it
 * to.
 *
 * Hotfix (2026-07-20): `<SignUp>`'s `forceRedirectUrl` points back to this
 * same page (with `token` preserved in the query string) instead of straight
 * to `/dashboard/configurator` — same root cause and fix as
 * `/partner-signup`'s (see that file's header comment): Clerk's
 * `unsafeMetadata` prop only survives the email/password strategy, not an
 * OAuth redirect, so an OAuth signup here would otherwise skip the
 * `signup_intent`/token metadata the webhook needs and never claim the
 * invite. Landing back here re-triggers `load()`'s existing `submitClaim()`
 * on mount, which claims via the authenticated route instead.
 */

type Step = 'loading' | 'invalid' | 'signup' | 'claiming' | 'claim-error' | 'already-member'

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

export default function PartnerInviteAcceptClient({ token }: { token: string }) {
  const { isLoaded, isSignedIn } = useAuth()
  const router = useRouter()
  const [step, setStep] = useState<Step>('loading')

  async function submitClaim() {
    setStep('claiming')
    try {
      const res = await fetch('/api/partner-invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (res.status === 422) {
        setStep('invalid')
        return
      }
      const data = await res.json()
      if (!res.ok) {
        setStep('claim-error')
        return
      }
      if (data.alreadyMember) {
        setStep('already-member')
        return
      }
      router.push('/dashboard/configurator')
    } catch {
      setStep('claim-error')
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!token) {
        setStep('invalid')
        return
      }
      if (!isLoaded) return
      try {
        const res = await fetch(`/api/partner-invite/accept?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (cancelled) return
        if (!data.valid) {
          setStep('invalid')
          return
        }
        // B2B-29 §6.7 — no click needed: decide signup vs. auto-claim
        // immediately, based on the sign-in state now known.
        if (isSignedIn) {
          void submitClaim()
        } else {
          setStep('signup')
        }
      } catch {
        if (!cancelled) setStep('invalid')
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isLoaded, isSignedIn])

  if (!isLoaded || step === 'loading') {
    return <div className="min-h-screen bg-void" />
  }

  if (step === 'invalid') {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <p className="text-[#7C3AED] text-xs font-bold uppercase tracking-widest mb-8">Clio</p>
          <h1 className="text-white text-2xl font-bold mb-3">This invite link is no longer valid.</h1>
          <p className="text-[#94A3B8] text-sm">Ask your Clio contact for a new link.</p>
        </div>
      </div>
    )
  }

  if (step === 'already-member') {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <p className="text-[#7C3AED] text-xs font-bold uppercase tracking-widest mb-8">Clio</p>
          <h1 className="text-white text-2xl font-bold mb-6">You already have a Clio account.</h1>
          <a
            href="/dashboard"
            className="inline-block bg-[#7C3AED] hover:bg-[#A855F7] text-white text-sm font-semibold px-6 py-3 rounded-lg transition-colors"
          >
            Go to your dashboard →
          </a>
        </div>
      </div>
    )
  }

  if (step === 'signup') {
    return (
      <div
        className="min-h-screen bg-void flex flex-col items-center justify-center"
        style={{ padding: 'clamp(1rem, 5vw, 2rem)' }}
      >
        <p className="text-white text-lg font-semibold mb-4 text-center">
          You&apos;ve been invited to set up a Clio partner account.
        </p>
        <SignUp
          forceRedirectUrl={`/partner-invite/accept?token=${encodeURIComponent(token)}`}
          unsafeMetadata={{
            signup_intent: 'direct_partner_invite',
            direct_partner_invite_token: token,
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
      <div className="max-w-sm w-full">
        <p className="text-white text-lg font-semibold mb-4 text-center">
          You&apos;ve been invited to set up a Clio partner account.
        </p>

        <div className="bg-[#111111] border border-[#222222] rounded-xl p-6">
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
    </div>
  )
}
