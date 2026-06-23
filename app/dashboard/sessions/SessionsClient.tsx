'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { Clock, ChevronRight, FlaskConical, Loader2, BookOpen, Link as LinkIcon, Loader, Zap, CalendarDays } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { TopUpModal } from '@/components/ui/TopUpModal'
import { useState } from 'react'

interface Session {
  id: string
  session_index: number
  session_title: string | null
  scheduled_at: string | null
  status: string
  topics: string[] | null
  duration_mins: number
  curriculum_session_id: string | null
  meeting_url: string | null
}

interface SessionsClientProps {
  sessions: Session[]
  topicTitleMap: Record<string, string>
  /** SESS-04: curriculum_session_id → arc name */
  arcNameMap?: Record<string, string>
  /** SESS-04: curriculum_session_id → arc type */
  arcTypeMap?: Record<string, string>
  minutesBalance?: number
  schedulingPrefsNull?: boolean
}

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  scheduled:  { label: 'Scheduled',  className: 'bg-[#1A1A1A] text-[#475569] border border-[#222222]' },
  active:     { label: 'Active',     className: 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30' },
  completed:  { label: 'Completed',  className: 'bg-green-950/40 text-green-400 border border-green-800/30' },
  cancelled:  { label: 'Cancelled',  className: 'bg-red-950/40 text-red-400 border border-red-800/30' },
}

function truncateUrl(url: string, max = 40): string {
  try {
    const { host, pathname } = new URL(url)
    const display = host + pathname
    return display.length > max ? display.slice(0, max) + '…' : display
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url
  }
}

