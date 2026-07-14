'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { COLORS, Card, PrimaryButton, SecondaryButton } from '../_shared'
import QuestionnaireBuilderClient from '../questionnaire/QuestionnaireBuilderClient'
import TopicsConfigClient from '../topics/TopicsConfigClient'
import ContentConfigClient from '../content/ContentConfigClient'
import VisualizationClient from '../visualization/VisualizationClient'
import DomainConfigClient from '../domain/DomainConfigClient'

/**
 * B2B-05 v1.1 — `/dashboard/configurator/wizard` shell (Requirement Doc
 * Section 13.4.A). Sequences the 5 existing/new Configurator screens plus a
 * Payment step (13.4.B) and a Go-live step (13.4.C) into one linear,
 * save-and-resume first-run flow. Not wrapped in `<ConfiguratorShell>` — the
 * wizard has its own chrome (step indicator + footer).
 *
 * Implementation note (deviation, flagged in the build report): the
 * Requirement Doc's wireframe (13.4.A Screen state 3) implies `[Continue →]`
 * is live-disabled per-step the same way the Domain screen's own Save button
 * is. That's achievable here for `questionnaire` (published-count from the
 * existing questionnaire list endpoint) and `domain` (subdomain_slug from the
 * existing domain-settings endpoint) — both endpoints expose real presence.
 * It is NOT achievable for `topics`/`content`/`visualization`/`payment`
 * without either modifying those screens' own save logic (explicitly
 * out-of-scope, 13.12) or adding a new read path (explicitly out-of-scope,
 * 13.8 — "adds no new read path... only re-derives a boolean from responses
 * already exposed", and `getTopicConfig`/`getContentSource`/`getThemeConfig`
 * all return default-filled values rather than null when no row exists, so
 * their existing GET responses cannot distinguish "no row" from "row with
 * defaults"). For those steps `[Continue →]` stays enabled and the click
 * itself is the live check — the server's `POST .../advance` 422
 * `step_not_ready` response (13.10's own documented error state) surfaces
 * "This step isn't finished yet." inline exactly as specified for the
 * disabled-button-bypass case.
 */

type WizardStep = 'questionnaire' | 'topics' | 'content' | 'visualization' | 'domain' | 'payment'
type WizardCurrentStep = WizardStep | 'go_live'
type StepStatus = 'pending' | 'completed' | 'skipped'

const STEP_ORDER: WizardStep[] = ['questionnaire', 'topics', 'content', 'visualization', 'domain', 'payment']
const STEP_LABEL: Record<WizardStep, string> = {
  questionnaire: 'Questionnaire',
  topics: 'Topics',
  content: 'Content',
  visualization: 'Visualization',
  domain: 'Domain',
  payment: 'Payment',
}

interface ProgressResponse {
  current_step: WizardCurrentStep
  onboarding_completed_at: string | null
  steps: Record<WizardStep, { status: StepStatus; status_at: string | null }>
}

interface DomainSettingsResponse {
  root_domain: string
  subdomain_slug: string | null
  subdomain_url: string | null
  custom_domain_status: 'none' | 'pending_verification' | 'verified' | 'failed'
  custom_domain_url: string | null
}

