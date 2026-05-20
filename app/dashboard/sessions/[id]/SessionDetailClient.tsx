'use client'

import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  ArrowLeft, CalendarDays, Clock, Download, Tag, CheckCircle,
  Circle, XCircle, Loader, Video, StopCircle, ExternalLink, Sparkles, EyeOff, Eye,
  MessageSquare, BookmarkPlus, Copy,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { SessionPlan } from '@/lib/session-plan'

interface DeferredQuestion {
  question: string
  deferred_at: string
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
}

type BotStatus = 'idle' | 'joining' | 'active' | 'ending'

interface Props {
  session: Session
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

export default function SessionDetailClient({ session }: Props) {
  const title = session.session_title ?? `Session ${session.session_index}`
  const status = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.scheduled
  const topics = session.topics ?? []
  const { user } = useUser()

  // Session plan state — polls until all visuals are ready
  const [sessionPlan, setSessionPlan] = useState<SessionPlan | null>(session.session_plan)

  const fetchPlan = useCallback(async () => {
    const res = await fetch(`/api/sessions/${session.id}/generate-plan`)
    if (!res.ok) return
    const data = await res.json() as { session_plan: SessionPlan | null }
    if (data.session_plan) setSessionPlan(data.session_plan)
  }, [session.id])

  const triggerGeneration = useCallback(() => {
    fetch(`/api/sessions/${session.id}/generate-plan`, { method: 'POST' }).catch(() => {})
  }, [session.id])

  // Trigger generation if no plan exists; poll until complete or failed
  useEffect(() => {
    if (!sessionPlan) {
      triggerGeneration()
    }
    if (sessionPlan?.plan_status === 'ready' || sessionPlan?.plan_status === 'failed') return
    const interval = setInterval(fetchPlan, 4000)
    return () => clearInterval(interval)
  }, [session.id, sessionPlan, fetchPlan, triggerGeneration])

  // Live session state — pre-fill from auto-generated Meet link if available
  const [meetingUrl, setMeetingUrl] = useState(session.meeting_url ?? '')
  const [resolvedMeetUrl, setResolvedMeetUrl] = useState<string | null>(session.meeting_url)

  // Poll for Meet link until it appears (created async after scheduling)
  useEffect(() => {
    if (resolvedMeetUrl) return
    const poll = setInterval(async () => {
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

  // Public URL — no auth, accessible by Recall.ai headless browser
  const walkthroughUrl = user?.id
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/walkthrough/${user.id}`
    : ''

  async function handleLaunchBot() {
    if (!meetingUrl.trim()) return
    setBotStatus('joining')
    setBotError(null)
    const skippedTopics = sessionPlan?.subtopics.filter((s) => s.skipped).map((s) => s.title) ?? []
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
      setBotStatus('active')
    } catch {
      setBotError('Network error — please try again')
      setBotStatus('idle')
    }
  }

  async function handleEndSession() {
    if (!botId) return
    setBotStatus('ending')
    try {
      await fetch('/api/recall/bot', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId }),
      })
    } catch {
      // Non-fatal
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

        {!sessionPlan || sessionPlan.plan_status === 'generating' ? (
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
            {sessionPlan.subtopics.map((sub, i) => (
              <div
                key={sub.id}
                className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-colors ${
                  sub.skipped
                    ? 'bg-[#0D0D0D] border-[#1A1A1A] opacity-50'
                    : 'bg-[#111111] border-[#1A1A1A]'
                }`}
              >
                <div className="w-5 h-5 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[9px] font-bold text-[#A855F7]">{i + 1}</span>
                </div>
                <p className={`text-sm flex-1 leading-snug ${sub.skipped ? 'line-through text-[#475569]' : 'text-[#94A3B8]'}`}>
                  {sub.title}
                </p>
                <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                  {/* Visual status indicator */}
                  {!sub.skipped && (
                    sub.visual_status === 'ready' ? (
                      <CheckCircle size={14} className="text-[#10B981]" />
                    ) : sub.visual_status === 'failed' ? (
                      <XCircle size={14} className="text-[#EF4444]" />
                    ) : (
                      <Loader size={14} className="text-[#475569] animate-spin" />
                    )
                  )}
                  {/* Skip toggle */}
                  <button
                    onClick={async () => {
                      const newSkipped = !sub.skipped
                      setSessionPlan((prev) => prev ? {
                        ...prev,
                        subtopics: prev.subtopics.map((s) =>
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
        const planReady = sessionPlan?.plan_status === 'partial' || sessionPlan?.plan_status === 'ready'
        const planFailed = sessionPlan?.plan_status === 'failed'
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
                  {planFailed ? (
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
                      >
                        <Video size={15} />
                        Launch AI Coach
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
                  {/* Status indicator */}
                  <div className="flex items-center gap-2.5 py-1">
                    <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse flex-shrink-0" />
                    <p className="text-sm text-[#10B981] font-medium">Bot is in the call</p>
                  </div>

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
