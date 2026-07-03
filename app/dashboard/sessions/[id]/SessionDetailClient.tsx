'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@clerk/nextjs'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  ArrowLeft, CalendarDays, Clock, Download, Tag, CheckCircle,
  Circle, XCircle, Loader, Video, StopCircle, ExternalLink, Sparkles, EyeOff, Eye,
  MessageSquare, BookmarkPlus, Copy, AlertTriangle, Timer, ChevronDown, ChevronRight,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { SessionPlan } from '@/lib/session-plan'
import type { TrainingScript } from '@/lib/content/script-generator'

interface DeferredQuestion {
  question: string
  deferred_at: string
}

interface SubSessionRecord {
  title: string
  type: string
  duration_mins: number
  learning_objective: string
}

interface Session {
  id: string
  session_index: number
  session_title: string | null
  scheduled_at: string | null
  status: string
  topics: string[] | null
  topic_id: string | null
  duration_mins: number
  session_plan: SessionPlan | null
  deferred_questions: DeferredQuestion[] | null
  meeting_url: string | null
  curriculum_session_id: string | null
  sub_sessions: SubSessionRecord[] | null
}

type BotStatus = 'idle' | 'joining' | 'active' | 'ending'

interface Props {
  session: Session
  minutesBalance: number
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  scheduled:  {
    label: 'Scheduled',
    icon: <Circle size={16} />,
    color: '#94A3B8', bg: 'rgba(148,163,184,0.08)', border: '#333333',
  },
  active:     {
    label: 'In Progress',
    icon: <Loader size={16} className="animate-spin" />,
    color: '#06B6D4', bg: 'rgba(6,182,212,0.1)', border: '#164E63',
  },
  completed:  {
    label: 'Completed',
    icon: <CheckCircle size={16} />,
    color: '#10B981', bg: 'rgba(16,185,129,0.1)', border: '#064E3B',
  },
  cancelled:  {
    label: 'Cancelled',
    icon: <XCircle size={16} />,
    color: '#EF4444', bg: 'rgba(239,68,68,0.1)', border: '#7F1D1D',
  },
}

function formatFullDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function StatusDot({ status }: { status: string }) {
  if (status === 'ready')
    return <div className="w-2.5 h-2.5 rounded-full bg-[#10B981] flex-shrink-0" title="Complete" />
  if (status === 'generating')
    return <div className="w-2.5 h-2.5 rounded-full bg-[#F59E0B] animate-pulse flex-shrink-0" title="In progress" />
  if (status === 'failed')
    return <div className="w-2.5 h-2.5 rounded-full bg-[#EF4444] flex-shrink-0" title="Error" />
  return <div className="w-2.5 h-2.5 rounded-full border border-[#333333] flex-shrink-0" title="Not started" />
}

