'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Calendar, Clock, Check, Pencil } from 'lucide-react'

export interface SchedulePrefs {
  selectedDays: number[]
  preferredHour: number
  preferredMinute: 0 | 15 | 30 | 45
  ampm: 'AM' | 'PM'
  maxDurationMins: 15 | 30
  timezone: string
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const HOUR_OPTIONS = [
  { label: '6:00 AM', hour: 6, ampm: 'AM' as const },
  { label: '7:00 AM', hour: 7, ampm: 'AM' as const },
  { label: '8:00 AM', hour: 8, ampm: 'AM' as const },
  { label: '9:00 AM', hour: 9, ampm: 'AM' as const },
  { label: '10:00 AM', hour: 10, ampm: 'AM' as const },
  { label: '11:00 AM', hour: 11, ampm: 'AM' as const },
  { label: '12:00 PM', hour: 12, ampm: 'PM' as const },
  { label: '1:00 PM', hour: 1, ampm: 'PM' as const },
  { label: '2:00 PM', hour: 2, ampm: 'PM' as const },
  { label: '3:00 PM', hour: 3, ampm: 'PM' as const },
  { label: '4:00 PM', hour: 4, ampm: 'PM' as const },
  { label: '5:00 PM', hour: 5, ampm: 'PM' as const },
  { label: '6:00 PM', hour: 6, ampm: 'PM' as const },
  { label: '7:00 PM', hour: 7, ampm: 'PM' as const },
  { label: '8:00 PM', hour: 8, ampm: 'PM' as const },
  { label: '9:00 PM', hour: 9, ampm: 'PM' as const },
  { label: '10:00 PM', hour: 10, ampm: 'PM' as const },
]

const DEFAULT_PREFS: SchedulePrefs = {
  selectedDays: [1, 3, 5],
  preferredHour: 2,
  preferredMinute: 0,
  ampm: 'PM',
  maxDurationMins: 30,
  timezone: 'UTC',
}

interface Props {
  initialPrefs: SchedulePrefs | null
  onSave: (prefs: SchedulePrefs) => void
}

export default function ScheduleCard({ initialPrefs, onSave }: Props) {
  const tz = typeof window !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC'

  const [editing, setEditing] = useState(!initialPrefs)
  const [prefs, setPrefs] = useState<SchedulePrefs>(initialPrefs ?? { ...DEFAULT_PREFS, timezone: tz })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleDay(day: number) {
    setPrefs((p) => {
      const has = p.selectedDays.includes(day)
      if (has && p.selectedDays.length === 1) return p
      return { ...p, selectedDays: has ? p.selectedDays.filter((d) => d !== day) : [...p.selectedDays, day].sort((a, b) => a - b) }
    })
  }

  function selectTime(hour: number, ampm: 'AM' | 'PM') {
    setPrefs((p) => ({ ...p, preferredHour: hour, ampm }))
  }

  function selectDuration(mins: 15 | 30) {
    setPrefs((p) => ({ ...p, maxDurationMins: mins }))
  }

  async function handleSave() {
    if (prefs.selectedDays.length === 0) {
      setError('Select at least one day.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/user/schedule-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...prefs, timezone: tz }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? 'Failed to save. Please try again.')
        return
      }
      onSave({ ...prefs, timezone: tz })
      setEditing(false)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const selectedTimeLabel = HOUR_OPTIONS.find(
    (o) => o.hour === prefs.preferredHour && o.ampm === prefs.ampm
  )?.label ?? '2:00 PM'

  const selectedDayLabels = prefs.selectedDays.map((d) => DAY_LABELS[d]).join(', ')

  if (!editing) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-[#10B981]/30 bg-[#10B981]/5 p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#10B981]/15 flex items-center justify-center flex-shrink-0">
            <Check size={14} className="text-[#10B981]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Schedule set</p>
            <p className="text-xs text-[#475569] mt-0.5">
              {selectedDayLabels} · {selectedTimeLabel} · {prefs.maxDurationMins} min sessions
            </p>
          </div>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 text-xs text-[#475569] hover:text-[#94A3B8] transition-colors"
        >
          <Pencil size={12} />
          Edit
        </button>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-[#7C3AED]/40 bg-[#7C3AED]/5 p-5 space-y-5"
    >
      <div className="flex items-center gap-2">
        <Calendar size={16} className="text-[#7C3AED]" />
        <p className="text-sm font-semibold text-white">Set your learning schedule</p>
        <span className="text-xs text-[#475569]">— required before approving</span>
      </div>

      {/* Day picker */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-[#475569] uppercase tracking-wider">Days</p>
        <div className="flex gap-2 flex-wrap">
          {DAY_LABELS.map((label, idx) => {
            const selected = prefs.selectedDays.includes(idx)
            return (
              <button
                key={label}
                onClick={() => toggleDay(idx)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                  selected
                    ? 'bg-[#7C3AED] text-white'
                    : 'bg-[#111111] border border-[#222222] text-[#475569] hover:border-[#333333] hover:text-[#94A3B8]'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Time + Duration */}
      <div className="flex gap-6 flex-wrap">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-[#475569]" />
            <p className="text-xs font-medium text-[#475569] uppercase tracking-wider">Preferred time</p>
          </div>
          <select
            value={`${prefs.preferredHour}-${prefs.ampm}`}
            onChange={(e) => {
              const [h, ap] = e.target.value.split('-')
              selectTime(parseInt(h), ap as 'AM' | 'PM')
            }}
            className="bg-[#111111] border border-[#222222] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#7C3AED] cursor-pointer"
          >
            {HOUR_OPTIONS.map((o) => (
              <option key={o.label} value={`${o.hour}-${o.ampm}`}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-[#475569] uppercase tracking-wider">Session length</p>
          <div className="flex gap-2">
            {([15, 30] as const).map((mins) => (
              <button
                key={mins}
                onClick={() => selectDuration(mins)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  prefs.maxDurationMins === mins
                    ? 'bg-[#7C3AED] text-white'
                    : 'bg-[#111111] border border-[#222222] text-[#475569] hover:border-[#333333] hover:text-[#94A3B8]'
                }`}
              >
                {mins} min
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-[#EF4444]">{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving || prefs.selectedDays.length === 0}
        className="px-5 py-2.5 rounded-lg bg-[#7C3AED] text-white text-sm font-semibold hover:bg-[#A855F7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving…' : 'Save schedule'}
      </button>
    </motion.div>
  )
}
