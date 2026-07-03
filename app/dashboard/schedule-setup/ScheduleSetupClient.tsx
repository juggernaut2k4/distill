'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface SessionRow {
  session_index: number
  session_title: string | null
  topic_id: string | null
  topics: string[] | null
  duration_mins: number
  status: string
}

function computeScheduledDates(
  sessions: { session_index: number }[],
  prefs: {
    selectedDays: number[]
    preferredHour: number
    preferredMinute: number
    ampm: 'AM' | 'PM'
    timezone: string
  }
): string[] {
  const sorted = [...sessions].sort((a, b) => a.session_index - b.session_index)
  const hour24 =
    prefs.ampm === 'AM'
      ? prefs.preferredHour === 12
        ? 0
        : prefs.preferredHour
      : prefs.preferredHour === 12
      ? 12
      : prefs.preferredHour + 12

  const firstDate = new Date().toLocaleDateString('en-CA', { timeZone: prefs.timezone }) // YYYY-MM-DD

  const sortedDays = [...prefs.selectedDays].sort((a, b) => a - b)
  const dates: string[] = []
  let current = new Date(`${firstDate}T00:00:00`)

  for (let i = 0; i < sorted.length; i++) {
    const dayOfWeek = current.getDay()
    const nextDay = sortedDays.find((d) => d >= dayOfWeek) ?? sortedDays[0]
    if (nextDay < dayOfWeek) {
      const daysToNext = 7 - dayOfWeek + nextDay
      current.setDate(current.getDate() + daysToNext)
    } else {
      current.setDate(current.getDate() + (nextDay - dayOfWeek))
    }
    const d = new Date(current)
    d.setHours(hour24, prefs.preferredMinute, 0, 0)
    dates.push(d.toISOString())
    current.setDate(current.getDate() + 1)
  }

  return dates
}

