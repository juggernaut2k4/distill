import type { CurriculumPlan, CurriculumSession } from '@/lib/content/curriculum'

export interface SchedulePreferences {
  firstSessionDate: string   // ISO date string
  frequencyDays: number      // fallback when selectedDays not provided
  selectedDays?: number[]    // 0=Sun, 1=Mon, ..., 6=Sat; when set, overrides frequencyDays
  maxDurationMins: number    // 15 or 30
  preferredHour?: number     // 0–23. Defaults to 9.
  preferredMinute?: number   // 0, 15, 30, or 45. Defaults to 0.
}

export interface ScheduledSession {
  sessionIndex: number
  title: string
  topicId: string           // catalog topic ID e.g. "ai-fundamentals"
  topics: string[]
  subtopics: string[]       // pre-defined subtopic titles from catalog
  scheduledAt: string       // ISO timestamp
  estimatedMinutes: number
}

function getSessionDatesForWeekDays(firstDate: Date, selectedDays: number[], count: number): Date[] {
  const sorted = [...selectedDays].sort((a, b) => a - b)
  if (sorted.length === 0) return []
  const dates: Date[] = []
  let current = new Date(firstDate)

  while (dates.length < count) {
    const dayOfWeek = current.getDay()
    const nextDay = sorted.find((d) => d >= dayOfWeek)

    if (nextDay !== undefined) {
      const d = new Date(current)
      d.setDate(current.getDate() + (nextDay - dayOfWeek))
      dates.push(d)
      current = new Date(d)
      current.setDate(d.getDate() + 1)
    } else {
      // No selected day remaining this week — jump to first selected day of next week
      const daysToNext = 7 - dayOfWeek + sorted[0]
      current.setDate(current.getDate() + daysToNext)
    }
  }

  return dates
}

/**
 * Generates a scheduled session list from a curriculum plan and preferences.
 */
export function scheduleSessions(
  plan: CurriculumPlan,
  prefs: SchedulePreferences
): ScheduledSession[] {
  const scheduled: ScheduledSession[] = []
  const startDate = new Date(`${prefs.firstSessionDate}T00:00:00`)
  const hour = prefs.preferredHour ?? 9
  const minute = prefs.preferredMinute ?? 0

  // Compute session dates — day-of-week mode or legacy frequency mode
  const sessionDates: Date[] =
    prefs.selectedDays && prefs.selectedDays.length > 0
      ? getSessionDatesForWeekDays(startDate, prefs.selectedDays, plan.sessions.length)
      : Array.from({ length: plan.sessions.length }, (_, i) => {
          const d = new Date(startDate)
          d.setDate(startDate.getDate() + i * prefs.frequencyDays)
          return d
        })

  for (let i = 0; i < plan.sessions.length; i++) {
    const session: CurriculumSession = plan.sessions[i]
    const sessionDate = sessionDates[i] ?? new Date(startDate)
    sessionDate.setHours(hour, minute, 0, 0)

    const cappedMinutes = Math.min(session.estimatedMinutes, prefs.maxDurationMins)
    const primaryTopic = session.topics[0]

    // Derive a stable topic ID guaranteed to be a non-empty string.
    // Priority: (1) catalog topic ID from the primary topic, (2) kebab-slug of the
    // session title, (3) positional fallback 'session-N' when the title produces an
    // empty slug (e.g. all-punctuation, all-numeric after stripping, or empty string).
    const slugFromTitle = session.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
      .slice(0, 60)
    const derivedTopicId: string = primaryTopic?.id || slugFromTitle || (() => {
      console.warn(
        `[planner] Session ${i + 1} title "${session.title}" produced an empty slug — using positional fallback.`
      )
      return `session-${i + 1}`
    })()

    scheduled.push({
      sessionIndex: i + 1,
      title: session.title,
      topicId: derivedTopicId,
      topics: session.topics.map((t) => t.title),
      subtopics: primaryTopic?.subtopics ?? [],
      scheduledAt: sessionDate.toISOString(),
      estimatedMinutes: cappedMinutes,
    })
  }

  return scheduled
}

/**
 * Returns total minutes needed for all sessions.
 */
export function totalMinutesNeeded(sessions: ScheduledSession[]): number {
  return sessions.reduce((sum, s) => sum + s.estimatedMinutes, 0)
}

/**
 * Checks if user has enough minutes and returns a recommendation if not.
 */
export function checkMinutesSufficiency(
  needed: number,
  balance: number
): { sufficient: boolean; deficit: number; recommendedPack: string | null } {
  if (balance >= needed) {
    return { sufficient: true, deficit: 0, recommendedPack: null }
  }

  const deficit = needed - balance

  let recommendedPack: string
  if (deficit <= 60) {
    recommendedPack = 'Starter Pack — 60 minutes'
  } else if (deficit <= 120) {
    recommendedPack = 'Standard Pack — 120 minutes'
  } else {
    recommendedPack = 'Power Pack — 300 minutes'
  }

  return { sufficient: false, deficit, recommendedPack }
}
