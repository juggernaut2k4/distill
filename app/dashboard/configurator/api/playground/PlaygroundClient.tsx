'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorShell, Card, PrimaryButton, COLORS } from '../../_shared'
import { ENDPOINTS, type PlaygroundEndpointId } from '../content'

/**
 * B2B-07 — /dashboard/configurator/api/playground (Requirement Doc
 * Section 4.C, architecture.md §17.3; moved under `api/` by B2B-16
 * Section 4.6). Calls the four already-live
 * /api/partner/v1/* routes directly from the browser using the partner's own
 * pasted credential — never a mock. No new npm dependency: a plain
 * <textarea>/<input> and hand-rolled cards only.
 *
 * The apiKey value lives in useState only — never written to
 * localStorage/sessionStorage (Requirement Doc Section 6/9).
 */

type ResponseState = { status: number; retryAfter: string | null; body: unknown } | { networkError: true } | null

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: COLORS.raised,
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 8,
  padding: 10,
  color: COLORS.textPrimary,
  fontSize: 13,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

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

export default function PlaygroundClient({
  accounts,
  activePartnerAccountId,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
}) {
  const [apiKey, setApiKey] = useState('')
  const [selectedId, setSelectedId] = useState<PlaygroundEndpointId>('sessions_get')
  const [pathParamValue, setPathParamValue] = useState('')
  const [editorValue, setEditorValue] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [response, setResponse] = useState<ResponseState>(null)

  const endpoint = ENDPOINTS.find((e) => e.id === selectedId)!

  function selectEndpoint(id: PlaygroundEndpointId) {
    setSelectedId(id)
    setValidationError(null)
    setResponse(null)
  }

  // Requirement Doc Section 4.C.1 / architecture.md §17.3 — reproduced faithfully.
  // 'sessions_create' enabled 2026-07-16 (see content.ts) — sends a real POST
  // with a JSON body, same as every other real partner integration call.
  async function handleSend() {
    if (endpoint.playgroundDisabled) return
    if (!apiKey) {
      setValidationError('Enter an API key first.')
      return
    }

    let url = endpoint.path
    const init: RequestInit = { method: endpoint.method, headers: { Authorization: `Bearer ${apiKey}` } }

    if (endpoint.id === 'sessions_get') {
      url = url.replace(':clio_session_ref', encodeURIComponent(pathParamValue))
    } else if (endpoint.id === 'usage') {
      let params: Record<string, string>
      try {
        params = JSON.parse(editorValue || '{}')
      } catch (e) {
        setValidationError(`Not valid JSON: ${(e as Error).message}`)
        return
      }
      const qs = new URLSearchParams(params).toString()
      if (qs) url += `?${qs}`
    } else if (endpoint.id === 'sessions_create') {
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
    // 'wallet' — no path param, no query params, no body.

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
    <ConfiguratorShell
      accounts={accounts}
      activePartnerAccountId={activePartnerAccountId}
      title="API › Playground"
      backHref={`/dashboard/configurator/api?partner_account_id=${activePartnerAccountId}`}
    >
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Playground</h1>

      <Card style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Your API key</p>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="clio_test_sk_... or an OAuth2 access token"
          style={inputStyle}
        />
        <p style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>
          Held in memory only — never saved, cleared on reload.
        </p>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 10 }}>Endpoint</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {ENDPOINTS.map((e) => (
            <label
              key={e.id}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="playground-endpoint"
                checked={selectedId === e.id}
                onChange={() => selectEndpoint(e.id)}
                style={{ marginTop: 2 }}
              />
              <span>
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {e.method} {e.path}
                </span>
                {e.playgroundDisabled && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: COLORS.amber }}>🔒 Documented, not testable</span>
                )}
              </span>
            </label>
          ))}
        </div>

        {endpoint.playgroundDisabled ? (
          <div>
            <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>{endpoint.playgroundDisabledReason}</p>
            <Link
              href={`/dashboard/configurator/api?partner_account_id=${activePartnerAccountId}`}
              style={{ fontSize: 13, color: COLORS.cyan }}
            >
              See the full request/response reference on the API page →
            </Link>
            <div style={{ marginTop: 16 }}>
              {/* Hard safety requirement (Requirement Doc Section 4.C, Screen state 2): this button
                  has NO onClick prop at all in this branch — not a disabled button that would
                  otherwise call handleSend(). There is no click-triggered path to a real request
                  from this state. */}
              <button
                disabled
                style={{
                  background: COLORS.purple,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  opacity: 0.4,
                  cursor: 'not-allowed',
                }}
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <>
            {endpoint.id === 'sessions_get' && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>clio_session_ref</p>
                <input
                  value={pathParamValue}
                  onChange={(e) => setPathParamValue(e.target.value)}
                  placeholder="uuid"
                  style={inputStyle}
                />
              </div>
            )}

            {endpoint.id === 'usage' && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Query params (JSON)</p>
                <textarea
                  value={editorValue}
                  onChange={(e) => setEditorValue(e.target.value)}
                  placeholder='{ "from": "2026-07-01T00:00:00Z", "event_type": "usage.voice_minute" }'
                  rows={4}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>
            )}

            {endpoint.id === 'sessions_create' && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Request body (JSON)</p>
                <textarea
                  value={editorValue}
                  onChange={(e) => setEditorValue(e.target.value)}
                  placeholder={JSON.stringify(endpoint.exampleRequestBody, null, 2)}
                  rows={8}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
                <p style={{ fontSize: 11, color: COLORS.amber, marginTop: 6 }}>
                  Dispatches a real meeting bot into the meeting_url you provide, bounded by your account&apos;s
                  test-mode trial allowance.
                </p>
              </div>
            )}

            {validationError && <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>{validationError}</p>}

            <PrimaryButton disabled={sending} onClick={handleSend}>
              {sending ? 'Sending…' : 'Send'}
            </PrimaryButton>
          </>
        )}
      </Card>

      <Card>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 10 }}>Response</p>
        {response === null && <p style={{ fontSize: 13, color: COLORS.textMuted }}>(empty — nothing sent yet)</p>}
        {response !== null && 'networkError' in response && (
          <p style={{ fontSize: 13, color: COLORS.red }}>Could not reach the API. Check your connection and try again.</p>
        )}
        {response !== null && 'status' in response && (
          <>
            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: response.status < 400 ? COLORS.green : COLORS.red }}>
              {response.status}
              {response.retryAfter ? ` · Retry-After: ${response.retryAfter}s` : ''}
            </p>
            <pre style={codeBlockStyle}>{JSON.stringify(response.body, null, 2)}</pre>
          </>
        )}
      </Card>
    </ConfiguratorShell>
  )
}
