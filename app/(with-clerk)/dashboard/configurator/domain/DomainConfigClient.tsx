'use client'

import { useEffect, useRef, useState } from 'react'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorShell, Card, PrimaryButton, SecondaryButton, COLORS } from '../_shared'

/**
 * B2B-05 — `/dashboard/configurator/domain` (Requirement Doc Section 4.A).
 * Follows the established `TopicsConfigClient.tsx`/`VisualizationClient.tsx`
 * pattern exactly — no new design system invented.
 */

type CustomDomainStatus = 'none' | 'pending_verification' | 'verified' | 'failed'

interface VerificationRecord {
  type: string
  domain: string
  value: string
  reason: string
}

interface DomainSettingsResponse {
  root_domain: string
  subdomain_slug: string | null
  subdomain_url: string | null
  custom_domain: string | null
  custom_domain_status: CustomDomainStatus
  custom_domain_error: string | null
  custom_domain_verification: VerificationRecord[] | null
  custom_domain_url: string | null
}

export default function DomainConfigClient({
  accounts,
  activePartnerAccountId,
  embedded = false,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  embedded?: boolean
}) {
  const [settings, setSettings] = useState<DomainSettingsResponse | null>(null)
  const [loadError, setLoadError] = useState(false)

  async function load() {
    setLoadError(false)
    try {
      const res = await fetch(`/api/admin/configurator/domain?partner_account_id=${activePartnerAccountId}`)
      if (!res.ok) throw new Error('load failed')
      setSettings(await res.json())
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    setSettings(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePartnerAccountId])

  let content: React.ReactNode

  if (loadError) {
    content = (
      <Card>
        <p style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13 }}>
          Couldn&apos;t load domain settings. Try refreshing the page.
        </p>
      </Card>
    )
  } else if (!settings) {
    content = (
      <Card>
        <p style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13 }}>Loading domain settings…</p>
      </Card>
    )
  } else {
    content = (
      <>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Domain</h1>
        <SubdomainCard partnerAccountId={activePartnerAccountId} settings={settings} onUpdated={load} />
        <CustomDomainCard partnerAccountId={activePartnerAccountId} settings={settings} onUpdated={load} />
      </>
    )
  }

  if (embedded) return <>{content}</>

  return (
    <ConfiguratorShell
      accounts={accounts}
      activePartnerAccountId={activePartnerAccountId}
      title="Domain"
      backHref={`/dashboard/configurator?partner_account_id=${activePartnerAccountId}`}
    >
      {content}
    </ConfiguratorShell>
  )
}

function StatusBadge({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

function SubdomainCard({
  partnerAccountId,
  settings,
  onUpdated,
}: {
  partnerAccountId: string
  settings: DomainSettingsResponse
  onUpdated: () => void
}) {
  const [editing, setEditing] = useState(!settings.subdomain_slug)
  const [slug, setSlug] = useState(settings.subdomain_slug ?? '')
  const [helper, setHelper] = useState<string | null>(null)
  const [helperIsError, setHelperIsError] = useState(false)
  const [available, setAvailable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setEditing(!settings.subdomain_slug)
    setSlug(settings.subdomain_slug ?? '')
  }, [settings.subdomain_slug])

  function onChangeSlug(value: string) {
    const next = value.toLowerCase()
    setSlug(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      if (!next) {
        setHelper(null)
        setHelperIsError(false)
        setAvailable(false)
        return
      }
      try {
        const res = await fetch(
          `/api/admin/configurator/domain/check-slug?partner_account_id=${partnerAccountId}&slug=${encodeURIComponent(next)}`
        )
        const data = await res.json()
        if (data.available) {
          setHelper(null)
          setHelperIsError(false)
          setAvailable(true)
        } else {
          setAvailable(false)
          setHelperIsError(true)
          setHelper(
            data.reason === 'taken'
              ? 'This subdomain is already taken.'
              : data.reason === 'reserved'
              ? 'This subdomain is reserved.'
              : 'Only lowercase letters, numbers, and hyphens, 3–63 characters.'
          )
        }
      } catch {
        // transient — leave state as-is, partner can retry via Save
      }
    }, 400)
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/configurator/domain/subdomain', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: partnerAccountId, subdomain_slug: slug }),
      })
      if (res.ok) {
        onUpdated()
        setEditing(false)
      } else {
        const data = await res.json().catch(() => ({}))
        setHelperIsError(true)
        setHelper(data.error?.message ?? 'Could not save subdomain.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function copyUrl() {
    if (!settings.subdomain_url) return
    try {
      await navigator.clipboard.writeText(settings.subdomain_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — no-op
    }
  }

  if (!editing && settings.subdomain_slug) {
    return (
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <p style={{ fontSize: 14, fontWeight: 600 }}>Your Clio subdomain</p>
          <StatusBadge color={COLORS.green} label="Live" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14 }}>{settings.subdomain_slug}.{settings.root_domain}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <SecondaryButton style={{ padding: '4px 10px' }} onClick={copyUrl}>{copied ? 'Copied' : 'Copy'}</SecondaryButton>
            <SecondaryButton style={{ padding: '4px 10px' }} onClick={() => setEditing(true)}>Edit</SecondaryButton>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Your Clio subdomain</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <input
          value={slug}
          onChange={(e) => onChangeSlug(e.target.value)}
          placeholder="acme-co"
          style={{ flex: 1, background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 13 }}
        />
        <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>.{settings.root_domain}</span>
      </div>
      <p style={{ fontSize: 12, color: helperIsError ? COLORS.red : COLORS.textSecondary, marginBottom: 12 }}>
        {helper ?? 'Lowercase letters, numbers, and hyphens only. 3–63 characters.'}
      </p>
      <PrimaryButton disabled={!available || !slug || saving} onClick={save}>
        {saving ? 'Saving…' : 'Save subdomain'}
      </PrimaryButton>
    </Card>
  )
}

