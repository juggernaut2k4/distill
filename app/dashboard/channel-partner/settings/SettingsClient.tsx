'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { COLORS, Card, PrimaryButton } from '../_shared'

/**
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §4). Two cards: Company
 * info (name + company_url, `PATCH /api/channel-partner/account`) and
 * Payment (card-on-file verification, reusing the B2B-27 Stripe `setup`-mode
 * mechanism via `/api/channel-partner/billing/card-verification`).
 *
 * Hotfix (2026-07-19, live-tested by Arun): Company info and Payment now
 * load via two fully independent fetches (`GET /api/channel-partner/account`
 * and `GET /api/channel-partner/billing/card-status`), each with its own
 * useState+useEffect+try/catch/finally. They used to share one combined
 * endpoint, which meant the name/company_url inputs (disabled until that
 * response resolved) sat disabled for as long as the slower card-on-file
 * check took, even though the two are unrelated data. Company info now
 * enables the moment its own (single-table-select, always-fast) fetch
 * resolves, regardless of how long the Payment card's "Checking…" state
 * lasts. Both cards remain permanently editable after their first save —
 * this is not a one-time setup form, per Arun's explicit requirement.
 */

const UNNAMED_PLACEHOLDER = 'Unnamed partner'

interface AccountData {
  name: string
  company_url: string | null
}

export default function SettingsClient() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [account, setAccount] = useState<AccountData | null>(null)
  const [loadError, setLoadError] = useState(false)

  const [name, setName] = useState('')
  const [companyUrl, setCompanyUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const [cardOnFile, setCardOnFile] = useState<boolean | null>(null)
  const [cardLoadError, setCardLoadError] = useState(false)
  const [cardBusy, setCardBusy] = useState(false)
  const [cardReturnMessage, setCardReturnMessage] = useState<string | null>(null)
  const handledCardVerifiedRef = useRef(false)

  async function loadAccount() {
    setLoadError(false)
    try {
      const res = await fetch('/api/channel-partner/account')
      if (!res.ok) throw new Error('load failed')
      const data: AccountData = await res.json()
      setAccount(data)
      setName(data.name)
      setCompanyUrl(data.company_url ?? '')
    } catch {
      setLoadError(true)
    }
  }

  async function loadCardStatus() {
    setCardLoadError(false)
    try {
      const res = await fetch('/api/channel-partner/billing/card-status')
      if (!res.ok) throw new Error('load failed')
      const data: { card_on_file: boolean } = await res.json()
      setCardOnFile(data.card_on_file)
    } catch {
      setCardLoadError(true)
    }
  }

  useEffect(() => {
    loadAccount()
    loadCardStatus()
  }, [])

  // Card-verification Stripe return — identical pattern to
  // PaymentConfigClient's own card_verified=1 handler.
  useEffect(() => {
    const cardVerified = searchParams?.get('card_verified')
    if (cardVerified === '1' && !handledCardVerifiedRef.current) {
      handledCardVerifiedRef.current = true
      ;(async () => {
        let confirmed = false
        try {
          const res = await fetch('/api/channel-partner/billing/card-status')
          if (res.ok) {
            const data: { card_on_file: boolean } = await res.json()
            confirmed = data.card_on_file === true
            setCardOnFile(confirmed)
          }
        } catch {
          confirmed = false
        }
        router.replace('/dashboard/channel-partner/settings')
        if (!confirmed) {
          setCardReturnMessage(
            "We couldn't confirm your card yet — this can take a few seconds if Stripe hasn't finished processing. Refresh in a moment to check again."
          )
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const unchanged = account !== null && name === account.name && companyUrl === (account.company_url ?? '')

  async function handleSave() {
    if (!name.trim()) {
      setValidationError('Company name is required.')
      return
    }
    setValidationError(null)
    setSaveError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/channel-partner/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), companyUrl: companyUrl.trim() || null }),
      })
      if (!res.ok) {
        setSaveError("Couldn't save. Try again.")
        return
      }
      setAccount((prev) => (prev ? { ...prev, name: name.trim(), company_url: companyUrl.trim() || null } : prev))
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch {
      setSaveError("Couldn't save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  async function handleAddCard() {
    setCardBusy(true)
    setCardReturnMessage(null)
    try {
      const res = await fetch('/api/channel-partner/billing/card-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success_url: `${window.location.origin}/dashboard/channel-partner/settings?card_verified=1`,
          cancel_url: `${window.location.origin}/dashboard/channel-partner/settings`,
        }),
      })
      const data = await res.json()
      if (data.checkout_url) {
        window.location.href = data.checkout_url
      }
    } finally {
      setCardBusy(false)
    }
  }

  return (
    <div>
      <h1 className="text-white text-2xl font-bold mb-4">Settings</h1>

      {loadError && (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ color: COLORS.red, fontSize: 13 }}>Couldn&apos;t load your account. Try refreshing the page.</p>
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 16px' }}>Company info</h2>

        <label style={{ display: 'block', color: COLORS.textSecondary, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
          Company name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          placeholder={UNNAMED_PLACEHOLDER}
          disabled={account === null}
          style={{ width: '100%', boxSizing: 'border-box', background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 13, marginBottom: 12 }}
        />
        {validationError && <p style={{ color: COLORS.red, fontSize: 12, marginTop: -8, marginBottom: 12 }}>{validationError}</p>}

        <label style={{ display: 'block', color: COLORS.textSecondary, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
          Company URL
        </label>
        <input
          type="text"
          value={companyUrl}
          onChange={(e) => setCompanyUrl(e.target.value)}
          maxLength={500}
          placeholder="acme.com"
          disabled={account === null}
          style={{ width: '100%', boxSizing: 'border-box', background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 13, marginBottom: 16 }}
        />

        {saveError && <p style={{ color: COLORS.red, fontSize: 12, marginBottom: 12 }}>{saveError}</p>}
        {savedFlash && <p style={{ color: COLORS.green, fontSize: 12, marginBottom: 12 }}>Saved.</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <PrimaryButton disabled={account === null || unchanged || saving} onClick={handleSave}>
            {saving && <Loader2 className="inline-block w-3.5 h-3.5 animate-spin mr-1.5" style={{ verticalAlign: 'middle' }} />}
            Save
          </PrimaryButton>
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 12px' }}>Payment</h2>

        {cardReturnMessage && <p style={{ color: COLORS.red, fontSize: 12, marginBottom: 12 }}>{cardReturnMessage}</p>}

        {cardLoadError && (
          <p style={{ color: COLORS.red, fontSize: 13 }}>Couldn&apos;t check your card status. Try refreshing the page.</p>
        )}

        {!cardLoadError && cardOnFile === null && <p style={{ color: COLORS.textSecondary, fontSize: 13 }}>Checking…</p>}

        {cardOnFile === false && (
          <>
            <p style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 12 }}>
              Add a card to unlock full access to your own account. This never charges you — it only confirms the card is
              valid.
            </p>
            <PrimaryButton disabled={cardBusy} onClick={handleAddCard}>
              {cardBusy ? 'Redirecting…' : 'Add a card'}
            </PrimaryButton>
          </>
        )}

        {cardOnFile === true && (
          <p style={{ fontSize: 13 }}>
            <span style={{ color: COLORS.green }}>✓</span> <span style={{ color: COLORS.textPrimary }}>Card on file.</span>
          </p>
        )}
      </Card>
    </div>
  )
}