export default function WizardClient({
  accounts,
  activePartnerAccountId,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [progress, setProgress] = useState<ProgressResponse | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [viewStep, setViewStep] = useState<WizardCurrentStep | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [questionnaireReady, setQuestionnaireReady] = useState(false)
  const [domainSettings, setDomainSettings] = useState<DomainSettingsResponse | null>(null)
  const [goLiveConfirming, setGoLiveConfirming] = useState(false)
  const handledFundedRef = useRef(false)

  async function load(): Promise<ProgressResponse | null> {
    setLoadError(false)
    try {
      const res = await fetch(`/api/admin/configurator/wizard/progress?partner_account_id=${activePartnerAccountId}`)
      if (!res.ok) throw new Error('load failed')
      const data: ProgressResponse = await res.json()
      setProgress(data)
      setViewStep((prev) => prev ?? data.current_step)
      return data
    } catch {
      setLoadError(true)
      return null
    }
  }

  useEffect(() => {
    setProgress(null)
    setViewStep(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePartnerAccountId])

  // Payment step return from Stripe Checkout (Requirement Doc 13.4.A Screen
  // state 4): verify live against partner_wallets.funding_mechanism via the
  // advance endpoint's own `action="complete"` check, never trust the URL
  // param alone.
  useEffect(() => {
    const funded = searchParams?.get('funded')
    if (funded === '1' && !handledFundedRef.current) {
      handledFundedRef.current = true
      ;(async () => {
        setBusy(true)
        setErrorMsg(null)
        let advanced = false
        try {
          const res = await fetch('/api/admin/configurator/wizard/advance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ partner_account_id: activePartnerAccountId, step: 'payment', action: 'complete' }),
          })
          advanced = res.ok
        } catch {
          advanced = false
        }
        router.replace(`/dashboard/configurator/wizard?partner_account_id=${activePartnerAccountId}`)
        const data = await load()
        // `load()`'s viewStep guard only fills a null viewStep — the user was
        // already on 'payment' before Stripe redirected them here, so it would
        // otherwise leave viewStep stuck even after a successful advance.
        // Force it to the server's fresh current_step, the only source of truth
        // for where a returning-from-Stripe user should actually land.
        if (data) setViewStep(data.current_step)
        if (!advanced) {
          setErrorMsg("We couldn't confirm your payment yet — this can take a few seconds if Stripe hasn't finished processing. Click Continue to try again.")
        }
        setBusy(false)
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Live-checkable steps (see note above): questionnaire + domain.
  useEffect(() => {
    if (viewStep === 'questionnaire') {
      const check = () =>
        fetch(`/api/admin/configurator/questionnaire?partner_account_id=${activePartnerAccountId}`)
          .then((r) => r.json())
          .then((data) => setQuestionnaireReady((data.questionnaires ?? []).some((q: { status: string }) => q.status === 'published')))
          .catch(() => {})
      check()
      const interval = setInterval(check, 2500)
      return () => clearInterval(interval)
    }
    if (viewStep === 'domain' || viewStep === 'go_live') {
      const check = () =>
        fetch(`/api/admin/configurator/domain?partner_account_id=${activePartnerAccountId}`)
          .then((r) => r.json())
          .then(setDomainSettings)
          .catch(() => {})
      check()
      const interval = setInterval(check, 2500)
      return () => clearInterval(interval)
    }
  }, [viewStep, activePartnerAccountId])

  async function onContinue() {
    if (!viewStep || viewStep === 'go_live') return
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/admin/configurator/wizard/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: activePartnerAccountId, step: viewStep, action: 'complete' }),
      })
      if (res.ok) {
        const data: ProgressResponse = await res.json()
        setProgress(data)
        setViewStep(data.current_step)
      } else if (res.status === 422) {
        setErrorMsg("This step isn't finished yet.")
      } else if (res.status === 409) {
        // Server disagrees about which step we're on (stale tab, double-submit,
        // or the funded=1 return flow already advanced it) — snap viewStep to
        // whatever the server says is current, never leave it pointing at a
        // step the server has already moved past.
        const data = await load()
        if (data) setViewStep(data.current_step)
      }
    } finally {
      setBusy(false)
    }
  }

  async function onSkip() {
    if (!viewStep || viewStep === 'go_live') return
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/admin/configurator/wizard/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: activePartnerAccountId, step: viewStep, action: 'skip' }),
      })
      if (res.ok) {
        const data: ProgressResponse = await res.json()
        setProgress(data)
        setViewStep(data.current_step)
      } else if (res.status === 409) {
        const data = await load()
        if (data) setViewStep(data.current_step)
      }
    } finally {
      setBusy(false)
    }
  }

  function onBack() {
    if (!viewStep || viewStep === 'questionnaire') return
    const idx = viewStep === 'go_live' ? STEP_ORDER.length : STEP_ORDER.indexOf(viewStep as WizardStep)
    if (idx > 0) setViewStep(STEP_ORDER[idx - 1])
    setErrorMsg(null)
  }

  async function onGoLive() {
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/admin/configurator/wizard/go-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: activePartnerAccountId }),
      })
      if (res.ok) {
        setGoLiveConfirming(true)
        setTimeout(() => {
          router.push(`/dashboard/configurator?partner_account_id=${activePartnerAccountId}&welcome=1`)
        }, 1500)
      } else {
        const data = await res.json().catch(() => ({}))
        const pending: string[] = data.error?.pending_steps ?? []
        setErrorMsg(pending.length ? `Still needs attention: ${pending.map((s) => STEP_LABEL[s as WizardStep] ?? s).join(', ')}.` : 'Could not go live.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (goLiveConfirming) {
    return (
      <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.textPrimary, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <p style={{ fontSize: 32, color: COLORS.green, marginBottom: 12 }}>✓</p>
        <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>You&apos;re live.</p>
        <p style={{ fontSize: 13, color: COLORS.textSecondary }}>Redirecting to your Configurator…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <WizardShell>
        <p style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13 }}>Couldn&apos;t load your setup. Try refreshing the page.</p>
      </WizardShell>
    )
  }

  if (!progress || !viewStep) {
    return (
      <WizardShell>
        <p style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13 }}>Loading your setup…</p>
      </WizardShell>
    )
  }

  return (
    <WizardShell accounts={accounts} activePartnerAccountId={activePartnerAccountId}>
      <StepIndicator progress={progress} viewStep={viewStep} onJump={(s) => { setViewStep(s); setErrorMsg(null) }} />

      <div style={{ minHeight: 300, marginBottom: 24 }}>
        {viewStep === 'questionnaire' && (
          <QuestionnaireBuilderClient accounts={accounts} activePartnerAccountId={activePartnerAccountId} embedded />
        )}
        {viewStep === 'topics' && (
          <TopicsConfigClient accounts={accounts} activePartnerAccountId={activePartnerAccountId} embedded />
        )}
        {viewStep === 'content' && (
          <ContentConfigClient accounts={accounts} activePartnerAccountId={activePartnerAccountId} embedded />
        )}
        {viewStep === 'visualization' && (
          <VisualizationClient accounts={accounts} activePartnerAccountId={activePartnerAccountId} embedded />
        )}
        {viewStep === 'domain' && (
          <DomainConfigClient accounts={accounts} activePartnerAccountId={activePartnerAccountId} embedded />
        )}
        {viewStep === 'payment' && (
          <PaymentStep partnerAccountId={activePartnerAccountId} />
        )}
        {viewStep === 'go_live' && (
          <GoLiveStep domainSettings={domainSettings} partnerAccountId={activePartnerAccountId} />
        )}
      </div>

      {errorMsg && <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>{errorMsg}</p>}

      {viewStep === 'go_live' ? (
        <div style={{ borderTop: `1px solid ${COLORS.borderSubtle}`, paddingTop: 16, display: 'flex', justifyContent: 'space-between' }}>
          <SecondaryButton onClick={onBack}>← Back</SecondaryButton>
          <PrimaryButton disabled={busy} onClick={onGoLive}>{busy ? 'Going live…' : 'Go live'}</PrimaryButton>
        </div>
      ) : (
        <div style={{ borderTop: `1px solid ${COLORS.borderSubtle}`, paddingTop: 16, display: 'flex', justifyContent: 'space-between' }}>
          {viewStep !== 'questionnaire' ? <SecondaryButton onClick={onBack}>← Back</SecondaryButton> : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <SecondaryButton disabled={busy} onClick={onSkip}>Skip for now</SecondaryButton>
            <PrimaryButton disabled={busy || (viewStep === 'questionnaire' && !questionnaireReady) || (viewStep === 'domain' && !domainSettings?.subdomain_slug)} onClick={onContinue}>
              Continue →
            </PrimaryButton>
          </div>
        </div>
      )}
    </WizardShell>
  )
}

