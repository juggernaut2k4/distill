'use client'

import Link from 'next/link'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorShell, Card, PrimaryButton, COLORS } from '../_shared'
import { ENDPOINTS, WEBHOOK_DOC, type EndpointDoc } from './content'

/**
 * B2B-07 — /dashboard/configurator/developer (Requirement Doc Section 4.A,
 * architecture.md §17). Renders hand-authored reference content from
 * content.ts only — no AI-generated call, no network fetch. Follows the
 * existing Configurator screen visual language unmodified (_shared.tsx).
 */

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

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: COLORS.textPrimary,
  marginBottom: 12,
  marginTop: 28,
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

export default function DeveloperDocsClient({
  accounts,
  activePartnerAccountId,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
}) {
  return (
    <ConfiguratorShell
      accounts={accounts}
      activePartnerAccountId={activePartnerAccountId}
      title="Developer"
      backHref={`/dashboard/configurator?partner_account_id=${activePartnerAccountId}`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>Developer</h1>
        <Link href={`/dashboard/configurator/developer/playground?partner_account_id=${activePartnerAccountId}`} style={{ textDecoration: 'none' }}>
          <PrimaryButton>Open Playground →</PrimaryButton>
        </Link>
      </div>

      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 8 }}>
        Reference documentation for the four partner-facing Clio API endpoints and the outbound usage webhook.
      </p>

      <AuthenticationCard partnerAccountId={activePartnerAccountId} />

      <h2 style={sectionHeadingStyle}>Endpoints</h2>
      {ENDPOINTS.map((endpoint) => (
        <EndpointCard key={endpoint.id} endpoint={endpoint} />
      ))}

      <h2 style={sectionHeadingStyle}>Outbound usage webhook</h2>
      <WebhookCard />
    </ConfiguratorShell>
  )
}

function AuthenticationCard({ partnerAccountId }: { partnerAccountId: string }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Authentication</p>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
        Clio&apos;s partner API uses OAuth2 Client Credentials (RFC 6749 §4.4). Exchange your{' '}
        <code>client_id</code>/<code>client_secret</code> for a short-lived access token, then send it as{' '}
        <code>Authorization: Bearer &lt;token&gt;</code> on every request.
      </p>
      <pre style={{ ...codeBlockStyle, marginBottom: 12 }}>
{`POST /api/partner/v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=...&client_secret=...

→ 200 { access_token, token_type: "Bearer", expires_in: 3600 }`}
      </pre>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>
        Tokens expire after 1 hour — re-authenticate to get a new one. A static API key mechanism also exists as a
        secondary, internal-operator recovery path; new integrations should use OAuth2.
      </p>
      <Link href={`/dashboard/configurator/integration?partner_account_id=${partnerAccountId}`} style={{ textDecoration: 'none' }}>
        <PrimaryButton>Generate credentials →</PrimaryButton>
      </Link>
    </Card>
  )
}

function EndpointCard({ endpoint }: { endpoint: EndpointDoc }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        {endpoint.method} {endpoint.path}
      </p>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 8 }}>{endpoint.purpose}</p>
      <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 12 }}>Rate limit: {endpoint.rateLimit}</p>

      {endpoint.requestFields && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Request fields</p>
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
        </>
      )}

      {endpoint.queryParams && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Query params</p>
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
        </>
      )}

      {endpoint.pathParam && (
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12 }}>
          Path param: <code>{endpoint.pathParam.name}</code> ({endpoint.pathParam.type}) — {endpoint.pathParam.notes}
        </p>
      )}

      {endpoint.exampleRequestBody && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Example request</p>
          <pre style={{ ...codeBlockStyle, marginBottom: 12 }}>{JSON.stringify(endpoint.exampleRequestBody, null, 2)}</pre>
        </>
      )}

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Example response</p>
      <pre style={{ ...codeBlockStyle, marginBottom: 12 }}>{JSON.stringify(endpoint.exampleResponse, null, 2)}</pre>

      {endpoint.responseNotes.length > 0 && (
        <ul style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12, paddingLeft: 18 }}>
          {endpoint.responseNotes.map((note, i) => (
            <li key={i} style={{ marginBottom: 4 }}>{note}</li>
          ))}
        </ul>
      )}

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Other responses</p>
      <table style={{ ...tableStyle, marginBottom: 0 }}>
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
    </Card>
  )
}

function WebhookCard() {
  return (
    <Card style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        {WEBHOOK_DOC.path}
      </p>
      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginTop: 12, marginBottom: 6 }}>Payload fields</p>
      <p style={{ fontSize: 12, color: COLORS.textPrimary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', marginBottom: 12 }}>
        {WEBHOOK_DOC.payloadFields.join(', ')}
      </p>

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Signature header</p>
      <pre style={{ ...codeBlockStyle, marginBottom: 12 }}>{WEBHOOK_DOC.signatureHeader}</pre>

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Verify</p>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>{WEBHOOK_DOC.verificationRecipe}</p>

      <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6 }}>Retries</p>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>{WEBHOOK_DOC.retrySchedule}</p>

      <p style={{ fontSize: 12, color: COLORS.amber }}>Known gap: {WEBHOOK_DOC.knownGap}</p>
    </Card>
  )
}
