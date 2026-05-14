'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { Clock, CalendarDays, PlusCircle, ChevronRight, FlaskConical, Loader2 } from 'lucide-react'
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
}

interface SessionsClientProps {
  sessions: Session[]
}

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  scheduled:  { label: 'Scheduled',  className: 'bg-[#1A1A1A] text-[#94A3B8] border border-[#333]' },
  active:     { label: 'Active',     className: 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30' },
  completed:  { label: 'Completed',  className: 'bg-green-950/40 text-green-400 border border-green-800/30' },
  cancelled:  { label: 'Cancelled',  className: 'bg-red-950/40 text-red-400 border border-red-800/30' },
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const datePart = d.toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  })
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase()
  return `${datePart} · ${timePart}`
}

function SessionRow({ session, index }: { session: Session; index: number }) {
  const status = STATUS_STYLE[session.status] ?? STATUS_STYLE.scheduled
  const title = session.session_title ?? `Session ${session.session_index}`
  const dateStr = session.scheduled_at ? formatDateTime(session.scheduled_at) : 'Not scheduled'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
    >
      <Link href={`/dashboard/sessions/${session.id}`} className="block group">
        <Card className="p-4 flex items-center gap-4 group-hover:border-[#333] transition-colors cursor-pointer">
          {/* Session number badge */}
          <div className="w-9 h-9 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-[#A855F7]">{session.session_index}</span>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{title}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <CalendarDays size={11} className="text-[#475569]" />
              <p className="text-xs text-[#475569]">{dateStr}</p>
            </div>
          </div>

          {/* Duration */}
          <div className="flex items-center gap-1 text-xs text-[#475569] flex-shrink-0">
            <Clock size={12} />
            ~{session.duration_mins}m
          </div>

          {/* Status badge */}
          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium flex-shrink-0 ${status.className}`}>
            {status.label}
          </span>

          {/* Add to Calendar — stop propagation so it doesn't navigate */}
          <a
            href={`/api/sessions/${session.id}/calendar`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-[#475569] hover:text-[#94A3B8] transition-colors whitespace-nowrap flex-shrink-0"
            title="Add to Calendar"
          >
            + Cal
          </a>

          <ChevronRight size={14} className="text-[#333] group-hover:text-[#475569] transition-colors flex-shrink-0" />
        </Card>
      </Link>
    </motion.div>
  )
}

function TestSessionButton() {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [meetingUrl, setMeetingUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setState('loading')
    try {
      const res = await fetch('/api/admin/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'How Claude Works', durationMins: 30 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unknown error')
      setMeetingUrl(data.meetingUrl)
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }

  if (state === 'done' && meetingUrl) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-green-400 font-medium">Meeting ready!</span>
        <a
          href={meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 rounded-lg bg-green-950/50 border border-green-800/40 text-green-400 hover:bg-green-900/40 transition-colors font-semibold"
        >
          Join Google Meet →
        </a>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleCreate}
        disabled={state === 'loading'}
        className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-[#333] text-[#94A3B8] hover:border-[#7C3AED] hover:text-[#A855F7] transition-colors disabled:opacity-50"
      >
        {state === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
        {state === 'loading' ? 'Creating meeting…' : 'Test: How Claude Works'}
      </button>
      {state === 'error' && (
        <span className="text-xs text-red-400">{error}</span>
      )}
    </div>
  )
}

export default function SessionsClient({ sessions }: SessionsClientProps) {
  const now = new Date()
  const upcoming = sessions.filter(
    (s) => s.scheduled_at && new Date(s.scheduled_at) >= now && s.status !== 'cancelled' && s.status !== 'completed'
  )
  const past = sessions.filter(
    (s) => (s.scheduled_at && new Date(s.scheduled_at) < now) || s.status === 'completed' || s.status === 'cancelled'
  )

  return (
    <div className="space-y-10 max-w-3xl">
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
        <p className="text-[#94A3B8]">Your scheduled coaching sessions.</p>
      </motion.div>

      {/* Upcoming */}
      <section>
        <h2 className="text-sm font-semibold text-[#94A3B8] uppercase tracking-wider mb-4">
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <Card className="p-8 flex flex-col items-center gap-3 text-center">
            <PlusCircle size={32} className="text-[#333]" />
            <p className="text-[#475569] text-sm">No upcoming sessions.</p>
            <Link
              href="/dashboard/schedule"
              className="text-sm text-[#7C3AED] hover:text-[#A855F7] transition-colors font-semibold"
            >
              Go to Schedule to book your first session →
            </Link>
          </Card>
        ) : (
          <div className="space-y-3">
            {upcoming.map((session, i) => (
              <SessionRow key={session.id} session={session} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* Past */}
      <section>
        <h2 className="text-sm font-semibold text-[#94A3B8] uppercase tracking-wider mb-4">
          Past
        </h2>
        {past.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-[#475569] text-sm">No past sessions yet.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {past.map((session, i) => (
              <SessionRow key={session.id} session={session} index={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