function WizardShell({
  accounts,
  activePartnerAccountId,
  children,
}: {
  accounts?: AdminPartnerAccount[]
  activePartnerAccountId?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ borderBottom: `1px solid ${COLORS.borderSubtle}`, padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Clio Configurator</span>
          <span style={{ color: COLORS.textMuted, fontSize: 13 }}>Getting set up</span>
        </div>
        {accounts && accounts.length > 0 && activePartnerAccountId && (
          <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>
            {accounts.find((a) => a.id === activePartnerAccountId)?.name ?? ''}
          </span>
        )}
      </div>
      <div style={{ padding: 32, maxWidth: 720, margin: '0 auto' }}>{children}</div>
    </div>
  )
}

function StepIndicator({
  progress,
  viewStep,
  onJump,
}: {
  progress: ProgressResponse
  viewStep: WizardCurrentStep
  onJump: (step: WizardCurrentStep) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
      {STEP_ORDER.map((step, i) => {
        const status = progress.steps[step].status
        const isCurrent = viewStep === step
        const isPast = STEP_ORDER.indexOf(step) < STEP_ORDER.indexOf(progress.current_step === 'go_live' ? 'payment' : (progress.current_step as WizardStep)) || status !== 'pending'
        const clickable = status !== 'pending'
        let indicator: React.ReactNode
        if (status === 'completed') indicator = <span style={{ color: COLORS.green }}>✓</span>
        else if (status === 'skipped') indicator = <span style={{ fontSize: 10, color: COLORS.textMuted }}>Skipped</span>
        else indicator = <span>{i + 1}</span>

        return (
          <div
            key={step}
            onClick={() => clickable && onJump(step)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: clickable ? 'pointer' : 'default',
              fontSize: 12,
              color: isCurrent ? COLORS.textPrimary : isPast ? COLORS.textSecondary : COLORS.textMuted,
              fontWeight: isCurrent ? 700 : 400,
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                background: isCurrent ? COLORS.purple : 'transparent',
                border: `1px solid ${isCurrent ? COLORS.purple : COLORS.borderStrong}`,
                color: isCurrent ? '#fff' : undefined,
              }}
            >
              {indicator}
            </span>
            {STEP_LABEL[step]}
          </div>
        )
      })}
      <div
        onClick={() => progress.current_step === 'go_live' && onJump('go_live')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          cursor: progress.current_step === 'go_live' ? 'pointer' : 'default',
          color: viewStep === 'go_live' ? COLORS.textPrimary : COLORS.textMuted,
          fontWeight: viewStep === 'go_live' ? 700 : 400,
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            background: viewStep === 'go_live' ? COLORS.purple : 'transparent',
            border: `1px solid ${viewStep === 'go_live' ? COLORS.purple : COLORS.borderStrong}`,
            color: viewStep === 'go_live' ? '#fff' : undefined,
          }}
        >
          7
        </span>
        Go live
      </div>
    </div>
  )
}

