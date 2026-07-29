'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorShell, COLORS, Card, PrimaryButton, SecondaryButton } from './_shared'
import { PLAN_TIERS, getIncludedAllowanceUsd, getPlanPriceUsd, type PlanTierKey, type PlanBillingPeriod } from '@/lib/billing/plan-tiers'

/**
 * B2B-20 §6 — Payment configuration, extracted verbatim (behavior-preserving)
 * from the wizard's former `PaymentStep` (`wizard/WizardClient.tsx`). This is
 * the guardrail "extract-and-verify" component: it is fully functional
 * standalone and is hosted `embedded` inside `ConfiguratorSurface`.
 *
 * The only functional changes vs. the wizard's `PaymentStep`:
 *   1. Stripe Checkout success/cancel return URLs now point at the unified
 *      surface (`/dashboard/configurator?section=payment&funded=1`) rather than
 *      the retired `/wizard?...&funded=1` (B2B-20 §6.2, §9).
 *   2. The `funded=1` return no longer calls the removed linear `advance`
 *      action — it re-reads the live completion status and surfaces the
 *      "couldn't confirm yet" message if the wallet isn't funded (B2B-20 §8),
 *      then invokes `onFunded()` so the surface can refresh its completion dot.
 *
 * Mirrors the `embedded` reuse pattern of the other five section clients:
 * `embedded` → bare content; otherwise wrapped in `<ConfiguratorShell>`.
 */

const TOPUP_PRESETS_USD = [50, 100, 250, 500]
const TOPUP_MIN_USD = 20
const TOPUP_MAX_USD = 50000

