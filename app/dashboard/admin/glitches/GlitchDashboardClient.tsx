'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowUpDown } from 'lucide-react'
import Link from 'next/link'

/**
 * B2B-09 Requirement Doc §4.A / §5.A — the one real screen this brief builds.
 * Layout follows app/dashboard/admin/clients/PartnerBillingClient.tsx exactly
 * (table/loading/empty/error state conventions) — no new design language
 * invented, no AI clustering (explicitly out of scope per the spec).
 *
 * Two stacked panels, always both visible (no tab switch):
 *  - Panel 1 ("Glitch Patterns"): aggregate summary, one row per distinct
 *    (glitch.type, partner) combination, sorted by Count descending by
 *    default. Always unfiltered.
 *  - Panel 2 ("All Glitches"): one row per individual glitch, sorted by
 *    Extracted at descending, with optional Partner/Type filters.
 */

const GLITCH_TYPES = ['misunderstanding', 'repetition', 'confusion_about_clio', 'derailment', 'other'] as const
type GlitchType = (typeof GLITCH_TYPES)[number]

const TYPE_LABELS: Record<GlitchType, string> = {
  misunderstanding: 'Misunderstanding',
  repetition: 'Repetition',
  confusion_about_clio: 'Confusion about Clio',
  derailment: 'Derailment',
  other: 'Other',
}

interface SummaryRow {
  glitch_type: GlitchType
  partner_account_id: string
  partner_name: string
  count: number
  first_seen: string
  last_seen: string
}

interface GlitchRow {
  partner_session_id: string
  partner_account_id: string
  partner_name: string
  glitch_type: GlitchType
  description: string | null
  full_detail_purged: boolean
  extracted_at: string
}

type SummarySortColumn = 'glitch_type' | 'partner_name' | 'count' | 'first_seen' | 'last_seen'

const SUMMARY_COLUMNS: Array<{ key: SummarySortColumn; label: string }> = [
  { key: 'glitch_type', label: 'Type' },
  { key: 'partner_name', label: 'Partner' },
  { key: 'count', label: 'Count' },
  { key: 'first_seen', label: 'First seen' },
  { key: 'last_seen', label: 'Last seen' },
]

const PURGE_NOTICE = '— purged (30-day retention window elapsed)'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function shortSessionId(id: string): string {
  return `${id.slice(0, 8)}…`
}

function sortSummaryRows(rows: SummaryRow[], column: SummarySortColumn, direction: 'asc' | 'desc'): SummaryRow[] {
  const sorted = [...rows].sort((a, b) => {
    let cmp: number
    switch (column) {
      case 'glitch_type':
        cmp = TYPE_LABELS[a.glitch_type].localeCompare(TYPE_LABELS[b.glitch_type])
        break
      case 'partner_name':
        cmp = a.partner_name.localeCompare(b.partner_name)
        break
      case 'first_seen':
      case 'last_seen':
        cmp = a[column].localeCompare(b[column])
        break
      default:
        cmp = a.count - b.count
    }
    return direction === 'asc' ? cmp : -cmp
  })
  return sorted
}

