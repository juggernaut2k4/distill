'use client'

import { useEffect, useMemo, useState } from 'react'
import { CreditCard, ArrowLeft, ArrowUpDown } from 'lucide-react'
import Link from 'next/link'
import { sortByDaysRemaining, type DaysRemainingNullReason } from '@/lib/billing/sort'

/**
 * B2B-04 Requirement Doc Section 4.A / 5.A — the one real screen this brief
 * builds. Layout follows app/dashboard/admin/templates/page.tsx exactly
 * (DashboardShell + a client component doing the fetch/render) — no new
 * design system invented, per CLAUDE.md's instruction to reuse an
 * established visual precedent rather than flag/invent one.
 */

interface PartnerBillingRow {
  partner_account_id: string
  name: string
  tier: 'self_serve' | 'mid_market' | 'enterprise'
  status: 'active' | 'suspended'
  revenue_lifetime_usd: number
  revenue_current_period_usd: number
  balance_usd: number
  avg_daily_burn_usd: number | null
  projected_days_remaining: number | null
  days_remaining_null_reason: DaysRemainingNullReason
  next_billing_date: string | null
  payment_method_on_file: boolean
  payment_method_card_brand: string | null
  payment_method_card_last4: string | null
  payment_method_type: 'card' | 'us_bank_account' | null
}

const TIER_LABELS: Record<PartnerBillingRow['tier'], string> = {
  self_serve: 'Self-serve',
  mid_market: 'Mid-market',
  enterprise: 'Enterprise',
}

type SortColumn = 'name' | 'tier' | 'status' | 'revenue_lifetime_usd' | 'revenue_current_period_usd' | 'balance_usd' | 'days_remaining' | 'next_billing_date'

const COLUMNS: Array<{ key: SortColumn; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'tier', label: 'Tier' },
  { key: 'status', label: 'Status' },
  { key: 'revenue_lifetime_usd', label: 'Revenue (lifetime)' },
  { key: 'revenue_current_period_usd', label: 'Revenue (this period)' },
  { key: 'balance_usd', label: 'Balance' },
  { key: 'days_remaining', label: 'Days remaining' },
  { key: 'next_billing_date', label: 'Next billing date' },
]

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

function formatDaysRemaining(row: PartnerBillingRow): string {
  return row.projected_days_remaining === null ? '—' : row.projected_days_remaining.toFixed(1)
}