function CustomDomainCard({
  partnerAccountId,
  settings,
  onUpdated,
}: {
  partnerAccountId: string
  settings: DomainSettingsResponse
  onUpdated: () => void
}) {
  const [domain, setDomain] = useState('')
  const [rechecking, setRechecking] = useState(false)
  const [removeConfirming, setRemoveConfirming] = useState(false)
  const [copied, setCopied] = useState(false)
  const removeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const muted = !settings.subdomain_slug

  async function copyUrl() {
    if (!settings.custom_domain_url) return
    try {
      await navigator.clipboard.writeText(settings.custom_domain_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — no-op
    }
  }

  async function add() {
    if (!domain.trim()) return
    const res = await fetch('/api/admin/configurator/domain/custom-domain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerAccountId, custom_domain: domain.trim().toLowerCase() }),
    })
    if (res.ok || res.status === 422) {
      setDomain('')
      onUpdated()
    }
  }

  async function recheck() {
    setRechecking(true)
    try {
      await fetch('/api/admin/configurator/domain/custom-domain/recheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: partnerAccountId }),
      })
      onUpdated()
    } finally {
      setRechecking(false)
    }
  }

  function onRemoveClick() {
    if (!removeConfirming) {
      setRemoveConfirming(true)
      removeTimerRef.current = setTimeout(() => setRemoveConfirming(false), 5000)
      return
    }
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current)
    setRemoveConfirming(false)
    fetch('/api/admin/configurator/domain/custom-domain', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerAccountId }),
    }).then(onUpdated)
  }

  function tryDifferentDomain() {
    setDomain('')
    // Clears the failed state client-side; next POST overwrites entirely (Section 9).
    fetch('/api/admin/configurator/domain/custom-domain', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerAccountId }),
    }).then(onUpdated)
  }

  if (settings.custom_domain_status === 'none') {
    return (
      <Card style={{ opacity: muted ? 0.6 : 1 }}>
        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Custom domain</p>
        {muted ? (
          <p style={{ fontSize: 13, color: COLORS.textSecondary }}>Add your own domain once your subdomain is set.</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
              Use your own domain instead of the subdomain above. Your subdomain keeps working either way.
            </p>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="learning.acme.com"
              style={{ width: '100%', background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 13, marginBottom: 12 }}
            />
            <PrimaryButton disabled={!domain.trim()} onClick={add}>Add domain</PrimaryButton>
          </>
        )}
      </Card>
    )
  }

  if (settings.custom_domain_status === 'pending_verification') {
    return (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 600 }}>Custom domain</p>
          <StatusBadge color={COLORS.amber} label="Pending" />
        </div>
        <p style={{ fontSize: 14, marginBottom: 12 }}>{settings.custom_domain}</p>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Add this DNS record at your domain registrar:</p>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>
            <span style={{ width: 60 }}>Type</span>
            <span style={{ width: 100 }}>Name</span>
            <span>Value</span>
          </div>
          {(settings.custom_domain_verification ?? []).map((v, i) => (
            <div key={i} style={{ display: 'flex', gap: 16, fontSize: 13, marginBottom: 4 }}>
              <span style={{ width: 60 }}>{v.type}</span>
              <span style={{ width: 100 }}>{v.domain}</span>
              <span>{v.value}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <SecondaryButton disabled={rechecking} onClick={recheck}>{rechecking ? 'Checking…' : 'Recheck verification'}</SecondaryButton>
          <SecondaryButton style={{ borderColor: COLORS.red, color: removeConfirming ? COLORS.red : COLORS.textPrimary }} onClick={onRemoveClick}>
            {removeConfirming ? 'Click again to remove' : 'Remove domain'}
          </SecondaryButton>
        </div>
        <p style={{ fontSize: 12, color: COLORS.textMuted }}>DNS changes can take up to 48 hours to propagate.</p>
      </Card>
    )
  }

  if (settings.custom_domain_status === 'verified') {
    return (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 600 }}>Custom domain</p>
          <StatusBadge color={COLORS.green} label="Verified" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14 }}>{settings.custom_domain}</span>
          <SecondaryButton style={{ padding: '4px 10px' }} onClick={copyUrl}>{copied ? 'Copied' : 'Copy'}</SecondaryButton>
        </div>
        <SecondaryButton style={{ borderColor: COLORS.red, color: removeConfirming ? COLORS.red : COLORS.textPrimary }} onClick={onRemoveClick}>
          {removeConfirming ? 'Click again to remove' : 'Remove domain'}
        </SecondaryButton>
      </Card>
    )
  }

  // 'failed'
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ fontSize: 14, fontWeight: 600 }}>Custom domain</p>
        <StatusBadge color={COLORS.red} label="Failed" />
      </div>
      <p style={{ fontSize: 14, marginBottom: 12 }}>{settings.custom_domain}</p>
      <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>
        Couldn&apos;t add this domain: {settings.custom_domain_error}
      </p>
      <SecondaryButton onClick={tryDifferentDomain}>Try a different domain</SecondaryButton>
    </Card>
  )
}
