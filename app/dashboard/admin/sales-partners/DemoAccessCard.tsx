'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §4.B). "Your demo access" card for
 * `/dashboard/admin/sales-partners`, placed above the sales-partner roster table. Same three states
 * (no-passcode / active / reveal-modal) and same buy-minutes modal as the reseller's
 * `DemoAccessClient.tsx`, sourced from `/api/admin/demo-access[/regenerate]` +
 * `/api/admin/billing/demo-topup` instead. Uses THIS file's own Tailwind-class convention
 * (`bg-[#111111] border border-[#222222] rounded-xl`), matching `SalesPartnersClient.tsx` — not the
 * inline-style `Card` component the reseller pages use, per the spec's explicit "match the file it's
 * added to" instruction.
 */

const TOPUP_TIERS: { key: string; label: string; price: string }[] = [
  { key: 'min15', label: '15 min', price: '$0.50' },
  { key: 'min30', label: '30 min', price: '$0.75' },
  { key: 'hr1', label: '1 hour', price: '$1.25' },
  { key: 'hr2', label: '2 hours', price: '$1.80' },
  { key: 'hr3', label: '3 hours', price: '$2.50' },
  { key: 'hr5', label: '5 hours', price: '$4.00' },
  { key: 'hr10', label: '10 hours', price: '$7.50' },
]

interface DemoAccessData {
  has_passcode: boolean
  generated_at: string | null
  demo_minutes_balance: number
  demo_reference_topup_minutes: number | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const RETURN_PATH = '/dashboard/admin/sales-partners'

export default function DemoAccessCard() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [data, setData] = useState<DemoAccessData | null>(null)
  const [loadError, setLoadError] = useState(false)

  const [regenerating, setRegenerating] = useState(false)
  const [regenerateError, setRegenerateError] = useState<string | null>(null)

  const [revealPasscode, setRevealPasscode] = useState<{ passcode: string; generated_at: string } | null>(null)
  const [savedChecked, setSavedChecked] = useState(false)
  const [copiedFlash, setCopiedFlash] = useState(false)

  const [buyModalOpen, setBuyModalOpen] = useState(false)
  const [selectedTier, setSelectedTier] = useState<string | null>(null)
  const [buyBusy, setBuyBusy] = useState(false)
  const [buyError, setBuyError] = useState<string | null>(null)

  const [topupMessage, setTopupMessage] = useState<string | null>(null)
  const handledTopupReturnRef = useRef(false)

