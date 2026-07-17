'use client'

import Link from 'next/link'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorNavShell, Card, COLORS, type BillingHealth } from '../_shared'
import { ENDPOINTS, WEBHOOK_DOC } from '../api/content'
import { PLAN_TIERS } from '@/lib/billing/plan-tiers'

/**
 * B2B-16 — /dashboard/configurator/docs (Requirement Doc Section 4.4). A new,
 * fully HAND-AUTHORED documentation page — no AI generation, no network fetch
 * (B2B-07 convention). Three sections:
 *   1. Getting-started quickstart (reuses the auth recipe from the API page).
 *   2. API / webhook reference — sourced from the single hand-authored module
 *      `../api/content` (ENDPOINTS / WEBHOOK_DOC); the data itself is not
 *      duplicated, both API and Docs import the one source.
 *   3. Plain-language billing explainer (anchor `#billing`, the target of the
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

      {/* 2 — API / webhook reference */}
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

      {/* 3 — Billing explained (anchor target of the billing-health banner) */}
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
