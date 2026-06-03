/**
 * Hourly cron: proactively generates content for Sessions 2+ for every user.
 *
 * Session 1 is handled immediately on schedule confirmation (via session-content-pipeline).
 * This job picks up the next pending session per user (session_index > 1) and fires
 * the content generation pipeline for it.
 *
 * Rate: one session per user per hour. Prevents thundering-herd and stays within
 * Claude API rate limits even with many concurrent users.
 */

import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'

export const sessionContentCron = inngest.createFunction(
  {
    id: 'session-content-cron',
    name: 'Hourly: Generate content for next pending session per user',
    triggers: [{ cron: '0 * * * *' }],
  },
  async ({ step }) => {
    const supabase = createSupabaseAdminClient()

    const SELECT_COLS = 'id, user_id, session_index, session_title, topic_id, topics, duration_mins, curriculum_session_id'

    // Branch 1: old-style sessions (have scheduled_at, session_index > 1)
    const { data: oldStyleSessions, error: err1 } = await supabase
      .from('sessions')
      .select(SELECT_COLS)
      .eq('status', 'scheduled')
      .not('content_status', 'eq', 'ready')
      .gt('session_index', 1)
      .not('scheduled_at', 'is', null)
      .gt('scheduled_at', new Date().toISOString())
      .order('session_index', { ascending: true })

    // Branch 2: curriculum sessions (no scheduled_at, have curriculum_session_id)
    const { data: curriculumSessions, error: err2 } = await supabase
      .from('sessions')
      .select(SELECT_COLS)
      .eq('status', 'scheduled')
      .not('content_status', 'eq', 'ready')
      .not('curriculum_session_id', 'is', null)
      .order('session_index', { ascending: true })

    if (err1) console.error('[session-content-cron] old-style query error:', err1.message)
    if (err2) console.error('[session-content-cron] curriculum query error:', err2.message)

    // Merge and deduplicate by session id
    const seen = new Set<string>()
    const allPending: Array<{ id: string; user_id: string; session_index: number; session_title: string | null; topic_id: string | null; topics: unknown; curriculum_session_id: string | null }> = []
    for (const s of [...(oldStyleSessions ?? []), ...(curriculumSessions ?? [])]) {
      if (!seen.has(s.id)) {
        seen.add(s.id)
        allPending.push(s as typeof allPending[0])
      }
    }

    if (allPending.length === 0) {
      console.log('[session-content-cron] No pending sessions found this hour')
      return { processed: 0 }
    }

    // For old-style sessions: throttle to one per user (lowest session_index).
    // For curriculum sessions: fire all — approve route handles initial load,
    // cron is the recovery mechanism so all pending sessions need processing.
    const perUserOldStyle = new Map<string, typeof allPending[0]>()
    const curriculumTargets: typeof allPending = []

    for (const session of allPending) {
      if (session.curriculum_session_id) {
        curriculumTargets.push(session)
      } else if (!perUserOldStyle.has(session.user_id)) {
        perUserOldStyle.set(session.user_id, session)
      }
    }

    const targets = [...Array.from(perUserOldStyle.values()), ...curriculumTargets]
    console.log(`[session-content-cron] Processing ${targets.length} sessions (${perUserOldStyle.size} old-style, ${curriculumTargets.length} curriculum)`)

    // Fire content generation event for each target session
    await step.run('fire-content-generation-events', async () => {
      const events = targets.map((session) => ({
        name: 'distill/session.content.generate' as const,
        data: {
          sessionId: session.id,
          topicId: session.topic_id ?? session.curriculum_session_id ?? 'ai-fundamentals',
          topicTitle: session.session_title ?? 'AI Session',
          subtopics: (session.topics as string[] | null) ?? [],
          userId: session.user_id,
          priority: 'background',
        },
      }))

      await inngest.send(events)
      return { fired: events.length }
    })

    return {
      processed: targets.length,
      sessionIds: targets.map((s) => s.id),
    }
  }
)
