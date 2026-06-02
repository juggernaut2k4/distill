'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { Clock, ChevronRight, FlaskConical, Loader2, BookOpen } from 'lucide-react'
import { Card } from '@/components/ui/Card'
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
}

interface SessionsClientProps {
  sessions: Session[]
  topicTitleMap: Record<string, string>
}

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  scheduled:  { label: 'Scheduled',  className: 'bg-[#1A1A1A] text-[#94A3B8] border border-[#333]' },
  active:     { label: 'Active',     className: 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30' },
  completed:  { label: 'Completed',  className: 'bg-green-950/40 text-green-400 border border-green-800/30' },
  cancelled:  { label: 'Cancelled',  className: 'bg-red-950/40 text-red-400 border border-red-800/30' },
}

function SessionRow({ session, index }: { session: Session; index: number }) {
  const status = STATUS_STYLE[session.status] ?? STATUS_STYLE.scheduled
  const title = session.session_title ?? `Session ${session.session_index}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
    >
      <Link href={`/dashboard/sessions/${session.id}`} className="block group">
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[#1A1A1A] transition-colors cursor-pointer">
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
    </motion.div>
  )
}

interface TopicGroup {
  topicId: string
  topicTitle: string
  sessions: Session[]
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

export default function SessionsClient({ sessions, topicTitleMap }: SessionsClientProps) {
  // Group sessions by curriculum topic
  const grouped: TopicGroup[] = []
  const topicOrder: string[] = []
  const topicMap: Record<string, Session[]> = {}

  for (const session of sessions) {
    const key = session.curriculum_session_id ?? '__ungrouped__'
    if (!topicMap[key]) {
      topicMap[key] = []
      topicOrder.push(key)
    }
    topicMap[key].push(session)
  }

  for (const key of topicOrder) {
    const title = key === '__ungrouped__'
      ? 'Other Sessions'
      : (topicTitleMap[key] ?? key)
    // Sort sessions within group by session_index
    const sortedSessions = [...topicMap[key]].sort((a, b) => a.session_index - b.session_index)
    grouped.push({ topicId: key, topicTitle: title, sessions: sortedSessions })
  }

  // Sort groups by the lowest session_index in each group so overall order matches plan order
  grouped.sort((a, b) => {
    const aMin = Math.min(...a.sessions.map((s) => s.session_index))
    const bMin = Math.min(...b.sessions.map((s) => s.session_index))
    return aMin - bMin
  })

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Page header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between gap-4 mb-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white">Sessions</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-950/50 border border-purple-800/40 text-[#A855F7]">
              {sessions.length}
            </span>
          </div>
          <TestSessionButton />
        </div>
        <p className="text-[#94A3B8] text-sm">
          {grouped.length > 0
            ? `${grouped.filter(g => g.topicId !== '__ungrouped__').length} topic${grouped.filter(g => g.topicId !== '__ungrouped__').length !== 1 ? 's' : ''} · ${sessions.length} sessions`
            : 'Your scheduled coaching sessions.'}
        </p>
      </motion.div>

      {/* Topic groups */}
      {grouped.length === 0 ? (
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
        <div className="space-y-4">
          {grouped.map((group, i) => (
            <TopicGroupCard key={group.topicId} group={group} startIndex={i} />
          ))}
        </div>
      )}
    </div>
  )
}
