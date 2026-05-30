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

    // Find all users who have at least one pending session beyond Session 1
    const { data: pendingSessions, error } = await supabase
      .from('sessions')
      .select('id, user_id, session_index, session_title, topic_id, topics, duration_mins')
      .eq('status', 'scheduled')
      .eq('content_status', 'pending')
      .gt('session_index', 1)           // Session 1 handled on schedule confirmation
      .gt('scheduled_at', new Date().toISOString()) // future sessions only
      .order('session_index', { ascending: true })

    if (error) {
      console.error('[session-content-cron] Failed to query pending sessions:', error.message)
      return { processed: 0, error: error.message }
    }

    if (!pendingSessions || pendingSessions.length === 0) {
      console.log('[session-content-cron] No pending sessions found this hour')
      return { processed: 0 }
    }

    // Group by user — pick only the lowest session_index per user
    const perUser = new Map<string, typeof pendingSessions[0]>()
    for (const session of pendingSessions) {
      if (!perUser.has(session.user_id)) {
        perUser.set(session.user_id, session)
      }
    }

    const targets = Array.from(perUser.values())
    console.log(`[session-content-cron] Processing ${targets.length} sessions (one per user)`)

    // Fire content generation event for each target session
    await step.run('fire-content-generation-events', async () => {
      const events = targets.map((session) => ({
        name: 'distill/session.content.generate' as const,
        data: {
          sessionId: session.id,
          topicId: session.topic_id ?? 'ai-fundamentals',
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
