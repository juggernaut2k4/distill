'use client'

import Link from 'next/link'
import { COLORS, Card, PrimaryButton } from '../../_shared'
import { StatusBadge } from '../ClientsClient'

/**
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §4). Client detail page
 * content — `ChannelPartnerShell` is deliberately NOT used here (the shell's
 * 4-tab nav doesn't apply to a single client's detail view); instead a
 * lighter, back-link-only header, matching B2B-28's
 * `SalesPartnerDetailClient.tsx` precedent. `StatusBadge` is imported from
 * `ClientsClient.tsx`, not re-implemented.
 */

interface ClientDetail {
  id: string
  name: string
  company_url: string | null
  status: 'active' | 'suspended'
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
      </div>
    </div>
  )
}
