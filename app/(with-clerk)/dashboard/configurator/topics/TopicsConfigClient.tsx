'use client'

import { useEffect, useState } from 'react'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorShell, Card, PrimaryButton, COLORS } from '../_shared'

export default function TopicsConfigClient({ accounts, activePartnerAccountId, embedded = false }: { accounts: AdminPartnerAccount[]; activePartnerAccountId: string; embedded?: boolean }) {
  const [topicsSource, setTopicsSource] = useState<'clio_generated' | 'partner_supplied'>('clio_generated')
  const [prerequisitesSource, setPrerequisitesSource] = useState<'clio_generated' | 'partner_supplied'>('clio_generated')
  const [saved, setSaved] = useState({ topicsSource: 'clio_generated', prerequisitesSource: 'clio_generated' })

  useEffect(() => {
    fetch(`/api/admin/configurator/topics-config?partner_account_id=${activePartnerAccountId}`)
      .then((r) => r.json())
      .then((data) => {
        const cfg = data.config ?? { topicsSource: 'clio_generated', prerequisitesSource: 'clio_generated' }
        setTopicsSource(cfg.topicsSource)
        setPrerequisitesSource(cfg.prerequisitesSource)
        setSaved(cfg)
      })
  }, [activePartnerAccountId])

  const dirty = topicsSource !== saved.topicsSource || prerequisitesSource !== saved.prerequisitesSource

  async function save() {
    const res = await fetch('/api/admin/configurator/topics-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: activePartnerAccountId, topics_source: topicsSource, prerequisites_source: prerequisitesSource }),
    })
    if (res.ok) setSaved({ topicsSource, prerequisitesSource })
  }

  const content = (
    <>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Topics</h1>

      <Card style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 14, marginBottom: 12 }}>Where do topics come from?</p>
        <RadioRow checked={topicsSource === 'clio_generated'} onSelect={() => setTopicsSource('clio_generated')} label="Clio generates topics automatically" />
        <RadioRow checked={topicsSource === 'partner_supplied'} onSelect={() => setTopicsSource('partner_supplied')} label="We supply our own topic list" />
        {topicsSource === 'partner_supplied' && (
          <p style={{ fontSize: 12, color: COLORS.textSecondary, marginLeft: 24, marginTop: 4 }}>
            Clio calls GET {'{your outbound endpoint}'}/topics at session-selection time. Configure your endpoint via the partner accounts API.
          </p>
        )}
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 14, marginBottom: 12 }}>Where do prerequisites / topic deltas come from?</p>
        <RadioRow checked={prerequisitesSource === 'clio_generated'} onSelect={() => setPrerequisitesSource('clio_generated')} label="Clio generates prerequisites automatically" />
        <RadioRow checked={prerequisitesSource === 'partner_supplied'} onSelect={() => setPrerequisitesSource('partner_supplied')} label="We supply our own prerequisite list" />
      </Card>

      <PrimaryButton disabled={!dirty} onClick={save}>Save changes</PrimaryButton>
    </>
  )

  if (embedded) return <>{content}</>
  return (
    <ConfiguratorShell accounts={accounts} activePartnerAccountId={activePartnerAccountId} title="Topics" backHref={`/dashboard/configurator?partner_account_id=${activePartnerAccountId}`}>
      {content}
    </ConfiguratorShell>
  )
}

function RadioRow({ checked, onSelect, label }: { checked: boolean; onSelect: () => void; label: string }) {
  return (
    <label style={{ display: 'block', fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
      <input type="radio" checked={checked} onChange={onSelect} style={{ marginRight: 8 }} />
      {label}
    </label>
  )
}