function PaymentStep({ partnerAccountId }: { partnerAccountId: string }) {
  const [busy, setBusy] = useState<'topup' | 'subscription' | null>(null)

  async function startCheckout() {
    setBusy('topup')
    const successUrl = `${window.location.origin}/dashboard/configurator/wizard?partner_account_id=${partnerAccountId}&step=payment&funded=1`
    const cancelUrl = `${window.location.origin}/dashboard/configurator/wizard?partner_account_id=${partnerAccountId}&step=payment`
    try {
      const res = await fetch('/api/admin/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: partnerAccountId, amount_usd: 100, success_url: successUrl, cancel_url: cancelUrl }),
      })
      const data = await res.json()
      if (data.checkout_url) window.location.href = data.checkout_url
    } finally {
      setBusy(null)
    }
  }

  async function startSubscription() {
    setBusy('subscription')
    const successUrl = `${window.location.origin}/dashboard/configurator/wizard?partner_account_id=${partnerAccountId}&step=payment&funded=1`
    const cancelUrl = `${window.location.origin}/dashboard/configurator/wizard?partner_account_id=${partnerAccountId}&step=payment`
    try {
      const res = await fetch('/api/admin/billing/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: partnerAccountId, monthly_minimum_usd: 100, success_url: successUrl, cancel_url: cancelUrl }),
      })
      const data = await res.json()
      if (data.checkout_url) window.location.href = data.checkout_url
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Add a payment method</h1>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 20 }}>Choose how you&apos;ll fund usage.</p>
      <div style={{ display: 'flex', gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <p style={{ fontWeight: 600, marginBottom: 6 }}>Pay as you go</p>
          <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12 }}>One-time top-up via Stripe Checkout.</p>
          <PrimaryButton disabled={busy !== null} onClick={startCheckout}>{busy === 'topup' ? 'Redirecting…' : 'Pay as you go'}</PrimaryButton>
        </Card>
        <Card style={{ flex: 1 }}>
          <p style={{ fontWeight: 600, marginBottom: 6 }}>Set a monthly minimum</p>
          <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12 }}>Auto-recharge subscription, discounted rate.</p>
          <PrimaryButton disabled={busy !== null} onClick={startSubscription}>{busy === 'subscription' ? 'Redirecting…' : 'Set a monthly minimum'}</PrimaryButton>
        </Card>
      </div>
    </>
  )
}

function GoLiveStep({ domainSettings, partnerAccountId }: { domainSettings: DomainSettingsResponse | null; partnerAccountId: string }) {
  const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const liveUrl =
    domainSettings?.custom_domain_status === 'verified' && domainSettings.custom_domain_url
      ? domainSettings.custom_domain_url
      : domainSettings?.subdomain_url
      ? domainSettings.subdomain_url
      : `${appUrl}/partner-questionnaire/${partnerAccountId}`

  return (
    <>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>You&apos;re ready to go live.</h1>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>Your end users will reach you at:</p>
      <Card>
        <p style={{ fontSize: 16, fontWeight: 600, textAlign: 'center' }}>{liveUrl}</p>
      </Card>
    </>
  )
}