function formatNextBillingDate(row: PartnerBillingRow): string {
  if (row.next_billing_date) {
    return new Date(row.next_billing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return row.tier === 'enterprise' ? 'N/A — per contract' : 'N/A — pay-as-you-go'
}

function formatPaymentMethod(row: PartnerBillingRow): string {
  if (!row.payment_method_on_file) return 'No payment method on file'
  if (row.payment_method_type === 'us_bank_account') return 'Bank account (ACH)'
  const brand = row.payment_method_card_brand
    ? row.payment_method_card_brand.charAt(0).toUpperCase() + row.payment_method_card_brand.slice(1)
    : 'Card'
  return `${brand} •••• ${row.payment_method_card_last4 ?? '????'}`
}

/** Generic ascending/descending sort for every column except days_remaining, which always uses the shared sortByDaysRemaining comparator (architecture.md §13.6). */
function sortByGenericColumn(rows: PartnerBillingRow[], column: Exclude<SortColumn, 'days_remaining'>, direction: 'asc' | 'desc'): PartnerBillingRow[] {
  const sorted = [...rows].sort((a, b) => {
    let cmp: number
    switch (column) {
      case 'name':
      case 'tier':
      case 'status':
        cmp = a[column].localeCompare(b[column])
        break
      case 'next_billing_date':
        cmp = (a.next_billing_date ?? '').localeCompare(b.next_billing_date ?? '')
        break
      default:
        cmp = a[column] - b[column]
    }
    return direction === 'asc' ? cmp : -cmp
  })
  return sorted
}

export default function PartnerBillingClient() {
  const [rows, setRows] = useState<PartnerBillingRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [sortColumn, setSortColumn] = useState<SortColumn>('days_remaining')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [testBlockBusyId, setTestBlockBusyId] = useState<string | null>(null)

  /**
   * B2B-08 Requirement Doc Section 4.D / 10 — the only entry point for
   * POST /api/admin/billing/test-block until a full partner-self-serve
   * Configurator UI ships (out of scope here). Mirrors the busy-state /
   * fetch-then-redirect pattern already used by WizardClient.tsx's
   * startCheckout() for the sibling wallet-topup route.
   */
  async function purchaseTestBlock(partnerAccountId: string) {
    setTestBlockBusyId(partnerAccountId)
    try {
      const res = await fetch('/api/admin/billing/test-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: partnerAccountId }),
      })
      const data = await res.json()
      if (data.checkout_url) window.location.href = data.checkout_url
    } finally {
      setTestBlockBusyId(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(false)
      try {
        const res = await fetch('/api/admin/billing/clients')
        if (!res.ok) throw new Error('failed to load')
        const data = await res.json()
        if (!cancelled) setRows(data.clients ?? [])
      } catch {
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const sortedRows = useMemo(() => {
    if (sortColumn === 'days_remaining') {
      return sortByDaysRemaining(rows, sortDirection)
    }
    return sortByGenericColumn(rows, sortColumn, sortDirection)
  }, [rows, sortColumn, sortDirection])

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
          <Link
            href="/dashboard/admin/templates"
            className="text-[#475569] hover:text-[#94A3B8] text-sm transition-colors"
          >
            Template Library →
          </Link>
        </div>
        <div className="flex items-center gap-3 mb-1">
          <CreditCard className="w-6 h-6 text-[#7C3AED]" />
          <h1 className="text-white text-2xl font-bold">Partner Billing</h1>
        </div>
        <p className="text-[#94A3B8] text-sm">
          Every partner&apos;s wallet balance, burn rate, and payment status — sorted by days remaining so at-risk accounts surface first.
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
                <th className="text-left px-4 py-3 whitespace-nowrap">
                  <span className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">Payment</span>
                </th>
                <th className="text-left px-4 py-3 whitespace-nowrap">
                  <span className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">Test block</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="text-center py-16 text-[#94A3B8] text-sm">
                    Loading partner accounts…
                  </td>
                </tr>
              )}

              {!isLoading && loadError && (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="text-center py-16 text-[#EF4444] text-sm">
                    Couldn&apos;t load partner billing data. Try refreshing the page.
                  </td>
                </tr>
              )}

              {!isLoading && !loadError && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="text-center py-16 text-[#94A3B8] text-sm">
                    No partner accounts yet.
                  </td>
                </tr>
              )}

              {!isLoading &&
                !loadError &&
                sortedRows.map((row) => (
                  <tr key={row.partner_account_id} className="border-b border-[#1a1a1a] last:border-0">
                    <td className="px-4 py-3 text-white font-medium whitespace-nowrap">{row.name}</td>
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{TIER_LABELS[row.tier]}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          row.status === 'active' ? 'bg-[#10B981]/20 text-[#10B981]' : 'bg-[#EF4444]/20 text-[#EF4444]'
                        }`}
                      >
                        {row.status === 'active' ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatUsd(row.revenue_lifetime_usd)}</td>
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatUsd(row.revenue_current_period_usd)}</td>
                    <td className={`px-4 py-3 whitespace-nowrap font-medium ${row.balance_usd < 0 ? 'text-[#EF4444]' : 'text-white'}`}>
                      {formatUsd(row.balance_usd)}
                    </td>
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatDaysRemaining(row)}</td>
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatNextBillingDate(row)}</td>
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatPaymentMethod(row)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => purchaseTestBlock(row.partner_account_id)}
                        disabled={testBlockBusyId === row.partner_account_id}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-white hover:border-[#7C3AED] transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {testBlockBusyId === row.partner_account_id ? 'Starting…' : 'Purchase test block (2hr, $1.80)'}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
