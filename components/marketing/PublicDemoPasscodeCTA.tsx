'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'

/**
 * DEMO-PASSCODE-01 (docs/specs/DEMO-PASSCODE-01-requirement-document.md §4.A) — homepage CTA for
 * the public $10 demo-passcode purchase flow. Rendered from PublicDemoPasscodeSection() in
 * app/(with-clerk)/(marketing)/page.tsx, placed directly after <WaitlistSection /> and before
 * <BottomCTA />. Deliberately smaller/quieter than WaitlistSection so it never competes with the
 * waitlist for primary attention (Known Constraint 4).
 */

type ClickStatus = 'idle' | 'redirecting' | 'error'

export default function PublicDemoPasscodeCTA() {
  const [clickStatus, setClickStatus] = useState<ClickStatus>('idle')
  const [showSuccess, setShowSuccess] = useState(false)

  // Reads window.location directly (rather than next/navigation's useSearchParams) so this
  // component never forces a Suspense boundary / CSR bailout onto the already-'use client'
  // marketing homepage. Strips the query param via history.replaceState on mount, per §4.A State
  // B/C — a page refresh should never re-show any transient state.
  useEffect(() => {
    const url = new URL(window.location.href)
    const param = url.searchParams.get('public_demo_passcode')
    if (param === 'success') {
      setShowSuccess(true)
    }
    if (param === 'success' || param === 'cancelled') {
      url.searchParams.delete('public_demo_passcode')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
  }, [])

  async function handleClick() {
    setClickStatus('redirecting')
    try {
      const res = await fetch('/api/public-demo-passcode/checkout', { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      if (!data?.checkout_url) throw new Error('missing checkout_url')
      window.location.href = data.checkout_url
    } catch {
      setClickStatus('error')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 text-center">
      <h2 className="text-xl md:text-2xl font-bold text-white mb-3">Already convinced? See the demo for $10.</h2>
      <p className="text-sm md:text-base text-[#94A3B8] mb-6 leading-relaxed">
        A real, live session with Clio — not a recording. Your passcode works twice and never
        expires.
      </p>

      {showSuccess && (
        <p className="text-sm text-[#10B981] mb-6">✓ Check your email for your passcode.</p>
      )}

      <Button
        onClick={handleClick}
        disabled={clickStatus === 'redirecting'}
        size="lg"
      >
        {clickStatus === 'redirecting' ? 'Redirecting…' : 'See the demo — $10'}
      </Button>

      {clickStatus === 'error' && (
        <p className="text-sm text-[#EF4444] mt-4">Couldn&apos;t start checkout. Try again.</p>
      )}
    </div>
  )
}
