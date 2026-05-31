import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'

type Step = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> }

const VISIBLE_MIN_THRESHOLD = 3
const VISIBLE_TARGET = 5

/**
 * Daily cron safety net at 08:00 UTC.
 * Promotes sessions from queue to visible plan for approved plans below threshold.
 * Also triggers queue regeneration if queue is depleted.
 */
export const curriculumQueueCron = inngest.createFunction(
  {
    id: 'curriculum-queue-cron',
    retries: 1,
    triggers: [{ cron: '0 8 * * *' }],
  },
  async ({ step }: { step: Step }) => {
    const supabase = createSupabaseAdminClient()

    const plans = await step.run('fetch-approved-plans', async () => {
      const { data } = await supabase
        .from('curriculum_plans')
        .select('id, user_id, visible_sessions, queue_sessions')
        .eq('is_approved', true)
        .is('superseded_at', null)
      return (data ?? []) as Array<{
        id: string
        user_id: string
        visible_sessions: Array<{ session_id: string }>
        queue_sessions: unknown[]
      }>
    })

    const completionsMap = await step.run('fetch-all-completions', async () => {
      const planIds = plans.map((p) => p.id)
      if (planIds.length === 0) return {} as Record<string, string[]>
      const { data } = await supabase
        .from('session_completions')
        .select('plan_id, session_id')
        .in('plan_id', planIds)
      const map: Record<string, string[]> = {}
      for (const row of (data ?? []) as Array<{ plan_id: string; session_id: string }>) {
        if (!map[row.plan_id]) map[row.plan_id] = []
        map[row.plan_id].push(row.session_id)
      }
      return map
    })

    let promoted = 0
    let regenerated = 0

    await step.run('process-plans', async () => {
      for (const plan of plans) {
        const completedIds = new Set((completionsMap[plan.id] ?? []))
        const visibleSessions = Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []
        const remaining = visibleSessions.filter((s) => !completedIds.has(s.session_id))
        const queueSessions = Array.isArray(plan.queue_sessions) ? plan.queue_sessions : []

        if (remaining.length < VISIBLE_MIN_THRESHOLD && queueSessions.length > 0) {
          const toPromote = Math.min(Math.max(0, VISIBLE_TARGET - remaining.length), queueSessions.length)
          const promoting = queueSessions.slice(0, toPromote)
          const newQueue = queueSessions.slice(toPromote)
          const newVisible = [...visibleSessions, ...promoting]

          await supabase
            .from('curriculum_plans')
            .update({ visible_sessions: newVisible, queue_sessions: newQueue })
            .eq('id', plan.id)

          promoted += toPromote

          if (newQueue.length < 5) {
            await inngest.send({ name: 'clio/queue.regenerate', data: { user_id: plan.user_id, plan_id: plan.id } })
            regenerated++
          }
        } else if (queueSessions.length < 5) {
          await inngest.send({ name: 'clio/queue.regenerate', data: { user_id: plan.user_id, plan_id: plan.id } })
          regenerated++
        }
      }
    })

    return { plans_checked: plans.length, sessions_promoted: promoted, queues_regenerated: regenerated }
  }
)
