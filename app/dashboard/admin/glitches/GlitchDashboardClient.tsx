'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowUpDown, Plus, X } from 'lucide-react'
import Link from 'next/link'
import {
  VALID_TRANSITIONS,
  type GlitchIssueStatus,
} from '@/lib/glitches/issue-status'

/**
 * B2B-17 Requirement Doc §4 — the glitch surface, extended from a read-only 2-panel report into an
 * internal issue tracker. Preserves Panel 1 ("Glitch Patterns") byte-for-byte; extends Panel 2 ("All
 * Glitches") with status/issue affordances; adds Panel 3 ("Tracked Issues"), a Create Issue form, and
 * an Issue Detail view. Reuses the existing dark admin table aesthetic — no new design language.
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

type InheritedStatus = 'untriaged' | GlitchIssueStatus

const STATUS_LABELS: Record<InheritedStatus, string> = {
  untriaged: 'Untriaged',
  open: 'Open',
  investigating: 'Investigating',
  resolved: 'Resolved',
  wont_fix: "Won't fix",
}

// Section 5 badge colors (reusing the existing palette).
const STATUS_COLORS: Record<InheritedStatus, string> = {
  untriaged: '#475569',
  open: '#F59E0B',
  investigating: '#06B6D4',
  resolved: '#10B981',
  wont_fix: '#475569',
}

const ISSUE_STATUS_FILTERS: Array<{ value: '' | GlitchIssueStatus; label: string }> = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'wont_fix', label: "Won't fix" },
]

const PANEL2_STATUS_FILTERS: Array<{ value: '' | InheritedStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'untriaged', label: 'Untriaged' },
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'wont_fix', label: "Won't fix" },
]

const PURGE_NOTICE = '— purged (30-day retention window elapsed)'
const NEW_ISSUE_SENTINEL = '__new_issue__'

interface SummaryRow {
  glitch_type: GlitchType
  partner_account_id: string
  partner_name: string
  count: number
  first_seen: string
  last_seen: string
}

interface GlitchRow {
  id: string
  partner_session_id: string
  partner_account_id: string
  partner_name: string
  glitch_type: GlitchType
  description: string | null
  full_detail_purged: boolean
  extracted_at: string
  issue_id: string | null
  issue_title: string | null
  status: InheritedStatus
}

interface IssueRow {
  id: string
  title: string
  root_cause_summary: string | null
  status: GlitchIssueStatus
  created_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  instance_count: number
  last_activity: string
}

interface NoteRow {
  id: string
  body: string
  author_clerk_user_id: string | null
  created_at: string
}

interface AttachedInstance {
  id: string
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

function StatusBadge({ status }: { status: InheritedStatus }) {
  const color = STATUS_COLORS[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold"
      style={{ color }}
    >
      {status !== 'untriaged' && (
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      )}
      {STATUS_LABELS[status]}
    </span>
  )
}

export default function GlitchDashboardClient() {
  // ─── View mode ───────────────────────────────────────────────────────────────────────────────────
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null)

  // ─── Panel 1 — Glitch Patterns (unchanged) ────────────────────────────────────────────────────────
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(false)
  const [summarySortColumn, setSummarySortColumn] = useState<SummarySortColumn>('count')
  const [summarySortDirection, setSummarySortDirection] = useState<'asc' | 'desc'>('desc')

  // ─── Panel 2 — All Glitches ────────────────────────────────────────────────────────────────────────
  const [glitchRows, setGlitchRows] = useState<GlitchRow[]>([])
  const [glitchLoading, setGlitchLoading] = useState(true)
  const [glitchError, setGlitchError] = useState(false)
  const [partnerFilter, setPartnerFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  // ─── Panel 3 — Tracked Issues ──────────────────────────────────────────────────────────────────────
  const [allIssues, setAllIssues] = useState<IssueRow[]>([])
  const [issuesLoading, setIssuesLoading] = useState(true)
  const [issuesError, setIssuesError] = useState(false)
  const [issueStatusFilter, setIssueStatusFilter] = useState<'' | GlitchIssueStatus>('')

  // ─── Create Issue modal ────────────────────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false)
  const [seedInstance, setSeedInstance] = useState<GlitchRow | null>(null)

  // ─── Loaders ───────────────────────────────────────────────────────────────────────────────────────
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    setSummaryError(false)
    try {
      const res = await fetch('/api/admin/glitches/summary')
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setSummaryRows(data.summary ?? [])
    } catch {
      setSummaryError(true)
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  const loadGlitches = useCallback(async () => {
    setGlitchLoading(true)
    setGlitchError(false)
    try {
      const params = new URLSearchParams()
      if (partnerFilter) params.set('partner_account_id', partnerFilter)
      if (typeFilter) params.set('type', typeFilter)
      if (statusFilter) params.set('status', statusFilter)
      const qs = params.toString()
      const res = await fetch(`/api/admin/glitches${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setGlitchRows(data.glitches ?? [])
    } catch {
      setGlitchError(true)
    } finally {
      setGlitchLoading(false)
    }
  }, [partnerFilter, typeFilter, statusFilter])

  const loadIssues = useCallback(async () => {
    setIssuesLoading(true)
    setIssuesError(false)
    try {
      const res = await fetch('/api/admin/glitches/issues')
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setAllIssues(data.issues ?? [])
    } catch {
      setIssuesError(true)
    } finally {
      setIssuesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSummary()
    loadIssues()
  }, [loadSummary, loadIssues])

  useEffect(() => {
    loadGlitches()
  }, [loadGlitches])

  const sortedSummaryRows = useMemo(
    () => sortSummaryRows(summaryRows, summarySortColumn, summarySortDirection),
    [summaryRows, summarySortColumn, summarySortDirection]
  )

  const partnerOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of summaryRows) {
      if (!seen.has(row.partner_account_id)) seen.set(row.partner_account_id, row.partner_name)
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [summaryRows])

  // Issues that can receive an attach (non-terminal — "existing open issues", Section 4.B).
  const attachableIssues = useMemo(
    () => allIssues.filter((i) => i.status === 'open' || i.status === 'investigating'),
    [allIssues]
  )

  const visibleIssues = useMemo(
    () => (issueStatusFilter ? allIssues.filter((i) => i.status === issueStatusFilter) : allIssues),
    [allIssues, issueStatusFilter]
  )

  function handleSummarySort(column: SummarySortColumn) {
    if (column === summarySortColumn) {
      setSummarySortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSummarySortColumn(column)
      setSummarySortDirection('asc')
    }
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────────────────────────────
  async function attachInstanceToIssue(instanceId: string, issueId: string) {
    const res = await fetch(`/api/admin/glitches/issues/${issueId}/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_ids: [instanceId] }),
    })
    if (res.ok) {
      await Promise.all([loadGlitches(), loadIssues()])
    }
  }

  function openCreateForInstance(instance: GlitchRow) {
    setSeedInstance(instance)
    setShowCreate(true)
  }

  function handlePanel2AttachChange(row: GlitchRow, value: string) {
    if (!value) return
    if (value === NEW_ISSUE_SENTINEL) {
      openCreateForInstance(row)
      return
    }
    void attachInstanceToIssue(row.id, value)
  }

  // ─── Render: Issue Detail takes over the whole surface when open ────────────────────────────────────
  if (detailIssueId) {
    return (
      <IssueDetailView
        issueId={detailIssueId}
        onBack={() => setDetailIssueId(null)}
        onChanged={() => {
          void loadIssues()
          void loadGlitches()
        }}
      />
    )
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
            href="/dashboard/admin/clients"
            className="text-[#475569] hover:text-[#94A3B8] text-sm transition-colors"
          >
            Partner Billing →
          </Link>
        </div>
        <div className="flex items-center gap-3 mb-1">
          <AlertTriangle className="w-6 h-6 text-[#7C3AED]" />
          <h1 className="text-white text-2xl font-bold">Glitch Dashboard</h1>
        </div>
        <p className="text-[#94A3B8] text-sm">
          Every glitch captured across every partner and every session — grouped so recurring patterns surface immediately, and tracked to closure as issues.
        </p>
      </div>

      {/* Panel 1 — Glitch Patterns (unchanged) */}
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

      {/* Panel 3 — Tracked Issues */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white text-lg font-bold">Tracked Issues</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
              Status
              <select
                value={issueStatusFilter}
                onChange={(e) => setIssueStatusFilter(e.target.value as '' | GlitchIssueStatus)}
                className="bg-[#111111] border border-[#333333] text-white text-sm rounded-lg px-2 py-1.5 normal-case font-normal tracking-normal focus:outline-none focus:border-[#7C3AED]"
              >
                {ISSUE_STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                setSeedInstance(null)
                setShowCreate(true)
              }}
              className="inline-flex items-center gap-1.5 bg-[#7C3AED] hover:bg-[#A855F7] text-white text-sm font-semibold rounded-lg px-3 py-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New issue
            </button>
          </div>
        </div>

        <div className="bg-[#111111] border border-[#222222] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#222222]">
                  {['Title', 'Status', 'Instances', 'Created', 'Last activity'].map((label) => (
                    <th key={label} className="text-left px-4 py-3 whitespace-nowrap">
                      <span className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">{label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {issuesLoading && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-[#94A3B8] text-sm">
                      Loading…
                    </td>
                  </tr>
                )}

                {!issuesLoading && issuesError && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-[#EF4444] text-sm">
                      Couldn&apos;t load tracked issues. Try refreshing the page.
                    </td>
                  </tr>
                )}

                {!issuesLoading && !issuesError && visibleIssues.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-[#94A3B8] text-sm">
                      No tracked issues yet. Create one from a glitch in the log below, or with ＋ New issue.
                    </td>
                  </tr>
                )}

                {!issuesLoading &&
                  !issuesError &&
                  visibleIssues.map((issue) => (
                    <tr key={issue.id} className="border-b border-[#1a1a1a] last:border-0">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setDetailIssueId(issue.id)}
                          className="text-left text-white hover:text-[#A855F7] font-medium transition-colors"
                        >
                          {issue.title}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={issue.status} />
                      </td>
                      <td className="px-4 py-3 text-white whitespace-nowrap">{issue.instance_count}</td>
                      <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatDate(issue.created_at)}</td>
                      <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatDate(issue.last_activity)}</td>
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

        <div className="flex flex-wrap items-center gap-4 mb-3">
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

          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#111111] border border-[#333333] text-white text-sm rounded-lg px-2 py-1.5 normal-case font-normal tracking-normal focus:outline-none focus:border-[#7C3AED]"
            >
              {PANEL2_STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
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
                  {['Partner', 'Session', 'Type', 'Description', 'Status', 'Issue', 'Extracted at'].map((label) => (
                    <th key={label} className="text-left px-4 py-3 whitespace-nowrap">
                      <span className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">{label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {glitchLoading && (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-[#94A3B8] text-sm">
                      Loading…
                    </td>
                  </tr>
                )}

                {!glitchLoading && glitchError && (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-[#EF4444] text-sm">
                      Couldn&apos;t load glitch data. Try refreshing the page.
                    </td>
                  </tr>
                )}

                {!glitchLoading && !glitchError && glitchRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-[#94A3B8] text-sm">
                      No glitches recorded yet.
                    </td>
                  </tr>
                )}

                {!glitchLoading &&
                  !glitchError &&
                  glitchRows.map((row) => (
                    <tr key={row.id} className="border-b border-[#1a1a1a] last:border-0">
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
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.issue_id ? (
                          <button
                            onClick={() => setDetailIssueId(row.issue_id!)}
                            className="text-left text-[#A855F7] hover:text-white transition-colors"
                          >
                            {row.issue_title}
                          </button>
                        ) : (
                          <select
                            value=""
                            onChange={(e) => handlePanel2AttachChange(row, e.target.value)}
                            className="bg-[#111111] border border-[#333333] text-[#94A3B8] text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-[#7C3AED]"
                          >
                            <option value="">Attach…</option>
                            {attachableIssues.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.title}
                              </option>
                            ))}
                            <option value={NEW_ISSUE_SENTINEL}>＋ New issue…</option>
                          </select>
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

      {showCreate && (
        <CreateIssueModal
          seedInstance={seedInstance}
          onClose={() => {
            setShowCreate(false)
            setSeedInstance(null)
          }}
          onCreated={() => {
            setShowCreate(false)
            setSeedInstance(null)
            void loadIssues()
            void loadGlitches()
          }}
        />
      )}
    </div>
  )
}

// ─── Create Issue modal ──────────────────────────────────────────────────────────────────────────────

function CreateIssueModal({
  seedInstance,
  onClose,
  onCreated,
}: {
  seedInstance: GlitchRow | null
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const titleValid = title.trim().length >= 1 && title.trim().length <= 200

  async function submit() {
    if (!titleValid || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/glitches/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          root_cause_summary: rootCause.trim() ? rootCause.trim() : null,
          attach_instance_id: seedInstance?.id,
        }),
      })
      if (!res.ok) {
        setError("Couldn't create the issue. Please try again.")
        setSubmitting(false)
        return
      }
      onCreated()
    } catch {
      setError("Couldn't create the issue. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#111111] border border-[#333333] rounded-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white text-lg font-bold">New tracked issue</h3>
          <button onClick={onClose} className="text-[#475569] hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wide text-[#94A3B8] mb-1.5">
          Title <span className="text-[#EF4444]">*</span>
        </label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Bot mis-hears numeric ranges as dates"
          className="w-full bg-[#0A0A0A] border border-[#333333] text-white text-sm rounded-lg px-3 py-2 mb-1 focus:outline-none focus:border-[#7C3AED]"
        />
        {!titleValid && title.length > 0 && (
          <p className="text-[#EF4444] text-xs mb-2">Title must be between 1 and 200 characters.</p>
        )}

        <label className="block text-xs font-semibold uppercase tracking-wide text-[#94A3B8] mb-1.5 mt-4">
          Root cause summary (optional)
        </label>
        <textarea
          value={rootCause}
          onChange={(e) => setRootCause(e.target.value)}
          rows={4}
          className="w-full bg-[#0A0A0A] border border-[#333333] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#7C3AED] resize-y"
        />

        {seedInstance && (
          <p className="text-[#94A3B8] text-xs mt-3">
            Will attach: glitch{' '}
            <span className="font-mono">{shortSessionId(seedInstance.id)}</span>{' '}
            ({seedInstance.partner_name})
          </p>
        )}

        {error && <p className="text-[#EF4444] text-xs mt-3">{error}</p>}

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="text-[#94A3B8] hover:text-white text-sm px-3 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!titleValid || submitting}
            className="bg-[#7C3AED] hover:bg-[#A855F7] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg px-4 py-2 transition-colors"
          >
            {submitting ? 'Creating…' : 'Create issue'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Issue Detail view ───────────────────────────────────────────────────────────────────────────────

function IssueDetailView({
  issueId,
  onBack,
  onChanged,
}: {
  issueId: string
  onBack: () => void
  onChanged: () => void
}) {
  const [issue, setIssue] = useState<IssueRow | null>(null)
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [instances, setInstances] = useState<AttachedInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [titleDraft, setTitleDraft] = useState('')
  const [rootCauseDraft, setRootCauseDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [savingRootCause, setSavingRootCause] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [addingNote, setAddingNote] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/admin/glitches/issues/${issueId}`)
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setIssue(data.issue)
      setNotes(data.notes ?? [])
      setInstances(data.instances ?? [])
      setTitleDraft(data.issue.title)
      setRootCauseDraft(data.issue.root_cause_summary ?? '')
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [issueId])

  useEffect(() => {
    load()
  }, [load])

  async function patch(fields: Record<string, unknown>): Promise<boolean> {
    setActionError(null)
    const res = await fetch(`/api/admin/glitches/issues/${issueId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setActionError(body.error ?? "Couldn't save the change.")
      return false
    }
    return true
  }

  async function saveTitle() {
    if (!issue || savingTitle) return
    const trimmed = titleDraft.trim()
    if (trimmed.length < 1 || trimmed.length > 200) {
      setActionError('Title must be between 1 and 200 characters.')
      return
    }
    setSavingTitle(true)
    const ok = await patch({ title: trimmed })
    if (ok) {
      await load()
      onChanged()
    }
    setSavingTitle(false)
  }

  async function saveRootCause() {
    if (!issue || savingRootCause) return
    setSavingRootCause(true)
    const ok = await patch({ root_cause_summary: rootCauseDraft.trim() ? rootCauseDraft.trim() : null })
    if (ok) {
      await load()
      onChanged()
    }
    setSavingRootCause(false)
  }

  async function changeStatus(next: GlitchIssueStatus) {
    if (!issue || savingStatus || next === issue.status) return
    setSavingStatus(true)
    const ok = await patch({ status: next })
    if (ok) {
      await load()
      onChanged()
    }
    setSavingStatus(false)
  }

  async function addNote() {
    if (addingNote || noteDraft.trim().length < 1) return
    setAddingNote(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/glitches/issues/${issueId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteDraft.trim() }),
      })
      if (!res.ok) {
        setActionError("Couldn't add the note.")
      } else {
        setNoteDraft('')
        await load()
        onChanged()
      }
    } catch {
      setActionError("Couldn't add the note.")
    } finally {
      setAddingNote(false)
    }
  }

  async function detach(instanceId: string) {
    setActionError(null)
    const res = await fetch(`/api/admin/glitches/issues/${issueId}/detach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_ids: [instanceId] }),
    })
    if (res.ok) {
      await load()
      onChanged()
    } else {
      setActionError("Couldn't detach the instance.")
    }
  }

  const statusOptions = useMemo(() => {
    if (!issue) return []
    return [issue.status, ...VALID_TRANSITIONS[issue.status]]
  }, [issue])

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <BackLink onBack={onBack} />
        <div className="bg-[#111111] border border-[#222222] rounded-xl py-16 text-center text-[#94A3B8] text-sm">
          Loading…
        </div>
      </div>
    )
  }

  if (error || !issue) {
    return (
      <div className="max-w-4xl mx-auto">
        <BackLink onBack={onBack} />
        <div className="bg-[#111111] border border-[#222222] rounded-xl py-16 text-center text-[#EF4444] text-sm">
          Couldn&apos;t load this issue. Try refreshing the page.
        </div>
      </div>
    )
  }

  const titleDirty = titleDraft.trim() !== issue.title
  const rootCauseDirty = rootCauseDraft.trim() !== (issue.root_cause_summary ?? '')

  return (
    <div className="max-w-4xl mx-auto">
      <BackLink onBack={onBack} />

      {/* Header */}
      <div className="bg-[#111111] border border-[#222222] rounded-xl p-5 mb-6">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                maxLength={200}
                className="flex-1 bg-transparent text-white text-xl font-bold focus:outline-none focus:bg-[#0A0A0A] rounded px-1 py-0.5 border border-transparent focus:border-[#333333]"
              />
              {titleDirty && (
                <button
                  onClick={saveTitle}
                  disabled={savingTitle}
                  className="text-xs font-semibold text-[#7C3AED] hover:text-[#A855F7] disabled:opacity-40 whitespace-nowrap transition-colors"
                >
                  {savingTitle ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-[#475569]">Status</span>
            <select
              value={issue.status}
              onChange={(e) => changeStatus(e.target.value as GlitchIssueStatus)}
              disabled={savingStatus}
              className="bg-[#0A0A0A] border border-[#333333] text-white text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#7C3AED]"
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[#475569] text-xs">
          Created {formatDate(issue.created_at)} · Updated {formatDate(issue.updated_at)}
        </p>
      </div>

      {actionError && (
        <div className="mb-4 text-[#EF4444] text-sm bg-[#1a0e0e] border border-[#3a1a1a] rounded-lg px-4 py-2">
          {actionError}
        </div>
      )}

      {/* Root cause summary */}
      <div className="bg-[#111111] border border-[#222222] rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white text-sm font-bold uppercase tracking-wide">Root cause summary</h3>
          <button
            onClick={saveRootCause}
            disabled={!rootCauseDirty || savingRootCause}
            className="text-xs font-semibold text-[#7C3AED] hover:text-[#A855F7] disabled:opacity-40 transition-colors"
          >
            {savingRootCause ? 'Saving…' : 'Save'}
          </button>
        </div>
        <textarea
          value={rootCauseDraft}
          onChange={(e) => setRootCauseDraft(e.target.value)}
          rows={4}
          placeholder="The current best diagnosis…"
          className="w-full bg-[#0A0A0A] border border-[#333333] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#7C3AED] resize-y"
        />
      </div>

      {/* Investigation log */}
      <div className="bg-[#111111] border border-[#222222] rounded-xl p-5 mb-6">
        <h3 className="text-white text-sm font-bold uppercase tracking-wide mb-3">Investigation log</h3>
        <div className="flex items-start gap-2 mb-4">
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={2}
            maxLength={5000}
            placeholder="Add a note…"
            className="flex-1 bg-[#0A0A0A] border border-[#333333] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#7C3AED] resize-y"
          />
          <button
            onClick={addNote}
            disabled={addingNote || noteDraft.trim().length < 1}
            className="bg-[#7C3AED] hover:bg-[#A855F7] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg px-3 py-2 whitespace-nowrap transition-colors"
          >
            {addingNote ? 'Adding…' : 'Add note'}
          </button>
        </div>

        {notes.length === 0 ? (
          <p className="text-[#475569] text-sm">No notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="border-t border-[#1a1a1a] pt-3 first:border-0 first:pt-0">
                <p className="text-[#475569] text-xs mb-1">
                  {formatDateTime(note.created_at)}
                  {note.author_clerk_user_id ? ` · ${note.author_clerk_user_id}` : ''}
                </p>
                <p className="text-[#94A3B8] text-sm whitespace-pre-wrap">{note.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Attached instances */}
      <div className="bg-[#111111] border border-[#222222] rounded-xl overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="text-white text-sm font-bold uppercase tracking-wide">
            Attached glitch instances ({instances.length})
          </h3>
        </div>
        {instances.length === 0 ? (
          <p className="px-5 pb-5 text-[#475569] text-sm">
            No instances attached yet — attach them from the All Glitches panel.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-[#222222]">
                  {['Partner', 'Session', 'Type', 'Description', 'Extracted at', ''].map((label, i) => (
                    <th key={i} className="text-left px-4 py-3 whitespace-nowrap">
                      <span className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">{label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => (
                  <tr key={inst.id} className="border-b border-[#1a1a1a] last:border-0">
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{inst.partner_name}</td>
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap font-mono text-xs">
                      {shortSessionId(inst.partner_session_id)}
                    </td>
                    <td className="px-4 py-3 text-white whitespace-nowrap">{TYPE_LABELS[inst.glitch_type]}</td>
                    <td className="px-4 py-3 text-[#94A3B8]">
                      {inst.full_detail_purged ? (
                        <span className="italic text-[#475569]">{PURGE_NOTICE}</span>
                      ) : (
                        inst.description
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{formatDateTime(inst.extracted_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => detach(inst.id)}
                        className="text-[#475569] hover:text-[#EF4444] transition-colors"
                        title="Detach"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors mb-4"
    >
      <ArrowLeft className="w-4 h-4" />
      Back to Glitch Dashboard
    </button>
  )
}
