'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import { Loader2 } from 'lucide-react'

/**
 * B2B-21 Requirement Doc §4.C — drives states A1–A4 of `/invite/accept`.
 * Dark-void styling, matching every other public-page precedent
 * (app/partner-signup/[[...partner-signup]]/page.tsx).
 */

type LookupState =
  | { phase: 'loading' }
  | { phase: 'invalid' } // State A4
  | { phase: 'valid'; email: string; role: 'super_admin' | 'sales_partner' }

type AcceptState = 'idle' | 'accepting' | 'accepted' | 'mismatch' | 'invalid'

type View =
  | { name: 'loading' }
  | { name: 'A4' } // invalid/expired/consumed token
  | { name: 'A1'; email: string; role: 'super_admin' | 'sales_partner' }
  | { name: 'accepting' }
  | { name: 'A2' } // accepted, redirecting
  | { name: 'A3'; invitedEmail: string; currentEmail: string } // email mismatch

function resolveView(lookup: LookupState, isLoaded: boolean, isSignedIn: boolean | undefined, acceptState: AcceptState, currentEmail: string | null): View {
  if (acceptState === 'accepted') return { name: 'A2' }
  if (acceptState === 'accepting') return { name: 'accepting' }
  if (acceptState === 'invalid') return { name: 'A4' }
  if (acceptState === 'mismatch' && lookup.phase === 'valid') {
    return { name: 'A3', invitedEmail: lookup.email, currentEmail: currentEmail ?? '' }
  }

  if (lookup.phase === 'loading') return { name: 'loading' }
  if (lookup.phase === 'invalid') return { name: 'A4' }

  // lookup.phase === 'valid' from here down
  if (!isLoaded) return { name: 'loading' }
  if (!isSignedIn) return { name: 'A1', email: lookup.email, role: lookup.role }

  const emailMatches = currentEmail !== null && currentEmail.toLowerCase() === lookup.email.toLowerCase()
  if (!emailMatches) return { name: 'A3', invitedEmail: lookup.email, currentEmail: currentEmail ?? '' }

  // Signed in with a matching email but the auto-accept effect hasn't set
  // acceptState yet — treat as "accepting" to avoid an A1 flash.
  return { name: 'accepting' }
}

export default function InviteAcceptClient({ token }: { token: string }) {
  const router = useRouter()
  const { isLoaded, isSignedIn, user } = useUser()
  const { signOut } = useClerk()

  const [lookup, setLookup] = useState<LookupState>({ phase: 'loading' })
  const [acceptState, setAcceptState] = useState<AcceptState>('idle')

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!token) {
        setLookup({ phase: 'invalid' })
        return
      }
      try {
        const res = await fetch(`/api/admin/team/invites/accept?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (cancelled) return
        if (data.valid) {
          setLookup({ phase: 'valid', email: data.email, role: data.role })
        } else {
          setLookup({ phase: 'invalid' })
        }
      } catch {
        if (!cancelled) setLookup({ phase: 'invalid' })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [token])

  const currentEmail = user?.primaryEmailAddress?.emailAddress ?? null
  const emailMatches = lookup.phase === 'valid' && currentEmail !== null && currentEmail.toLowerCase() === lookup.email.toLowerCase()

  // State A2 — signed in with a matching email: auto-fire accept on load.
  useEffect(() => {
    if (lookup.phase !== 'valid' || !isLoaded || !isSignedIn) return
    if (!emailMatches) return
    if (acceptState !== 'idle') return

    setAcceptState('accepting')
    ;(async () => {
      try {
        const res = await fetch('/api/admin/team/invites/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await res.json()
        if (!res.ok) {
          setAcceptState(data?.error?.code === 'email_mismatch' ? 'mismatch' : 'invalid')
          return
        }
        setAcceptState('accepted')
        const destination = data.role === 'super_admin' ? '/dashboard/admin/team' : '/dashboard/admin/glitches'
        setTimeout(() => router.push(destination), 2000)
      } catch {
        setAcceptState('invalid')
      }
    })()
  }, [lookup, isLoaded, isSignedIn, emailMatches, acceptState, token, router])

  const view = resolveView(lookup, isLoaded, isSignedIn, acceptState, currentEmail)
  const signInHref = `/sign-in?redirect_url=${encodeURIComponent(`/invite/accept?token=${token}`)}`

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <p className="text-[#7C3AED] text-xs font-bold uppercase tracking-widest mb-8">Clio</p>

        {(view.name === 'loading' || view.name === 'accepting') && (
          <div className="flex items-center justify-center gap-2 text-[#94A3B8] text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            {view.name === 'accepting' ? 'Accepting invite…' : 'Loading invite…'}
          </div>
        )}

        {view.name === 'A4' && (
          <>
            <h1 className="text-white text-2xl font-bold mb-3">This invite link is no longer valid.</h1>
            <p className="text-[#94A3B8] text-sm">Ask a Clio super-admin to resend it.</p>
          </>
        )}

        {view.name === 'A1' && (
          <>
            <h1 className="text-white text-2xl font-bold mb-3">
              You&apos;ve been invited to Clio as {view.role === 'super_admin' ? 'a super-admin' : 'a sales partner'}.
            </h1>
            <p className="text-[#94A3B8] text-sm mb-8">Invited: {view.email}</p>
            <a
              href={signInHref}
              className="inline-block bg-[#7C3AED] hover:bg-[#A855F7] text-white text-sm font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              Sign in to accept
            </a>
          </>
        )}

        {view.name === 'A2' && (
          <>
            <h1 className="text-white text-2xl font-bold mb-3">You&apos;re in.</h1>
            <p className="text-[#94A3B8] text-sm">Redirecting…</p>
          </>
        )}

        {view.name === 'A3' && (
          <>
            <h1 className="text-white text-2xl font-bold mb-3">Email mismatch</h1>
            <p className="text-[#94A3B8] text-sm mb-2">
              You&apos;re signed in as <span className="text-white">{view.currentEmail}</span>, but this invite was sent to{' '}
              <span className="text-white">{view.invitedEmail}</span>.
            </p>
            <p className="text-[#94A3B8] text-sm mb-8">Sign out and sign back in with the invited address to accept.</p>
            <button
              onClick={() => signOut({ redirectUrl: signInHref })}
              className="inline-block bg-[#7C3AED] hover:bg-[#A855F7] text-white text-sm font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </div>
  )
}
