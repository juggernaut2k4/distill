'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import {
  CalendarDays, Clock, CheckCircle, AlertTriangle, ArrowRight, Zap, Download,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { buildCurriculum } from '@/lib/content/curriculum'
import { scheduleSessions, totalMinutesNeeded, checkMinutesSufficiency } from '@/lib/sessions/planner'

interface User {
  id: string
  ai_maturity: string | null
  topic_interests: string[] | null
  minutes_balance: number | null
  plan_tier: string | null
}

interface ExistingSession {
  id: string
  session_index: number
  session_title: string | null
  scheduled_at: string | null
  status: string
  topics: string[] | null
  duration_mins: number
}

interface ScheduleClientProps {
  user: User
  existingSessions: ExistingSession[]
}

const FREQUENCY_OPTIONS = [
  { value: 1, label: 'Daily', description: 'One session every day' },
  { value: 2, label: 'Every 2 days', description: 'Moderate pace' },
  { value: 7, label: 'Weekly', description: 'One session per week' },
]

const DURATION_OPTIONS = [
  { value: 15, label: '15 min', description: 'Quick focused sessions' },
  { value: 30, label: '30 min', description: 'Deep dives' },
]

const TIME_OPTIONS = [
  { value: 9,  label: 'Morning',   description: '9:00 am' },
  { value: 13, label: 'Afternoon', description: '1:00 pm' },
  { value: 18, label: 'Evening',   description: '6:00 pm' },
]

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
}

