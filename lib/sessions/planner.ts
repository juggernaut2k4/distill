import type { CurriculumPlan, CurriculumSession } from '@/lib/content/curriculum'

export interface SchedulePreferences {
  firstSessionDate: string  // ISO date string
  frequencyDays: number     // 1 = daily, 2 = every 2 days, 7 = weekly
  maxDurationMins: number   // 15 or 30
  preferredHour?: number    // Hour of day: 9 (Morning), 13 (Afternoon), 18 (Evening). Defaults to 9.
}

export interface ScheduledSession {
  sessionIndex: number
  title: string
  topics: string[]
  scheduledAt: string       // ISO timestamp
  estimatedMinutes: number
}

/**
 * Generates a scheduled session list from a curriculum plan and preferences.
 */
export function scheduleSessions(
  plan: CurriculumPlan,
  prefs: SchedulePreferences
): ScheduledSession[] {
  const scheduled: ScheduledSession[] = []
  const startDate = new Date(prefs.firstSessionDate)

  for (let i = 0; i < plan.sessions.length; i++) {
    const session: CurriculumSession = plan.sessions[i]
    const sessionDate = new Date(startDate)
    sessionDate.setDate(startDate.getDate() + i * prefs.frequencyDays)

    // Set to preferred hour (defaults to 9am)
    const hour = prefs.preferredHour ?? 9
    sessionDate.setHours(hour, 0, 0, 0)

    const cappedMinutes = Math.min(session.estimatedMinutes, prefs.maxDurationMins)

    scheduled.push({
      sessionIndex: i + 1,
      title: session.title,
      topics: session.topics.map((t) => t.title),
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
