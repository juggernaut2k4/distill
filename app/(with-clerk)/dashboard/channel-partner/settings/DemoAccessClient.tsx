'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { COLORS, Card, PrimaryButton, SecondaryButton } from '../_shared'

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §4.A). "Demo access" card for
 * `/dashboard/channel-partner/settings` — reseller's own demo passcode + demo-minutes balance.
 * Rendered as a sibling `<DemoAccessCard />`-style component imported into the existing
 * `SettingsClient.tsx`, below the "Company info" and "Payment" cards (developer's-call placement per
 * the spec — imported directly into that file, same `Card`/`COLORS` import source).
 *
 * Hard rule carried forward from the spec: the plaintext passcode is shown exactly once, in the
 * reveal modal below, immediately after a successful regenerate call — never re-fetched, never
 * re-displayed, no "view current passcode" capability anywhere.
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

const MODAL_OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 16,
  boxSizing: 'border-box',
}

// Per the standing responsive/mobile-friendly rule — fluid width, never a fixed px cap.
const MODAL_CARD_STYLE: React.CSSProperties = { width: 'min(92vw, 420px)', boxSizing: 'border-box' }

export default function DemoAccessClient({
  fetchUrl = '/api/channel-partner/demo-access',
  regenerateUrl = '/api/channel-partner/demo-access/regenerate',
  topupUrl = '/api/channel-partner/billing/demo-topup',
  returnPath = '/dashboard/channel-partner/settings',
  title = 'Demo access',
}: {
  fetchUrl?: string
  regenerateUrl?: string
  topupUrl?: string
  returnPath?: string
  title?: string
}) {
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
      const res = await fetch(fetchUrl)
      if (!res.ok) throw new Error('load failed')
      const body: DemoAccessData = await res.json()
      setData(body)
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const demoTopup = searchParams?.get('demo_topup')
    if (demoTopup === 'success' && !handledTopupReturnRef.current) {
      handledTopupReturnRef.current = true
      setTopupMessage('Demo minutes added.')
      router.replace(returnPath)
      loadData()
    } else if (demoTopup === 'cancelled' && !handledTopupReturnRef.current) {
      handledTopupReturnRef.current = true
      router.replace(returnPath)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function doRegenerate() {
    setRegenerateError(null)
    setRegenerating(true)
    try {
      const res = await fetch(regenerateUrl, { method: 'POST' })
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
      console.warn('[DemoAccessClient] clipboard copy failed — plaintext remains selectable in the field')
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
      const res = await fetch(topupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: selectedTier,
          success_url: `${window.location.origin}${returnPath}?demo_topup=success`,
          cancel_url: `${window.location.origin}${returnPath}?demo_topup=cancelled`,
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
    <Card style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 12px' }}>{title}</h2>

      {topupMessage && <p style={{ color: COLORS.green, fontSize: 12, marginBottom: 12 }}>{topupMessage}</p>}

      {loadError && (
        <p style={{ color: COLORS.red, fontSize: 13 }}>Couldn&apos;t load your demo access. Try refreshing the page.</p>
      )}

      {!loadError && data === null && <p style={{ color: COLORS.textSecondary, fontSize: 13 }}>Checking…</p>}

      {!loadError && data !== null && !data.has_passcode && (
        <>
          <p style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
            You don&apos;t have a demo passcode yet. Generate one to let anyone use your passcode to trigger the &quot;Learn
            with AI&quot; demo — billed to your own account.
          </p>
          {regenerateError && <p style={{ color: COLORS.red, fontSize: 12, marginBottom: 12 }}>{regenerateError}</p>}
          <PrimaryButton disabled={regenerating} onClick={handleGenerateOrRegenerateClick}>
            {regenerating && <Loader2 className="inline-block w-3.5 h-3.5 animate-spin mr-1.5" style={{ verticalAlign: 'middle' }} />}
            Generate passcode
          </PrimaryButton>
        </>
      )}

      {!loadError && data !== null && data.has_passcode && (
        <>
          <p style={{ fontSize: 13, marginBottom: 12 }}>
            <span style={{ color: COLORS.green }}>✓</span>{' '}
            <span style={{ color: COLORS.textPrimary }}>
              Passcode active{data.generated_at ? ` — generated ${formatDate(data.generated_at)}` : ''}
            </span>
          </p>

          <p style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 6 }}>
            Demo minutes remaining: {data.demo_minutes_balance.toFixed(1)}
            {data.demo_reference_topup_minutes != null ? ` / ${data.demo_reference_topup_minutes}` : ''}
          </p>
          {balancePct !== null && (
            <div style={{ background: COLORS.raised, borderRadius: 4, height: 6, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ background: COLORS.purple, height: '100%', width: `${balancePct}%`, transition: 'width 0.3s' }} />
            </div>
          )}

          {regenerateError && <p style={{ color: COLORS.red, fontSize: 12, marginBottom: 12 }}>{regenerateError}</p>}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <SecondaryButton disabled={regenerating} onClick={handleGenerateOrRegenerateClick}>
              {regenerating ? 'Regenerating…' : 'Regenerate passcode'}
            </SecondaryButton>
            <SecondaryButton
              onClick={() => {
                setSelectedTier(null)
                setBuyError(null)
                setBuyModalOpen(true)
              }}
            >
              Buy more demo minutes
            </SecondaryButton>
          </div>
        </>
      )}

      {/* Reveal modal — no close/X/backdrop-click dismissal, checkbox + Done is the only way out. */}
      {revealPasscode && (
        <div style={MODAL_OVERLAY_STYLE}>
          <Card style={MODAL_CARD_STYLE}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 8px' }}>Your demo passcode</h3>
            <p style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 16 }}>
              Save this now — it will never be shown again.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                readOnly
                value={revealPasscode.passcode}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: COLORS.raised,
                  border: `1px solid ${COLORS.borderStrong}`,
                  borderRadius: 8,
                  padding: 10,
                  color: COLORS.textPrimary,
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  fontFamily: 'monospace',
                }}
              />
              <SecondaryButton onClick={handleCopy} style={{ flexShrink: 0 }}>
                {copiedFlash ? 'Copied' : 'Copy'}
              </SecondaryButton>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: COLORS.textSecondary, marginBottom: 20, cursor: 'pointer' }}>
              <input type="checkbox" checked={savedChecked} onChange={(e) => setSavedChecked(e.target.checked)} />
              I&apos;ve saved this passcode
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <PrimaryButton disabled={!savedChecked} onClick={handleDone}>
                Done
              </PrimaryButton>
            </div>
          </Card>
        </div>
      )}

      {/* Buy demo minutes modal */}
      {buyModalOpen && (
        <div style={MODAL_OVERLAY_STYLE}>
          <Card style={MODAL_CARD_STYLE}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 4px' }}>Buy demo minutes</h3>
            <p style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 16 }}>Provisional pricing — subject to change.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
              {TOPUP_TIERS.map((tier) => (
                <label
                  key={tier.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${selectedTier === tier.key ? COLORS.purple : COLORS.borderSubtle}`,
                    background: selectedTier === tier.key ? 'rgba(124,58,237,0.1)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="radio"
                      name="demo-topup-tier"
                      checked={selectedTier === tier.key}
                      onChange={() => setSelectedTier(tier.key)}
                    />
                    <span style={{ color: COLORS.textPrimary }}>{tier.label}</span>
                  </span>
                  <span style={{ color: COLORS.textSecondary }}>{tier.price}</span>
                </label>
              ))}
            </div>

            {buyError && <p style={{ color: COLORS.red, fontSize: 12, marginBottom: 12 }}>{buyError}</p>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch' }}>
              <PrimaryButton disabled={!selectedTier || buyBusy} onClick={handleBuyMinutes}>
                {buyBusy ? 'Redirecting…' : 'Continue to checkout'}
              </PrimaryButton>
              <button
                onClick={() => setBuyModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: COLORS.textSecondary, fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
              >
                Cancel
              </button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  )
}
