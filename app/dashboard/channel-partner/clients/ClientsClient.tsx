'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { COLORS, PrimaryButton, SecondaryButton, Card } from '../_shared'

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §4) — Clients screen
 * client component. Fetches `GET /api/channel-partner/clients` on mount
 * (mirrors `TeamClient.tsx`'s `loadX()` pattern exactly — useState +
 * useEffect + try/catch/finally).
 *
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §4) — each client row
 * becomes a `<Link>` to `/dashboard/channel-partner/clients/{client.id}`,
 * mirroring the exact `<Link>`-not-`<tr>`-click-handler pattern
 * `SalesPartnersClient.tsx` established in B2B-28, for the same
 * keyboard/screen-reader-navigable reason.
 */

interface ClientRow {
  id: string
  name: string
  company_url: string | null
  status: 'active' | 'suspended'
  created_at: string
}

// B2B-29 (docs/specs/B2B-29-requirement-document.md §4) — exported so the new
// client detail page (`clients/[id]/ClientDetailClient.tsx`) imports this
// exact component rather than re-implementing it.
export function StatusBadge({ status }: { status: 'active' | 'suspended' }) {
  const styles: Record<'active' | 'suspended', string> = {
    active: 'bg-[#10B981]/20 text-[#10B981]',
    suspended: 'bg-[#475569]/20 text-[#94A3B8]',
  }
  return (
    <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap ${styles[status]}`}>
      {status}
    </span>
  )
}

export default function ClientsClient({ initialFormOpen }: { initialFormOpen: boolean }) {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [formOpen, setFormOpen] = useState(initialFormOpen)
  const [name, setName] = useState('')
  const [companyUrl, setCompanyUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function loadClients() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/channel-partner/clients')
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setClients(data.clients ?? [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClients()
  }, [])

  async function handleAdd() {
    if (!name.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/channel-partner/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), companyUrl: companyUrl.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(data?.error ?? "Couldn't add this client. Try again.")
        return
      }
      setName('')
      setCompanyUrl('')
      setFormOpen(false)
      await loadClients()
    } catch {
      setSubmitError("Couldn't add this client. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-white text-2xl font-bold">Clients</h1>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors"
        >
          Add client
        </button>
      </div>

      {formOpen && (
        <Card style={{ marginBottom: 16 }}>
          <div>
            <label className="block text-[#94A3B8] text-sm font-medium mb-1.5">Client name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pluralsight"
              className="w-full bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white placeholder-[#475569] focus:outline-none focus:border-[#7C3AED] mb-4"
            />
            <label className="block text-[#94A3B8] text-sm font-medium mb-1.5">Company URL</label>
            <input
              type="text"
              value={companyUrl}
              onChange={(e) => setCompanyUrl(e.target.value)}
              placeholder="pluralsight.com"
              className="w-full bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white placeholder-[#475569] focus:outline-none focus:border-[#7C3AED] mb-4"
            />
            {submitError && <p className="text-[#EF4444] text-xs mb-3">{submitError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={submitting || !name.trim()}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Add
              </button>
              <button
                onClick={() => setFormOpen(false)}
                className="text-sm font-semibold px-4 py-2 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </Card>
      )}

      {loading && <p style={{ color: COLORS.textSecondary, fontSize: 14 }}>Loading…</p>}
      {!loading && loadError && <p style={{ color: COLORS.red, fontSize: 14 }}>Couldn&apos;t load your clients.</p>}

      {!loading && !loadError && clients.length === 0 && !formOpen && (
        <p style={{ color: COLORS.textMuted, fontSize: 14, textAlign: 'center', padding: '32px 0' }}>
          No clients yet. Add your first client to get started.
        </p>
      )}

      {!loading && !loadError && clients.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {clients.map((client) => (
            <Link key={client.id} href={`/dashboard/channel-partner/clients/${client.id}`} style={{ textDecoration: 'none', display: 'block' }}>
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <p style={{ color: COLORS.textPrimary, fontWeight: 600, margin: 0 }}>{client.name}</p>
                    {client.company_url && (
                      <p style={{ color: COLORS.textSecondary, fontSize: 13, margin: '2px 0 0' }}>{client.company_url}</p>
                    )}
                  </div>
                  <StatusBadge status={client.status} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
