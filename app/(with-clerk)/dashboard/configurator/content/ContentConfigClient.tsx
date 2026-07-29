'use client'

import { useEffect, useState } from 'react'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import type { PartnerContentItem } from '@/lib/partner/content-generation'
import { ConfiguratorShell, Card, PrimaryButton, SecondaryButton, COLORS } from '../_shared'

const STATUS_LABEL: Record<PartnerContentItem['status'], string> = {
  generating: 'GENERATING…',
  ready_for_review: 'READY FOR REVIEW',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  failed: 'GENERATION FAILED',
}

export default function ContentConfigClient({ accounts, activePartnerAccountId, embedded = false }: { accounts: AdminPartnerAccount[]; activePartnerAccountId: string; embedded?: boolean }) {
  const [contentSource, setContentSource] = useState<'clio_generated' | 'partner_supplied'>('clio_generated')
  const [items, setItems] = useState<PartnerContentItem[]>([])
  const [newTopicRef, setNewTopicRef] = useState('')
  const [reviewing, setReviewing] = useState<string | null>(null)

  async function reload() {
    const res = await fetch(`/api/admin/configurator/content-config?partner_account_id=${activePartnerAccountId}`)
    const data = await res.json()
    setContentSource(data.content_source ?? 'clio_generated')
    setItems(data.items ?? [])
  }

  useEffect(() => {
    reload()
    const interval = setInterval(() => {
      if (items.some((i) => i.status === 'generating')) reload()
    }, 5000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePartnerAccountId])

  async function switchSource(source: 'clio_generated' | 'partner_supplied') {
    await fetch('/api/admin/configurator/content-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: activePartnerAccountId, content_source: source }),
    })
    setContentSource(source)
  }

  async function generate() {
    if (!newTopicRef.trim()) return
    await fetch('/api/admin/configurator/content/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: activePartnerAccountId, partner_topic_ref: newTopicRef }),
    })
    setNewTopicRef('')
    reload()
  }

  const reviewingItem = items.find((i) => i.id === reviewing) ?? null

  if (reviewingItem) {
    const content = (
      <ReviewView
        item={reviewingItem}
        partnerAccountId={activePartnerAccountId}
        onBack={() => { setReviewing(null); reload() }}
      />
    )
    if (embedded) return <>{content}</>
    return (
      <ConfiguratorShell accounts={accounts} activePartnerAccountId={activePartnerAccountId} title="Content — Review" backHref={`/dashboard/configurator?partner_account_id=${activePartnerAccountId}`}>
        {content}
      </ConfiguratorShell>
    )
  }

  const content = (
    <>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Content</h1>

      <Card style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 14, marginBottom: 12 }}>Where does session content come from?</p>
        <label style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>
          <input type="radio" checked={contentSource === 'clio_generated'} onChange={() => switchSource('clio_generated')} /> Clio generates content automatically
        </label>
        <label style={{ display: 'block', fontSize: 13 }}>
          <input type="radio" checked={contentSource === 'partner_supplied'} onChange={() => switchSource('partner_supplied')} /> We supply our own predefined content
        </label>
      </Card>

      {contentSource === 'partner_supplied' ? (
        <p style={{ fontSize: 13, color: COLORS.textSecondary }}>
          You&apos;re supplying your own content — Clio pulls it from your configured endpoint at session time. No action needed here.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 8 }}>Generated content (this partner only)</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {items.map((item) => (
              <Card key={item.id} style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>
                      &quot;{item.partnerTopicRef}&quot;{' '}
                      <span style={{ fontSize: 11, color: item.status === 'approved' ? COLORS.green : item.status === 'failed' || item.status === 'rejected' ? COLORS.red : COLORS.amber, marginLeft: 6 }}>
                        {STATUS_LABEL[item.status]}
                      </span>
                    </p>
                    <p style={{ fontSize: 12, color: COLORS.textSecondary }}>
                      {item.status === 'approved' ? `Pushed ${new Date(item.createdAt).toLocaleDateString()}` : `Created ${new Date(item.createdAt).toLocaleString()}`}
                    </p>
                  </div>
                  {item.status === 'ready_for_review' && (
                    <SecondaryButton onClick={() => setReviewing(item.id)}>Review &amp; approve</SecondaryButton>
                  )}
                </div>
              </Card>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newTopicRef}
              onChange={(e) => setNewTopicRef(e.target.value)}
              placeholder="Topic reference"
              style={{ flex: 1, background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: 10, color: COLORS.textPrimary, fontSize: 13 }}
            />
            <PrimaryButton disabled={!newTopicRef.trim()} onClick={generate}>Generate</PrimaryButton>
          </div>
        </>
      )}
    </>
  )

  if (embedded) return <>{content}</>
  return (
    <ConfiguratorShell accounts={accounts} activePartnerAccountId={activePartnerAccountId} title="Content" backHref={`/dashboard/configurator?partner_account_id=${activePartnerAccountId}`}>
      {content}
    </ConfiguratorShell>
  )
}

function ReviewView({ item, partnerAccountId, onBack }: { item: PartnerContentItem; partnerAccountId: string; onBack: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const payload = item.draftPayload as { sections?: { type: string }[] } | null

  async function approve() {
    setError(null)
    const res = await fetch(`/api/admin/configurator/content/${item.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerAccountId }),
    })
    if (res.ok) {
      onBack()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(`Couldn't push — ${data.error ?? res.status}. Your draft is saved; try again.`)
    }
  }

  async function discard() {
    await fetch(`/api/admin/configurator/content/${item.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerAccountId }),
    })
    onBack()
  }

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: COLORS.textSecondary, cursor: 'pointer', fontSize: 13, marginBottom: 16 }}>
        ← Content list
      </button>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>&quot;{item.partnerTopicRef}&quot; — Review</h2>

      <Card style={{ marginBottom: 16, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 13, color: COLORS.textSecondary }}>
          {payload?.sections ? `${payload.sections.length} section(s) generated · template: ${payload.sections.map((s) => s.type).join(', ')}` : 'No preview available'}
        </p>
      </Card>

      {error && <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <PrimaryButton onClick={approve}>Approve &amp; push to my endpoint</PrimaryButton>
        <SecondaryButton onClick={discard}>Discard</SecondaryButton>
      </div>
    </div>
  )
}
