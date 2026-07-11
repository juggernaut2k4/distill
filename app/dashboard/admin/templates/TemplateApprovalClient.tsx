'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Clock, CheckCircle2, XCircle, ArrowLeft, Loader2, FileText, Sparkles, AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'
import TemplateRenderer from '@/components/templates/TemplateRenderer'
import type { TemplateSection, TemplateMeta } from '@/lib/templates/types'
import type { StyleOverrides } from '@/lib/templates/styleOverrideSlots'
import { getFixStatusDisplay, hasFixHistory, type FixState } from './fixStatus'

interface TemplateLibraryRow {
  template_name: string
  display_name: string
  provenance: 'existing' | 'new'
  status: 'pending_review' | 'approved' | 'changes_requested'
  sample_data: Record<string, unknown>
  container_spec: Record<string, unknown>
  review_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  // TMPL-01 (requirement doc Section 6) — added by migration 067. Always
  // present on every row (fix_state defaults to 'none', style_overrides to
  // '{}') even for the 25 templates that never participate in the fix loop.
  fix_state: FixState
  style_overrides: StyleOverrides
  fix_changes_summary: string | null
  fix_failure_reason: string | null
  fix_attempt_count: number
  fix_cycle_id: string | null
  fix_last_activity_at: string | null
}

const FIX_STATUS_ICONS = { check: CheckCircle2, clock: Clock, x: XCircle, loader: Loader2, alert: AlertTriangle } as const

type StatusKey = 'pending_review' | 'approved' | 'changes_requested'

const STATUS_TABS: Array<{ key: StatusKey; label: string; icon: typeof Clock }> = [
  { key: 'pending_review', label: 'Pending Review', icon: Clock },
  { key: 'approved', label: 'Approved', icon: CheckCircle2 },
  { key: 'changes_requested', label: 'Changes Requested', icon: XCircle },
]

// Purpose blurbs for the templates called out specifically in the RTV-04
// requirement document (Section 4.2, Section 4.3 Screen state 1). All other
// existing templates fall back to a generic, accurate one-liner — this phase
// does not author bespoke marketing copy for all 25 pre-existing templates,
// only for the 2 genuinely new ones and the one documented special case
// (QuoteCallout's generic fallback).
const TEMPLATE_DESCRIPTIONS: Partial<Record<string, string>> = {
  Heatmap: 'Graduated intensity across a small grid — e.g. AI maturity by function.',
  Overlay: 'Up to 4 labeled zones of one whole concept — e.g. where AI fits in your stack.',
  QuoteCallout:
    'Currently renders via the generic fallback card — no dedicated visual design exists yet. Approving this means approving the generic card as shown, exactly as it renders live today.',
}

const FALLBACK_DESCRIPTION = 'Already renders live in production today — approving confirms the existing design.'

const PREVIEW_META: TemplateMeta = {
  subtopicTitle: 'Preview',
  sessionTitle: 'Template Library',
  userRole: '',
  userIndustry: '',
}

function buildPreviewSection(row: TemplateLibraryRow): TemplateSection {
  return {
    id: row.template_name,
    type: row.template_name,
    data: row.sample_data,
    meta: PREVIEW_META,
    status: 'ready',
  } as unknown as TemplateSection
}

