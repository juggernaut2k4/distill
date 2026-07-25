'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check } from 'lucide-react'
import { COLORS, Card, PrimaryButton } from '../../_shared'
import { StatusBadge } from '../ClientsClient'

/**
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §4). Client detail page
 * content — `ChannelPartnerShell` is deliberately NOT used here (the shell's
 * 4-tab nav doesn't apply to a single client's detail view); instead a
 * lighter, back-link-only header, matching B2B-28's
 * `SalesPartnerDetailClient.tsx` precedent. `StatusBadge` is imported from
 * `ClientsClient.tsx`, not re-implemented.
 *
 * B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §4/§5) — adds a "Client ID" card
 * below "Configure": the only place a reseller can learn which UUID to pass as `client_id` when
 * creating a session for this client via the API.
 */

interface ClientDetail {
  id: string
  name: string
  company_url: string | null
  status: 'active' | 'suspended'
}

function ClientIdCard({ clientId }: { clientId: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(clientId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API failure degrades gracefully — select the text so the reseller can copy by hand.
      const range = document.createRange()
      const el = document.getElementById('client-id-value')
      if (el) {
        range.selectNodeContents(el)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    }
  }

  return (
    <Card style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 8px' }}>Client ID</h2>
      <p style={{ color: COLORS.textSecondary, fontSize: 13, margin: '0 0 16px' }}>
        Pass this as <code>client_id</code> when creating a session for this client via the API.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <code
          id="client-id-value"
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 13,
            color: COLORS.textPrimary,
            background: '#0A0A0A',
            border: `1px solid ${COLORS.borderSubtle}`,
            borderRadius: 8,
            padding: '8px 12px',
            userSelect: 'all',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
          }}
        >
          {clientId}
        </code>
        <button
          onClick={handleCopy}
          aria-label="Copy client ID"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
            fontSize: 13,
            fontWeight: 600,
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${copied ? COLORS.green : COLORS.borderSubtle}`,
            background: 'transparent',
            color: copied ? COLORS.green : COLORS.textSecondary,
            cursor: 'pointer',
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </Card>
  )
}

export default function ClientDetailClient({ client }: { client: ClientDetail }) {
  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(16px, 4vw, 32px)' }}>
        <Link
          href="/dashboard/channel-partner/clients"
          style={{ color: COLORS.textMuted, fontSize: 13, textDecoration: 'none', display: 'inline-block', marginBottom: 16 }}
        >
          ← All clients
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ color: COLORS.textPrimary, fontSize: 24, fontWeight: 700, margin: 0 }}>{client.name}</h1>
          <StatusBadge status={client.status} />
        </div>
        {client.company_url && (
          <p style={{ color: COLORS.textSecondary, fontSize: 14, margin: '0 0 24px' }}>{client.company_url}</p>
        )}
        {!client.company_url && <div style={{ marginBottom: 24 }} />}

        <Card>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 8px' }}>Configure</h2>
          <p style={{ color: COLORS.textSecondary, fontSize: 13, margin: '0 0 16px' }}>
            Set up API credentials, outbound routing, and payment for this client.
          </p>
          <Link href={`/dashboard/channel-partner/clients/${client.id}/configure`} style={{ textDecoration: 'none' }}>
            <PrimaryButton>Configure →</PrimaryButton>
          </Link>
        </Card>

        <ClientIdCard clientId={client.id} />
      </div>
    </div>
  )
}