  async function loadData() {
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/demo-access')
      if (!res.ok) throw new Error('load failed')
      const body: DemoAccessData = await res.json()
      setData(body)
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    const demoTopup = searchParams?.get('demo_topup')
    if (demoTopup === 'success' && !handledTopupReturnRef.current) {
      handledTopupReturnRef.current = true
      setTopupMessage('Demo minutes added.')
      router.replace(RETURN_PATH)
      loadData()
    } else if (demoTopup === 'cancelled' && !handledTopupReturnRef.current) {
      handledTopupReturnRef.current = true
      router.replace(RETURN_PATH)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function doRegenerate() {
    setRegenerateError(null)
    setRegenerating(true)
    try {
      const res = await fetch('/api/admin/demo-access/regenerate', { method: 'POST' })
      if (!res.ok) {
        setRegenerateError("Couldn't generate a passcode. Try again.")
        return
      }
      const body: { passcode: string; generated_at: string } = await res.json()
      setSavedChecked(false)
      setRevealPasscode(body)
    } catch {
      setRegenerateError("Couldn't generate a passcode. Try again.")
    } finally {
      setRegenerating(false)
    }
  }

  function handleGenerateOrRegenerateClick() {
    if (data?.has_passcode) {
      const confirmed = window.confirm(
        'This immediately invalidates your current passcode for new demo sessions. Any demo session already running is not affected. Continue?'
      )
      if (!confirmed) return
    }
    doRegenerate()
  }

  async function handleCopy() {
    if (!revealPasscode) return
    try {
      await navigator.clipboard.writeText(revealPasscode.passcode)
      setCopiedFlash(true)
      setTimeout(() => setCopiedFlash(false), 1500)
    } catch {
      console.warn('[DemoAccessCard] clipboard copy failed — plaintext remains selectable in the field')
    }
  }

  function handleDone() {
    setRevealPasscode(null)
    setSavedChecked(false)
    loadData()
  }

  async function handleBuyMinutes() {
    if (!selectedTier) return
    setBuyBusy(true)
    setBuyError(null)
    try {
      const res = await fetch('/api/admin/billing/demo-topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: selectedTier,
          success_url: `${window.location.origin}${RETURN_PATH}?demo_topup=success`,
          cancel_url: `${window.location.origin}${RETURN_PATH}?demo_topup=cancelled`,
        }),
      })
      const body = await res.json()
      if (!res.ok || !body.checkout_url) {
        setBuyError('Failed to create checkout session.')
        return
      }
      window.location.href = body.checkout_url
    } catch {
      setBuyError('Failed to create checkout session.')
    } finally {
      setBuyBusy(false)
    }
  }

  const balancePct =
    data?.demo_reference_topup_minutes && data.demo_reference_topup_minutes > 0
      ? Math.max(0, Math.min(100, (data.demo_minutes_balance / data.demo_reference_topup_minutes) * 100))
      : null

  return (
    <div className="bg-[#111111] border border-[#222222] rounded-xl p-5 mb-6">
      <h2 className="text-white text-base font-semibold mb-0.5">Your demo access</h2>
      <p className="text-[#475569] text-xs mb-4">(Clio Internal — Public Demo account)</p>

      {topupMessage && <p className="text-[#10B981] text-xs mb-3">{topupMessage}</p>}

      {loadError && <p className="text-[#EF4444] text-sm">Couldn&apos;t load demo access. Try refreshing the page.</p>}

      {!loadError && data === null && <p className="text-[#94A3B8] text-sm">Checking…</p>}

      {!loadError && data !== null && !data.has_passcode && (
        <>
          <p className="text-[#94A3B8] text-sm mb-3 leading-relaxed">
            No demo passcode yet. Generate one to keep demoing Clio without editing Vercel environment variables.
          </p>
          {regenerateError && <p className="text-[#EF4444] text-xs mb-3">{regenerateError}</p>}
          <button
            disabled={regenerating}
            onClick={handleGenerateOrRegenerateClick}
            className="bg-[#7C3AED] text-white text-sm font-semibold rounded-lg px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {regenerating ? 'Generating…' : 'Generate passcode'}
          </button>
        </>
      )}

      {!loadError && data !== null && data.has_passcode && (
        <>
          <p className="text-sm mb-3">
            <span className="text-[#10B981]">✓</span>{' '}
            <span className="text-white">
              Passcode active{data.generated_at ? ` — generated ${formatDate(data.generated_at)}` : ''}
            </span>
          </p>
          <p className="text-[#94A3B8] text-sm mb-2">
            Demo minutes remaining: {data.demo_minutes_balance.toFixed(1)}
            {data.demo_reference_topup_minutes != null ? ` / ${data.demo_reference_topup_minutes}` : ''}
          </p>
          {balancePct !== null && (
            <div className="bg-[#1A1A1A] rounded h-1.5 mb-4 overflow-hidden">
              <div className="bg-[#7C3AED] h-full transition-all" style={{ width: `${balancePct}%` }} />
            </div>
          )}

          {regenerateError && <p className="text-[#EF4444] text-xs mb-3">{regenerateError}</p>}

          <div className="flex gap-2 flex-wrap">
            <button
              disabled={regenerating}
              onClick={handleGenerateOrRegenerateClick}
              className="bg-transparent text-white text-sm border border-[#333333] rounded-lg px-4 py-2.5 disabled:opacity-40"
            >
              {regenerating ? 'Regenerating…' : 'Regenerate passcode'}
            </button>
            <button
              onClick={() => {
                setSelectedTier(null)
                setBuyError(null)
                setBuyModalOpen(true)
              }}
              className="bg-transparent text-white text-sm border border-[#333333] rounded-lg px-4 py-2.5"
            >
              Buy more demo minutes
            </button>
          </div>
        </>
      )}

      {revealPasscode && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4">
          <div className="bg-[#111111] border border-[#222222] rounded-xl p-5" style={{ width: 'min(92vw, 420px)', boxSizing: 'border-box' }}>
            <h3 className="text-white text-base font-semibold mb-2">Your demo passcode</h3>
            <p className="text-[#94A3B8] text-sm mb-4">Save this now — it will never be shown again.</p>

            <div className="flex gap-2 mb-4">
              <input
                readOnly
                value={revealPasscode.passcode}
                className="flex-1 min-w-0 bg-[#1A1A1A] border border-[#333333] rounded-lg px-2.5 py-2.5 text-white text-base font-bold tracking-wide font-mono"
              />
              <button onClick={handleCopy} className="flex-shrink-0 bg-transparent text-white text-sm border border-[#333333] rounded-lg px-4 py-2.5">
                {copiedFlash ? 'Copied' : 'Copy'}
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-[#94A3B8] mb-5 cursor-pointer">
              <input type="checkbox" checked={savedChecked} onChange={(e) => setSavedChecked(e.target.checked)} />
              I&apos;ve saved this passcode
            </label>

            <div className="flex justify-end">
              <button
                disabled={!savedChecked}
                onClick={handleDone}
                className="bg-[#7C3AED] text-white text-sm font-semibold rounded-lg px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {buyModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4">
          <div className="bg-[#111111] border border-[#222222] rounded-xl p-5" style={{ width: 'min(92vw, 420px)', boxSizing: 'border-box' }}>
            <h3 className="text-white text-base font-semibold mb-1">Buy demo minutes</h3>
            <p className="text-[#475569] text-xs mb-4">Provisional pricing — subject to change.</p>

            <div className="flex flex-col gap-1 mb-5">
              {TOPUP_TIERS.map((tier) => (
                <label
                  key={tier.key}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg border cursor-pointer text-sm ${
                    selectedTier === tier.key ? 'border-[#7C3AED] bg-[#7C3AED]/10' : 'border-[#222222]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input type="radio" name="admin-demo-topup-tier" checked={selectedTier === tier.key} onChange={() => setSelectedTier(tier.key)} />
                    <span className="text-white">{tier.label}</span>
                  </span>
                  <span className="text-[#94A3B8]">{tier.price}</span>
                </label>
              ))}
            </div>

            {buyError && <p className="text-[#EF4444] text-xs mb-3">{buyError}</p>}

            <div className="flex flex-col gap-3">
              <button
                disabled={!selectedTier || buyBusy}
                onClick={handleBuyMinutes}
                className="bg-[#7C3AED] text-white text-sm font-semibold rounded-lg px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {buyBusy ? 'Redirecting…' : 'Continue to checkout'}
              </button>
              <button onClick={() => setBuyModalOpen(false)} className="bg-transparent border-none text-[#94A3B8] text-sm underline cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
