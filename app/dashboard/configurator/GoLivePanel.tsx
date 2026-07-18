'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { COLORS, Card, PrimaryButton } from './_shared'
import type { ConfiguratorStatus } from '@/lib/partner/configurator-status'

/**
 * B2B-20 §4.4 / §6 — Go Live panel, extracted from the wizard's former
 * `GoLiveStep` + `onGoLive` action (`wizard/WizardClient.tsx`). Guardrail
 * "extract-and-verify" component: fully functional standalone, hosted inside
 * `ConfiguratorSurface`.
 *
 * Required-to-go-live set (B2B-23 §6.1, updated from B2B-20 §6.3): Integration
 * + Payment. Everything else is optional (working Clio defaults exist). The
 * confirm button is disabled until both required sections pass; the
 * server-side `goLive()` re-validates the same required set via live
 * `checkStepComplete`.
 *
 * Retains the section-internal inline-style aesthetic (§8 note — out of the
 * new-shell grep scope).
 */

interface DomainSettingsResponse {
  root_domain: string
  subdomain_slug: string | null
  subdomain_url: string | null
  custom_domain_status: 'none' | 'pending_verification' | 'verified' | 'failed'
  custom_domain_url: string | null
}

// B2B-24 §6.1/§9 — exported so the Dashboard panel's setup glimpse (Area 1)
// reuses this exact label/requirement copy instead of inventing separate
// wording that could visibly disagree with this panel (Known Constraint 1).
export const REQUIRED_LABELS: { key: 'integration' | 'payment'; label: string; requirement: string }[] = [
  { key: 'integration', label: 'Integration', requirement: 'configure your API base URL (Integration) or register a content source via the API' },
  { key: 'payment', label: 'Payment', requirement: 'add a funding method' },
]

export default function GoLivePanel({
  partnerAccountId,
  isLive,
  status,
  onWentLive,
}: {
  partnerAccountId: string
  isLive: boolean
  /** Live completion map from the surface; null while it is still loading. */
  status: ConfiguratorStatus | null
  /** Called after a successful go-live so the surface can refresh its live state. */
  onWentLive?: () => void
}) {
  const router = useRouter()
  const [domainSettings, setDomainSettings] = useState<DomainSettingsResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/configurator/domain?partner_account_id=${partnerAccountId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setDomainSettings(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [partnerAccountId])

  const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const liveUrl =
    domainSettings?.custom_domain_status === 'verified' && domainSettings.custom_domain_url
      ? domainSettings.custom_domain_url
      : domainSettings?.subdomain_url
      ? domainSettings.subdomain_url
      : `${appUrl}/partner-questionnaire/${partnerAccountId}`

  const requiredReady = status !== null && status.integration && status.payment

  async function onGoLive() {
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/admin/configurator/wizard/go-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: partnerAccountId }),
      })
      if (res.ok) {
        setConfirming(true)
        onWentLive?.()
        // Reflect the new live state (pinned row → "Live", first-run hint gone)
        // by re-running the server component.
        setTimeout(() => router.refresh(), 1200)
      } else if (res.status === 422) {
        const data = await res.json().catch(() => ({}))
        const pending: string[] = data.error?.pending_steps ?? []
        const labels = pending.map((s) => REQUIRED_LABELS.find((r) => r.key === s)?.label ?? s)
        setErrorMsg(labels.length ? `Still required: ${labels.join(', ')}.` : 'Some required setup is still incomplete.')
      } else {
        setErrorMsg("Couldn't go live — try again.")
      }
    } catch {
      setErrorMsg("Couldn't go live — try again.")
    } finally {
      setBusy(false)
    }
  }

  if (confirming) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
        <p style={{ fontSize: 32, color: COLORS.green, marginBottom: 12 }}>✓</p>
        <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>You&apos;re live.</p>
        <p style={{ fontSize: 13, color: COLORS.textSecondary }}>Your integration is now active.</p>
      </div>
    )
  }

  // Live state — surface is otherwise identical; the panel shows the live URL.
  if (isLive) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.green, display: 'inline-block' }} />
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>You&apos;re live</h1>
        </div>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>Your end users reach you at:</p>
        <Card>
          <p style={{ fontSize: 16, fontWeight: 600, textAlign: 'center', wordBreak: 'break-all' }}>{liveUrl}</p>
        </Card>
      </>
    )
  }

  // Not-live state — required checklist + optional note + confirm.
  return (
    <>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Go Live</h1>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>
        {requiredReady ? 'Everything required is ready.' : 'Before you go live, finish the required setup:'}
      </p>

      <Card style={{ marginBottom: 16 }}>
        {REQUIRED_LABELS.map((r) => {
          const done = status?.[r.key] === true
          return (
            <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: done ? COLORS.green : COLORS.red, width: 14 }}>{done ? '✓' : '✕'}</span>
              <span style={{ color: COLORS.textPrimary }}>{r.label}</span>
              {!done && <span style={{ color: COLORS.textSecondary }}>— {r.requirement}</span>}
            </div>
          )
        })}
      </Card>

      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 6 }}>Your end users will reach you at:</p>
      <Card style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 15, fontWeight: 600, textAlign: 'center', wordBreak: 'break-all' }}>{liveUrl}</p>
      </Card>

      {errorMsg && <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>{errorMsg}</p>}

      <PrimaryButton disabled={busy || !requiredReady} onClick={onGoLive}>
        {busy ? 'Going live…' : 'Go live'}
      </PrimaryButton>
    </>
  )
}