export default function GlitchDashboardClient() {
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(false)
  const [summarySortColumn, setSummarySortColumn] = useState<SummarySortColumn>('count')
  const [summarySortDirection, setSummarySortDirection] = useState<'asc' | 'desc'>('desc')

  const [glitchRows, setGlitchRows] = useState<GlitchRow[]>([])
  const [glitchLoading, setGlitchLoading] = useState(true)
  const [glitchError, setGlitchError] = useState(false)

  const [partnerFilter, setPartnerFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')

  // Panel 1 — always unfiltered, fetched once on mount.
  useEffect(() => {
    let cancelled = false
    async function load() {
      setSummaryLoading(true)
      setSummaryError(false)
      try {
        const res = await fetch('/api/admin/glitches/summary')
        if (!res.ok) throw new Error('failed to load')
        const data = await res.json()
        if (!cancelled) setSummaryRows(data.summary ?? [])
      } catch {
        if (!cancelled) setSummaryError(true)
      } finally {
        if (!cancelled) setSummaryLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Panel 2 — re-fetches whenever either filter changes.
  useEffect(() => {
    let cancelled = false
    async function load() {
      setGlitchLoading(true)
      setGlitchError(false)
      try {
        const params = new URLSearchParams()
        if (partnerFilter) params.set('partner_account_id', partnerFilter)
        if (typeFilter) params.set('type', typeFilter)
        const qs = params.toString()
        const res = await fetch(`/api/admin/glitches${qs ? `?${qs}` : ''}`)
        if (!res.ok) throw new Error('failed to load')
        const data = await res.json()
        if (!cancelled) setGlitchRows(data.glitches ?? [])
      } catch {
        if (!cancelled) setGlitchError(true)
      } finally {
        if (!cancelled) setGlitchLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [partnerFilter, typeFilter])

  const sortedSummaryRows = useMemo(
    () => sortSummaryRows(summaryRows, summarySortColumn, summarySortDirection),
    [summaryRows, summarySortColumn, summarySortDirection]
  )

  // Partner dropdown: distinct partners with at least one glitch, derived
  // from the summary panel's own data (Requirement Doc §4.A).
  const partnerOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of summaryRows) {
      if (!seen.has(row.partner_account_id)) seen.set(row.partner_account_id, row.partner_name)
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [summaryRows])

  function handleSummarySort(column: SummarySortColumn) {
    if (column === summarySortColumn) {
      setSummarySortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSummarySortColumn(column)
      setSummarySortDirection('asc')
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
        <div className="flex items-center gap-3 mb-1">
          <AlertTriangle className="w-6 h-6 text-[#7C3AED]" />
          <h1 className="text-white text-2xl font-bold">Glitch Dashboard</h1>
        </div>
        <p className="text-[#94A3B8] text-sm">
          Every glitch captured across every partner and every session — grouped so recurring patterns surface immediately.
        </p>
      </div>

      {/* Panel 1 — Glitch Patterns */}
      <div className="mb-8">
        <h2 className="text-white text-lg font-bold mb-3">Glitch Patterns</h2>
        <div className="bg-[#111111] border border-[#222222] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#222222]">
                  {SUMMARY_COLUMNS.map(({ key, label }) => (
                    <th key={key} className="text-left px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => handleSummarySort(key)}
                        className="flex items-center gap-1 text-[#94A3B8] hover:text-white text-xs font-semibold uppercase tracking-wide transition-colors"
                      >
                        {label}
                        <ArrowUpDown className={`w-3 h-3 ${summarySortColumn === key ? 'text-[#7C3AED]' : 'text-[#333333]'}`} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaryLoading && (
                  <tr>
                    <td colSpan={SUMMARY_COLUMNS.length} className="text-center py-16 text-[#94A3B8] text-sm">
                      Loading…
                    </td>
                  </tr>
                )}

                {!summaryLoading && summaryError && (
                  <tr>
                    <td colSpan={SUMMARY_COLUMNS.length} className="text-center py-16 text-[#EF4444] text-sm">
                      Couldn&apos;t load glitch data. Try refreshing the page.
                    </td>
                  </tr>
                )}

                {!summaryLoading && !summaryError && sortedSummaryRows.length === 0 && (
                  <tr>
                    <td colSpan={SUMMARY_COLUMNS.length} className="text-center py-16 text-[#94A3B8] text-sm">
                      No glitches recorded yet.
                    </td>
                  </tr>
                )}

                {!summaryLoading &&
                  !summaryError &&
                  sortedSummaryRows.map((row) => (
                    <tr key={`${row.glitch_type}-${row.partner_account_id}`} className="border-b border-[#1a1a1a] last:border-0">
                      <td className="px-4 py-3 text-white font-medium whitespace-nowrap">{TYPE_LABELS[row.glitch_type]}</td>
                      <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{row.partner_name}</td>
                      <td className="px-4 py-3 text-white whitespace-nowrap">{row.count}</td>
                      <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatDate(row.first_seen)}</td>
                      <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatDate(row.last_seen)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Panel 2 — All Glitches */}
      <div>
        <h2 className="text-white text-lg font-bold mb-3">All Glitches</h2>

        <div className="flex items-center gap-4 mb-3">
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
            Partner
            <select
              value={partnerFilter}
              onChange={(e) => setPartnerFilter(e.target.value)}
              className="bg-[#111111] border border-[#333333] text-white text-sm rounded-lg px-2 py-1.5 normal-case font-normal tracking-normal focus:outline-none focus:border-[#7C3AED]"
            >
              <option value="">All partners</option>
              {partnerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
            Type
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-[#111111] border border-[#333333] text-white text-sm rounded-lg px-2 py-1.5 normal-case font-normal tracking-normal focus:outline-none focus:border-[#7C3AED]"
            >
              <option value="">All types</option>
              {GLITCH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="bg-[#111111] border border-[#222222] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#222222]">
                  <th className="text-left px-4 py-3 whitespace-nowrap">
                    <span className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">Partner</span>
                  </th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">
                    <span className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">Session</span>
                  </th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">
                    <span className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">Type</span>
                  </th>
                  <th className="text-left px-4 py-3">
                    <span className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">Description</span>
                  </th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">
                    <span className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">Extracted at</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {glitchLoading && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-[#94A3B8] text-sm">
                      Loading…
                    </td>
                  </tr>
                )}

                {!glitchLoading && glitchError && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-[#EF4444] text-sm">
                      Couldn&apos;t load glitch data. Try refreshing the page.
                    </td>
                  </tr>
                )}

                {!glitchLoading && !glitchError && glitchRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-[#94A3B8] text-sm">
                      No glitches recorded yet.
                    </td>
                  </tr>
                )}

                {!glitchLoading &&
                  !glitchError &&
                  glitchRows.map((row, idx) => (
                    <tr key={`${row.partner_session_id}-${idx}`} className="border-b border-[#1a1a1a] last:border-0">
                      <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{row.partner_name}</td>
                      <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap font-mono text-xs">
                        {shortSessionId(row.partner_session_id)}
                      </td>
                      <td className="px-4 py-3 text-white whitespace-nowrap">{TYPE_LABELS[row.glitch_type]}</td>
                      <td className="px-4 py-3 text-[#94A3B8]">
                        {row.full_detail_purged ? (
                          <span className="italic text-[#475569]">{PURGE_NOTICE}</span>
                        ) : (
                          row.description
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatDateTime(row.extracted_at)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
