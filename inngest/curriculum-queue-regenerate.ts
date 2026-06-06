import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateQueueExtension } from '@/lib/curriculum/planner'

interface RegenerateEvent {
  data: { user_id: string; plan_id: string }
}
type Step = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> }

/**
 * Regenerates the shadow queue when it drops below 5 sessions.
 * Triggered by: POST /api/curriculum/complete-session or daily cron.
 */
export const curriculumQueueRegenerate = inngest.createFunction(
  {
    id: 'curriculum-queue-regenerate',
    retries: 3,
    triggers: [{ event: 'clio/queue.regenerate' }],
  },
  async ({ event, step }: { event: RegenerateEvent; step: Step }) => {
    const { user_id, plan_id } = event.data
    const supabase = createSupabaseAdminClient()

    const { plan, user, completions } = await step.run('fetch-data', async () => {
      const [p, u, c] = await Promise.all([
        supabase.from('curriculum_plans').select('id, queue_sessions').eq('id', plan_id).single(),
        supabase.from('users').select('role, industry, ai_maturity, role_level, topic_interests, plan_tier, worry').eq('id', user_id).single(),
        supabase.from('session_completions').select('session_id').eq('user_id', user_id).eq('plan_id', plan_id),
      ])
      return { plan: p.data, user: u.data, completions: c.data ?? [] }
    })

    if (!plan || !user) return { skipped: true, reason: 'plan or user not found' }

    const currentQueue = Array.isArray(plan.queue_sessions) ? plan.queue_sessions : []
    if (currentQueue.length >= 5) return { skipped: true, reason: 'queue already sufficient' }

    const completedIds = (completions as Array<{ session_id: string }>).map((c) => c.session_id)

    const { data: fullPlan } = await supabase
      .from('curriculum_plans')
      .select('visible_sessions')
      .eq('id', plan_id)
      .single()

    const visibleSessions: Array<{ session_id: string; title: string }> = Array.isArray(fullPlan?.visible_sessions) ? fullPlan.visible_sessions : []
    const completedTitles = visibleSessions
      .filter((s) => completedIds.includes(s.session_id))
      .map((s) => s.title)

    const newSessions = await step.run('generate-extension', async () => {
      return generateQueueExtension(
        {
          userId: user_id,
          role: (user as { role?: string }).role ?? 'executive',
          industry: (user as { industry?: string }).industry ?? 'general',
          maturity: (user as { ai_maturity?: string }).ai_maturity ?? 'intermediate',
          roleLevel: (user as { role_level?: string }).role_level ?? 'c-suite',
          worry: (user as { worry?: string }).worry ?? '',
          topics: Array.isArray((user as { topic_interests?: string[] }).topic_interests) ? (user as { topic_interests: string[] }).topic_interests : [],
          planTier: (user as { plan_tier?: string }).plan_tier ?? null,
        },
        completedTitles,
      )
    })

    if (newSessions.length === 0) return { success: false, reason: 'LLM returned no sessions' }

    await step.run('append-to-queue', async () => {
      const updatedQueue = [...currentQueue, ...newSessions]
      await supabase
        .from('curriculum_plans')
        .update({ queue_sessions: updatedQueue })
        .eq('id', plan_id)
    })

    return { success: true, added: newSessions.length }
  }
)
