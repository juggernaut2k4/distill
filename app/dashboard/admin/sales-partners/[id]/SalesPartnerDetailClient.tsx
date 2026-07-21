'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4) — super-admin-only
 * sales-partner detail: client roster (reused, `listClientsForChannelPartner`'s
 * exact shape), team glimpse (reused, `listTeamAndInvites`'s exact shape), and
 * a forward-reference-only, non-functional "Legal agreement" placeholder card.
 * Revenue-share editing removed per Arun's direct instruction (2026-07-21) —
 * the feature is fully dropped, not deferred.
 */

interface ClientRow {
  id: string
  name: string
  company_url: string | null
  status: 'active' | 'suspended'
  created_at: string
}

interface DetailData {
  sales_partner: {
    id: string
    name: string
    status: 'active' | 'suspended'
    created_at: string
  }
  clients: ClientRow[]
  team: { active_count: number; pending_count: number }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SalesPartnerDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/admin/sales-partners/${id}`)
      if (!res.ok) throw new Error('failed')
      const json = await res.json()
      setData(json)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <p className="text-[#94A3B8] text-sm py-8">Loading sales-partner…</p>
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="max-w-4xl mx-auto">
        <p className="text-[#EF4444] text-sm py-8">Couldn&apos;t load sales-partner data. Try refreshing the page.</p>
      </div>
    )
  }

  const { sales_partner, clients, team } = data

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <Link
          href="/dashboard/admin/sales-partners"
          className="inline-flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          All sales-partners
        </Link>

        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-white text-2xl font-bold">{sales_partner.name}</h1>
          <span
            className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
              sales_partner.status === 'active' ? 'bg-[#10B981]/20 text-[#10B981]' : 'bg-[#EF4444]/20 text-[#EF4444]'
            }`}
          >
            {sales_partner.status === 'active' ? 'Active' : 'Suspended'}
          </span>
        </div>
        <p className="text-[#94A3B8] text-sm">Signed up {formatDate(sales_partner.created_at)}</p>
      </div>

      <div className="space-y-4">
        <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6">
          <h2 className="text-white text-lg font-semibold mb-3">Clients</h2>
          {clients.length === 0 ? (
            <p className="text-[#475569] text-sm">No clients yet.</p>
          ) : (
            <div className="space-y-2">
              {clients.map((client) => (
                <div key={client.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-[#0A0A0A] border border-[#1A1A1A]">
                  <div className="min-w-0">
                    <p className="text-white text-sm truncate">{client.name}</p>
                    {client.company_url && <p className="text-[#94A3B8] text-xs truncate">{client.company_url}</p>}
                  </div>
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap ${
                      client.status === 'active' ? 'bg-[#10B981]/20 text-[#10B981]' : 'bg-[#475569]/20 text-[#94A3B8]'
                    }`}
                  >
                    {client.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6">
          <h2 className="text-white text-lg font-semibold mb-3">Team</h2>
          <p className="text-[#94A3B8] text-sm">
            {team.active_count + team.pending_count} people ({team.active_count} active, {team.pending_count} pending)
          </p>
        </div>

        <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6">
          <h2 className="text-white text-lg font-semibold mb-3">Legal agreement</h2>
          <p className="text-[#475569] text-sm">Agreement tracking is coming soon.</p>
        </div>
      </div>
    </div>
  )
}
