'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, Loader2, CheckCircle2, Clock, XCircle, AlertTriangle, ChevronRight, FileText } from 'lucide-react'
import Link from 'next/link'
import { getFixStatusDisplay, type FixState, type TemplateStatus } from '../../fixStatus'

interface FixLogEntry {
  id: number
  template_name: string
  fix_cycle_id: string
  attempt_number: number | null
  event_type: string
  message: string
  actor: string | null
  created_at: string
}

interface Props {
  templateName: string
}

// TMPL-01 (requirement doc Section 4.2) — 5 automatic attempts per cycle.
// Purely a display constant here; the actual cap is enforced server-side by
// the fix-generator Inngest function.
const AUTO_RETRY_CAP = 5

const STATUS_ICONS = { check: CheckCircle2, clock: Clock, x: XCircle, loader: Loader2, alert: AlertTriangle } as const

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour12: false })
  } catch {
    return iso
  }
}

function LogLine({ entry }: { entry: FixLogEntry }) {
  return (
    <div className="flex gap-3 text-sm py-1.5">
      <span className="text-[#475569] shrink-0 font-mono text-xs pt-0.5">{formatTime(entry.created_at)}</span>
      <span className="text-[#94A3B8]">{entry.message}</span>
    </div>
  )
}

/**
 * TMPL-01 (requirement doc Section 4.3) — per-template Fix Progress view.
 * Reads GET /api/templates/library (for the row's status/fix_cycle_id and
 * viewerIsApprover — the progress endpoint itself does not return
 * viewerIsApprover, so this mirrors TemplateApprovalClient.tsx's own
 * approach rather than inventing a new auth signal) and
 * GET /api/templates/library/[templateName]/progress (for the log). Drives
 * the two nudge actions via POST .../nudge, then refetches both.
 */
