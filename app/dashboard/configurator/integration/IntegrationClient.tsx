'use client'

import { useEffect, useState } from 'react'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorShell, Card, PrimaryButton, SecondaryButton, COLORS } from '../_shared'

/**
 * B2B-06 — `/dashboard/configurator/integration` (Requirement Doc Section
 * 4.C). Two cards, matching the Domain screen's own two-card layout
 * precedent: "API credentials" (self-serve OAuth2 client generation/listing)
 * and "Outbound webhooks" (base URL + auth token + signing secret).
 */

interface OAuthClient {
  id: string
  client_id: string
  mode: 'test' | 'live'
  label: string | null
  status: 'active' | 'revoked'
  last_used_at: string | null
  created_at: string
}

interface GeneratedClient {
  id: string
  client_id: string
  client_secret: string
  mode: 'test' | 'live'
  label: string | null
}

interface OutboundConfig {
  outbound_base_url: string | null
  outbound_auth_token_set: boolean
  outbound_signing_secret_set: boolean
}

interface IntegrationData {
  clients: OAuthClient[]
  outbound: OutboundConfig
}

export default function IntegrationClient({
  accounts,
  activePartnerAccountId,
  embedded = false,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  embedded?: boolean
}) {
  const [data, setData] = useState<IntegrationData | null>(null)
  const [loadError, setLoadError] = useState(false)

  async function load() {
    setLoadError(false)
    try {
      const [clientsRes, outboundRes] = await Promise.all([
        fetch(`/api/admin/configurator/oauth-clients?partner_account_id=${activePartnerAccountId}`),
        fetch(`/api/admin/configurator/outbound-config?partner_account_id=${activePartnerAccountId}`),
      ])
      if (!clientsRes.ok || !outboundRes.ok) throw new Error('load failed')
      const [clientsBody, outboundBody] = await Promise.all([clientsRes.json(), outboundRes.json()])
      setData({ clients: clientsBody.clients ?? [], outbound: outboundBody })
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    setData(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePartnerAccountId])

  let content: React.ReactNode

  if (loadError) {
    content = (
      <>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Integration</h1>
        <Card style={{ marginBottom: 16 }}>
          <p style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13 }}>
            Couldn&apos;t load integration settings. Try refreshing the page.
          </p>
        </Card>
        <Card>
          <p style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13 }}>
            Couldn&apos;t load integration settings. Try refreshing the page.
          </p>
        </Card>
      </>
    )
  } else if (!data) {
    content = (
      <>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Integration</h1>
        <Card style={{ marginBottom: 16 }}>
          <p style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13 }}>Loading integration settings…</p>
        </Card>
        <Card>
          <p style={{ textAlign: 'center', color: COLORS.textSecondary, fontSize: 13 }}>Loading integration settings…</p>
        </Card>
      </>
    )
  } else {
    content = (
      <>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Integration</h1>
        <ApiCredentialsCard partnerAccountId={activePartnerAccountId} clients={data.clients} onUpdated={load} />
        <OutboundWebhooksCard partnerAccountId={activePartnerAccountId} outbound={data.outbound} onUpdated={load} />
      </>
    )
  }

  if (embedded) return <>{content}</>

  return (
    <ConfiguratorShell
      accounts={accounts}
      activePartnerAccountId={activePartnerAccountId}
      title="Integration"
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

function ApiCredentialsCard({
  partnerAccountId,
  clients,
  onUpdated,
}: {
  partnerAccountId: string
  clients: OAuthClient[]
  onUpdated: () => void
}) {
  const [formOpen, setFormOpen] = useState(clients.length === 0)
  const [mode, setMode] = useState<'test' | 'live'>('test')
  const [label, setLabel] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<GeneratedClient | null>(null)
  const [copiedId, setCopiedId] = useState(false)
  const [copiedSecret, setCopiedSecret] = useState(false)

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/configurator/oauth-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_account_id: partnerAccountId,
          mode,
          ...(label.trim() ? { label: label.trim() } : {}),
        }),
      })
      if (res.ok) {
        const body: GeneratedClient = await res.json()
        setRevealed(body)
        setLabel('')
        setMode('test')
        onUpdated()
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.error?.message ?? (typeof body.error === 'string' ? body.error : 'Could not generate credentials.'))
      }
    } finally {
      setGenerating(false)
    }
  }

  async function copy(value: string, setCopied: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — no-op
    }
  }

  // Screen state 2 — reveal-once. Takes priority over the list regardless of
  // how many credentials now exist (Requirement Doc Section 4.C).
  if (revealed) {
    return (
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 600 }}>API credentials</p>
          <StatusBadge color={COLORS.green} label="Generated" />
        </div>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Client ID</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <code style={{ flex: 1, fontSize: 13, wordBreak: 'break-all', background: COLORS.raised, padding: 8, borderRadius: 6 }}>
            {revealed.client_id}
          </code>
          <SecondaryButton style={{ padding: '4px 10px' }} onClick={() => copy(revealed.client_id, setCopiedId)}>
            {copiedId ? 'Copied' : 'Copy'}
          </SecondaryButton>
        </div>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Client secret (shown once — save it now)</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <code style={{ flex: 1, fontSize: 13, wordBreak: 'break-all', background: COLORS.raised, padding: 8, borderRadius: 6 }}>
            {revealed.client_secret}
          </code>
          <SecondaryButton style={{ padding: '4px 10px' }} onClick={() => copy(revealed.client_secret, setCopiedSecret)}>
            {copiedSecret ? 'Copied' : 'Copy'}
          </SecondaryButton>
        </div>
        <p style={{ fontSize: 12, color: COLORS.amber, marginBottom: 16 }}>This secret will not be shown again.</p>
        <PrimaryButton
          onClick={() => {
            setRevealed(null)
            setFormOpen(true)
          }}
        >
          Generate another credential
        </PrimaryButton>
      </Card>
    )
  }

  const form = (
    <>
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Mode</p>
        <div style={{ display: 'flex', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="radio" name="oauth-mode" checked={mode === 'test'} onChange={() => setMode('test')} />
            Test
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="radio" name="oauth-mode" checked={mode === 'live'} onChange={() => setMode('live')} />
            Live
          </label>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Label (optional)</p>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Production integration"
          style={{ width: '100%', background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 13 }}
        />
      </div>
      {error && <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>{error}</p>}
      <PrimaryButton disabled={generating} onClick={generate}>
        {generating ? 'Generating…' : 'Generate credentials'}
      </PrimaryButton>
    </>
  )

  // Screen state 1 — no credentials generated yet.
  if (clients.length === 0) {
    return (
      <Card style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>API credentials</p>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>
          Generate a client ID and secret for your own backend to call the Clio API.
        </p>
        {form}
      </Card>
    )
  }

  // Screen state 3 — one or more credentials already exist.
  return (
    <Card style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>API credentials</p>
      {formOpen && <div style={{ marginBottom: 16 }}>{form}</div>}
      <div style={{ marginBottom: formOpen ? 0 : 12 }}>
        {clients.map((c) => (
          <div
            key={c.id}
            style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13, padding: '8px 0', borderBottom: `1px solid ${COLORS.borderSubtle}` }}
          >
            <code style={{ flex: 1, color: COLORS.textPrimary }}>{c.client_id}</code>
            <span style={{ textTransform: 'capitalize', color: c.mode === 'live' ? COLORS.amber : COLORS.textSecondary, width: 48 }}>
              {c.mode}
            </span>
            <span style={{ color: COLORS.textSecondary }}>{c.label ?? '—'}</span>
          </div>
        ))}
      </div>
      {!formOpen && (
        <SecondaryButton style={{ marginTop: 12 }} onClick={() => setFormOpen(true)}>
          + Generate new credential
        </SecondaryButton>
      )}
    </Card>
  )
}

