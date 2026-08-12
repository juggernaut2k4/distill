'use client'

import { useEffect, useState } from 'react'
import { Card, PrimaryButton, SecondaryButton, COLORS } from '../_shared'

/**
 * B2B-78 §4.B / B2B-79 §4 — the "Developer" page's four tabs. Client component: each tab fetches
 * its own data on first activation and manages its own local state; nothing is shared across tabs
 * beyond the `clients` list passed down from the server component.
 */

type Tab = 'passcodes' | 'api-keys' | 'bot-voices' | 'domain'

interface ClientOption {
  id: string
  name: string
}

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 8,
  border: `1px solid ${active ? COLORS.purple : COLORS.borderSubtle}`,
  background: active ? 'rgba(124, 58, 237, 0.12)' : 'transparent',
  color: active ? COLORS.textPrimary : COLORS.textSecondary,
  cursor: 'pointer',
})

const inputStyle: React.CSSProperties = {
  background: COLORS.bg,
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  color: COLORS.textPrimary,
}

const revealBoxStyle: React.CSSProperties = {
  background: 'rgba(124, 58, 237, 0.08)',
  border: `1px solid ${COLORS.purple}`,
  borderRadius: 8,
  padding: 14,
  marginTop: 12,
  fontFamily: 'monospace',
  fontSize: 14,
  wordBreak: 'break-all',
}

export default function DeveloperClient({ clients }: { clients: ClientOption[] }) {
  const [tab, setTab] = useState<Tab>('passcodes')

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Developer</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button style={tabStyle(tab === 'passcodes')} onClick={() => setTab('passcodes')}>Passcodes</button>
        <button style={tabStyle(tab === 'api-keys')} onClick={() => setTab('api-keys')}>API Keys</button>
        <button style={tabStyle(tab === 'bot-voices')} onClick={() => setTab('bot-voices')}>Bot Voices</button>
        <button style={tabStyle(tab === 'domain')} onClick={() => setTab('domain')}>Domain</button>
      </div>

      {tab === 'passcodes' && <PasscodesTab clients={clients} />}
      {tab === 'api-keys' && <ApiKeysTab clients={clients} />}
      {tab === 'bot-voices' && <BotVoicesTab />}
      {tab === 'domain' && <DomainTab />}
    </div>
  )
}

// ─── Passcodes ──────────────────────────────────────────────────────────────────────────────────

interface PasscodeRow {
  id: string
  client_id: string
  passcode_prefix: string
  created_at: string
}

