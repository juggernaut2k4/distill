'use client'

import Link from 'next/link'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorNavShell, Card, COLORS, type BillingHealth } from '../_shared'
import { ENDPOINTS, WEBHOOK_DOC } from '../api/content'
import { PLAN_TIERS } from '@/lib/billing/plan-tiers'

/**
 * B2B-16 — /dashboard/configurator/docs (Requirement Doc Section 4.4). A new,
 * fully HAND-AUTHORED documentation page — no AI generation, no network fetch
 * (B2B-07 convention). Four sections:
 *   1. Getting-started quickstart (reuses the auth recipe from the API page).
 *   2. Content & image auth (B2B-23 WS-3) — exactly what a partner must send
 *      per content-source auth type, and Clio's fetch constraints. Every
 *      field/default/constraint is copied verbatim from the approved B2B-23
 *      spec, itself fact-checked against content-sources.ts, the
 *      POST /api/partner/v1/content-sources Zod schemas, crypto.ts,
 *      live-render.ts, and ssrf.ts — no AI invention.
 *   3. API / webhook reference — sourced from the single hand-authored module
 *      `../api/content` (ENDPOINTS / WEBHOOK_DOC); the data itself is not
 *      duplicated, both API and Docs import the one source.
 *   4. Plain-language billing explainer (anchor `#billing`, the target of the
 *      billing-health banner's "Fix billing" / "Add funds" link). Facts only —
 *      Plan-tier figures render directly from the codified `PLAN_TIERS` module
 *      so no dollar figure is hand-typed or can drift; no invented pricing.
 *
 * Reuses the existing Configurator visual language unmodified (_shared.tsx) —
 * no new design system.
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
  fontSize: 16,
  fontWeight: 700,
  color: COLORS.textPrimary,
  marginBottom: 4,
  marginTop: 32,
}

const subHeadingStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: COLORS.textPrimary,
  marginTop: 16,
  marginBottom: 6,
}

const bodyStyle: React.CSSProperties = {
  fontSize: 13,
  color: COLORS.textSecondary,
  lineHeight: 1.6,
  marginBottom: 12,
}

const monoInline: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }

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

export default function DocsClient({
  accounts,
  activePartnerAccountId,
  billingHealth,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  billingHealth: BillingHealth
}) {
  return (
    <ConfiguratorNavShell
      accounts={accounts}
      activePartnerAccountId={activePartnerAccountId}
      active="docs"
      billingHealth={billingHealth}
    >
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Docs</h1>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 8 }}>
        Everything you need to integrate with Clio — a quickstart, the full API and webhook reference, and how
        billing works.
      </p>

      {/* 1 — Getting started */}
      <h2 style={sectionHeadingStyle}>Getting started</h2>
      <Card style={{ marginBottom: 16 }}>
        <ol style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: COLORS.textPrimary }}>Generate credentials.</strong> Create an OAuth2
            client on the{' '}
            <Link
              href={`/dashboard/configurator/integration?partner_account_id=${activePartnerAccountId}`}
              style={{ color: COLORS.cyan, textDecoration: 'none' }}
            >
              Integration page
            </Link>{' '}
            to get a <code style={monoInline}>client_id</code> and <code style={monoInline}>client_secret</code>.
            The secret is shown once — store it securely.
          </li>
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: COLORS.textPrimary }}>Obtain an access token.</strong> Exchange your
            credentials for a short-lived bearer token (OAuth2 Client Credentials, RFC 6749 §4.4):
            <pre style={{ ...codeBlockStyle, marginTop: 8, marginBottom: 0 }}>
{`POST /api/partner/v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=...&client_secret=...

→ 200 { access_token, token_type: "Bearer", expires_in: 3600 }`}
            </pre>
          </li>
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: COLORS.textPrimary }}>Start a session.</strong> Send the token as{' '}
            <code style={monoInline}>Authorization: Bearer &lt;token&gt;</code> and create a session:
            <pre style={{ ...codeBlockStyle, marginTop: 8, marginBottom: 0 }}>
{`POST /api/partner/v1/sessions
Authorization: Bearer <token>
Content-Type: application/json

{ "meeting_url": "https://meet.google.com/abc-defg-hij",
  "partner_topic_ref": "onboarding-101" }

→ 200 { clio_session_ref, status: "bot_active", render_url }`}
            </pre>
          </li>
          <li>
            <strong style={{ color: COLORS.textPrimary }}>Read status.</strong> Poll{' '}
            <code style={monoInline}>GET /api/partner/v1/sessions/&#123;clio_session_ref&#125;</code> for the
            live status, and subscribe to the outbound usage webhook for billing events. Try any of these live in
            the{' '}
            <Link
              href={`/dashboard/configurator/api/playground?partner_account_id=${activePartnerAccountId}`}
              style={{ color: COLORS.cyan, textDecoration: 'none' }}
            >
              Playground
            </Link>
            .
          </li>
        </ol>
      </Card>

      {/* 2 — Content & image auth (B2B-23 WS-3). Hand-authored, no AI
          generation, no network fetch — matches this file's existing B2B-07
          convention. Every field name/requiredness/default below is copied
          verbatim from the approved spec (B2B-23 Requirement Doc §6.4),
          itself fact-checked against content-sources.ts, the
          POST /api/partner/v1/content-sources Zod schemas, crypto.ts,
          live-render.ts, and ssrf.ts. */}
      <h2 style={sectionHeadingStyle}>Content &amp; image auth</h2>
      <Card style={{ marginBottom: 16 }}>
        <p style={bodyStyle}>
          Register a content source once via{' '}
          <code style={monoInline}>POST /api/partner/v1/content-sources</code>, then reference its{' '}
          <code style={monoInline}>content_source_id</code> when you trigger a session with inline content. Clio
          uses the registered auth to fetch every HTML page and image URL you pass at trigger time — the same
          auth, applied identically to every page in that session.
        </p>

        <p style={subHeadingStyle}>
          <code style={monoInline}>auth_type: &apos;none&apos;</code>
        </p>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Field</th>
              <th style={thStyle}>Required</th>
              <th style={thStyle}>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...tdStyle, ...monoInline }}>label</td>
              <td style={tdStyle}>No</td>
              <td style={tdStyle}>Optional name for your reference</td>
            </tr>
          </tbody>
        </table>
        <p style={{ ...bodyStyle, marginBottom: 16 }}>No auth header is sent when fetching this source&apos;s URLs.</p>

        <p style={subHeadingStyle}>
          <code style={monoInline}>auth_type: &apos;static_bearer&apos;</code>
        </p>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Field</th>
              <th style={thStyle}>Required</th>
              <th style={thStyle}>Default</th>
              <th style={thStyle}>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...tdStyle, ...monoInline }}>token</td>
              <td style={tdStyle}>Yes</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>
                Your API token/key. Encrypted at rest (AES-256-GCM); never returned after registration.
              </td>
            </tr>
            <tr>
              <td style={{ ...tdStyle, ...monoInline }}>header_name</td>
              <td style={tdStyle}>No</td>
              <td style={{ ...tdStyle, ...monoInline }}>Authorization</td>
              <td style={tdStyle}>The HTTP header Clio sends the token in</td>
            </tr>
            <tr>
              <td style={{ ...tdStyle, ...monoInline }}>header_scheme</td>
              <td style={tdStyle}>No</td>
              <td style={{ ...tdStyle, ...monoInline }}>Bearer</td>
              <td style={tdStyle}>
                Prefix before the token. Set to an empty string to send the raw token with no prefix.
              </td>
            </tr>
            <tr>
              <td style={{ ...tdStyle, ...monoInline }}>label</td>
              <td style={tdStyle}>No</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>Optional name</td>
            </tr>
          </tbody>
        </table>
        <p style={{ ...bodyStyle, marginBottom: 16 }}>
          Clio sends: <code style={monoInline}>{'{header_name}: {header_scheme} {token}'}</code> (or just the
          bare token if <code style={monoInline}>header_scheme</code> is empty).
        </p>

        <p style={subHeadingStyle}>
          <code style={monoInline}>auth_type: &apos;oauth2_client_credentials&apos;</code>
        </p>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Field</th>
              <th style={thStyle}>Required</th>
              <th style={thStyle}>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...tdStyle, ...monoInline }}>token_url</td>
              <td style={tdStyle}>Yes</td>
              <td style={tdStyle}>Your OAuth2 token endpoint — must be a valid, publicly reachable HTTPS URL</td>
            </tr>
            <tr>
              <td style={{ ...tdStyle, ...monoInline }}>client_id</td>
              <td style={tdStyle}>Yes</td>
              <td style={tdStyle}>—</td>
            </tr>
            <tr>
              <td style={{ ...tdStyle, ...monoInline }}>client_secret</td>
              <td style={tdStyle}>Yes</td>
              <td style={tdStyle}>Encrypted at rest; never returned after registration</td>
            </tr>
            <tr>
              <td style={{ ...tdStyle, ...monoInline }}>scope</td>
              <td style={tdStyle}>No</td>
              <td style={tdStyle}>—</td>
            </tr>
            <tr>
              <td style={{ ...tdStyle, ...monoInline }}>audience</td>
              <td style={tdStyle}>No</td>
              <td style={tdStyle}>—</td>
            </tr>
            <tr>
              <td style={{ ...tdStyle, ...monoInline }}>label</td>
              <td style={tdStyle}>No</td>
              <td style={tdStyle}>—</td>
            </tr>
          </tbody>
        </table>
        <p style={{ ...bodyStyle, marginBottom: 16 }}>
          Clio performs an RFC 6749 §4.4 Client Credentials Grant against <code style={monoInline}>token_url</code>{' '}
          (HTTP Basic auth, <code style={monoInline}>grant_type=client_credentials</code>, plus{' '}
          <code style={monoInline}>scope</code>/<code style={monoInline}>audience</code> if set), caches the
          resulting token, and sends <code style={monoInline}>Authorization: Bearer &lt;token&gt;</code> when
          fetching your content/image URLs.
        </p>

        <p style={subHeadingStyle}>Not yet supported</p>
        <p style={bodyStyle}>
          <code style={monoInline}>presigned_url</code> and <code style={monoInline}>mtls</code> are documented{' '}
          <code style={monoInline}>auth_type</code> values but are <strong style={{ color: COLORS.textPrimary }}>rejected
          at registration</strong> (HTTP 422, <code style={monoInline}>content_source_auth_type_not_supported</code>)
          — no row is ever stored for them.
        </p>
        <p style={bodyStyle}>
          If your images already carry a presigned/expiring signature <strong style={{ color: COLORS.textPrimary }}>in
          the URL itself</strong> (e.g. an S3 presigned GET URL), this is <strong style={{ color: COLORS.textPrimary }}>not
          a gap</strong> — register that content source with <code style={monoInline}>auth_type: &apos;none&apos;</code>.
          Clio fetches the URL exactly as given, with no extra auth header, and the embedded signature
          authenticates it. Only a mechanism where Clio itself generates or refreshes presigned URLs on your
          behalf is unsupported.
        </p>
        <p style={{ ...bodyStyle, marginBottom: 16 }}>
          Also not yet supported: <strong style={{ color: COLORS.textPrimary }}>API-key-in-query-string auth</strong>{' '}
          (e.g. <code style={monoInline}>?api_key=...</code>) and <strong style={{ color: COLORS.textPrimary }}>multiple
          custom headers</strong> per content source — only a single configurable header (
          <code style={monoInline}>static_bearer</code>) or an <code style={monoInline}>Authorization: Bearer</code>{' '}
          token (OAuth2) is supported today. Both are logged as candidate enhancements (<code style={monoInline}>BACKLOG.md</code>).
        </p>

        <p style={subHeadingStyle}>Fetch constraints</p>
        <p style={{ ...bodyStyle, marginBottom: 4 }}>
          Apply to every content/image URL Clio fetches, regardless of auth type:
        </p>
        <ul style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.7, paddingLeft: 20, margin: 0, marginBottom: 0 }}>
          <li>HTTPS only.</li>
          <li>
            Must be publicly reachable. Clio blocks loopback addresses, private IP ranges, link-local addresses
            (including cloud metadata endpoints), and <code style={monoInline}>.internal</code>/
            <code style={monoInline}>.local</code>/<code style={monoInline}>.localhost</code> hostnames — checked
            against every DNS address your hostname resolves to, not just the first.
          </li>
          <li>15-second timeout per request.</li>
          <li>
            Redirects are followed up to 3 hops; each redirect target is independently re-validated against the
            same reachability rules before being fetched (never blindly followed).
          </li>
          <li>
            The response <code style={monoInline}>Content-Type</code> must match what you declared: HTML pages
            must return <code style={monoInline}>text/html</code>; images must return an{' '}
            <code style={monoInline}>image/*</code> type. A mismatch is treated as a fetch failure for that page.
          </li>
          <li>Size limits: 5MB for HTML pages, 10MB for images.</li>
          <li>
            Images are fetched server-side and re-hosted to the meeting bot as a data URI — your image URL is
            never exposed to the browser, so no CORS configuration is needed on your end.
          </li>
        </ul>
      </Card>

      {/* 3 — API / webhook reference */}
      <h2 style={sectionHeadingStyle}>API &amp; webhook reference</h2>
      <p style={bodyStyle}>
        Full request/response details, rate limits, and example payloads live on the{' '}
        <Link
          href={`/dashboard/configurator/api?partner_account_id=${activePartnerAccountId}`}
          style={{ color: COLORS.cyan, textDecoration: 'none' }}
        >
          API page
        </Link>
        . A summary of the four partner endpoints and the usage webhook:
      </p>
      <Card style={{ marginBottom: 16 }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Endpoint</th>
              <th style={thStyle}>Purpose</th>
              <th style={thStyle}>Rate limit</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={e.id}>
                <td style={{ ...tdStyle, ...monoInline, whiteSpace: 'nowrap' }}>
                  {e.method} {e.path}
                </td>
                <td style={tdStyle}>{e.purpose}</td>
                <td style={tdStyle}>{e.rateLimit}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={subHeadingStyle}>Outbound usage webhook</p>
        <p style={{ ...bodyStyle, marginBottom: 6 }}>
          <span style={monoInline}>{WEBHOOK_DOC.path}</span>
        </p>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Payload fields</p>
        <p style={{ fontSize: 12, color: COLORS.textPrimary, ...monoInline, marginBottom: 12 }}>
          {WEBHOOK_DOC.payloadFields.join(', ')}
        </p>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Signature header</p>
        <pre style={{ ...codeBlockStyle, marginBottom: 12 }}>{WEBHOOK_DOC.signatureHeader}</pre>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Verify</p>
        <p style={{ ...bodyStyle, marginBottom: 12 }}>{WEBHOOK_DOC.verificationRecipe}</p>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Retries</p>
        <p style={{ ...bodyStyle, marginBottom: 0 }}>{WEBHOOK_DOC.retrySchedule}</p>
      </Card>

      {/* 4 — Billing explained (anchor target of the billing-health banner) */}
      <h2 id="billing" style={{ ...sectionHeadingStyle, scrollMarginTop: 24 }}>
        Billing explained
      </h2>
      <Card style={{ marginBottom: 16 }}>
        <p style={subHeadingStyle}>Your prepaid wallet</p>
        <p style={bodyStyle}>
          Clio bills against a single prepaid wallet — one unified USD balance per partner account. Every metered
          event draws down this balance. You can always read your current balance, burn rate, and projected
          days-remaining from <code style={monoInline}>GET /api/partner/v1/wallet</code>.
        </p>

        <p style={subHeadingStyle}>Two ways to fund the wallet</p>
        <p style={bodyStyle}>
          <strong style={{ color: COLORS.textPrimary }}>Recurring Plan tiers</strong> credit an included usage
          allowance to your wallet on each invoice. <strong style={{ color: COLORS.textPrimary }}>One-off
          top-ups</strong> add a credit to your balance outside the recurring Plan — useful for covering a burst
          of usage between invoices. Current plan tiers:
        </p>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Tier</th>
              <th style={thStyle}>Monthly</th>
              <th style={thStyle}>Annual</th>
              <th style={thStyle}>Included allowance / mo</th>
            </tr>
          </thead>
          <tbody>
            {PLAN_TIERS.map((tier) => (
              <tr key={tier.key}>
                <td style={tdStyle}>{tier.displayName}</td>
                <td style={tdStyle}>${tier.monthlyPriceUsd}/mo</td>
                <td style={tdStyle}>${tier.annualPriceUsd}/yr</td>
                <td style={tdStyle}>${tier.includedAllowanceUsdMonthly}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 12 }}>
          Figures reflect the current catalog; your agreement confirms the pricing that applies to your account.
        </p>

        <p style={subHeadingStyle}>What a metered event costs</p>
        <p style={bodyStyle}>
          Each metered event — a voice minute, or an LLM generation call — draws down your balance at the
          per-event rate configured for your account. Your live rates are returned as{' '}
          <code style={monoInline}>burn_rate_by_event_type</code> on the wallet endpoint, so you always see the
          exact rate applied to each event type.
        </p>

        <p style={subHeadingStyle}>Payment problems &amp; low balance</p>
        <p style={bodyStyle}>
          Your Plan&apos;s payment state is mirrored on the wallet. <strong style={{ color: COLORS.textPrimary }}>Past
          due</strong> means a recurring Plan invoice failed; <strong style={{ color: COLORS.textPrimary }}>canceled</strong>{' '}
          means the Plan is no longer active. A depleting balance raises a low-balance alert. Any of these shows a
          warning banner at the top of your dashboard — it is advisory only and never blocks access to the
          Configurator, API, or Docs.
        </p>
        <p style={{ ...bodyStyle, marginBottom: 0 }}>
          <strong style={{ color: COLORS.textPrimary }}>To resolve:</strong> update your payment method or add
          funds to your wallet. Self-serve billing management is coming soon; until then, contact your Clio
          account manager to update payment details or top up your balance.
        </p>
      </Card>
    </ConfiguratorNavShell>
  )
}
