'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  ArrowLeft, CalendarDays, Clock, Download, Tag, CheckCircle,
  Circle, XCircle, Loader,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

interface Session {
  id: string
  session_index: number
  session_title: string | null
  scheduled_at: string | null
  status: string
  topics: string[] | null
  duration_mins: number
}

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
    </div>
  )
}