export default function ScheduleClient({ user, existingSessions }: ScheduleClientProps) {
  const router = useRouter()
  const hasExisting = existingSessions.length > 0

  // Get tomorrow as default start date
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  const [firstDate, setFirstDate] = useState(tomorrowStr)
  const [frequencyDays, setFrequencyDays] = useState(2)
  const [maxDuration, setMaxDuration] = useState(30)
  const [preferredHour, setPreferredHour] = useState(9)
  const [saving, setSaving] = useState(false)
  // confirmed: true once the user successfully posts the schedule
  const [confirmed, setConfirmed] = useState(false)

  const plan = useMemo(() => buildCurriculum(
    user.topic_interests ?? [],
    user.ai_maturity ?? 'observer'
  ), [user.topic_interests, user.ai_maturity])

  const scheduledSessions = useMemo(() =>
    scheduleSessions(plan, {
      firstSessionDate: firstDate,
      frequencyDays,
      maxDurationMins: maxDuration,
      preferredHour,
    }),
    [plan, firstDate, frequencyDays, maxDuration, preferredHour]
  )

  const totalNeeded = totalMinutesNeeded(scheduledSessions)
  const balance = user.minutes_balance ?? 0
  const { sufficient, deficit, recommendedPack } = checkMinutesSufficiency(totalNeeded, balance)

  async function handleConfirm() {
    setSaving(true)
    try {
      await fetch('/api/sessions/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: scheduledSessions }),
      })
      setConfirmed(true)
    } catch {
      setSaving(false)
    }
  }

  // Existing sessions view (already scheduled, not yet confirmed in this session)
  if (!confirmed && hasExisting) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Your Sessions</h1>
          <p className="text-[#94A3B8]">Your scheduled learning sessions.</p>
        </div>
        <div className="space-y-3">
          {existingSessions.map((session) => (
            <Card key={session.id} className="p-4 flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-[#A855F7]">{session.session_index}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {session.session_title ?? `Session ${session.session_index}`}
                </p>
                {session.scheduled_at && (
                  <p className="text-xs text-[#475569] mt-0.5">
                    {formatDateTime(session.scheduled_at)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-[#475569]">
                <Clock size={12} />
                {session.duration_mins}m
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                session.status === 'completed' ? 'bg-green-950/40 text-green-400 border border-green-800/30' :
                session.status === 'active' ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30' :
                'bg-[#1A1A1A] text-[#475569] border border-[#222]'
              }`}>
                {session.status}
              </span>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // Confirmation view — shown after successful schedule POST
  if (confirmed) {
    return (
      <AnimatePresence>
        <motion.div
          key="confirmed"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="max-w-2xl space-y-8"
        >
          {/* Success header */}
          <div className="flex flex-col items-center text-center py-8">
            <CheckCircle size={56} className="text-[#10B981] mb-4" />
            <h1 className="text-3xl font-bold text-white mb-2">Sessions Scheduled!</h1>
            <p className="text-[#94A3B8] max-w-sm">
              Your {scheduledSessions.length} session{scheduledSessions.length !== 1 ? 's are' : ' is'} confirmed.
              Reminders will be sent the day before each session.
            </p>
          </div>

          {/* Sessions list */}
          <div className="space-y-2">
            {scheduledSessions.map((session, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#111111] border border-[#1A1A1A]"
              >
                <div className="w-7 h-7 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-[#A855F7]">{session.sessionIndex}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{session.title}</p>
                  <p className="text-xs text-[#475569] mt-0.5">{formatDateTime(session.scheduledAt)}</p>
                </div>
                <div className="flex items-center gap-1 text-xs text-[#475569] flex-shrink-0">
                  <Clock size={10} />
                  {session.estimatedMinutes}m
                </div>
              </motion.div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-3 flex-wrap">
            {/* TODO: implement /api/sessions/calendar/all endpoint to generate ICS for all sessions */}
            <a
              href="/api/sessions/calendar/all"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#333333] text-sm font-semibold text-white hover:bg-[#1A1A1A] transition-colors"
            >
              <Download size={16} />
              Download All Calendar Invites
            </a>
            <Button onClick={() => router.push('/dashboard')} className="gap-2">
              Go to Dashboard
              <ArrowRight size={16} />
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>
    )
  }

  // Scheduling form
  return (
    <div className="max-w-2xl space-y-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 mb-2">
          <CalendarDays size={18} className="text-[#06B6D4]" />
          <span className="text-xs font-semibold text-[#06B6D4] uppercase tracking-wider">Schedule</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Schedule your sessions</h1>
        <p className="text-[#94A3B8]">
          {plan.sessions.length} sessions planned · {totalNeeded} minutes total
        </p>
      </motion.div>

      {/* Minutes check */}
      <AnimatePresence>
        {!sufficient && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-3 p-4 rounded-xl bg-amber-950/20 border border-amber-800/30"
          >
            <AlertTriangle size={18} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#FCD34D] mb-1">
                You need {deficit} more minutes
              </p>
              <p className="text-xs text-[#94A3B8] mb-3">
                Your balance ({balance} min) won&apos;t cover all sessions ({totalNeeded} min needed).
                Recommended: <strong className="text-white">{recommendedPack}</strong>
              </p>
              <Button variant="secondary" size="sm" className="gap-1.5">
                <Zap size={13} />
                Top up minutes
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preferences */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="space-y-6"
      >
        {/* Start date */}
        <div>
          <label className="text-sm font-semibold text-white mb-2 block">
            First session date
          </label>
          <input
            type="date"
            value={firstDate}
            min={tomorrowStr}
            onChange={(e) => setFirstDate(e.target.value)}
            className="bg-[#111111] border border-[#222222] text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#7C3AED] transition-colors w-full max-w-xs"
          />
        </div>

        {/* Frequency */}
        <div>
          <label className="text-sm font-semibold text-white mb-3 block">Frequency</label>
          <div className="grid grid-cols-3 gap-3">
            {FREQUENCY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFrequencyDays(opt.value)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  frequencyDays === opt.value
                    ? 'bg-purple-950/40 border-[#7C3AED] text-white'
                    : 'bg-[#111111] border-[#222222] text-[#94A3B8] hover:border-[#333] hover:text-white'
                }`}
              >
                <p className="text-sm font-semibold">{opt.label}</p>
                <p className="text-xs text-[#475569] mt-0.5">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Preferred time */}
        <div>
          <label className="text-sm font-semibold text-white mb-3 block">Preferred time</label>
          <div className="grid grid-cols-3 gap-3">
            {TIME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPreferredHour(opt.value)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  preferredHour === opt.value
                    ? 'bg-purple-950/40 border-[#7C3AED] text-white'
                    : 'bg-[#111111] border-[#222222] text-[#94A3B8] hover:border-[#333] hover:text-white'
                }`}
              >
                <p className="text-sm font-semibold">{opt.label}</p>
                <p className="text-xs text-[#475569] mt-0.5">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Max duration */}
        <div>
          <label className="text-sm font-semibold text-white mb-3 block">Max session duration</label>
          <div className="flex gap-3">
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMaxDuration(opt.value)}
                className={`flex-1 p-3 rounded-xl border text-left transition-all ${
                  maxDuration === opt.value
                    ? 'bg-purple-950/40 border-[#7C3AED] text-white'
                    : 'bg-[#111111] border-[#222222] text-[#94A3B8] hover:border-[#333] hover:text-white'
                }`}
              >
                <p className="text-sm font-semibold">{opt.label}</p>
                <p className="text-xs text-[#475569] mt-0.5">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Preview */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <h3 className="text-sm font-semibold text-[#94A3B8] uppercase tracking-wider mb-3">
          Schedule Preview
        </h3>
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {scheduledSessions.map((session, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#111111] border border-[#1A1A1A]"
            >
              <div className="w-6 h-6 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-bold text-[#A855F7]">{session.sessionIndex}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{session.title}</p>
              </div>
              <div className="text-xs text-[#475569] whitespace-nowrap">
                {new Date(session.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <div className="flex items-center gap-1 text-xs text-[#475569]">
                <Clock size={10} />
                {session.estimatedMinutes}m
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Confirm */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="flex items-center gap-4"
      >
        <Button
          onClick={handleConfirm}
          disabled={saving}
          size="lg"
          className="gap-2"
        >
          {saving ? (
            'Saving...'
          ) : (
            <>
              Confirm Schedule
              <ArrowRight size={18} />
            </>
          )}
        </Button>
        {sufficient && (
          <p className="text-xs text-[#475569]">
            Uses {totalNeeded} of your {balance} available minutes
          </p>
        )}
      </motion.div>
    </div>
  )
}
