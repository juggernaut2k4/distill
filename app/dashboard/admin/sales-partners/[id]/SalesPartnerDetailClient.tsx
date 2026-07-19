'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import Link from 'next/link'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4) — super-admin-only
 * sales-partner detail: revenue-share editor, client roster (reused,
 * `listClientsForChannelPartner`'s exact shape), team glimpse (reused,
 * `listTeamAndInvites`'s exact shape), and a forward-reference-only,
 * non-functional "Legal agreement" placeholder card.
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
    revenue_share_percent: number | null
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

  const [shareInput, setShareInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/admin/sales-partners/${id}`)
      if (!res.ok) throw new Error('failed')
      const json = await res.json()
      setData(json)
      setShareInput(json.sales_partner.revenue_share_percent === null ? '' : String(json.sales_partner.revenue_share_percent))
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

  const currentValue = data?.sales_partner.revenue_share_percent
  const currentValueStr = currentValue === null || currentValue === undefined ? '' : String(currentValue)
  const isUnchanged = shareInput === currentValueStr

  async function handleSave() {
    setSaveError(null)
    const trimmed = shareInput.trim()
    const value = trimmed === '' ? null : Number(trimmed)
    if (value !== null && (Number.isNaN(value) || value < 0 || value > 100)) {
      setSaveError('Enter a value between 0 and 100.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/sales-partners/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revenue_share_percent: value }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSaveError(json?.error ?? "Couldn't save. Try again.")
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      await load()
    } catch {
      setSaveError("Couldn't save. Try again.")
    } finally {
      setSaving(false)
    }
  }

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
          <h2 className="text-white text-lg font-semibold mb-3">Sales-partner share</h2>
          {sales_partner.revenue_share_percent === null && (
            <p className="text-[#475569] text-sm mb-3">No revenue share set.</p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[#94A3B8] text-sm">Sales-partner share:</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={shareInput}
              onChange={(e) => setShareInput(e.target.value)}
              className="w-24 bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#7C3AED]"
            />
            <span className="text-[#94A3B8] text-sm">%</span>
            <button
              onClick={handleSave}
              disabled={saving || isUnchanged}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save
            </button>
            {saved && <span className="text-[#10B981] text-sm">Saved.</span>}
          </div>
          {saveError && <p className="text-[#EF4444] text-xs mt-2">{saveError}</p>}
        </div>

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
