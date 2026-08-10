'use client'

import { useState } from 'react'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorNavShell, PrimaryButton, COLORS, type BillingHealth } from '../_shared'
import { ENDPOINTS, ENDPOINT_CATEGORIES, WEBHOOK_DOC, type EndpointDoc, type PlaygroundEndpointId } from './content'

/**
 * B2B-16/B2B-07 unification (2026-08-10) — the docs page and the separate
 * /playground page are merged into one 3-pane surface: left nav (grouped by
 * category), middle reference content (scrolls independently), right
 * collapsible live playground. Calls the real /api/partner/v1/* routes
 * directly from the browser using the partner's own pasted credential —
 * never a mock, same as the playground it replaces. The apiKey value lives
 * in useState only — never written to localStorage/sessionStorage.
 *
 * Every request body and every response is shown as raw JSON, uniformly,
 * across every endpoint — no per-endpoint special-cased UI (e.g. no
 * clickable "open render_url" action) per Arun's explicit instruction
 * (2026-08-10): the reseller decides how to use a value like render_url in
 * their own app: we only need to show them the raw response.
 */

type ResponseState = { status: number; retryAfter: string | null; body: unknown } | { networkError: true } | null
type NavSelection = PlaygroundEndpointId | 'webhook'

const PANE_HEIGHT = 'clamp(420px, calc(100vh - 220px), 900px)'

const codeBlockStyle: React.CSSProperties = {
  background: COLORS.raised,
  border: `1px solid ${COLORS.borderSubtle}`,
  borderRadius: 8,
  padding: 12,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: COLORS.textPrimary,
  overflowX: 'auto',
  whiteSpace: 'pre',
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  color: COLORS.textSecondary,
  fontWeight: 600,
  padding: '4px 8px 4px 0',
  borderBottom: `1px solid ${COLORS.borderSubtle}`,
}
const tdStyle: React.CSSProperties = {
  padding: '6px 8px 6px 0',
  borderBottom: `1px solid ${COLORS.borderSubtle}`,
  color: COLORS.textPrimary,
  verticalAlign: 'top',
}

function buildCurlSnippet(endpoint: EndpointDoc): string {
  const lines = [`curl -X ${endpoint.method} \\`, `  https://hello-clio.com${endpoint.path.replace(':clio_session_ref', '<clio_session_ref>')} \\`]
  if (!endpoint.noAuthRequired) lines.push(`  -H "Authorization: Bearer <your-api-key>" \\`)
  if (endpoint.exampleRequestBody) {
    lines.push(`  -H "Content-Type: application/json" \\`)
    lines.push(`  -d '${JSON.stringify(endpoint.exampleRequestBody)}'`)
  } else {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, '')
  }
  return lines.join('\n')
}