export default function TemplateFixProgressClient({ templateName }: Props) {
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [viewerIsApprover, setViewerIsApprover] = useState(false)
  const [status, setStatus] = useState<TemplateStatus>('changes_requested')
  const [fixState, setFixState] = useState<FixState>('none')
  const [currentFixCycleId, setCurrentFixCycleId] = useState<string | null>(null)
  const [fixAttemptCount, setFixAttemptCount] = useState(0)
  const [fixLastActivityAt, setFixLastActivityAt] = useState<string | null>(null)
  const [fixFailureReason, setFixFailureReason] = useState<string | null>(null)
  const [fixChangesSummary, setFixChangesSummary] = useState<string | null>(null)
  const [log, setLog] = useState<FixLogEntry[]>([])
  const [previousCyclesExpanded, setPreviousCyclesExpanded] = useState(false)
  const [actioning, setActioning] = useState({ statusCheck: false, forceRetrigger: false })
  const [, forceTick] = useState(0)

  async function load() {
    setIsLoading(true)
    setLoadError(false)
    setNotFound(false)
    try {
      const [libRes, progressRes] = await Promise.all([
        fetch('/api/templates/library'),
        fetch(`/api/templates/library/${templateName}/progress`),
      ])
      if (!libRes.ok || !progressRes.ok) throw new Error('failed to load')
      const libData = await libRes.json()
      const progressData = await progressRes.json()

      const row = (libData.templates ?? []).find(
        (t: { template_name: string }) => t.template_name === templateName
      )
      if (!row) {
        setNotFound(true)
        return
      }

      setViewerIsApprover(!!libData.viewerIsApprover)
      setStatus(row.status)
      setCurrentFixCycleId(row.fix_cycle_id ?? null)
      setFixState(progressData.fixState ?? 'none')
      setFixAttemptCount(progressData.fixAttemptCount ?? 0)
      setFixLastActivityAt(progressData.fixLastActivityAt ?? null)
      setFixFailureReason(progressData.fixFailureReason ?? null)
      setFixChangesSummary(progressData.fixChangesSummary ?? null)
      setLog(progressData.log ?? [])
    } catch {
      setLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateName])

  // "Last update: X minutes ago" ticks forward client-side without a refetch.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 15000)
    return () => clearInterval(id)
  }, [])

  async function nudge(action: 'status_check' | 'force_retrigger') {
    const key = action === 'status_check' ? 'statusCheck' : 'forceRetrigger'
    setActioning((p) => ({ ...p, [key]: true }))
    try {
      await fetch(`/api/templates/library/${templateName}/nudge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      await load()
    } catch {
      /* non-fatal — user can retry */
    } finally {
      setActioning((p) => ({ ...p, [key]: false }))
    }
  }

  const display = getFixStatusDisplay(status, fixState)
  const StatusIcon = STATUS_ICONS[display.icon]

  // Group the log by fix_cycle_id: the row's current cycle (always shown,
  // expanded) vs. every older cycle (collapsed behind "Previous cycles (N)").
  // `log` arrives newest-first, so the Map's insertion order already puts the
  // most recently active previous cycle first.
  const currentCycleLog = log.filter((l) => l.fix_cycle_id === currentFixCycleId)
  const previousCyclesMap = new Map<string, FixLogEntry[]>()
  for (const entry of log) {
    if (entry.fix_cycle_id === currentFixCycleId) continue
    const arr = previousCyclesMap.get(entry.fix_cycle_id) ?? []
    arr.push(entry)
    previousCyclesMap.set(entry.fix_cycle_id, arr)
  }
  const previousCycleIds = Array.from(previousCyclesMap.keys())

  const buttonTooltip = !viewerIsApprover ? 'Only Arun can do this' : undefined
  const hasHistory = log.length > 0

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/dashboard/admin/templates"
          className="inline-flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Template Library
        </Link>
        <h1 className="text-white text-2xl font-bold">{templateName} — Fix Progress</h1>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-[#94A3B8]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading fix progress...
        </div>
      )}

      {!isLoading && (loadError || notFound) && (
        <div className="bg-[#111111] border border-[#EF4444]/30 rounded-xl p-12 text-center">
          <p className="text-[#EF4444] text-sm">Couldn&apos;t load fix progress. Refresh to try again.</p>
        </div>
      )}

      {!isLoading && !loadError && !notFound && !hasHistory && (
        <div className="bg-[#111111] border border-[#222222] rounded-xl p-12 text-center">
          <FileText className="w-10 h-10 text-[#333333] mx-auto mb-3" />
          <p className="text-[#94A3B8] text-sm">No fix cycles yet for this template.</p>
        </div>
      )}

      {!isLoading && !loadError && !notFound && hasHistory && (
        <div className="bg-[#111111] border border-[#222222] rounded-xl p-6">
          {/* Status line */}
          <div className="flex items-center gap-2 mb-1">
            <StatusIcon
              className={`w-4 h-4 ${display.icon === 'loader' ? 'animate-spin' : ''}`}
              style={{ color: display.color }}
            />
            <span className="text-white font-semibold">
              Status: {display.label}
              {fixState === 'generating' && ` (attempt ${fixAttemptCount} of ${AUTO_RETRY_CAP})`}
            </span>
          </div>
          <p className="text-[#475569] text-xs mb-6">
            Last update:{' '}
            {fixLastActivityAt ? formatDistanceToNow(new Date(fixLastActivityAt), { addSuffix: true }) : 'unknown'}
          </p>

          {fixState === 'failed' && fixFailureReason && (
            <div className="mb-6 rounded-lg border border-[#F97316]/30 bg-[#F97316]/10 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#F97316] mb-1">Failure reason</p>
              <p className="text-sm text-[#94A3B8]">{fixFailureReason}</p>
            </div>
          )}

          {fixState === 'none' && fixChangesSummary && (
            <div className="mb-6 rounded-lg border border-[#7C3AED]/30 bg-[#7C3AED]/10 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#A855F7] mb-1">
                Last successful fix
              </p>
              <p className="text-sm text-[#94A3B8]">{fixChangesSummary}</p>
            </div>
          )}

          {/* Current cycle */}
          <p className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8] mb-2">Current cycle</p>
          <div className="rounded-lg border border-[#222222] bg-[#0d0d0d] p-4 mb-6 divide-y divide-[#1a1a1a]">
            <AnimatePresence initial={false}>
              {currentCycleLog
                .slice()
                .reverse()
                .map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  >
                    <LogLine entry={entry} />
                  </motion.div>
                ))}
            </AnimatePresence>
            {currentCycleLog.length === 0 && (
              <p className="text-[#475569] text-sm py-1">No entries in the current cycle.</p>
            )}
          </div>

          {/* Nudge actions */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <button
              onClick={() => nudge('status_check')}
              disabled={!viewerIsApprover || actioning.statusCheck}
              title={buttonTooltip}
              className="flex items-center gap-1.5 px-4 py-2 bg-transparent border border-[#333333] hover:border-[#7C3AED] disabled:opacity-40 disabled:cursor-not-allowed text-[#94A3B8] hover:text-white text-sm font-medium rounded-lg transition-colors"
            >
              {actioning.statusCheck && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Check status now
            </button>
            <button
              onClick={() => nudge('force_retrigger')}
              disabled={!viewerIsApprover || actioning.forceRetrigger}
              title={buttonTooltip}
              className="flex items-center gap-1.5 px-4 py-2 bg-transparent border border-[#333333] hover:border-[#F59E0B] disabled:opacity-40 disabled:cursor-not-allowed text-[#94A3B8] hover:text-white text-sm font-medium rounded-lg transition-colors"
            >
              {actioning.forceRetrigger && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Force retrigger fix attempt
            </button>
          </div>

          {/* Previous cycles */}
          {previousCycleIds.length > 0 && (
            <div>
              <button
                onClick={() => setPreviousCyclesExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-[#94A3B8] hover:text-white text-sm transition-colors"
              >
                <ChevronRight
                  className={`w-3.5 h-3.5 transition-transform ${previousCyclesExpanded ? 'rotate-90' : ''}`}
                />
                Previous cycles ({previousCycleIds.length})
              </button>
              <AnimatePresence>
                {previousCyclesExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-lg border border-[#222222] bg-[#0d0d0d] p-4 mt-3">
                      {previousCycleIds.map((cycleId) => (
                        <div key={cycleId} className="mb-4 last:mb-0">
                          <p className="text-[10px] uppercase tracking-wider text-[#475569] mb-1">
                            Cycle {cycleId.slice(0, 8)}
                          </p>
                          <div className="divide-y divide-[#1a1a1a]">
                            {(previousCyclesMap.get(cycleId) ?? [])
                              .slice()
                              .reverse()
                              .map((entry) => (
                                <LogLine key={entry.id} entry={entry} />
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
