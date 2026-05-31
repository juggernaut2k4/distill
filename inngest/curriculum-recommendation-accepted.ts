import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateQueueExtension } from '@/lib/curriculum/planner'

interface AcceptedEvent {
  data: { user_id: string; plan_id: string; session_id: string }
}
type Step = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> }

/**
 * Handles a user accepting a recommended topic.
 * Generates follow-on sessions for the accepted topic's arc and appends to queue.
 */
export const curriculumRecommendationAccepted = inngest.createFunction(
  {
    id: 'curriculum-recommendation-accepted',
    retries: 2,
    triggers: [{ event: 'clio/recommendation.accepted' }],
  },
  async ({ event, step }: { event: AcceptedEvent; step: Step }) => {
    const { user_id, plan_id, session_id } = event.data
    const supabase = createSupabaseAdminClient()

    const { plan, user } = await step.run('fetch-context', async () => {
      const [p, u] = await Promise.all([
        supabase.from('curriculum_plans').select('queue_sessions, visible_sessions').eq('id', plan_id).single(),
        supabase.from('users').select('role, industry, ai_maturity, topic_interests, plan_tier, worry').eq('id', user_id).single(),
      ])
      return { plan: p.data, user: u.data }
    })

    if (!plan || !user) return { skipped: true }

    const visibleSessions: Array<{ session_id: string; title: string; arc_name?: string }> = Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []
    const accepted = visibleSessions.find((s) => s.session_id === session_id)
    const arcName = accepted?.arc_name ?? 'Unknown Arc'

    const completedTitles = visibleSessions.map((s) => s.title)

    const newSessions = await step.run('generate-follow-on', async () => {
      const u = user as { role?: string; industry?: string; ai_maturity?: string; worry?: string; topic_interests?: string[]; plan_tier?: string }
      return generateQueueExtension(
        {
          userId: user_id,
          role: u.role ?? 'executive',
          industry: u.industry ?? 'general',
          maturity: u.ai_maturity ?? 'intermediate',
          worry: u.worry ?? '',
          topics: Array.isArray(u.topic_interests) ? u.topic_interests : [],
          planTier: u.plan_tier ?? null,
        },
        completedTitles,
      )
    })

    if (newSessions.length === 0) return { success: false, reason: 'no follow-on sessions generated' }

    await step.run('append-sessions', async () => {
      const currentQueue: unknown[] = Array.isArray(plan.queue_sessions) ? plan.queue_sessions : []
      const updatedQueue = [...currentQueue, ...newSessions]
      await supabase
        .from('curriculum_plans')
        .update({ queue_sessions: updatedQueue })
        .eq('id', plan_id)
    })

    return { success: true, added: newSessions.length, arc: arcName }
  }
)