export default function ApiClient({
  accounts,
  activePartnerAccountId,
  billingHealth,
  basePath = '/dashboard/configurator',
  navLabel,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  billingHealth: BillingHealth
  basePath?: string
  navLabel?: string
}) {
  const [selectedId, setSelectedId] = useState<NavSelection>(ENDPOINTS[0].id)
  const [playgroundOpen, setPlaygroundOpen] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [pathParamValue, setPathParamValue] = useState('')
  const [editorValue, setEditorValue] = useState(() => (ENDPOINTS[0].exampleRequestBody ? JSON.stringify(ENDPOINTS[0].exampleRequestBody, null, 2) : ''))
  const [queryParamsValue, setQueryParamsValue] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [response, setResponse] = useState<ResponseState>(null)

  const isWebhookSelected = selectedId === 'webhook'
  const endpoint = isWebhookSelected ? null : ENDPOINTS.find((e) => e.id === selectedId)!

  function selectEndpoint(id: NavSelection) {
    setSelectedId(id)
    const next = id === 'webhook' ? null : ENDPOINTS.find((e) => e.id === id)!
    setEditorValue(next?.exampleRequestBody ? JSON.stringify(next.exampleRequestBody, null, 2) : '')
    setQueryParamsValue('')
    setPathParamValue('')
    setValidationError(null)
    setResponse(null)
  }

  async function handleSend() {
    if (!endpoint) return
    if (!endpoint.noAuthRequired && !apiKey) {
      setValidationError('Enter an API key first.')
      return
    }

    let url = `https://hello-clio.com${endpoint.path}`
    const init: RequestInit = {
      method: endpoint.method,
      headers: endpoint.noAuthRequired ? {} : { Authorization: `Bearer ${apiKey}` },
    }

    if (endpoint.pathParam) {
      url = url.replace(':clio_session_ref', encodeURIComponent(pathParamValue))
    } else if (endpoint.queryParams) {
      let params: Record<string, string>
      try {
        params = JSON.parse(queryParamsValue || '{}')
      } catch (e) {
        setValidationError(`Not valid JSON: ${(e as Error).message}`)
        return
      }
      const qs = new URLSearchParams(params).toString()
      if (qs) url += `?${qs}`
    } else if (endpoint.exampleRequestBody) {
      let body: unknown
      try {
        body = JSON.parse(editorValue || '{}')
      } catch (e) {
        setValidationError(`Not valid JSON: ${(e as Error).message}`)
        return
      }
      init.headers = { ...init.headers, 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body)
    }

    setValidationError(null)
    setSending(true)
    try {
      const res = await fetch(url, init)
      const body = await res.json().catch(() => null)
      setResponse({ status: res.status, retryAfter: res.headers.get('Retry-After'), body })
    } catch {
      setResponse({ networkError: true })
    } finally {
      setSending(false)
    }
  }

  return (
    <ConfiguratorNavShell
      accounts={accounts}
      activePartnerAccountId={activePartnerAccountId}
      active="api"
      billingHealth={billingHealth}
      basePath={basePath}
      navLabel={navLabel}
    >
      <style>{`
        .api-docs-grid { display: grid; grid-template-columns: 200px 1fr 340px; gap: 0; border: 1px solid ${COLORS.borderSubtle}; border-radius: 12px; overflow: hidden; height: ${PANE_HEIGHT}; }
        .api-docs-grid.collapsed { grid-template-columns: 200px 1fr; }
        .api-docs-pane { overflow-y: auto; }
        @media (max-width: 860px) {
          .api-docs-grid, .api-docs-grid.collapsed { grid-template-columns: 1fr; height: auto; }
          .api-docs-nav { height: auto; max-height: 220px; }
          .api-docs-middle { height: 60vh; }
          .api-docs-playground { height: auto; max-height: 70vh; }
        }
      `}</style>

      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>API</h1>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>
        Every endpoint you send requests to and receive data from — pick one on the left, read it in the middle, try it live on the right.
      </p>

      <div className={`api-docs-grid${playgroundOpen ? '' : ' collapsed'}`}>
        <nav className="api-docs-pane api-docs-nav" style={{ background: COLORS.surface, padding: '14px 10px', borderRight: `1px solid ${COLORS.borderSubtle}` }}>
          {ENDPOINT_CATEGORIES.map((category) => (
            <div key={category} style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 11, color: COLORS.textMuted, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{category}</p>
              {ENDPOINTS.filter((e) => e.category === category).map((e) => {
                const isActive = e.id === selectedId
                return (
                  <button
                    key={e.id}
                    onClick={() => selectEndpoint(e.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      background: isActive ? COLORS.raised : 'transparent',
                      color: isActive ? COLORS.textPrimary : COLORS.textSecondary,
                      fontWeight: isActive ? 600 : 400,
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 8px',
                      marginBottom: 2,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {e.method} {e.path.split('/').pop()}
                  </button>
                )
              })}
            </div>
          ))}
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: COLORS.textMuted, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Webhooks</p>
            <button
              onClick={() => selectEndpoint('webhook')}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: isWebhookSelected ? COLORS.raised : 'transparent',
                color: isWebhookSelected ? COLORS.textPrimary : COLORS.textSecondary,
                fontWeight: isWebhookSelected ? 600 : 400,
                border: 'none',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Usage webhook
            </button>
          </div>
        </nav>

        <div className="api-docs-pane api-docs-middle" style={{ padding: 20, borderRight: playgroundOpen ? `1px solid ${COLORS.borderSubtle}` : 'none' }}>
          {isWebhookSelected || !endpoint ? <WebhookDoc /> : <EndpointDocView endpoint={endpoint} />}
        </div>

        {playgroundOpen && endpoint && (
          <div className="api-docs-pane api-docs-playground" style={{ background: COLORS.surface, padding: '14px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <p style={{ fontWeight: 700, fontSize: 13, margin: 0 }}>Playground</p>
              <button
                onClick={() => setPlaygroundOpen(false)}
                aria-label="Collapse playground"
                style={{ background: 'transparent', border: 'none', color: COLORS.textMuted, cursor: 'pointer', fontSize: 13 }}
              >
                Collapse →
              </button>
            </div>

            {!endpoint.noAuthRequired && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 }}>Your API key</p>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="clio_test_sk_... or an OAuth2 access token"
                  style={{ width: '100%', background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                />
                <p style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 4 }}>Held in memory only — never saved, cleared on reload.</p>
              </div>
            )}

            {endpoint.pathParam && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 }}>{endpoint.pathParam.name}</p>
                <input
                  value={pathParamValue}
                  onChange={(e) => setPathParamValue(e.target.value)}
                  placeholder="uuid"
                  style={{ width: '100%', background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                />
              </div>
            )}

            {endpoint.queryParams && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 }}>Query params (JSON)</p>
                <textarea
                  value={queryParamsValue}
                  onChange={(e) => setQueryParamsValue(e.target.value)}
                  placeholder='{ "from": "2026-07-01T00:00:00Z" }'
                  rows={4}
                  style={{ width: '100%', background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' }}
                />
              </div>
            )}

            {endpoint.exampleRequestBody && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 }}>Request body (JSON) — edit freely, this is a real editable example</p>
                <textarea
                  value={editorValue}
                  onChange={(e) => setEditorValue(e.target.value)}
                  rows={10}
                  style={{ width: '100%', background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' }}
                />
              </div>
            )}

            {validationError && <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>{validationError}</p>}

            <PrimaryButton disabled={sending} onClick={handleSend} style={{ width: '100%', marginBottom: 12 }}>
              {sending ? 'Sending…' : 'Send'}
            </PrimaryButton>

            <p style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 6 }}>Response</p>
            {response === null && <p style={{ fontSize: 12, color: COLORS.textMuted }}>(empty — nothing sent yet)</p>}
            {response !== null && 'networkError' in response && (
              <p style={{ fontSize: 12, color: COLORS.red }}>Could not reach the API. Check your connection and try again.</p>
            )}
            {response !== null && 'status' in response && (
              <>
                <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: response.status < 400 ? COLORS.green : COLORS.red }}>
                  {response.status}
                  {response.retryAfter ? ` · Retry-After: ${response.retryAfter}s` : ''}
                </p>
                <pre style={{ ...codeBlockStyle, fontSize: 11 }}>{JSON.stringify(response.body, null, 2)}</pre>
              </>
            )}
          </div>
        )}
        {!playgroundOpen && !isWebhookSelected && (
          <button
            onClick={() => setPlaygroundOpen(true)}
            style={{
              background: COLORS.surface,
              border: 'none',
              borderLeft: `1px solid ${COLORS.borderSubtle}`,
              color: COLORS.textSecondary,
              cursor: 'pointer',
              writingMode: 'vertical-rl',
              padding: '16px 8px',
              fontSize: 12,
            }}
          >
            ← Open playground
          </button>
        )}
      </div>
    </ConfiguratorNavShell>
  )
}

