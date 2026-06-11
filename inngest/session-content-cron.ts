/**
 * Hourly cron: proactively generates content for sessions per user.
 *
 * Each tick performs three tasks in order:
 *   1. Stale-ready recovery — sessions marked 'ready' with no topic_content_cache rows
 *      are silently broken; reset them to 'pending' so the pipeline re-runs.
 *   2. Pending generation — fire content pipeline for sessions not yet generated,
 *      excluding any session currently in-flight (content_status='generating').
 *   3. Empty-subtopic guard — never fire the pipeline for sessions with no subtopics
 *      designed yet; prevents ai-fundamentals fallback content being stored under
 *      the wrong cache key.
 *
 * Rate: one old-style session per user per hour. Curriculum sessions: all pending.
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

    // ── Task 1: Stale-ready recovery ─────────────────────────────────────────
    // A session with content_status='ready' but zero topic_content_cache rows
    // will return CONTENT_NOT_READY when launched. Reset it to 'pending' so
    // the cron re-queues it for generation this tick.
    const recoveryResult = await step.run('reset-stale-ready-sessions', async () => {
      const { data: candidateSessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('content_status', 'ready')
        .eq('status', 'scheduled')

      if (!candidateSessions?.length) return { reset: 0 }

      const staleIds: string[] = []
      await Promise.all(
        candidateSessions.map(async (s) => {
          const { count } = await supabase
            .from('topic_content_cache')
            .select('id', { count: 'exact', head: true })
            .eq('topic_id', s.id)
          if ((count ?? 0) === 0) staleIds.push(s.id)
        })
      )

      if (staleIds.length === 0) return { reset: 0 }

      await supabase
        .from('sessions')
        .update({ content_status: 'pending' })
        .in('id', staleIds)

      console.log(`[session-content-cron] Stale-ready reset: ${staleIds.length} sessions`, staleIds)
      return { reset: staleIds.length }
    })

    // ── Task 2: Query pending sessions ───────────────────────────────────────
    // Fix 1: exclude 'generating' to prevent duplicate parallel pipeline runs.
    const SELECT_COLS = 'id, user_id, session_index, session_title, topic_id, topics, duration_mins, curriculum_session_id, subtopics'

    // Branch A: old-style sessions (have scheduled_at, session_index > 1)
    const { data: oldStyleSessions, error: err1 } = await supabase
      .from('sessions')
      .select(SELECT_COLS)
      .eq('status', 'scheduled')
      .not('content_status', 'eq', 'ready')
      .not('content_status', 'eq', 'generating')
      .gt('session_index', 1)
      .not('scheduled_at', 'is', null)
      .gt('scheduled_at', new Date().toISOString())
      .order('session_index', { ascending: true })

    // Branch B: sessions with subtopics assigned (session designer has run)
    const { data: curriculumSessions, error: err2 } = await supabase
      .from('sessions')
      .select(SELECT_COLS)
      .eq('status', 'scheduled')
      .not('content_status', 'eq', 'ready')
      .not('content_status', 'eq', 'generating')
      .not('subtopics', 'is', null)
      .order('session_index', { ascending: true })

    if (err1) console.error('[session-content-cron] old-style query error:', err1.message)
    if (err2) console.error('[session-content-cron] curriculum query error:', err2.message)

    // Merge and deduplicate by session id
    const seen = new Set<string>()
    const allPending: Array<{
      id: string
      user_id: string
      session_index: number
      session_title: string | null
      topic_id: string | null
      topics: unknown
      curriculum_session_id: string | null
      subtopics: unknown
    }> = []
    for (const s of [...(oldStyleSessions ?? []), ...(curriculumSessions ?? [])]) {
      if (!seen.has(s.id)) {
        seen.add(s.id)
        allPending.push(s as typeof allPending[0])
      }
    }

    if (allPending.length === 0) {
      console.log('[session-content-cron] No pending sessions found this hour')
      return { processed: 0, staleReset: recoveryResult.reset }
    }

    // ── Task 3: Build firing targets ─────────────────────────────────────────
    // Old-style: one per user (lowest session_index).
    // Curriculum: all pending, but skip any session with no subtopics designed yet
    // (Fix 3: pipeline would silently fall back to ai-fundamentals subtopics and
    // store content under the wrong cache key).
    const perUserOldStyle = new Map<string, typeof allPending[0]>()
    const curriculumTargets: typeof allPending = []
    const skippedNoSubtopics: string[] = []

    for (const session of allPending) {
      if (session.curriculum_session_id) {
        const hasSubtopics =
          Array.isArray(session.subtopics) && (session.subtopics as unknown[]).length > 0
        const hasTopics =
          Array.isArray(session.topics) && (session.topics as unknown[]).length > 0
        if (!hasSubtopics && !hasTopics) {
          skippedNoSubtopics.push(session.id)
          console.log(
            `[session-content-cron] Skipping ${session.id} ("${session.session_title}") — no subtopics designed yet`
          )
          continue
        }
        curriculumTargets.push(session)
      } else if (!perUserOldStyle.has(session.user_id)) {
        perUserOldStyle.set(session.user_id, session)
      }
    }

    const targets = [...Array.from(perUserOldStyle.values()), ...curriculumTargets]
    console.log(
      `[session-content-cron] Firing ${targets.length} sessions ` +
      `(${perUserOldStyle.size} old-style, ${curriculumTargets.length} curriculum, ` +
      `${skippedNoSubtopics.length} skipped — no subtopics)`
    )

    // ── Fire content generation events ───────────────────────────────────────
    await step.run('fire-content-generation-events', async () => {
      const events = targets.map((session) => ({
        name: 'distill/session.content.generate' as const,
        data: {
          sessionId: session.id,
          userId: session.user_id,
          priority: 'background' as const,
        },
      }))

      await inngest.send(events)
      return { fired: events.length }
    })

    return {
      processed: targets.length,
      staleReset: recoveryResult.reset,
      skippedNoSubtopics: skippedNoSubtopics.length,
      sessionIds: targets.map((s) => s.id),
    }
  }
)