/** Inline meeting link widget — manages its own edit/save state */
function MeetingLinkWidget({ sessionId, initialUrl }: { sessionId: string; initialUrl: string | null }) {
  const [meetingUrl, setMeetingUrl] = useState<string | null>(initialUrl)
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState(initialUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/meeting-url`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingUrl: inputValue }),
      })
      if (res.ok) {
        setMeetingUrl(inputValue)
        setEditing(false)
      } else {
        setError("Couldn't save the link. Please try again.")
      }
    } catch {
      setError("Couldn't save the link. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  // State B — has link, not editing
  if (meetingUrl && !editing) {
    return (
      <div className="mt-3 flex items-center gap-2">
        <LinkIcon size={13} className="text-[#06B6D4] flex-shrink-0" />
        <a
          href={meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#06B6D4] text-sm truncate hover:underline flex-1 min-w-0"
          title={meetingUrl}
        >
          {truncateUrl(meetingUrl)}
        </a>
        <button
          onClick={() => {
            setInputValue(meetingUrl)
            setEditing(true)
          }}
          className="text-xs text-[#475569] hover:text-[#94A3B8] transition-colors border border-[#333333] rounded-lg px-3 py-1 flex-shrink-0 ml-2"
        >
          Edit
        </button>
      </div>
    )
  }

  // State A / C — no link, or editing
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-[#94A3B8] mb-1.5">Meeting link</p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="https://meet.google.com/..."
          disabled={saving}
          className="flex-1 min-w-0 h-[38px] px-[10px] rounded-[10px] bg-[#111111] border border-[#222222] text-[13px] text-white placeholder:text-[#475569] focus:outline-none focus:border-[#7C3AED] transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-[38px] px-4 rounded-[10px] bg-[#7C3AED] text-white text-[13px] font-semibold flex-shrink-0 flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed hover:bg-[#A855F7] transition-colors"
        >
          {saving ? <Loader size={13} className="animate-spin" /> : 'Save'}
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-[#EF4444]">{error}</p>
      )}
    </div>
  )
}

function SessionRow({ session, index }: { session: Session; index: number }) {
  const status = STATUS_STYLE[session.status] ?? STATUS_STYLE.scheduled
  const title = session.session_title ?? `Session ${session.session_index}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className="px-4 py-3"
    >
      {/* Top row: number, title, duration, status, chevron */}
      <Link href={`/dashboard/sessions/${session.id}`} className="block group">
        <div className="flex items-center gap-3 rounded-lg hover:bg-[#1A1A1A] transition-colors cursor-pointer -mx-1 px-1 py-1">
          {/* Session number */}
          <div className="w-7 h-7 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold text-[#A855F7]">{session.session_index}</span>
          </div>

          {/* Title */}
          <p className="text-sm text-white flex-1 min-w-0 truncate">{title}</p>

          {/* Duration */}
          <div className="flex items-center gap-1 text-xs text-[#475569] flex-shrink-0">
            <Clock size={11} />
            {session.duration_mins}m
          </div>

          {/* Status badge */}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${status.className}`}>
            {status.label}
          </span>

          <ChevronRight size={13} className="text-[#333] group-hover:text-[#475569] transition-colors flex-shrink-0" />
        </div>
      </Link>

      {/* Meeting link widget — below the clickable row */}
      <MeetingLinkWidget sessionId={session.id} initialUrl={session.meeting_url} />
    </motion.div>
  )
}

interface TopicGroup {
  topicId: string
  topicTitle: string
  sessions: Session[]
}

interface ArcGroup {
  arcName: string
  arcType: string
  topics: TopicGroup[]
}

function TopicGroupCard({ group, startIndex }: { group: TopicGroup; startIndex: number }) {
  const sessionCount = group.sessions.length
  const totalMins = group.sessions.reduce((sum, s) => sum + s.duration_mins, 0)
  const completedCount = group.sessions.filter((s) => s.status === 'completed').length

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: startIndex * 0.08 }}
    >
      <Card className="overflow-hidden">
        {/* Topic header */}
        <div className="px-4 py-3 border-b border-[#1E1E1E] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen size={14} className="text-[#475569] flex-shrink-0" />
            <span className="text-sm font-semibold text-white truncate">{group.topicTitle}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {completedCount > 0 && (
              <span className="text-xs text-[#10B981]">{completedCount}/{sessionCount} done</span>
            )}
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-950/40 border border-purple-800/30 text-[#A855F7] font-medium">
              {sessionCount} session{sessionCount !== 1 ? 's' : ''} · {totalMins}m total
            </span>
          </div>
        </div>

        {/* Sessions under this topic */}
        <div className="divide-y divide-[#0D0D0D]">
          {group.sessions.map((session, i) => (
            <SessionRow key={session.id} session={session} index={i} />
          ))}
        </div>
      </Card>
    </motion.div>
  )
}

/** SESS-04: Arc header — rendered above each group of topic cards that share an arc. */
function ArcHeader({ arcName, arcType, sessionCount, completedCount }: {
  arcName: string
  arcType: string
  sessionCount: number
  completedCount: number
}) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2 pb-1">
      <div className="flex items-center gap-2 min-w-0">
        {/* Accent line */}
        <div className="w-1 h-5 rounded-full bg-[#7C3AED] flex-shrink-0" />
        <span className="text-sm font-bold text-white truncate">{arcName}</span>
        {arcType && arcType !== 'singleton' && (
          <span className="text-xs px-1.5 py-0.5 rounded-full border border-[#333333] text-[#475569] capitalize">
            {arcType}
          </span>
        )}
      </div>
      <span className="text-xs text-[#475569] flex-shrink-0">
        {completedCount}/{sessionCount} sessions complete
      </span>
    </div>
  )
}

function TestSessionButton() {
  const [expanded, setExpanded] = useState(false)
  const [meetingInput, setMeetingInput] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!meetingInput.trim()) return
    setState('loading')
    try {
      const res = await fetch('/api/admin/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'How Claude Works', meetingUrl: meetingInput.trim(), durationMins: 30 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unknown error')
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }

  if (state === 'done') {
    return <span className="text-xs text-green-400 font-medium">Bot is joining your meeting now!</span>
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-[#333] text-[#94A3B8] hover:border-[#7C3AED] hover:text-[#A855F7] transition-colors"
      >
        <FlaskConical size={12} />
        Test: How Claude Works
      </button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <p className="text-xs text-[#475569]">
        Go to{' '}
        <a href="https://meet.google.com" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">
          meet.google.com
        </a>
        {' '}→ New meeting → paste the URL below
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={meetingInput}
          onChange={(e) => setMeetingInput(e.target.value)}
          placeholder="https://meet.google.com/xxx-xxxx-xxx"
          className="text-xs px-3 py-1.5 rounded-lg bg-[#111] border border-[#333] text-white placeholder:text-[#475569] focus:outline-none focus:border-[#7C3AED] w-64"
        />
        <button
          onClick={handleCreate}
          disabled={state === 'loading' || !meetingInput.trim()}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors disabled:opacity-50"
        >
          {state === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
          {state === 'loading' ? 'Sending bot…' : 'Send bot'}
        </button>
        <button onClick={() => setExpanded(false)} className="text-xs text-[#475569] hover:text-white transition-colors">✕</button>
      </div>
      {state === 'error' && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

export default function SessionsClient({ sessions, topicTitleMap, arcNameMap = {}, arcTypeMap = {}, minutesBalance = 0, schedulingPrefsNull }: SessionsClientProps) {
  const [topUpOpen, setTopUpOpen] = useState(false)

  // ── SESS-04: Group sessions by Arc → Topic → Sessions ────────────────────
  // Step 1: build flat topic groups (same logic as before, but use session_title first)
  const topicGroupMap: Record<string, Session[]> = {}
  const topicOrder: string[] = []

  for (const session of sessions) {
    const key = session.curriculum_session_id ?? '__ungrouped__'
    if (!topicGroupMap[key]) {
      topicGroupMap[key] = []
      topicOrder.push(key)
    }
    topicGroupMap[key].push(session)
  }

  const flatTopicGroups: TopicGroup[] = topicOrder.map((key) => {
    const groupSessions = [...topicGroupMap[key]].sort((a, b) => a.session_index - b.session_index)
    // TITLE-01: prefer session_title of the first session in the group as the topic label.
    // Fall back to topicTitleMap (curriculum plan title), then the key itself.
    const firstSession = groupSessions[0]
    const titleFromSession = firstSession?.session_title ?? null
    const titleFromPlan = key !== '__ungrouped__' ? (topicTitleMap[key] ?? null) : null
    const title = titleFromSession ?? titleFromPlan ?? (key === '__ungrouped__' ? 'Other Sessions' : key)
    return { topicId: key, topicTitle: title, sessions: groupSessions }
  })

  // Sort topic groups by lowest session_index so order matches plan
  flatTopicGroups.sort((a, b) => {
    const aMin = Math.min(...a.sessions.map((s) => s.session_index))
    const bMin = Math.min(...b.sessions.map((s) => s.session_index))
    return aMin - bMin
  })

  // Step 2: group topic groups by arc name (from arcNameMap)
  const arcGroupMap: Map<string, ArcGroup> = new Map()
  const arcOrder: string[] = []

  for (const tg of flatTopicGroups) {
    const arcName = arcNameMap[tg.topicId] ?? 'Your Learning Path'
    const arcType = arcTypeMap[tg.topicId] ?? 'singleton'
    if (!arcGroupMap.has(arcName)) {
      arcGroupMap.set(arcName, { arcName, arcType, topics: [] })
      arcOrder.push(arcName)
    }
    arcGroupMap.get(arcName)!.topics.push(tg)
  }

  const arcGroups: ArcGroup[] = arcOrder.map((name) => arcGroupMap.get(name)!)

  const anyMissingLink = sessions.some((s) => !s.meeting_url)

  return (
    <div className="space-y-8 max-w-3xl">
      <TopUpModal open={topUpOpen} onClose={() => setTopUpOpen(false)} currentBalance={minutesBalance} />

      {/* Schedule setup banner — shown when scheduling prefs not yet configured */}
      {schedulingPrefsNull && (
        <div className="flex items-center justify-between bg-amber-950/20 border border-amber-800/30 rounded-xl px-4 py-3 mb-6">
          <div className="flex items-center gap-2">
            <CalendarDays size={16} className="text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-300 font-medium">Set your schedule to see session dates</span>
          </div>
          <Link
            href="/dashboard/schedule-setup"
            className="text-xs font-medium text-white bg-[#7C3AED] hover:bg-[#6D28D9] px-3 py-1.5 rounded-lg transition-colors"
          >
            Set up schedule →
          </Link>
        </div>
      )}

      {/* Page header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between gap-4 mb-1 flex-wrap">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white">Sessions</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-950/50 border border-purple-800/40 text-[#A855F7]">
              {sessions.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[#475569]">Balance</span>
              <span className="font-bold text-[#06B6D4]">{minutesBalance} min</span>
            </div>
            <button
              onClick={() => setTopUpOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#333333] bg-[#111111] hover:border-[#555555] hover:bg-[#1A1A1A] text-xs font-medium text-white transition-all"
            >
              <Zap size={12} className="text-[#F59E0B]" />
              Top up
            </button>
            <TestSessionButton />
          </div>
        </div>
        <p className="text-[#94A3B8] text-sm">
          {flatTopicGroups.length > 0
            ? `${flatTopicGroups.filter(g => g.topicId !== '__ungrouped__').length} topic${flatTopicGroups.filter(g => g.topicId !== '__ungrouped__').length !== 1 ? 's' : ''} · ${sessions.length} sessions`
            : 'Your scheduled coaching sessions.'}
        </p>

        {/* Informational banner — shown only when at least one session is missing a meeting link */}
        {anyMissingLink && sessions.length > 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-3 text-sm text-[#94A3B8]"
          >
            Add your Google Meet links so you&apos;re ready to join each session. You can do this any time before it starts.
          </motion.p>
        )}
      </motion.div>

      {/* Arc → Topic → Session groups (SESS-04) */}
      {arcGroups.length === 0 ? (
        <Card className="p-8 flex flex-col items-center gap-3 text-center">
          <BookOpen size={32} className="text-[#333]" />
          <p className="text-[#475569] text-sm">No sessions yet.</p>
          <Link
            href="/dashboard/plan"
            className="text-sm text-[#7C3AED] hover:text-[#A855F7] transition-colors font-semibold"
          >
            Go to My Plan to approve your learning path →
          </Link>
        </Card>
      ) : (
        <div className="space-y-6">
          {(() => {
            // Pre-compute a global topic index so TopicGroupCard stagger delays are correct
            let globalTopicIndex = 0
            return arcGroups.map((arc) => {
              const allArcSessions = arc.topics.flatMap((t) => t.sessions)
              const arcCompletedCount = allArcSessions.filter((s) => s.status === 'completed').length
              // Only render the Arc header when there are multiple arcs, or when the arc
              // has a real name from the curriculum plan (not the generic fallback)
              const showArcHeader = arcGroups.length > 1 || arc.arcName !== 'Your Learning Path'
              return (
                <div key={arc.arcName} className="space-y-3">
                  {showArcHeader && (
                    <ArcHeader
                      arcName={arc.arcName}
                      arcType={arc.arcType}
                      sessionCount={allArcSessions.length}
                      completedCount={arcCompletedCount}
                    />
                  )}
                  {arc.topics.map((group) => {
                    const idx = globalTopicIndex++
                    return (
                      <TopicGroupCard key={group.topicId} group={group} startIndex={idx} />
                    )
                  })}
                </div>
              )
            })
          })()}
        </div>
      )}
    </div>
  )
}