export default function SessionDetailClient({ session, minutesBalance }: Props) {
  const title = session.session_title ?? `Session ${session.session_index}`
  const status = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.scheduled
  const topics = session.topics ?? []
  const { user } = useUser()

  // Curriculum sessions (created via plan approval) use sub_sessions JSONB + topic_content_cache.
  // They do NOT use the old session_plan / generate-plan visual pipeline.
  const isCurriculumSession = !!session.curriculum_session_id

  // Session plan state — polls until all visuals are ready (old-style sessions only)
  const [sessionPlan, setSessionPlan] = useState<SessionPlan | null>(session.session_plan)
  const planFetchFailures = useRef(0)

  const fetchPlan = useCallback(async () => {
    const res = await fetch(`/api/sessions/${session.id}/generate-plan`)
    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || ++planFetchFailures.current >= 3) {
        // Force the plan into a terminal state so the interval clears
        setSessionPlan((prev) => prev ? { ...prev, plan_status: 'failed' } : prev)
      }
      return
    }
    planFetchFailures.current = 0
    const data = await res.json() as { session_plan: SessionPlan | null }
    if (data.session_plan) setSessionPlan(data.session_plan)
  }, [session.id])

  const triggerGeneration = useCallback(() => {
    fetch(`/api/sessions/${session.id}/generate-plan`, { method: 'POST' }).catch(() => {})
  }, [session.id])

  // Trigger generation if no plan exists; poll until complete or failed.
  // Skip entirely for curriculum sessions — they don't use the session_plan pipeline.
  useEffect(() => {
    if (isCurriculumSession) return
    if (!sessionPlan) {
      triggerGeneration()
    }
    if (sessionPlan?.plan_status === 'ready' || sessionPlan?.plan_status === 'failed') return
    const interval = setInterval(fetchPlan, 4000)
    return () => clearInterval(interval)
  }, [isCurriculumSession, session.id, sessionPlan, fetchPlan, triggerGeneration])

  // ── Content pipeline state ──────────────────────────────────────────────────
  // ContentSubSession: one tab (sub-session) in the content pipeline
  // (stored as sessions.sub_sessions in DB — TERM-01 Phase 2 complete)
  interface ContentSubSession {
    title: string
    slug: string
    pipeline_status: string
    training_script: TrainingScript | null
    content_outline: { content_summary?: string; key_concepts?: string[]; builds_on?: string[] } | null
    template_type: string | null
  }

  const [contentStatus, setContentStatus] = useState<'pending' | 'generating' | 'ready' | 'failed'>('pending')
  const [contentSubSessions, setContentSubSessions] = useState<ContentSubSession[]>([])
  const [isGeneratingContent, setIsGeneratingContent] = useState(false)
  const [expandedScript, setExpandedScript] = useState<string | null>(null)
  const [contentGenStartedAt, setContentGenStartedAt] = useState<number | null>(null)
  const [isStuck, setIsStuck] = useState(false)

  const isInitialLoadRef = useRef(true)
  const contentFetchFailures = useRef(0)

  const fetchContentStatus = useCallback(async () => {
    const res = await fetch(`/api/sessions/${session.id}/generate-content`)
    if (!res.ok) {
      // Stop polling on auth failure or after 3 consecutive errors
      if (res.status === 401 || res.status === 403 || ++contentFetchFailures.current >= 3) {
        setContentStatus('failed')
        setIsGeneratingContent(false)
      }
      return
    }
    contentFetchFailures.current = 0
    const data = await res.json() as { content_status: string; sub_sessions: ContentSubSession[] }
    const status = data.content_status as typeof contentStatus

    // If page loads and DB already has 'generating', only treat it as stuck
    // if there is zero subtopic progress — indicating a dead prior run.
    // If any subtopics are already ready/generating, the Inngest job is still
    // active and we should keep polling rather than showing "interrupted".
    if (isInitialLoadRef.current && status === 'generating') {
      isInitialLoadRef.current = false
      const hasProgress = (data.sub_sessions ?? []).some(
        (s: { pipeline_status: string }) => s.pipeline_status === 'ready' || s.pipeline_status === 'generating'
      )
      if (!hasProgress) {
        setContentStatus('failed')
        setContentSubSessions(data.sub_sessions ?? [])
        return
      }
      // Active generation in progress — fall through to normal polling
    } else {
      isInitialLoadRef.current = false
    }

    setContentStatus(status)
    setContentSubSessions(data.sub_sessions ?? [])
    if (status === 'ready' || status === 'failed') {
      setIsGeneratingContent(false)
      setContentGenStartedAt(null)
      setIsStuck(false)
    }
  }, [session.id])

  // Initial load + poll every 3s while generating
  useEffect(() => {
    fetchContentStatus()
  }, [fetchContentStatus])

  useEffect(() => {
    if (contentStatus !== 'generating') return
    const interval = setInterval(fetchContentStatus, 3000)
    return () => clearInterval(interval)
  }, [contentStatus, fetchContentStatus])

  // Stuck detection: if still generating after 3 minutes with no topics ready, surface error
  useEffect(() => {
    if (!contentGenStartedAt || contentStatus !== 'generating') return
    const check = setInterval(() => {
      const elapsed = Date.now() - contentGenStartedAt
      const readyCount = contentSubSessions.filter((s) => s.pipeline_status === 'ready').length
      if (elapsed > 3 * 60 * 1000 && readyCount === 0) {
        setIsStuck(true)
      }
    }, 15000)
    return () => clearInterval(check)
  }, [contentGenStartedAt, contentStatus, contentSubSessions])

  const handleGenerateContent = useCallback(() => {
    setIsGeneratingContent(true)
    setContentStatus('generating')
    setContentGenStartedAt(Date.now())
    setIsStuck(false)
    // Fire-and-forget — the pipeline runs up to 5 min server-side;
    // polling every 3s picks up per-topic progress as each row is written.
    fetch(`/api/sessions/${session.id}/generate-content`, { method: 'POST' }).catch(() => {})
  }, [session.id])

  const handleRetryContent = useCallback(() => {
    setIsStuck(false)
    setIsGeneratingContent(false)
    setContentGenStartedAt(null)
    // Reset DB status then immediately kick off a fresh generation
    fetch(`/api/sessions/${session.id}/generate-content`, { method: 'DELETE' })
      .catch(() => {})
      .finally(() => {
        setContentStatus('generating')
        setContentGenStartedAt(Date.now())
        fetch(`/api/sessions/${session.id}/generate-content`, { method: 'POST' }).catch(() => {})
      })
  }, [session.id])

  // Auto-trigger content generation once all visual slots are settled (old-style sessions only).
  // Curriculum sessions skip this — Inngest fires their content pipeline on approval.
  const allVisualsSettled = !isCurriculumSession &&
    !!sessionPlan &&
    sessionPlan.sub_sessions.length > 0 &&
    sessionPlan.sub_sessions.every((s) => s.skipped || s.visual_status === 'ready' || s.visual_status === 'failed')

  useEffect(() => {
    if (allVisualsSettled && contentStatus === 'pending' && !isGeneratingContent) {
      handleGenerateContent()
    }
  }, [allVisualsSettled, contentStatus, isGeneratingContent, handleGenerateContent])

  // Merge visual-phase sub-sessions with script-phase sub-sessions into one list
  const mergedSubtopics = (sessionPlan?.sub_sessions ?? []).map((sub) => {
    const contentSub = contentSubSessions.find((c) => c.title === sub.title)
    return {
      id: sub.id,
      title: sub.title,
      skipped: sub.skipped,
      visualStatus: sub.visual_status as string,
      scriptStatus: contentSub?.pipeline_status ?? 'pending',
      slug: contentSub?.slug ?? sub.id,
      training_script: contentSub?.training_script ?? null,
      content_outline: contentSub?.content_outline ?? null,
    }
  })

  // Live session state — pre-fill from auto-generated Meet link if available
  const [meetingUrl, setMeetingUrl] = useState(session.meeting_url ?? '')
  const [resolvedMeetUrl, setResolvedMeetUrl] = useState<string | null>(session.meeting_url)
  const [meetLinkTimedOut, setMeetLinkTimedOut] = useState(false)

  // Poll for Meet link for up to 30s. If not created by then (e.g. Google credentials
  // not configured), fall back to a manual input so the user isn't stuck spinning.
  useEffect(() => {
    if (resolvedMeetUrl) return
    let polls = 0
    const poll = setInterval(async () => {
      polls++
      if (polls > 10) {
        clearInterval(poll)
        setMeetLinkTimedOut(true)
        return
      }
      try {
        const res = await fetch(`/api/sessions/${session.id}`)
        if (!res.ok) return
        const data = await res.json() as { session?: { meeting_url?: string } }
        const url = data?.session?.meeting_url
        if (url) {
          setResolvedMeetUrl(url)
          setMeetingUrl(url)
          clearInterval(poll)
        }
      } catch { /* non-fatal */ }
    }, 3000)
    return () => clearInterval(poll)
  }, [session.id, resolvedMeetUrl])
  const [botStatus, setBotStatus] = useState<BotStatus>('idle')
  const [botId, setBotId] = useState<string | null>(null)
  const [botError, setBotError] = useState<string | null>(null)
  // Guards against a click landing on the End Session button in the same
  // click sequence that launched the bot. Root cause: Launch and End render
  // in the same DOM slot and swap the instant botStatus flips 'joining' →
  // 'active'; a single mousedown(Launch)/mouseup(End) pair (or a fast
  // double-click at the same screen position) can register as an End click
  // before the user ever sees the End button. Confirmed in production logs:
  // POST /api/recall/bot → Attendee join_requested → DELETE /api/recall/bot
  // (leave_requested, event_sub_type: user_requested) within <1s, repeatedly.
  const activeSinceRef = useRef<number>(0)
  const END_SESSION_GUARD_MS = 1500

  // Session timer state
  const [timerSecondsLeft, setTimerSecondsLeft] = useState<number | null>(null)
  const [timerWarning, setTimerWarning] = useState(false)  // true when ≤ 2 min left
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Public URL — no auth, accessible by Recall.ai headless browser
  const walkthroughUrl = user?.id
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/walkthrough/${user.id}`
    : ''

  function startTimer(durationMins: number) {
    const totalSeconds = durationMins * 60
    setTimerSecondsLeft(totalSeconds)
    setTimerWarning(false)

    timerRef.current = setInterval(() => {
      setTimerSecondsLeft((prev) => {
        if (prev === null || prev <= 0) return 0
        const next = prev - 1
        if (next <= 120) setTimerWarning(true)
        return next
      })
    }, 1000)
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setTimerSecondsLeft(null)
    setTimerWarning(false)
  }

  // Auto-end when timer hits zero
  useEffect(() => {
    if (timerSecondsLeft === 0 && botStatus === 'active') {
      handleEndSession()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerSecondsLeft, botStatus])

  // Clean up timer on unmount
  useEffect(() => () => stopTimer(), [])

  async function handleLaunchBot() {
    if (!meetingUrl.trim()) return
    setBotStatus('joining')
    setBotError(null)

    // Check minutes balance and record session start
    let effectiveDurationMins = session.duration_mins
    try {
      const startRes = await fetch(`/api/sessions/${session.id}/start`, { method: 'POST' })
      const startData = (await startRes.json()) as { effectiveDurationMins?: number; error?: string }
      if (!startRes.ok) {
        setBotError(startData.error ?? 'Could not start session — check your minutes balance')
        setBotStatus('idle')
        return
      }
      effectiveDurationMins = startData.effectiveDurationMins ?? session.duration_mins
    } catch {
      setBotError('Network error — please try again')
      setBotStatus('idle')
      return
    }

    const skippedTopics = sessionPlan?.sub_sessions.filter((s) => s.skipped).map((s) => s.title) ?? []
    try {
      const res = await fetch('/api/recall/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingUrl: meetingUrl.trim(), sessionId: session.id, skippedTopics }),
      })
      const data = (await res.json()) as { botId?: string; error?: string }
      if (!res.ok || !data.botId) {
        setBotError(data.error ?? 'Failed to launch bot')
        setBotStatus('idle')
        return
      }
      setBotId(data.botId)
      activeSinceRef.current = Date.now()
      setBotStatus('active')
      startTimer(effectiveDurationMins)
    } catch {
      setBotError('Network error — please try again')
      setBotStatus('idle')
    }
  }

  async function handleEndSession() {
    if (!botId && botStatus !== 'active') return
    // See activeSinceRef comment above — swallow End clicks that land within
    // the guard window of the bot going active; these are click-swap
    // artifacts from the Launch→End DOM swap, never an intentional end.
    if (Date.now() - activeSinceRef.current < END_SESSION_GUARD_MS) {
      console.warn('[SessionDetail] Ignored End Session click within guard window (likely click-swap artifact)')
      return
    }
    setBotStatus('ending')
    stopTimer()

    // Remove bot from meeting
    if (botId) {
      try {
        await fetch('/api/recall/bot', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botId }),
        })
      } catch {
        // Non-fatal
      }
    }

    // Record session end and deduct minutes
    try {
      await fetch(`/api/sessions/${session.id}/end`, { method: 'POST' })
    } catch {
      // Non-fatal — balance will reconcile on next load
    }

    setBotId(null)
    setBotStatus('idle')
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Back */}
      <Link
        href="/dashboard/sessions"
        className="inline-flex items-center gap-2 text-sm text-[#475569] hover:text-[#94A3B8] transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Sessions
      </Link>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0 mt-1">
            <span className="text-sm font-bold text-[#A855F7]">{session.session_index}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-white leading-tight">{title}</h1>

            {/* Status pill */}
            <div
              className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-xs font-semibold border"
              style={{ color: status.color, background: status.bg, borderColor: status.border }}
            >
              {status.icon}
              {status.label}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Details card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="divide-y divide-[#1A1A1A]">
          {/* Date */}
          {session.scheduled_at && (
            <div className="flex items-center gap-3 p-4">
              <CalendarDays size={16} className="text-[#7C3AED] flex-shrink-0" />
              <div>
                <p className="text-xs text-[#475569] mb-0.5">Scheduled for</p>
                <p className="text-sm font-semibold text-white">{formatFullDate(session.scheduled_at)}</p>
                <p className="text-xs text-[#94A3B8] mt-0.5">{formatTime(session.scheduled_at)}</p>
              </div>
            </div>
          )}

          {/* Duration */}
          <div className="flex items-center gap-3 p-4">
            <Clock size={16} className="text-[#06B6D4] flex-shrink-0" />
            <div>
              <p className="text-xs text-[#475569] mb-0.5">Duration</p>
              <p className="text-sm font-semibold text-white">~{session.duration_mins} minutes</p>
            </div>
          </div>

          {/* Google Meet link */}
          {resolvedMeetUrl ? (
            <div className="flex items-center gap-3 p-4">
              <Video size={16} className="text-[#10B981] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#475569] mb-0.5">Google Meet</p>
                <p className="text-sm font-mono text-[#10B981] truncate">{resolvedMeetUrl}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => navigator.clipboard.writeText(resolvedMeetUrl)}
                  title="Copy link"
                  className="text-[#475569] hover:text-[#94A3B8] transition-colors"
                >
                  <Copy size={14} />
                </button>
                <a
                  href={resolvedMeetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#475569] hover:text-[#94A3B8] transition-colors"
                  title="Open Meet"
                >
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          ) : meetLinkTimedOut ? (
            <div className="flex items-start gap-3 p-4">
              <Video size={16} className="text-[#475569] flex-shrink-0 mt-2" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#475569] mb-1.5">Google Meet — paste your meeting link</p>
                <input
                  type="url"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="https://meet.google.com/xxx-xxxx-xxx"
                  className="w-full bg-[#111111] border border-[#333333] focus:border-[#7C3AED] outline-none rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#475569] transition-colors"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4">
              <Video size={16} className="text-[#475569] flex-shrink-0" />
              <div>
                <p className="text-xs text-[#475569] mb-0.5">Google Meet</p>
                <p className="text-sm text-[#475569] flex items-center gap-1.5">
                  <Loader size={11} className="animate-spin" /> Creating meeting link...
                </p>
              </div>
            </div>
          )}

          {/* Topics */}
          {topics.length > 0 && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Tag size={14} className="text-[#F59E0B]" />
                <p className="text-xs text-[#475569]">Topics covered</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {topics.map((topic, i) => (
                  <span
                    key={i}
                    className="text-xs px-3 py-1 rounded-full bg-[#1A1A1A] border border-[#2A2A2A] text-[#94A3B8]"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Session Agenda */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-[#A855F7]" />
          <h2 className="text-sm font-semibold text-[#94A3B8] uppercase tracking-wider">Session Agenda</h2>
          {sessionPlan && sessionPlan.plan_status === 'generating' && (
            <span className="text-xs text-[#475569] flex items-center gap-1">
              <Loader size={11} className="animate-spin" />
              Preparing visuals...
            </span>
          )}
          {sessionPlan && sessionPlan.plan_status === 'partial' && (
            <span className="text-xs text-[#06B6D4] flex items-center gap-1">
              <Loader size={11} className="animate-spin" />
              Building remaining visuals...
            </span>
          )}
        </div>

        {/* Content generation progress */}
        {contentStatus === 'generating' && (() => {
          const total = contentSubSessions.length || topics.length || 1
          const done = contentSubSessions.filter((s) => s.pipeline_status === 'ready').length
          const inProgress = contentSubSessions.filter((s) => s.pipeline_status === 'generating').length
          const pct = Math.round((done / total) * 100)

          const stepLabel =
            done === 0 && inProgress === 0
              ? 'Analysing session structure...'
              : done === total
              ? 'Finalising...'
              : inProgress > 0
              ? `Writing scripts (${done + inProgress} of ${total} in progress)...`
              : `${done} of ${total} topics ready`

          return (
            <div className="mb-4 rounded-xl border border-[#1A1A1A] bg-[#111111] p-4 space-y-3">
              {isStuck ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-[#EF4444]">
                    <AlertTriangle size={14} />
                    Generation is taking longer than expected. The server may have timed out.
                  </div>
                  <Button variant="secondary" className="gap-2 w-full justify-center" onClick={handleRetryContent}>
                    <Loader size={13} />
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-[#06B6D4]">
                      <Loader size={11} className="animate-spin flex-shrink-0" />
                      <span>{stepLabel}</span>
                    </div>
                    <span className="text-xs font-semibold text-[#94A3B8]">{pct}%</span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 rounded-full bg-[#1A1A1A] overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#06B6D4]"
                      initial={{ width: '4%' }}
                      animate={{ width: `${Math.max(pct, 4)}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                  </div>
                  {/* Per-topic chips */}
                  {contentSubSessions.length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      {contentSubSessions.map((sub) => (
                        <div key={sub.slug} className="flex items-center gap-2">
                          {sub.pipeline_status === 'ready' ? (
                            <CheckCircle size={11} className="text-[#10B981] flex-shrink-0" />
                          ) : sub.pipeline_status === 'generating' ? (
                            <Loader size={11} className="text-[#06B6D4] animate-spin flex-shrink-0" />
                          ) : (
                            <Circle size={11} className="text-[#333333] flex-shrink-0" />
                          )}
                          <span className={`text-xs truncate ${
                            sub.pipeline_status === 'ready' ? 'text-[#94A3B8]' :
                            sub.pipeline_status === 'generating' ? 'text-[#06B6D4]' :
                            'text-[#475569]'
                          }`}>
                            {sub.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })()}

        {/* Failed / interrupted state */}
        {contentStatus === 'failed' && (
          <div className="mb-4 rounded-xl border border-[#EF4444]/30 bg-[#EF4444]/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-[#EF4444]">
              <AlertTriangle size={14} className="flex-shrink-0" />
              Content generation was interrupted. Click below to restart — it only takes 2–3 minutes.
            </div>
            <Button
              variant="primary"
              className="gap-2 w-full justify-center"
              onClick={handleRetryContent}
            >
              <Sparkles size={13} />
              Generate Content &amp; Training Script
            </Button>
          </div>
        )}

        {isCurriculumSession ? (
          // Curriculum sessions: show sub_sessions from JSONB with content pipeline status dots.
          // No session_plan visuals needed — topic_content_cache is the source of truth.
          <div className="space-y-2">
            {(session.sub_sessions ?? []).map((sub, i) => {
              const contentSub = contentSubSessions.find((c) => c.title === sub.title)
              const scriptStatus = contentSub?.pipeline_status ?? 'pending'
              return (
                <div key={i} className="rounded-xl border border-[#1A1A1A] overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 bg-[#111111]">
                    <div className="w-5 h-5 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-bold text-[#A855F7]">{i + 1}</span>
                    </div>
                    <p className="text-sm flex-1 leading-snug text-[#94A3B8]">{sub.title}</p>
                    <StatusDot status={scriptStatus} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : !sessionPlan || sessionPlan.plan_status === 'generating' ? (
          <Card className="p-4 flex items-center gap-3">
            <Loader size={15} className="text-[#7C3AED] animate-spin flex-shrink-0" />
            <p className="text-sm text-[#475569]">Generating your session agenda and pre-building visuals...</p>
          </Card>
        ) : sessionPlan.plan_status === 'failed' ? (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <XCircle size={16} className="text-[#EF4444] flex-shrink-0" />
              <p className="text-sm text-[#94A3B8]">Visual generation failed. Click retry to try again.</p>
            </div>
            <Button
              variant="secondary"
              className="gap-2"
              onClick={() => {
                setSessionPlan(null)
                triggerGeneration()
              }}
            >
              <Loader size={14} />
              Retry
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            {mergedSubtopics.map((sub, i) => (
              <div
                key={sub.id}
                className={`rounded-xl border overflow-hidden transition-colors ${
                  sub.skipped ? 'border-[#1A1A1A] opacity-50' : 'border-[#1A1A1A]'
                }`}
              >
                {/* Row */}
                <div className={`flex items-center gap-3 px-4 py-3 ${sub.skipped ? 'bg-[#0D0D0D]' : 'bg-[#111111]'}`}>
                  <div className="w-5 h-5 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold text-[#A855F7]">{i + 1}</span>
                  </div>
                  <p className={`text-sm flex-1 leading-snug ${sub.skipped ? 'line-through text-[#475569]' : 'text-[#94A3B8]'}`}>
                    {sub.title}
                  </p>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Visual dot */}
                    {!sub.skipped && (
                      <div className="flex items-center gap-1">
                        <StatusDot status={sub.visualStatus} />
                        <StatusDot status={sub.scriptStatus} />
                      </div>
                    )}
                    {/* Expand script (only when script ready) */}
                    {sub.training_script && !sub.skipped && (
                      <button
                        onClick={() => setExpandedScript(expandedScript === sub.slug ? null : sub.slug)}
                        className="text-[#475569] hover:text-[#94A3B8] transition-colors"
                        title="View training script"
                      >
                        {expandedScript === sub.slug
                          ? <ChevronDown size={14} />
                          : <ChevronRight size={14} />}
                      </button>
                    )}
                    {/* Skip toggle */}
                    <button
                      onClick={async () => {
                        const newSkipped = !sub.skipped
                        setSessionPlan((prev) => prev ? {
                          ...prev,
                          sub_sessions: prev.sub_sessions.map((s) =>
                            s.id === sub.id ? { ...s, skipped: newSkipped } : s
                          ),
                        } : prev)
                        await fetch(`/api/sessions/${session.id}/generate-plan`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ subtopicId: sub.id, skipped: newSkipped }),
                        })
                      }}
                      title={sub.skipped ? 'Include this topic' : 'Skip this topic'}
                      className="text-[#475569] hover:text-[#94A3B8] transition-colors"
                    >
                      {sub.skipped ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  </div>
                </div>

                {/* Expanded training script */}
                {expandedScript === sub.slug && sub.training_script && (
                  <div className="px-4 pb-4 space-y-3 border-t border-[#1A1A1A] pt-3 bg-[#0D0D0D]">
                    {sub.content_outline?.key_concepts && (
                      <div>
                        <p className="text-xs font-semibold text-[#06B6D4] mb-1.5 uppercase tracking-wide">Key Concepts</p>
                        <div className="flex flex-wrap gap-1.5">
                          {sub.content_outline.key_concepts.map((c, ci) => (
                            <span key={ci} className="text-xs px-2 py-0.5 rounded-full bg-[#1A1A1A] border border-[#2A2A2A] text-[#94A3B8]">{c}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {sub.training_script.segments.map((seg, si) => (
                      <div key={si} className={`rounded-lg p-3 border ${
                        seg.type === 'TEACH'      ? 'border-[#7C3AED]/30 bg-[#7C3AED]/5' :
                        seg.type === 'CHECKPOINT' ? 'border-[#06B6D4]/30 bg-[#06B6D4]/5' :
                        seg.type === 'PROBE'      ? 'border-[#F59E0B]/30 bg-[#F59E0B]/5' :
                                                    'border-[#10B981]/30 bg-[#10B981]/5'
                      }`}>
                        <div className={`text-xs font-bold mb-1.5 uppercase tracking-widest ${
                          seg.type === 'TEACH'      ? 'text-[#A855F7]' :
                          seg.type === 'CHECKPOINT' ? 'text-[#06B6D4]' :
                          seg.type === 'PROBE'      ? 'text-[#F59E0B]' :
                                                      'text-[#10B981]'
                        }`}>
                          {seg.type}
                          {seg.duration_seconds && (
                            <span className="ml-2 text-[#475569] font-normal normal-case">~{seg.duration_seconds}s</span>
                          )}
                        </div>
                        <p className="text-xs text-[#94A3B8] leading-relaxed">{seg.content}</p>
                      </div>
                    ))}
                    <p className="text-xs text-[#475569] text-right">
                      Total: ~{Math.round((sub.training_script.total_duration_seconds ?? 0) / 60)} min
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex items-center gap-3 flex-wrap"
      >
        {session.scheduled_at && session.status !== 'cancelled' && (
          <a href={`/api/sessions/${session.id}/calendar`}>
            <Button variant="secondary" className="gap-2">
              <Download size={15} />
              Add to Calendar
            </Button>
          </a>
        )}
        <Link href="/dashboard/sessions">
          <Button variant="ghost">
            View all sessions
          </Button>
        </Link>
      </motion.div>

      {/* ── DEFERRED QUESTIONS ── */}
      {session.deferred_questions && session.deferred_questions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <BookmarkPlus size={14} className="text-[#F59E0B]" />
            <h2 className="text-sm font-semibold text-[#94A3B8] uppercase tracking-wider">Saved for Follow-up</h2>
            <span className="text-xs text-[#475569] px-2 py-0.5 rounded-full bg-[#1A1A1A] border border-[#2A2A2A]">
              {session.deferred_questions.length}
            </span>
          </div>
          <Card className="divide-y divide-[#1A1A1A]">
            {session.deferred_questions.map((dq, i) => (
              <div key={i} className="flex items-start gap-3 p-4">
                <MessageSquare size={14} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#94A3B8] leading-snug">{dq.question}</p>
                  <p className="text-xs text-[#475569] mt-1">
                    Deferred {new Date(dq.deferred_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  </p>
                </div>
              </div>
            ))}
            <div className="p-4 bg-amber-950/10">
              <p className="text-xs text-[#F59E0B]">
                These questions were saved during your session. Schedule a follow-up session to cover them in depth.
              </p>
            </div>
          </Card>
        </motion.div>
      )}

      {/* ── LIVE SESSION LAUNCHER ── */}
      {session.status !== 'cancelled' && (() => {
        // Curriculum sessions don't use session_plan — treat them as always visually ready.
        // Their readiness is gated solely by contentSubSessions (topic_content_cache pipeline).
        const planReady = isCurriculumSession ||
          sessionPlan?.plan_status === 'partial' ||
          sessionPlan?.plan_status === 'ready'
        const planFailed = !isCurriculumSession && sessionPlan?.plan_status === 'failed'
        return (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card>
            <div className="p-5 space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center flex-shrink-0">
                  <Video size={16} className="text-[#06B6D4]" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Start Live Session</h2>
                  <p className="text-xs text-[#475569]">
                    Clio AI joins your Zoom or Teams call and shares a visual walkthrough
                  </p>
                </div>
              </div>

              {botStatus === 'idle' && (
                <div className="space-y-3">
                  {minutesBalance < session.duration_mins ? (
                    <div className="flex items-start gap-2.5 py-3 px-3 rounded-lg bg-red-950/20 border border-red-800/30">
                      <AlertTriangle size={13} className="text-[#EF4444] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-[#EF4444] mb-0.5">Insufficient minutes</p>
                        <p className="text-xs text-[#EF4444]/80">
                          This session needs {session.duration_mins} minutes but you only have {minutesBalance} remaining.
                          Top up your balance to join.
                        </p>
                      </div>
                    </div>
                  ) : planFailed ? (
                    <div className="flex items-center gap-2.5 py-2 px-3 rounded-lg bg-red-950/20 border border-red-800/20">
                      <XCircle size={13} className="text-[#EF4444] flex-shrink-0" />
                      <p className="text-xs text-[#EF4444]">
                        Visual preparation failed — retry from the agenda above before launching
                      </p>
                    </div>
                  ) : !planReady ? (
                    <div className="flex items-center gap-2.5 py-2 px-3 rounded-lg bg-amber-950/20 border border-amber-800/20">
                      <Loader size={13} className="text-[#F59E0B] animate-spin flex-shrink-0" />
                      <p className="text-xs text-[#F59E0B]">
                        Preparing visuals — you can join as soon as the first diagram is ready
                      </p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs text-[#475569] mb-1.5">
                          Meeting URL
                        </label>
                        <input
                          type="url"
                          placeholder="https://zoom.us/j/... or https://teams.microsoft.com/..."
                          value={meetingUrl}
                          onChange={(e) => setMeetingUrl(e.target.value)}
                          className="w-full bg-[#0D0D0D] border border-[#222222] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#475569] focus:outline-none focus:border-[#7C3AED] transition-colors"
                        />
                      </div>
                      {botError && (
                        <p className="text-xs text-red-400">{botError}</p>
                      )}
                      <Button
                        variant="primary"
                        className="w-full gap-2"
                        onClick={handleLaunchBot}
                        disabled={
                          !meetingUrl.trim() ||
                          contentSubSessions.length === 0 ||
                          !contentSubSessions.every((s) => s.pipeline_status === 'ready')
                        }
                      >
                        <Video size={15} />
                        {contentSubSessions.length > 0 && !contentSubSessions.every((s) => s.pipeline_status === 'ready')
                          ? 'Preparing content...'
                          : 'Launch AI Coach'}
                      </Button>
                    </>
                  )}
                </div>
              )}

              {botStatus === 'joining' && (
                <div className="flex items-center gap-3 py-2">
                  <Loader size={16} className="text-[#06B6D4] animate-spin flex-shrink-0" />
                  <p className="text-sm text-[#94A3B8]">Joining meeting...</p>
                </div>
              )}

              {botStatus === 'active' && (
                <div className="space-y-3">
                  {/* Status indicator + countdown */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 py-1">
                      <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse flex-shrink-0" />
                      <p className="text-sm text-[#10B981] font-medium">Bot is in the call</p>
                    </div>
                    {timerSecondsLeft !== null && (
                      <div
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border font-mono text-sm font-semibold ${
                          timerWarning
                            ? 'bg-red-950/30 border-red-800/40 text-[#EF4444]'
                            : 'bg-[#111111] border-[#222222] text-[#94A3B8]'
                        }`}
                      >
                        <Timer size={13} className={timerWarning ? 'text-[#EF4444]' : 'text-[#475569]'} />
                        {String(Math.floor(timerSecondsLeft / 60)).padStart(2, '0')}:
                        {String(timerSecondsLeft % 60).padStart(2, '0')}
                      </div>
                    )}
                  </div>

                  {/* 2-minute warning banner */}
                  {timerWarning && timerSecondsLeft !== null && timerSecondsLeft > 0 && (
                    <div className="flex items-center gap-2.5 py-2 px-3 rounded-lg bg-red-950/20 border border-red-800/30">
                      <AlertTriangle size={13} className="text-[#EF4444] flex-shrink-0" />
                      <p className="text-xs text-[#EF4444]">
                        {timerSecondsLeft <= 60
                          ? 'Less than 1 minute left — wrapping up now'
                          : '2 minutes remaining — Clio will begin wrapping up'}
                      </p>
                    </div>
                  )}

                  {/* Walkthrough URL */}
                  <div className="bg-[#0D0D0D] border border-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-[#475569] mb-1">Shared screen URL (auto-managed by bot)</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#94A3B8] truncate flex-1 font-mono">
                        {walkthroughUrl}
                      </span>
                      <a
                        href={walkthroughUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#7C3AED] hover:text-[#A855F7] flex-shrink-0"
                      >
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  </div>

                  <Button
                    variant="danger"
                    className="w-full gap-2"
                    onClick={handleEndSession}
                  >
                    <StopCircle size={15} />
                    End Session
                  </Button>
                </div>
              )}

              {botStatus === 'ending' && (
                <div className="flex items-center gap-3 py-2">
                  <Loader size={16} className="text-[#475569] animate-spin flex-shrink-0" />
                  <p className="text-sm text-[#475569]">Ending session...</p>
                </div>
              )}
            </div>
          </Card>
        </motion.div>
        )
      })()}
    </div>
  )
}