function OutboundWebhooksCard({
  partnerAccountId,
  outbound,
  onUpdated,
}: {
  partnerAccountId: string
  outbound: OutboundConfig
  onUpdated: () => void
}) {
  const [editing, setEditing] = useState(!outbound.outbound_base_url)
  const [baseUrl, setBaseUrl] = useState(outbound.outbound_base_url ?? '')
  const [authToken, setAuthToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSavedSecret, setJustSavedSecret] = useState<string | null>(null)
  const [copiedSecret, setCopiedSecret] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    setEditing(!outbound.outbound_base_url)
    setBaseUrl(outbound.outbound_base_url ?? '')
  }, [outbound.outbound_base_url])

  const configured = Boolean(outbound.outbound_base_url)

  async function save() {
    if (!baseUrl.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/configurator/outbound-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_account_id: partnerAccountId,
          outbound_base_url: baseUrl.trim(),
          ...(authToken.trim() ? { outbound_auth_token: authToken.trim() } : {}),
          regenerate_signing_secret: true,
        }),
      })
      if (res.ok) {
        const body = await res.json()
        setJustSavedSecret(body.outbound_signing_secret ?? null)
        setAuthToken('')
        setEditing(false)
        setTestResult(null)
        onUpdated()
      } else {
        const body = await res.json().catch(() => ({}))
        setSaveError(body.error?.message ?? (typeof body.error === 'string' ? body.error : 'Could not save outbound config.'))
      }
    } finally {
      setSaving(false)
    }
  }

  async function copySecret() {
    if (!justSavedSecret) return
    try {
      await navigator.clipboard.writeText(justSavedSecret)
      setCopiedSecret(true)
      setTimeout(() => setCopiedSecret(false), 1500)
    } catch {
      // clipboard unavailable — no-op
    }
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/admin/configurator/integration/test-outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: partnerAccountId }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 422) {
        setTestResult({ success: false, message: `✗ ${body.error?.message ?? 'Set your outbound base URL and signing secret first.'}` })
      } else if (body.success) {
        setTestResult({ success: true, message: `✓ Connected — received HTTP ${body.status_code}.` })
      } else {
        setTestResult({ success: false, message: `✗ ${body.error ?? 'Connection failed.'}` })
      }
    } catch {
      setTestResult({ success: false, message: '✗ Could not reach Clio to run the test.' })
    } finally {
      setTesting(false)
    }
  }

  // Screen state 1 / edit mode.
  if (editing) {
    return (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <p style={{ fontSize: 14, fontWeight: 600 }}>Outbound webhooks</p>
          {configured && <StatusBadge color={COLORS.green} label="Configured" />}
        </div>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>Clio delivers usage events to your own system.</p>
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Your base URL</p>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-domain.com/clio"
            style={{ width: '100%', background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 13 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>
            Your API token (for Clio to authenticate to your API — optional, write-only)
          </p>
          <input
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            type="password"
            placeholder="••••••••••••"
            style={{ width: '100%', background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 13 }}
          />
        </div>
        {saveError && <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>{saveError}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <PrimaryButton disabled={!baseUrl.trim() || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save & generate signing secret'}
          </PrimaryButton>
          {configured && (
            <SecondaryButton
              onClick={() => {
                setEditing(false)
                setBaseUrl(outbound.outbound_base_url ?? '')
                setAuthToken('')
                setSaveError(null)
              }}
            >
              Cancel
            </SecondaryButton>
          )}
        </div>
      </Card>
    )
  }

  // Screen state 4 — outbound config already set.
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ fontSize: 14, fontWeight: 600 }}>Outbound webhooks</p>
        <StatusBadge color={COLORS.green} label="Configured" />
      </div>
      {justSavedSecret && (
        <div style={{ marginBottom: 16, padding: 12, background: COLORS.raised, borderRadius: 8, border: `1px solid ${COLORS.amber}` }}>
          <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Signing secret (shown once — save it now)</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, fontSize: 13, wordBreak: 'break-all' }}>{justSavedSecret}</code>
            <SecondaryButton style={{ padding: '4px 10px' }} onClick={copySecret}>
              {copiedSecret ? 'Copied' : 'Copy'}
            </SecondaryButton>
          </div>
          <p style={{ fontSize: 11, color: COLORS.amber, marginTop: 6 }}>This secret will not be shown again.</p>
        </div>
      )}
      <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Your base URL:</p>
      <p style={{ fontSize: 14, marginBottom: 12 }}>{outbound.outbound_base_url}</p>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>
        Your API token: {outbound.outbound_auth_token_set ? '●●●●●●●● (set)' : 'Not set'}
      </p>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>
        Your signing secret: {outbound.outbound_signing_secret_set ? '●●●●●●●● (set — not retrievable; regenerate to get a new one)' : 'Not set'}
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: testResult ? 8 : 0 }}>
        <SecondaryButton disabled={testing} onClick={testConnection}>
          {testing ? 'Testing…' : 'Test connection'}
        </SecondaryButton>
        <SecondaryButton
          onClick={() => {
            setEditing(true)
            setAuthToken('')
            setSaveError(null)
          }}
        >
          Edit
        </SecondaryButton>
      </div>
      {testResult && <p style={{ fontSize: 13, color: testResult.success ? COLORS.green : COLORS.red }}>{testResult.message}</p>}
    </Card>
  )
}