export default function TemplateApprovalClient() {
  const [rows, setRows] = useState<TemplateLibraryRow[]>([])
  const [viewerIsApprover, setViewerIsApprover] = useState(false)
  const [activeTab, setActiveTab] = useState<StatusKey>('pending_review')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<'approve' | 'request_changes' | null>(null)
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})
  const [actioning, setActioning] = useState<Record<string, boolean>>({})

  async function load() {
    setIsLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/templates/library')
      if (!res.ok) throw new Error('failed to load')
      const data = await res.json()
      setRows(data.templates ?? [])
      setViewerIsApprover(!!data.viewerIsApprover)
    } catch {
      setLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function startAction(templateName: string, action: 'approve' | 'request_changes') {
    setConfirmingId(templateName)
    setPendingAction(action)
  }

  function cancelAction() {
    setConfirmingId(null)
    setPendingAction(null)
  }

  async function patchTemplate(templateName: string, body: Record<string, unknown>) {
    setActioning((p) => ({ ...p, [templateName]: true }))
    try {
      const res = await fetch(`/api/templates/library/${templateName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.template) {
        setRows((prev) => prev.map((r) => (r.template_name === templateName ? data.template : r)))
      }
    } catch {
      /* non-fatal — row stays in its previous tab, user can retry */
    } finally {
      setActioning((p) => ({ ...p, [templateName]: false }))
    }
  }

  async function confirmAction(templateName: string) {
    if (!pendingAction) return
    const notes = notesDraft[templateName]?.trim()
    await patchTemplate(templateName, { action: pendingAction, notes: notes || undefined })
    setConfirmingId(null)
    setPendingAction(null)
  }

  async function resetToPending(templateName: string) {
    await patchTemplate(templateName, { action: 'reset_to_pending' })
  }

  // TMPL-03 (Section 4.1) — single-click action, no confirmation dialog, no
  // notes field, matching resetToPending exactly. Arun's actual feedback is
  // left one step later via the existing, unmodified "Request changes" button
  // once the card reappears in the Pending Review tab (Section 6b).
  async function reopenForReview(templateName: string) {
    await patchTemplate(templateName, { action: 'reopen_for_review' })
  }

  const filtered = rows.filter((r) => r.status === activeTab)
  const counts: Record<StatusKey, number> = {
    pending_review: rows.filter((r) => r.status === 'pending_review').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    changes_requested: rows.filter((r) => r.status === 'changes_requested').length,
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
        <div className="flex items-center gap-3 mb-1">
          <Sparkles className="w-6 h-6 text-[#7C3AED]" />
          <h1 className="text-white text-2xl font-bold">Template Library — Design Approval</h1>
        </div>
        <p className="text-[#94A3B8] text-sm">
          Every visualization template needs an explicit sign-off before it can ever be used in a live session.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[#111111] border border-[#222222] rounded-xl p-1">
        {STATUS_TABS.map(({ key, label, icon: Icon }) => {
          const isActive = activeTab === key
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-[#1a1a1a] text-white border border-[#333333]' : 'text-[#475569] hover:text-[#94A3B8]'
              }`}
            >
              <Icon size={14} />
              <span>{label}</span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  key === 'pending_review' ? 'bg-[#F59E0B]/20 text-[#F59E0B]' : 'bg-[#333333] text-[#94A3B8]'
                }`}
              >
                {counts[key]}
              </span>
            </button>
          )
        })}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-[#94A3B8]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading templates...
        </div>
      )}

      {!isLoading && loadError && (
        <div className="bg-[#111111] border border-[#EF4444]/30 rounded-xl p-12 text-center">
          <p className="text-[#EF4444] text-sm">Couldn&apos;t load the template library. Refresh to try again.</p>
        </div>
      )}

      {!isLoading && !loadError && rows.length === 0 && (
        <div className="bg-[#111111] border border-[#222222] rounded-xl p-12 text-center">
          <FileText className="w-10 h-10 text-[#333333] mx-auto mb-3" />
          <p className="text-[#94A3B8] text-sm">No templates found. Run the RTV-04 seed migration.</p>
        </div>
      )}

      {!isLoading && !loadError && rows.length > 0 && filtered.length === 0 && (
        <div className="bg-[#111111] border border-[#222222] rounded-xl p-12 text-center">
          <FileText className="w-10 h-10 text-[#333333] mx-auto mb-3" />
          <p className="text-[#94A3B8] text-sm">No templates in this tab yet.</p>
        </div>
      )}

      {/* Cards */}
      <div className="space-y-6">
        <AnimatePresence>
          {filtered.map((row, i) => {
            const isActioning = actioning[row.template_name]
            const isConfirming = confirmingId === row.template_name
            const disabledForNonApprover = !viewerIsApprover || isActioning

            // TMPL-01 (Section 4.2) — the per-card status "bulb."
            const fixDisplay = getFixStatusDisplay(row.status, row.fix_state)
            const FixIcon = FIX_STATUS_ICONS[fixDisplay.icon]
            const showFixHistoryLink = hasFixHistory(row)
            const fixInFlightOrFailed = row.fix_state === 'generating' || row.fix_state === 'failed'

            return (
              <motion.div
                key={row.template_name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.25, delay: i * 0.03 }}
                className="bg-[#111111] border border-[#222222] rounded-xl overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* TMPL-01 Section 4.2 — glanceable status dot, doesn't require reading text */}
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: fixDisplay.color }}
                        title={fixDisplay.label}
                        aria-label={fixDisplay.label}
                      />
                      <h3 className="text-white text-lg font-bold">{row.display_name}</h3>
                      {row.provenance === 'new' && (
                        <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/30">
                          New
                        </span>
                      )}
                      {row.template_name === 'QuoteCallout' && (
                        <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/30">
                          Existing — Generic
                        </span>
                      )}
                    </div>
                    {row.status === 'approved' && row.reviewed_by && (
                      <span className="text-xs text-[#10B981] shrink-0">
                        Approved by {row.reviewed_by}
                        {row.reviewed_at ? ` on ${new Date(row.reviewed_at).toLocaleDateString()}` : ''}
                      </span>
                    )}
                    {row.status === 'changes_requested' && row.reviewed_by && (
                      <span className="text-xs text-[#EF4444] shrink-0">
                        Changes requested by {row.reviewed_by}
                        {row.reviewed_at ? ` on ${new Date(row.reviewed_at).toLocaleDateString()}` : ''}
                      </span>
                    )}
                  </div>

                  <p className="text-[#94A3B8] text-sm mb-3">
                    {TEMPLATE_DESCRIPTIONS[row.template_name] ?? FALLBACK_DESCRIPTION}
                  </p>

                  {/* TMPL-01 Section 4.2 — "Generating fix…" / "Fix failed — needs attention." label line */}
                  {(row.fix_state === 'generating' || row.fix_state === 'failed') && (
                    <div className="flex items-center gap-1.5 mb-3" style={{ color: fixDisplay.color }}>
                      <FixIcon className={`w-3.5 h-3.5 ${row.fix_state === 'generating' ? 'animate-spin' : ''}`} />
                      <span className="text-xs font-semibold">{fixDisplay.label}</span>
                    </div>
                  )}

                  {row.review_notes && (
                    <p className="text-[#94A3B8] text-xs italic mb-4">&ldquo;{row.review_notes}&rdquo;</p>
                  )}

                  {/* TMPL-01 acceptance criteria — fix_changes_summary visible on the Pending Review card */}
                  {row.status === 'pending_review' && row.fix_changes_summary && (
                    <div className="mb-4 rounded-lg border border-[#7C3AED]/30 bg-[#7C3AED]/10 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#A855F7] mb-1">
                        Automated fix applied
                      </p>
                      <p className="text-sm text-[#94A3B8]">{row.fix_changes_summary}</p>
                    </div>
                  )}

                  {/* Live-rendered preview — the real TemplateRenderer with frozen sample data */}
                  <div className="relative rounded-xl border border-[#222222] overflow-hidden mb-4 bg-[#080808]" style={{ height: 520 }}>
                    <TemplateRenderer
                      section={buildPreviewSection(row)}
                      isActive
                      styleOverrides={row.style_overrides}
                    />
                  </div>

                  {/* Actions */}
                  {row.status === 'pending_review' && !isConfirming && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => startAction(row.template_name, 'approve')}
                        disabled={disabledForNonApprover}
                        title={!viewerIsApprover ? 'Only the configured approver can approve templates' : undefined}
                        className="flex items-center gap-1.5 px-4 py-2 bg-[#10B981] hover:bg-[#059669] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approve for production
                      </button>
                      <button
                        onClick={() => startAction(row.template_name, 'request_changes')}
                        disabled={disabledForNonApprover}
                        title={!viewerIsApprover ? 'Only the configured approver can request changes' : undefined}
                        className="flex items-center gap-1.5 px-4 py-2 bg-transparent border border-[#333333] hover:border-[#EF4444] hover:text-[#EF4444] disabled:opacity-40 disabled:cursor-not-allowed text-[#94A3B8] text-sm font-medium rounded-lg transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Request changes
                      </button>
                    </div>
                  )}

                  {row.status === 'pending_review' && isConfirming && (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={notesDraft[row.template_name] ?? ''}
                        onChange={(e) => setNotesDraft((p) => ({ ...p, [row.template_name]: e.target.value }))}
                        placeholder={
                          pendingAction === 'approve'
                            ? 'Optional note: why this looks right, e.g. "Clean, on-brand."'
                            : 'What needs to change?'
                        }
                        rows={2}
                        className="bg-[#0d0d0d] border border-[#333333] focus:border-[#7C3AED] outline-none rounded-lg px-3 py-2 text-white text-sm placeholder:text-[#333333] resize-none transition-colors"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => confirmAction(row.template_name)}
                          disabled={isActioning}
                          className="flex items-center gap-1.5 px-4 py-2 bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          {isActioning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          {pendingAction === 'approve' ? 'Confirm approval' : 'Confirm request'}
                        </button>
                        <button
                          onClick={cancelAction}
                          disabled={isActioning}
                          className="px-4 py-2 text-[#94A3B8] hover:text-white text-sm transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {row.status === 'changes_requested' && (
                    <button
                      onClick={() => resetToPending(row.template_name)}
                      disabled={disabledForNonApprover}
                      title={!viewerIsApprover ? 'Only the configured approver can change template status' : undefined}
                      className="flex items-center gap-1.5 px-4 py-2 bg-transparent border border-[#333333] hover:border-[#7C3AED] disabled:opacity-40 disabled:cursor-not-allowed text-[#94A3B8] hover:text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {isActioning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Move back to Pending Review
                    </button>
                  )}

                  {/* TMPL-03 (Section 4.1) — single-click, no confirmation, no notes
                      field, matching "Move back to Pending Review" exactly. */}
                  {row.status === 'approved' && (
                    <button
                      onClick={() => reopenForReview(row.template_name)}
                      disabled={disabledForNonApprover}
                      title={!viewerIsApprover ? 'Only the configured approver can reopen templates' : undefined}
                      className="flex items-center gap-1.5 px-4 py-2 bg-transparent border border-[#333333] hover:border-[#7C3AED] disabled:opacity-40 disabled:cursor-not-allowed text-[#94A3B8] hover:text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {isActioning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Reopen for review
                    </button>
                  )}

                  {/* TMPL-01 Section 4.3 — entry point to the Fix Progress view. Only
                      shown once this template has at least one fix cycle; visually
                      emphasized while a fix is generating/failed. */}
                  {showFixHistoryLink && (
                    <Link
                      href={`/dashboard/admin/templates/${row.template_name}/progress`}
                      className="inline-block text-xs mt-3 transition-colors hover:underline"
                      style={{ color: fixInFlightOrFailed ? fixDisplay.color : '#475569' }}
                    >
                      View fix progress →
                    </Link>
                  )}
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
