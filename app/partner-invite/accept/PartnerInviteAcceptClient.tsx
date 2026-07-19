'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SignUp, useAuth } from '@clerk/nextjs'
import { Loader2 } from 'lucide-react'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4) — drives
 * `/partner-invite/accept`. Structurally mirrors
 * `app/team-invite/accept/TeamInviteAcceptClient.tsx`'s state machine as
 * closely as the different problem shape allows — this flow creates a
 * BRAND-NEW account, not a membership on an existing one, so it needs a
 * company-name-capture step `/team-invite/accept` never had. Reuses
 * `/partner-signup` State 1's capture UI verbatim as a sibling render branch,
 * not a new design.
 *
 * 7-state machine (§4): loading / invalid / capture / signup (signed-out
 * only) / claiming+claim-error (signed-in only) / already-member (terminal,
 * distinct from claim-error) / post-signup landing (Clerk mechanism / router.push).
 */

type Step = 'loading' | 'invalid' | 'capture' | 'signup' | 'claiming' | 'claim-error' | 'already-member'

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
  const [companyName, setCompanyName] = useState('')
  const [showValidationError, setShowValidationError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!token) {
        setStep('invalid')
        return
      }
      try {
        const res = await fetch(`/api/partner-invite/accept?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (cancelled) return
        setStep(data.valid ? 'capture' : 'invalid')
      } catch {
        if (!cancelled) setStep('invalid')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [token])

  async function submitClaim() {
    setStep('claiming')
    try {
      const res = await fetch('/api/partner-invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, companyName: companyName.trim() }),
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
      <div className="min-h-screen bg-void flex items-center justify-center">
        <SignUp
          forceRedirectUrl="/dashboard/configurator"
          unsafeMetadata={{
            signup_intent: 'direct_partner_invite',
            company_name: companyName.trim(),
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
        {step === 'capture' && (
          <p className="text-white text-lg font-semibold mb-4 text-center">
            You&apos;ve been invited to set up a Clio partner account.
          </p>
        )}

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
    </div>
  )
}
