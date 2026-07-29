'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import { Loader2 } from 'lucide-react'

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §4) — drives
 * `/team-invite/accept`. Structurally identical to
 * `app/invite/accept/InviteAcceptClient.tsx` (B2B-21) — same states (loading
 * / invalid-or-expired / "sign in to accept" / accepted-redirecting /
 * email-mismatch), same dark-void centered-text layout, same `Loader2`
 * spinner, same `signOut()`-and-retry flow for a mismatched email. Two
 * differences: copy (a plain team-member invite, no role distinction to
 * display) and the accept destination (`/dashboard/channel-partner`, not
 * `/dashboard/admin/team` or `/dashboard/admin/glitches`).
 */

type LookupState =
  | { phase: 'loading' }
  | { phase: 'invalid' }
  | { phase: 'valid'; email: string; companyName: string }

type AcceptState = 'idle' | 'accepting' | 'accepted' | 'mismatch' | 'invalid'

type View =
  | { name: 'loading' }
  | { name: 'invalid' }
  | { name: 'A1'; email: string; companyName: string }
  | { name: 'accepting' }
  | { name: 'accepted' }
  | { name: 'mismatch'; invitedEmail: string; currentEmail: string }

function resolveView(lookup: LookupState, isLoaded: boolean, isSignedIn: boolean | undefined, acceptState: AcceptState, currentEmail: string | null): View {
  if (acceptState === 'accepted') return { name: 'accepted' }
  if (acceptState === 'accepting') return { name: 'accepting' }
  if (acceptState === 'invalid') return { name: 'invalid' }
  if (acceptState === 'mismatch' && lookup.phase === 'valid') {
    return { name: 'mismatch', invitedEmail: lookup.email, currentEmail: currentEmail ?? '' }
  }

  if (lookup.phase === 'loading') return { name: 'loading' }
  if (lookup.phase === 'invalid') return { name: 'invalid' }

  if (!isLoaded) return { name: 'loading' }
  if (!isSignedIn) return { name: 'A1', email: lookup.email, companyName: lookup.companyName }

  const emailMatches = currentEmail !== null && currentEmail.toLowerCase() === lookup.email.toLowerCase()
  if (!emailMatches) return { name: 'mismatch', invitedEmail: lookup.email, currentEmail: currentEmail ?? '' }

  return { name: 'accepting' }
}

export default function TeamInviteAcceptClient({ token }: { token: string }) {
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
        const res = await fetch(`/api/team-invite/accept?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (cancelled) return
        if (data.valid) {
          setLookup({ phase: 'valid', email: data.email, companyName: data.companyName ?? '' })
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

  useEffect(() => {
    if (lookup.phase !== 'valid' || !isLoaded || !isSignedIn) return
    if (!emailMatches) return
    if (acceptState !== 'idle') return

    setAcceptState('accepting')
    ;(async () => {
      try {
        const res = await fetch('/api/team-invite/accept', {
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
        setTimeout(() => router.push('/dashboard/channel-partner'), 2000)
      } catch {
        setAcceptState('invalid')
      }
    })()
  }, [lookup, isLoaded, isSignedIn, emailMatches, acceptState, token, router])

  const view = resolveView(lookup, isLoaded, isSignedIn, acceptState, currentEmail)
  const signInHref = `/sign-in?redirect_url=${encodeURIComponent(`/team-invite/accept?token=${token}`)}`

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

        {view.name === 'invalid' && (
          <>
            <h1 className="text-white text-2xl font-bold mb-3">This invite link is no longer valid.</h1>
            <p className="text-[#94A3B8] text-sm">Ask the sales-partner to resend it.</p>
          </>
        )}

        {view.name === 'A1' && (
          <>
            <h1 className="text-white text-2xl font-bold mb-3">
              You&apos;ve been invited to join {view.companyName}&apos;s team on Clio.
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

        {view.name === 'accepted' && (
          <>
            <h1 className="text-white text-2xl font-bold mb-3">You&apos;re in.</h1>
            <p className="text-[#94A3B8] text-sm">Redirecting…</p>
          </>
        )}

        {view.name === 'mismatch' && (
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
