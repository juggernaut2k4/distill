'use client'

import { useState } from 'react'
import { useClerk, useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'

/**
 * AUTH-02 Section 5.1 — shown when an already-signed-in, fully paying user
 * lands on /onboarding (e.g. by clicking the public "Get Started" button).
 *
 * This is Clio's custom confirmation screen: Clerk's own <SignIn>/<SignUp>
 * components silently auto-redirect to Home when a single-session app already
 * has an active session (spec Section 8) — there is no native "Continue as X"
 * confirmation available. So this screen is the only confirmation step, and
 * its one exit (the "Login" button) must genuinely terminate the current
 * session before navigating to /sign-in, guaranteeing Clerk's <SignIn>
 * actually renders and requires real re-authentication.
 *
 * Visual pattern matches the existing "Account already exists" interstitial
 * in app/checkout/page.tsx (lines ~477-496) for consistency.
 */
export function AlreadySignedInInterstitial() {
  const { signOut } = useClerk()
  const { user } = useUser()
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const email = user?.primaryEmailAddress?.emailAddress ?? ''

  async function handleLogin() {
    setIsSigningOut(true)
    try {
      await signOut()
    } catch (err) {
      // Best-effort sign-out per spec Section 11 — navigate to /sign-in
      // regardless. Clerk's server-side session validation is the actual
      // source of truth, not whether this client call resolved cleanly.
      // Log client-side only, no PII.
      console.error('[onboarding] signOut failed before navigating to /sign-in:', err)
    }
    router.push('/sign-in')
  }

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full text-center">
        <div className="w-14 h-14 rounded-full bg-amber-900/30 border border-amber-700/40 flex items-center justify-center mx-auto mb-5">
          <Lock className="w-6 h-6 text-amber-400" />
        </div>
        <h2 className="text-white text-xl font-bold mb-2">You&apos;re already signed in</h2>
        <p className="text-[#94A3B8] text-sm mb-1">You&apos;re signed in as</p>
        <p className="text-white font-medium text-sm mb-6">{email}</p>
        <p className="text-[#475569] text-sm mb-8">Log in to continue to your dashboard.</p>
        <button
          onClick={handleLogin}
          disabled={isSigningOut}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 text-white font-semibold rounded-xl transition-colors"
        >
          Login
        </button>
      </div>
    </div>
  )
}
