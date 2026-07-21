'use client'

import { useEffect, useMemo, useState } from 'react'
import { Users, ArrowLeft, ArrowUpDown } from 'lucide-react'
import Link from 'next/link'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4) — super-admin-only
 * sales-partner roster. Reuses `PartnerBillingClient.tsx`'s sortable-table
 * VISUAL pattern only (column headers with ArrowUpDown sort icons,
 * bg-[#111111] border-[#222222] rounded-xl overflow-hidden,
 * overflow-x-auto table wrapper) — none of its billing-specific data/logic.
 */

interface SalesPartnerRow {
  id: string
  name: string
  status: 'active' | 'suspended'
  created_at: string
  client_count: number
  team_count: number
}

type SortColumn = 'name' | 'client_count' | 'team_count' | 'status' | 'created_at'

const COLUMNS: Array<{ key: SortColumn; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'client_count', label: 'Clients' },
  { key: 'team_count', label: 'Team' },
  { key: 'status', label: 'Status' },
  { key: 'created_at', label: 'Signed up' },
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function sortRows(rows: SalesPartnerRow[], column: SortColumn, direction: 'asc' | 'desc'): SalesPartnerRow[] {
  const sorted = [...rows].sort((a, b) => {
    let cmp: number
    if (column === 'name' || column === 'status') {
      cmp = a[column].localeCompare(b[column])
    } else if (column === 'created_at') {
      cmp = a.created_at.localeCompare(b.created_at)
    } else {
      cmp = a[column] - b[column]
    }
    return direction === 'asc' ? cmp : -cmp
  })
  return sorted
}

export default function SalesPartnersClient() {
  const [rows, setRows] = useState<SalesPartnerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [sortColumn, setSortColumn] = useState<SortColumn>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(false)
      try {
        const res = await fetch('/api/admin/sales-partners')
        if (!res.ok) throw new Error('failed')
        const data = await res.json()
        if (!cancelled) setRows(data.sales_partners ?? [])
      } catch {
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const sortedRows = useMemo(() => sortRows(rows, sortColumn, sortDirection), [rows, sortColumn, sortDirection])

  function handleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
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
          <Users className="w-6 h-6 text-[#7C3AED]" />
          <h1 className="text-white text-2xl font-bold">Sales-partners</h1>
        </div>
        <p className="text-[#94A3B8] text-sm">
          Companies reselling Clio to their own clients — not Clio&apos;s internal sales staff (see Team &amp; Access).
        </p>
      </div>

      <div className="bg-[#111111] border border-[#222222] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#222222]">
                {COLUMNS.map(({ key, label }) => (
                  <th key={key} className="text-left px-4 py-3 whitespace-nowrap">
                    <button
                      onClick={() => handleSort(key)}
                      className="flex items-center gap-1 text-[#94A3B8] hover:text-white text-xs font-semibold uppercase tracking-wide transition-colors"
                    >
                      {label}
                      <ArrowUpDown className={`w-3 h-3 ${sortColumn === key ? 'text-[#7C3AED]' : 'text-[#333333]'}`} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center py-16 text-[#94A3B8] text-sm">
                    Loading sales-partners…
                  </td>
                </tr>
              )}

              {!loading && loadError && (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center py-16 text-[#EF4444] text-sm">
                    Couldn&apos;t load sales-partner data. Try refreshing the page.
                  </td>
                </tr>
              )}

              {!loading && !loadError && sortedRows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center py-16 text-[#94A3B8] text-sm">
                    No sales-partners yet.
                  </td>
                </tr>
              )}

              {!loading &&
                !loadError &&
                sortedRows.map((row) => (
                  <tr key={row.id} className="border-b border-[#1a1a1a] last:border-0 hover:bg-[#1A1A1A] transition-colors">
                    <td className="px-0 py-0">
                      <Link href={`/dashboard/admin/sales-partners/${row.id}`} className="flex px-4 py-3 text-white font-medium whitespace-nowrap">
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{row.client_count}</td>
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{row.team_count}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          row.status === 'active' ? 'bg-[#10B981]/20 text-[#10B981]' : 'bg-[#EF4444]/20 text-[#EF4444]'
                        }`}
                      >
                        {row.status === 'active' ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatDate(row.created_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