function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`
}

export default function PaymentConfigClient({
  accounts,
  activePartnerAccountId,
  embedded = false,
  onFunded,
  basePath = '/dashboard/configurator',
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  embedded?: boolean
  /** Called after a Stripe return so the host surface can refetch completion status. */
  onFunded?: () => void
  /** B2B-29 (docs/specs/B2B-29-requirement-document.md §6.1) — see ConfiguratorSurface.tsx. */
  basePath?: string
}) {
  const partnerAccountId = activePartnerAccountId
  const router = useRouter()
  const searchParams = useSearchParams()

  const [busy, setBusy] = useState<PlanTierKey | 'topup' | 'card_verification' | null>(null)
  const [billingPeriod, setBillingPeriod] = useState<PlanBillingPeriod>('monthly')
  const [topupAmount, setTopupAmount] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null)
  const [returnMessage, setReturnMessage] = useState<string | null>(null)
  const handledFundedRef = useRef(false)

  // B2B-27 — card-on-file verification status. `null` = not yet loaded.
  const [cardOnFile, setCardOnFile] = useState<boolean | null>(null)
  const [cardReturnMessage, setCardReturnMessage] = useState<string | null>(null)
  const handledCardVerifiedRef = useRef(false)

  // Always-run mount-time status fetch — populates cardOnFile on first load,
  // independent of any Stripe return param. Failure leaves cardOnFile null
  // ("Checking…" persists), matching this component's existing catch{}
  // discipline on its other fetch calls.
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/configurator/status?partner_account_id=${partnerAccountId}`)
        if (res.ok) {
          const status = await res.json()
          setCardOnFile(status.card_on_file === true)
        }
      } catch {
        // leave cardOnFile null — block keeps showing "Checking…"
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerAccountId])

  // Card verification return (mirrors the funded=1 handler exactly, kept
  // structurally separate — the two query params gate two independent Stripe
  // flows that can each fire on their own return trip).
  useEffect(() => {
    const cardVerified = searchParams?.get('card_verified')
    if (cardVerified === '1' && !handledCardVerifiedRef.current) {
      handledCardVerifiedRef.current = true
      ;(async () => {
        let confirmed = false
        try {
          const res = await fetch(`/api/admin/configurator/status?partner_account_id=${partnerAccountId}`)
          if (res.ok) {
            const status = await res.json()
            confirmed = status.card_on_file === true
            setCardOnFile(confirmed)
          }
        } catch {
          confirmed = false
        }
        router.replace(`${basePath}?partner_account_id=${partnerAccountId}&section=payment`)
        if (!confirmed) {
          setCardReturnMessage(
            "We couldn't confirm your card yet — this can take a few seconds if Stripe hasn't finished processing. Refresh in a moment to check again.",
          )
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const trimmedAmount = topupAmount.trim()
  const amountNum = trimmedAmount === '' ? NaN : Number(trimmedAmount)
  const amountValid = !Number.isNaN(amountNum) && amountNum >= TOPUP_MIN_USD && amountNum <= TOPUP_MAX_USD
  const showAmountError = trimmedAmount !== '' && !amountValid

  // Stripe Checkout return (B2B-20 §8/§9). Verify live against the completion
  // status endpoint (`payment` = wallet funding_mechanism set) — never trust
  // the URL param alone — then clean the param and notify the host.
  useEffect(() => {
    const funded = searchParams?.get('funded')
    if (funded === '1' && !handledFundedRef.current) {
      handledFundedRef.current = true
      ;(async () => {
        let confirmed = false
        try {
          const res = await fetch(`/api/admin/configurator/status?partner_account_id=${partnerAccountId}`)
          if (res.ok) {
            const status = await res.json()
            confirmed = status.payment === true
          }
        } catch {
          confirmed = false
        }
        router.replace(`${basePath}?partner_account_id=${partnerAccountId}&section=payment`)
        if (!confirmed) {
          setReturnMessage(
            "We couldn't confirm your payment yet — this can take a few seconds if Stripe hasn't finished processing. Refresh in a moment to check again.",
          )
        }
        onFunded?.()
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function successAndCancelUrls() {
    return {
      successUrl: `${window.location.origin}${basePath}?partner_account_id=${partnerAccountId}&section=payment&funded=1`,
      cancelUrl: `${window.location.origin}${basePath}?partner_account_id=${partnerAccountId}&section=payment`,
    }
  }

  async function startPlanCheckout(tierKey: PlanTierKey) {
    setBusy(tierKey)
    const { successUrl, cancelUrl } = successAndCancelUrls()
    try {
      const res = await fetch('/api/admin/billing/plan-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_account_id: partnerAccountId,
          plan_tier_key: tierKey,
          billing_period: billingPeriod,
          success_url: successUrl,
          cancel_url: cancelUrl,
        }),
      })
      const data = await res.json()
      if (data.checkout_url) window.location.href = data.checkout_url
    } finally {
      setBusy(null)
    }
  }

  async function startCheckout() {
    if (!amountValid) return
    setBusy('topup')
    const { successUrl, cancelUrl } = successAndCancelUrls()
    try {
      const res = await fetch('/api/admin/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: partnerAccountId, amount_usd: amountNum, success_url: successUrl, cancel_url: cancelUrl }),
      })
      const data = await res.json()
      if (data.checkout_url) window.location.href = data.checkout_url
    } finally {
      setBusy(null)
    }
  }

  function cardVerificationUrls() {
    return {
      successUrl: `${window.location.origin}${basePath}?partner_account_id=${partnerAccountId}&section=payment&card_verified=1`,
      cancelUrl: `${window.location.origin}${basePath}?partner_account_id=${partnerAccountId}&section=payment`,
    }
  }

  async function startCardVerification() {
    setBusy('card_verification')
    const { successUrl, cancelUrl } = cardVerificationUrls()
    try {
      const res = await fetch('/api/admin/billing/card-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: partnerAccountId, success_url: successUrl, cancel_url: cancelUrl }),
      })
      const data = await res.json()
      if (data.checkout_url) window.location.href = data.checkout_url
    } finally {
      setBusy(null)
    }
  }

  function onPresetClick(amount: number) {
    setSelectedPreset(amount)
    setTopupAmount(String(amount))
  }

  function onCustomAmountChange(value: string) {
    setTopupAmount(value)
    setSelectedPreset(null)
  }

  const content = (
    <>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Add a payment method</h1>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 20 }}>Choose how you&apos;ll fund usage.</p>

      {returnMessage && <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>{returnMessage}</p>}
      {cardReturnMessage && <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>{cardReturnMessage}</p>}

      <Card style={{ marginBottom: 20 }}>
        <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Card verification</p>
        {cardOnFile === null && (
          <p style={{ fontSize: 12, color: COLORS.textSecondary }}>Checking…</p>
        )}
        {cardOnFile === false && (
          <>
            <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12 }}>
              Verify a card to unlock test-mode access. This never charges you — it only confirms the card is valid.
            </p>
            <PrimaryButton disabled={busy !== null} onClick={startCardVerification}>
              {busy === 'card_verification' ? 'Redirecting…' : 'Add a card'}
            </PrimaryButton>
          </>
        )}
        {cardOnFile === true && (
          <p style={{ fontSize: 13 }}>
            <span style={{ color: COLORS.green }}>✓</span>{' '}
            <span style={{ color: COLORS.textPrimary }}>Card on file — testing unlocked.</span>
          </p>
        )}
      </Card>

      <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 8 }}>Plans</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <BillingPeriodPill label="Monthly" active={billingPeriod === 'monthly'} disabled={busy !== null} onClick={() => setBillingPeriod('monthly')} />
        <BillingPeriodPill label="Annual" active={billingPeriod === 'annual'} disabled={busy !== null} onClick={() => setBillingPeriod('annual')} />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {PLAN_TIERS.map((tier) => (
          <Card key={tier.key} style={{ flex: 1, minWidth: 180 }}>
            <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{tier.displayName}</p>
            <p style={{ fontWeight: 700, fontSize: 20, marginBottom: 4 }}>
              {formatUsd(getPlanPriceUsd(tier, billingPeriod))}
              {billingPeriod === 'monthly' ? '/mo' : '/yr'}
            </p>
            <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12 }}>
              Includes {formatUsd(getIncludedAllowanceUsd(tier, billingPeriod))}
              {billingPeriod === 'monthly' ? '/mo' : '/yr'} of usage
            </p>
            <PrimaryButton disabled={busy !== null} onClick={() => startPlanCheckout(tier.key)}>
              {busy === tier.key ? 'Redirecting…' : `Choose ${tier.displayName}`}
            </PrimaryButton>
          </Card>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${COLORS.borderSubtle}`, paddingTop: 16, marginBottom: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary }}>Pay as you go</p>
      </div>

      <Card>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12 }}>One-time top-up via Stripe Checkout.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {TOPUP_PRESETS_USD.map((amount) => (
            <SecondaryButton
              key={amount}
              disabled={busy !== null}
              onClick={() => onPresetClick(amount)}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                borderWidth: selectedPreset === amount ? 2 : 1,
                borderColor: selectedPreset === amount ? COLORS.purple : COLORS.borderStrong,
                opacity: busy !== null ? 0.4 : 1,
                cursor: busy !== null ? 'not-allowed' : 'pointer',
              }}
            >
              ${amount}
            </SecondaryButton>
          ))}
        </div>
        <label style={{ display: 'block', fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Or enter a custom amount</label>
        <div style={{ position: 'relative', marginBottom: showAmountError ? 6 : 12 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: COLORS.textSecondary, fontSize: 13, pointerEvents: 'none' }}>$</span>
          <input
            type="number"
            placeholder="e.g. 150"
            value={topupAmount}
            disabled={busy !== null}
            onChange={(e) => onCustomAmountChange(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px 10px 22px',
              background: COLORS.raised,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              color: COLORS.textPrimary,
              fontSize: 13,
            }}
          />
        </div>
        {showAmountError && <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>Enter an amount between $20 and $50,000.</p>}
        <PrimaryButton disabled={busy !== null || !amountValid} onClick={startCheckout}>
          {busy === 'topup' ? 'Redirecting…' : amountValid ? `Pay as you go — $${trimmedAmount}` : 'Pay as you go'}
        </PrimaryButton>
      </Card>
    </>
  )

  if (embedded) return <>{content}</>

  return (
    <ConfiguratorShell
      accounts={accounts}
      activePartnerAccountId={activePartnerAccountId}
      title="Payment"
      backHref={`${basePath}?partner_account_id=${activePartnerAccountId}`}
    >
      {content}
    </ConfiguratorShell>
  )
}

function BillingPeriodPill({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 16px',
        fontSize: 12,
        fontWeight: 600,
        background: active ? COLORS.purple : 'transparent',
        color: active ? '#fff' : COLORS.textSecondary,
        border: `1px solid ${active ? COLORS.purple : COLORS.borderStrong}`,
        borderRadius: 999,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  )
}