function EndpointDocView({ endpoint }: { endpoint: EndpointDoc }) {
  return (
    <>
      <p style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: COLORS.cyan, marginBottom: 4 }}>{endpoint.method}</p>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{endpoint.path}</h2>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.6, marginBottom: 6 }}>{endpoint.purpose}</p>
      <p style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 16 }}>Rate limit: {endpoint.rateLimit}</p>

      {endpoint.pathParam && (
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 16 }}>
          Path param: <code>{endpoint.pathParam.name}</code> ({endpoint.pathParam.type}) — {endpoint.pathParam.notes}
        </p>
      )}

      {endpoint.requestFields && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Request fields</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Field</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Required</th>
                  <th style={thStyle}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {endpoint.requestFields.map((f) => (
                  <tr key={f.field}>
                    <td style={{ ...tdStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{f.field}</td>
                    <td style={tdStyle}>{f.type}</td>
                    <td style={tdStyle}>{f.required}</td>
                    <td style={tdStyle}>{f.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {endpoint.queryParams && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Query params</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Param</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Default</th>
                  <th style={thStyle}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {endpoint.queryParams.map((p) => (
                  <tr key={p.param}>
                    <td style={{ ...tdStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{p.param}</td>
                    <td style={tdStyle}>{p.type}</td>
                    <td style={tdStyle}>{p.default}</td>
                    <td style={tdStyle}>{p.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Example</p>
      <pre style={{ ...codeBlockStyle, marginBottom: 16 }}>{buildCurlSnippet(endpoint)}</pre>

      {endpoint.exampleRequestBody && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Example request body</p>
          <pre style={{ ...codeBlockStyle, marginBottom: 16 }}>{JSON.stringify(endpoint.exampleRequestBody, null, 2)}</pre>
        </>
      )}

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Example response</p>
      <pre style={{ ...codeBlockStyle, marginBottom: 12 }}>{JSON.stringify(endpoint.exampleResponse, null, 2)}</pre>

      {endpoint.responseNotes.length > 0 && (
        <ul style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 16, paddingLeft: 18 }}>
          {endpoint.responseNotes.map((note, i) => (
            <li key={i} style={{ marginBottom: 4 }}>{note}</li>
          ))}
        </ul>
      )}

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Other responses</p>
      <table style={{ ...tableStyle, marginBottom: 20 }}>
        <thead>
          <tr>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {endpoint.otherResponses.map((r) => (
            <tr key={r.status}>
              <td style={{ ...tdStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{r.status}</td>
              <td style={tdStyle}>{r.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function WebhookDoc() {
  return (
    <>
      <p style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: COLORS.cyan, marginBottom: 4 }}>POST</p>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{WEBHOOK_DOC.path}</h2>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.6, marginBottom: 16 }}>
        What you receive, not what you send — Clio pushes this to your own outbound_base_url as events happen. Not testable here since it
        requires a real endpoint on your side to deliver to.
      </p>

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Event types</p>
      <p style={{ fontSize: 12, color: COLORS.textPrimary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', marginBottom: 16 }}>
        {WEBHOOK_DOC.eventTypes.join(', ')}
      </p>

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Payload fields</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Field</th>
              <th style={thStyle}>When</th>
            </tr>
          </thead>
          <tbody>
            {WEBHOOK_DOC.payloadFields.map((f) => (
              <tr key={f.field}>
                <td style={{ ...tdStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{f.field}</td>
                <td style={tdStyle}>{f.notes || 'Always present.'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6, marginTop: 4 }}>Signature header</p>
      <pre style={{ ...codeBlockStyle, marginBottom: 16 }}>{WEBHOOK_DOC.signatureHeader}</pre>

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Verify</p>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>{WEBHOOK_DOC.verificationRecipe}</p>

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Retries</p>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>{WEBHOOK_DOC.retrySchedule}</p>
    </>
  )
}