export default function ScheduleSetupClient() {
  const router = useRouter()

  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]) // Mon–Fri
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(0)
  const [ampm, setAmpm] = useState<'AM' | 'PM'>('AM')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timezone =
    typeof window !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC'

  function toggleDay(day: number) {
    setSelectedDays((prev) => {
      if (prev.includes(day)) {
        // Don't allow deselecting the last day
        if (prev.length === 1) return prev
        return prev.filter((d) => d !== day)
      }
      return [...prev, day]
    })
  }

  function decrementHour() {
    setHour((h) => (h === 1 ? 12 : h - 1))
  }

  function incrementHour() {
    setHour((h) => (h === 12 ? 1 : h + 1))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)

    try {
      // 1. Save prefs
      const prefsRes = await fetch('/api/user/schedule-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedDays,
          preferredHour: hour,
          preferredMinute: minute,
          ampm,
          timezone,
        }),
      })
      if (!prefsRes.ok) throw new Error('Failed to save preferences')

      // 2. Fetch current sessions
      const sessionsRes = await fetch('/api/sessions/schedule')
      if (!sessionsRes.ok) throw new Error('Failed to fetch sessions')
      const { sessions } = (await sessionsRes.json()) as { sessions: SessionRow[] }
      const activeSessions = (sessions ?? []).filter(
        (s) => !['completed', 'cancelled', 'draft'].includes(s.status)
      )

      if (activeSessions.length === 0) {
        // No sessions to schedule — go straight to sessions page
        router.push('/dashboard/sessions')
        return
      }

      // 3. Compute new dates
      const dates = computeScheduledDates(activeSessions, {
        selectedDays,
        preferredHour: hour,
        preferredMinute: minute,
        ampm,
        timezone,
      })

      // 4. Build ScheduledSession array
      const scheduledSessions = activeSessions.map((s, i) => ({
        sessionIndex: s.session_index,
        title: s.session_title ?? `Session ${s.session_index}`,
        topicId: s.topic_id ?? (s.topics?.[0] ?? 'unknown'),
        topics: s.topics ?? [],
        subtopics: [],
        scheduledAt: dates[i] ?? new Date().toISOString(),
        // Duration is fixed at generation time from onboarding data — this screen
        // no longer collects or overrides it (AUTOGEN-01 Part B).
        estimatedMinutes: s.duration_mins ?? 30,
      }))

      // 5. Schedule sessions
      const schedRes = await fetch('/api/sessions/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: scheduledSessions }),
      })
      if (!schedRes.ok) throw new Error('Failed to schedule sessions')

      // 6. Redirect
      router.push('/dashboard/sessions')
    } catch {
      setError('Something went wrong — please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <h1 className="text-2xl font-bold text-white mb-1">When do you want to learn?</h1>
      <p className="text-sm text-[#475569] mb-8">
        Clio will schedule your sessions around these times.
      </p>

      {/* ── Day picker ── */}
      <div className="mb-8">
        <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider mb-3">
          Days
        </p>
        <div className="flex gap-2 flex-wrap">
          {DAY_LABELS.map((label, idx) => {
            const selected = selectedDays.includes(idx)
            return (
              <button
                key={idx}
                onClick={() => toggleDay(idx)}
                className={
                  selected
                    ? 'bg-purple-950/50 border border-[#7C3AED] text-white rounded-full px-3 py-1.5 text-sm font-semibold cursor-pointer transition-colors'
                    : 'bg-[#111111] border border-[#222222] text-[#475569] rounded-full px-3 py-1.5 text-sm cursor-pointer hover:border-[#333333] hover:text-[#94A3B8] transition-colors'
                }
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Time picker ── */}
      <div className="mb-8">
        <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider mb-3">
          Time
        </p>

        {/* Hour */}
        <div className="flex items-center gap-4 mb-4">
          <span className="text-xs text-[#475569] w-14">Hour</span>
          <div className="flex items-center gap-3">
            <button
              onClick={decrementHour}
              className="w-8 h-8 rounded-lg border border-[#222222] bg-[#111111] flex items-center justify-center text-[#94A3B8] hover:border-[#333333] hover:text-white transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-white font-bold text-lg w-6 text-center">{hour}</span>
            <button
              onClick={incrementHour}
              className="w-8 h-8 rounded-lg border border-[#222222] bg-[#111111] flex items-center justify-center text-[#94A3B8] hover:border-[#333333] hover:text-white transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Minute */}
        <div className="flex items-center gap-4 mb-4">
          <span className="text-xs text-[#475569] w-14">Minute</span>
          <div className="flex gap-2">
            {([0, 15, 30, 45] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMinute(m)}
                className={
                  minute === m
                    ? 'px-3 py-1.5 rounded-lg text-sm font-semibold bg-purple-950/50 border border-[#7C3AED] text-white transition-colors'
                    : 'px-3 py-1.5 rounded-lg text-sm bg-[#111111] border border-[#222222] text-[#475569] hover:border-[#333333] hover:text-[#94A3B8] transition-colors'
                }
              >
                {String(m).padStart(2, '0')}
              </button>
            ))}
          </div>
        </div>

        {/* AM/PM */}
        <div className="flex items-center gap-4">
          <span className="text-xs text-[#475569] w-14">AM/PM</span>
          <div className="flex gap-2">
            {(['AM', 'PM'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setAmpm(period)}
                className={
                  ampm === period
                    ? 'px-4 py-1.5 rounded-lg text-sm font-semibold bg-purple-950/50 border border-[#7C3AED] text-white transition-colors'
                    : 'px-4 py-1.5 rounded-lg text-sm bg-[#111111] border border-[#222222] text-[#475569] hover:border-[#333333] hover:text-[#94A3B8] transition-colors'
                }
              >
                {period}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

      <Button onClick={handleSubmit} disabled={submitting} className="w-full mt-6 gap-2">
        {submitting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Saving…
          </>
        ) : (
          <>
            Confirm schedule <ArrowRight size={16} />
          </>
        )}
      </Button>

      <p className="text-xs text-[#475569] text-center mt-3">Your timezone: {timezone}</p>
    </div>
  )
}
