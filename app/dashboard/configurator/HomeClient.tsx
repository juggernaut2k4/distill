'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorShell, Card, COLORS } from './_shared'

interface Summary {
  questionnairePublished: number
  questionnaireDraft: number
  topicsSource: string
  contentSource: string
  themeLabel: string
  parameterizedCount: number
  preferenceScore: number
  domainLabel: string
  integrationLabel: string
}

export default function HomeClient({ accounts, activePartnerAccountId }: { accounts: AdminPartnerAccount[]; activePartnerAccountId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const searchParams = useSearchParams()
  const showWelcome = searchParams?.get('welcome') === '1'

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [qRes, tRes, cRes, themeRes, templatesRes, meterRes, domainRes, oauthClientsRes] = await Promise.all([
        fetch(`/api/admin/configurator/questionnaire?partner_account_id=${activePartnerAccountId}`),
        fetch(`/api/admin/configurator/topics-config?partner_account_id=${activePartnerAccountId}`),
        fetch(`/api/admin/configurator/content-config?partner_account_id=${activePartnerAccountId}`),
        fetch(`/api/admin/configurator/theme?partner_account_id=${activePartnerAccountId}`),
        fetch(`/api/admin/configurator/templates?partner_account_id=${activePartnerAccountId}`),
        fetch(`/api/admin/configurator/preference-meter?partner_account_id=${activePartnerAccountId}`),
        fetch(`/api/admin/configurator/domain?partner_account_id=${activePartnerAccountId}`),
        fetch(`/api/admin/configurator/oauth-clients?partner_account_id=${activePartnerAccountId}`),
      ])
      if (cancelled) return
      const [q, t, c, theme, templates, meter, domain, oauthClients] = await Promise.all([
        qRes.json(), tRes.json(), cRes.json(), themeRes.json(), templatesRes.json(), meterRes.json(), domainRes.json(), oauthClientsRes.json(),
      ])
      const clientCount = (oauthClients.clients ?? []).length
      setSummary({
        questionnairePublished: (q.questionnaires ?? []).filter((x: { status: string }) => x.status === 'published').length,
        questionnaireDraft: (q.questionnaires ?? []).filter((x: { status: string }) => x.status === 'draft').length,
        topicsSource: t.config?.topicsSource ?? 'clio_generated',
        contentSource: c.content_source ?? 'clio_generated',
        themeLabel: theme.theme?.themeLabel ?? 'Untitled theme',
        parameterizedCount: (templates.templates ?? []).filter((x: { parameterized: boolean }) => x.parameterized).length,
        preferenceScore: meter.meter?.score ?? 0,
        domainLabel: domain.subdomain_slug ? `${domain.subdomain_slug}.${domain.root_domain}` : 'Not configured',
        integrationLabel: clientCount > 0 ? `${clientCount} API credential${clientCount === 1 ? '' : 's'}` : 'Not configured',
      })
    }
    load()
    return () => { cancelled = true }
  }, [activePartnerAccountId])

  return (
    <ConfiguratorShell accounts={accounts} activePartnerAccountId={activePartnerAccountId} title="">
      {showWelcome && (
        <Card style={{ marginBottom: 20, borderColor: COLORS.green }}>
          <p style={{ fontSize: 13, color: COLORS.green }}>Setup complete — you&apos;re live.</p>
        </Card>
      )}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>
          Design profile: {summary ? `${summary.preferenceScore}%` : '—'}
        </p>
        <div style={{ height: 8, background: COLORS.borderSubtle, borderRadius: 4, overflow: 'hidden', maxWidth: 320 }}>
          <div style={{ height: '100%', width: `${summary?.preferenceScore ?? 0}%`, background: COLORS.purple, transition: 'width 0.3s' }} />
        </div>
        <p style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 6, maxWidth: 420 }}>
          Clio is still learning your visual preferences. Full profile unlocks proactive design suggestions.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
        <DomainCard
          href={`/dashboard/configurator/questionnaire?partner_account_id=${activePartnerAccountId}`}
          title="Questionnaire"
          status={summary ? `${summary.questionnairePublished} published` : '—'}
        />
        <DomainCard
          href={`/dashboard/configurator/topics?partner_account_id=${activePartnerAccountId}`}
          title="Topics"
          status={summary ? (summary.topicsSource === 'clio_generated' ? 'Clio-generated' : 'Partner-supplied') : '—'}
        />
        <DomainCard
          href={`/dashboard/configurator/content?partner_account_id=${activePartnerAccountId}`}
          title="Content"
          status={summary ? (summary.contentSource === 'clio_generated' ? 'Clio-generated' : 'Partner-supplied') : '—'}
        />
        <DomainCard
          href={`/dashboard/configurator/domain?partner_account_id=${activePartnerAccountId}`}
          title="Domain"
          status={summary ? summary.domainLabel : '—'}
        />
        <DomainCard
          href={`/dashboard/configurator/integration?partner_account_id=${activePartnerAccountId}`}
          title="Integration"
          status={summary ? summary.integrationLabel : '—'}
        />
        <DomainCard
          href={`/dashboard/configurator/developer?partner_account_id=${activePartnerAccountId}`}
          title="Developer"
          status="Docs & Playground"
        />
      </div>

      <Link href={`/dashboard/configurator/visualization?partner_account_id=${activePartnerAccountId}`} style={{ textDecoration: 'none' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>Visualization</p>
              <p style={{ fontSize: 13, color: COLORS.textSecondary }}>
                Theme: {summary?.themeLabel ?? '—'} · {summary?.parameterizedCount ?? 0} templates parameterized
              </p>
            </div>
            <span style={{ color: COLORS.textSecondary }}>Open →</span>
          </div>
        </Card>
      </Link>
    </ConfiguratorShell>
  )
}

function DomainCard({ href, title, status }: { href: string; title: string; status: string }) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <Card>
        <p style={{ fontWeight: 600, marginBottom: 4, color: COLORS.textPrimary }}>{title}</p>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>{status}</p>
        <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>Open →</span>
      </Card>
    </Link>
  )
}