function PasscodesTab({ clients }: { clients: ClientOption[] }) {
  const [passcodes, setPasscodes] = useState<PasscodeRow[] | null>(null)
  const [generating, setGeneratingFor] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{ clientId: string; passcode: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/channel-partner/passcodes')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { passcodes: PasscodeRow[] }) => setPasscodes(data.passcodes))
      .catch(() => setPasscodes([]))
  }, [])

  async function generate(clientId: string) {
    setGeneratingFor(clientId)
    setError(null)
    try {
      const res = await fetch('/api/channel-partner/passcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to generate passcode.')
      setRevealed({ clientId, passcode: data.passcode })
      const refreshed = await fetch('/api/channel-partner/passcodes')
      if (refreshed.ok) setPasscodes((await refreshed.json()).passcodes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate passcode.')
    } finally {
      setGeneratingFor(null)
    }
  }

  if (clients.length === 0) {
    return (
      <Card>
        <p style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 12 }}>
          You don&apos;t have any clients registered yet. Passcodes are issued per client — add a client first.
        </p>
        <a href="/dashboard/channel-partner/clients"><SecondaryButton>Go to Clients</SecondaryButton></a>
      </Card>
    )
  }

  return (
    <Card>
      <p style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 16 }}>
        A passcode identifies which client a <code>bot-dispatch</code> call is for. Send it in the &quot;passcode&quot;
        field of every <code>bot-dispatch</code> request for that client.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: COLORS.textMuted, borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
            <th style={{ padding: '8px 0' }}>Client</th>
            <th>Passcode</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => {
            const existing = passcodes?.find((p) => p.client_id === client.id)
            return (
              <tr key={client.id} style={{ borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                <td style={{ padding: '10px 0' }}>{client.name}</td>
                <td>{existing ? `${existing.passcode_prefix}-••••••••` : 'No passcode yet'}</td>
                <td>
                  <SecondaryButton disabled={generating === client.id} onClick={() => generate(client.id)}>
                    {generating === client.id ? 'Generating…' : existing ? 'Regenerate' : 'Generate'}
                  </SecondaryButton>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {error && <p style={{ color: COLORS.red ?? '#EF4444', fontSize: 13, marginTop: 12 }}>{error}</p>}

      {revealed && (
        <div style={revealBoxStyle}>
          <p style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12, color: COLORS.textSecondary, marginBottom: 8 }}>
            Passcode generated for {clients.find((c) => c.id === revealed.clientId)?.name}
          </p>
          <p>{revealed.passcode}</p>
          <p style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12, color: COLORS.textMuted, marginTop: 8 }}>
            This is shown once. Store it securely — Clio cannot show it again. Regenerating replaces it immediately.
          </p>
          <div style={{ marginTop: 10 }}>
            <PrimaryButton onClick={() => setRevealed(null)}>Done</PrimaryButton>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── API Keys ───────────────────────────────────────────────────────────────────────────────────

interface ApiKeyRow {
  id: string
  mode: 'test' | 'live'
  key_prefix: string
  label: string | null
  status: 'active' | 'revoked'
  scoped_client_id: string
}

function ApiKeysTab({ clients }: { clients: ClientOption[] }) {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null)
  const [showCreateFor, setShowCreateFor] = useState<string | null>(null)
  const [mode, setMode] = useState<'test' | 'live'>('live')
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [revealedKey, setRevealedKey] = useState<{ clientName: string; key: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function refresh() {
    fetch('/api/channel-partner/api-keys')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { keys: ApiKeyRow[] }) => setKeys(data.keys))
      .catch(() => setKeys([]))
  }

  useEffect(refresh, [])

  async function create(clientId: string) {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/channel-partner/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, mode, label: label.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to create key.')
      setRevealedKey({ clientName: clients.find((c) => c.id === clientId)?.name ?? '', key: data.key })
      setShowCreateFor(null)
      setLabel('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key.')
    } finally {
      setCreating(false)
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/channel-partner/api-keys/${id}`, { method: 'DELETE' })
    refresh()
  }

  return (
    <Card>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: COLORS.textMuted, borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
            <th style={{ padding: '8px 0' }}>Client</th>
            <th>Key</th>
            <th>Mode</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => {
            const clientKeys = (keys ?? []).filter((k) => k.scoped_client_id === client.id)
            if (clientKeys.length === 0) {
              return (
                <tr key={client.id} style={{ borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                  <td style={{ padding: '10px 0' }}>{client.name}</td>
                  <td colSpan={3}>—</td>
                  <td><SecondaryButton onClick={() => setShowCreateFor(client.id)}>Create</SecondaryButton></td>
                </tr>
              )
            }
            return clientKeys.map((key, i) => (
              <tr key={key.id} style={{ borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                <td style={{ padding: '10px 0' }}>{i === 0 ? client.name : ''}</td>
                <td>{key.key_prefix}…</td>
                <td style={{ textTransform: 'capitalize' }}>{key.mode}</td>
                <td>{key.status}</td>
                <td>
                  {key.status === 'active' && <SecondaryButton onClick={() => revoke(key.id)}>Revoke</SecondaryButton>}
                </td>
              </tr>
            ))
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 16 }}>
        <PrimaryButton onClick={() => setShowCreateFor(clients[0]?.id ?? null)} disabled={clients.length === 0}>
          + Create key
        </PrimaryButton>
      </div>

      {showCreateFor && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
            <label style={{ fontSize: 12, color: COLORS.textSecondary }}>
              Client
              <select style={{ ...inputStyle, width: '100%', marginTop: 4 }} value={showCreateFor} onChange={(e) => setShowCreateFor(e.target.value)}>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: COLORS.textSecondary }}>
              Mode
              <select style={{ ...inputStyle, width: '100%', marginTop: 4 }} value={mode} onChange={(e) => setMode(e.target.value as 'test' | 'live')}>
                <option value="live">Live</option>
                <option value="test">Test</option>
              </select>
            </label>
            <label style={{ fontSize: 12, color: COLORS.textSecondary }}>
              Label (optional)
              <input style={{ ...inputStyle, width: '100%', marginTop: 4 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production integration" />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <PrimaryButton disabled={creating} onClick={() => create(showCreateFor)}>{creating ? 'Creating…' : 'Create'}</PrimaryButton>
              <SecondaryButton onClick={() => setShowCreateFor(null)}>Cancel</SecondaryButton>
            </div>
          </div>
        </Card>
      )}

      {error && <p style={{ color: COLORS.red ?? '#EF4444', fontSize: 13, marginTop: 12 }}>{error}</p>}

      {revealedKey && (
        <div style={revealBoxStyle}>
          <p style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12, color: COLORS.textSecondary, marginBottom: 8 }}>
            This key will only work for {revealedKey.clientName}. It authenticates as your own sales-partner account, scoped to this one client — sessions created with it must include this client&apos;s id.
          </p>
          <p>{revealedKey.key}</p>
          <div style={{ marginTop: 10 }}>
            <PrimaryButton onClick={() => setRevealedKey(null)}>Done</PrimaryButton>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Bot Voices ─────────────────────────────────────────────────────────────────────────────────

interface CatalogAgent {
  id: string
  catalog_name: string
  language: string
  alias: string | null
}

function BotVoicesTab() {
  const [agents, setAgents] = useState<CatalogAgent[] | null>(null)
  const [enabledLanguages, setEnabledLanguages] = useState<Set<string>>(new Set())
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/channel-partner/bot-aliases')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { agents: CatalogAgent[] }) => {
        setAgents(data.agents)
        setEnabledLanguages(new Set(data.agents.filter((a) => a.alias).map((a) => a.language)))
      })
      .catch(() => setAgents([]))
  }, [])

  async function saveAlias(agentId: string) {
    const alias = (aliasDrafts[agentId] ?? '').trim()
    if (!alias) return
    setSaving(agentId)
    try {
      await fetch('/api/channel-partner/bot-aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_catalog_agent_id: agentId, alias }),
      })
      setAgents((prev) => prev?.map((a) => (a.id === agentId ? { ...a, alias } : a)) ?? null)
    } finally {
      setSaving(null)
    }
  }

  const languages = Array.from(new Set((agents ?? []).map((a) => a.language)))
  const availableToAdd = languages.filter((l) => !enabledLanguages.has(l))

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: COLORS.textSecondary }}>Enabled languages:</span>
        {Array.from(enabledLanguages).map((l) => (
          <span key={l} style={{ ...tabStyle(true), cursor: 'default' }}>{l}</span>
        ))}
        {availableToAdd.length > 0 && (
          <select
            style={{ ...inputStyle, fontSize: 12 }}
            value=""
            onChange={(e) => e.target.value && setEnabledLanguages((prev) => new Set(prev).add(e.target.value))}
          >
            <option value="">+ Add language</option>
            {availableToAdd.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
      </div>

      {Array.from(enabledLanguages).map((language) => (
        <div key={language} style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{language}</p>
          {(agents ?? []).filter((a) => a.language === language).map((agent) => (
            <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
              <span style={{ color: COLORS.textSecondary, minWidth: 160 }}>{agent.catalog_name}</span>
              <span style={{ color: COLORS.textMuted }}>→ your alias:</span>
              <input
                style={{ ...inputStyle, width: 180 }}
                placeholder="(not set)"
                value={aliasDrafts[agent.id] ?? agent.alias ?? ''}
                onChange={(e) => setAliasDrafts((prev) => ({ ...prev, [agent.id]: e.target.value }))}
                onBlur={() => saveAlias(agent.id)}
              />
              {saving === agent.id && <span style={{ color: COLORS.textMuted, fontSize: 12 }}>Saving…</span>}
            </div>
          ))}
        </div>
      ))}

      <p style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 8 }}>
        Send your alias in the &quot;bot_id&quot; field of bot-sessions to use that voice for a session.
      </p>
    </Card>
  )
}

// ─── Domain ─────────────────────────────────────────────────────────────────────────────────────

interface DomainSettings {
  custom_domain: string | null
  custom_domain_status: 'none' | 'pending_verification' | 'verified' | 'failed'
  custom_domain_error: string | null
  custom_domain_verification: { type: string; domain: string; value: string; reason: string }[] | null
}

function DomainTab() {
  const [settings, setSettings] = useState<DomainSettings | null>(null)
  const [domainInput, setDomainInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function refresh() {
    fetch('/api/channel-partner/domain')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: DomainSettings) => setSettings(data))
      .catch(() => setSettings(null))
  }

  useEffect(refresh, [])

  async function addDomain() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/channel-partner/domain/custom-domain', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_domain: domainInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to add domain.')
      setSettings(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add domain.')
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)
    try {
      const res = await fetch('/api/channel-partner/domain/custom-domain/recheck', { method: 'POST' })
      if (res.ok) setSettings(await res.json())
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await fetch('/api/channel-partner/domain/custom-domain', { method: 'DELETE' })
      refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!settings) return <Card><p style={{ color: COLORS.textMuted, fontSize: 13 }}>Loading…</p></Card>

  if (settings.custom_domain_status === 'none') {
    return (
      <Card>
        <p style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 16 }}>
          Your sessions need to render on a domain you own — Clio never serves them from a shared address. This is
          required before bot-sessions will return a working render_url.
        </p>
        <label style={{ fontSize: 12, color: COLORS.textSecondary, display: 'block', marginBottom: 8 }}>
          Domain
          <input
            style={{ ...inputStyle, width: '100%', marginTop: 4 }}
            placeholder="widget.ailearn.com"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
          />
        </label>
        <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 12 }}>A subdomain of a domain you already own.</p>
        {error && <p style={{ color: COLORS.red ?? '#EF4444', fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <PrimaryButton disabled={busy || !domainInput.trim()} onClick={addDomain}>Add domain</PrimaryButton>
      </Card>
    )
  }

  const record = settings.custom_domain_verification?.[0]

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Domain</span>
        <span style={{ fontSize: 12, color: settings.custom_domain_status === 'verified' ? '#10B981' : settings.custom_domain_status === 'failed' ? '#EF4444' : '#F59E0B' }}>
          ● {settings.custom_domain_status === 'verified' ? 'Live' : settings.custom_domain_status === 'failed' ? 'Failed' : 'Pending'}
        </span>
      </div>
      <p style={{ fontFamily: 'monospace', fontSize: 14, marginBottom: 12 }}>{settings.custom_domain}</p>

      {settings.custom_domain_status === 'verified' && (
        <p style={{ fontSize: 12, color: COLORS.textSecondary }}>
          Your sessions now render at: https://{settings.custom_domain}/widget-render/&#123;session_id&#125;
        </p>
      )}

      {settings.custom_domain_status !== 'verified' && (
        <>
          {settings.custom_domain_error && (
            <p style={{ fontSize: 12, color: '#EF4444', marginBottom: 8 }}>
              Vercel could not verify this domain: {settings.custom_domain_error}
            </p>
          )}
          {record && (
            <div style={{ fontSize: 12, fontFamily: 'monospace', color: COLORS.textSecondary, marginBottom: 12 }}>
              {record.type}  {record.domain}  →  {record.value}
            </div>
          )}
          <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 12 }}>
            DNS changes can take a few minutes to a few hours to take effect, depending on your provider.
          </p>
        </>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {settings.custom_domain_status !== 'verified' && (
          <SecondaryButton disabled={busy} onClick={verify}>{busy ? 'Checking…' : 'Verify'}</SecondaryButton>
        )}
        <SecondaryButton disabled={busy} onClick={remove}>Remove</SecondaryButton>
      </div>
      <p style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 12 }}>
        Removing this domain will break any session links already issued on it. This cannot be undone.
      </p>
    </Card>
  )
}
