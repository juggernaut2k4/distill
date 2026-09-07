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
 *
 * "Usage" card added by B2B-34 Piece 3 (docs/specs/B2B-34-requirement-document.md
 * Part E §4) — trailing-30-day + all-time minutes totals plus a per-client
 * breakdown, inserted between the Clients and Team cards. `usage.error`
 * drives this card's own independent error state (Part E §8) — a usage-query
 * failure never blocks the Clients/Team sections from rendering.
 *
 * "Voice rate" card added by PRICING-01
 * (docs/specs/PRICING-01-requirement-document.md §4.A, §6.4) — inserted
 * between the Usage and Team cards. Makes its own independent fetch to
 * GET /api/admin/sales-partners/[id]/rate on mount, with its own
 * loading/error state — a rate-load failure never blocks the
 * Clients/Team/Usage cards from rendering.
 */

interface ClientRow {
  id: string
  name: string
  company_url: string | null
  status: 'active' | 'suspended'
  created_at: string
}

interface UsageBreakdownRow {
  client_id: string
  client_name: string
  minutes: number
}

interface UsageData {
  minutes_30d: number
  minutes_all_time: number
  breakdown: UsageBreakdownRow[]
  error: boolean
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
  usage: UsageData
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface RateData {
  standard_rate_usd: number
  override: { rate_usd: number; effective_from: string } | null
}

/**
 * PRICING-01 §4.A, §6.4 — Voice rate card. Independent fetch/loading/error
 * state from the rest of this page (§6.4) — a load failure here must never
 * block the Clients/Team/Usage cards.
 */
function VoiceRateCard({ partnerAccountId }: { partnerAccountId: string }) {
  const [rate, setRate] = useState<RateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState(false)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/admin/sales-partners/${partnerAccountId}/rate`)
      if (!res.ok) throw new Error('failed')
      const json = await res.json()
      setRate(json)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerAccountId])

  useEffect(() => {
    if (!savedMessage) return
    const timer = setTimeout(() => setSavedMessage(false), 3000)
    return () => clearTimeout(timer)
  }, [savedMessage])

  function openEditor(prefill?: number) {
    setInputValue(prefill != null ? String(prefill) : '')
    setSaveError(null)
    setEditing(true)
  }

  function cancelEditor() {
    setEditing(false)
    setSaveError(null)
  }

  const trimmed = inputValue.trim()
  const numericValue = trimmed === '' ? NaN : Number(trimmed)
  const standardRateUsd = rate?.standard_rate_usd ?? 0.3
  const inputValid = !Number.isNaN(numericValue) && numericValue > 0 && numericValue < standardRateUsd
  const showInputError = trimmed !== '' && !inputValid

  async function saveRate() {
    if (!inputValid) return
    setBusy(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/admin/sales-partners/${partnerAccountId}/rate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate_usd: numericValue }),
      })
      if (!res.ok) throw new Error('failed')
      const json = await res.json()
      setRate({ standard_rate_usd: standardRateUsd, override: { rate_usd: json.rate_usd, effective_from: json.effective_from } })
      setEditing(false)
      setSavedMessage(true)
    } catch {
      setSaveError("Couldn't save. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function clearOverride() {
    setClearing(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/admin/sales-partners/${partnerAccountId}/rate`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      setRate({ standard_rate_usd: standardRateUsd, override: null })
      setSavedMessage(true)
    } catch {
      setSaveError("Couldn't save. Try again.")
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6">
      <h2 className="text-white text-lg font-semibold mb-3">Voice rate</h2>

      {loading ? (
        <p className="text-[#94A3B8] text-sm">Loading…</p>
      ) : loadError || !rate ? (
        <p className="text-[#EF4444] text-sm">Couldn&apos;t load rate. Try refreshing.</p>
      ) : (
        <>
          {rate.override ? (
            <>
              <p className="text-white text-sm">
                ${rate.override.rate_usd.toFixed(2)}/min — custom rate (standard is ${rate.standard_rate_usd.toFixed(2)}/min)
              </p>
              <p className="text-[#94A3B8] text-xs mb-3">Set {formatDate(rate.override.effective_from)}</p>
            </>
          ) : (
            <p className="text-white text-sm mb-3">${rate.standard_rate_usd.toFixed(2)}/min — standard rate</p>
          )}

          {!editing && (
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => openEditor(rate.override?.rate_usd)}
                className="text-xs font-semibold text-[#7C3AED] transition-colors hover:text-[#A855F7]"
              >
                {rate.override ? 'Change rate' : 'Set custom rate'}
              </button>
              {rate.override && (
                <button
                  type="button"
                  disabled={clearing}
                  onClick={clearOverride}
                  className="text-xs font-semibold text-[#94A3B8] transition-colors hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {clearing ? 'Clearing…' : 'Clear override'}
                </button>
              )}
            </div>
          )}

          {editing && (
            <div className="mt-1">
              <div className="flex items-center gap-2 mb-1">
                <div style={{ position: 'relative' }}>
                  <span
                    style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                    className="text-[#94A3B8] text-sm"
                  >
                    $
                  </span>
                  <input
                    type="number"
                    step="0.0001"
                    autoFocus
                    disabled={busy}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    style={{ paddingLeft: 22 }}
                    className="w-32 py-2 pr-2 bg-[#1A1A1A] border border-[#333333] rounded-lg text-white text-sm"
                  />
                </div>
                <span className="text-[#94A3B8] text-sm">/min</span>
                <button
                  type="button"
                  disabled={busy || !inputValid}
                  onClick={saveRate}
                  className="text-xs font-semibold text-[#7C3AED] transition-colors hover:text-[#A855F7] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={cancelEditor}
                  className="text-xs font-semibold text-[#94A3B8] transition-colors hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              </div>
              {showInputError && (
                <p className="text-[#EF4444] text-xs">Enter a rate below the standard ${standardRateUsd.toFixed(2)}/min.</p>
              )}
              {!showInputError && (
                <p className="text-[#94A3B8] text-xs">
                  Standard rate is ${standardRateUsd.toFixed(2)}/min. Enter a lower negotiated rate.
                </p>
              )}
            </div>
          )}

          {saveError && <p className="text-[#EF4444] text-xs mt-2">{saveError}</p>}
          {savedMessage && <p className="text-[#10B981] text-xs mt-2">✓ Rate updated.</p>}
        </>
      )}
    </div>
  )
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

  const { sales_partner, clients, team, usage } = data

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
          <h2 className="text-white text-lg font-semibold mb-3">Usage</h2>
          {usage.error ? (
            <p className="text-[#EF4444] text-sm">Couldn&apos;t load usage data. Try refreshing.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 mb-4">
                <p className="text-[#94A3B8] text-sm">
                  <span className="text-white font-semibold">{usage.minutes_30d}</span> minutes (last 30 days)
                </p>
                <p className="text-[#94A3B8] text-sm">
                  <span className="text-white font-semibold">{usage.minutes_all_time}</span> minutes (all time)
                </p>
              </div>
              {usage.breakdown.length === 0 ? (
                <p className="text-[#475569] text-sm">No usage in the last 30 days.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#222222]">
                        <th className="text-left px-3 py-2 text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">
                          Client
                        </th>
                        <th className="text-right px-3 py-2 text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">
                          Minutes (30d)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.breakdown.map((row) => (
                        <tr key={row.client_id} className="border-b border-[#1a1a1a] last:border-0">
                          <td className="px-3 py-2 text-white truncate">{row.client_name}</td>
                          <td className="px-3 py-2 text-[#94A3B8] text-right whitespace-nowrap">{row.minutes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <VoiceRateCard partnerAccountId={sales_partner.id} />

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
