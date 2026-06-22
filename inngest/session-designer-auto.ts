import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  designSessionsForTopic,
  getSessionDuration,
  type CurriculumTopicInput,
} from '@/lib/curriculum/session-designer'

interface PlanGeneratedEvent {
  data: { planId: string; userId: string; cached: boolean }
}
type Step = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> }

interface VisibleSession extends CurriculumTopicInput {
  arc_name:        string
  arc_type:        string
  arc_position:    number
  arc_length:      number
  is_visible:      boolean
  queue_rationale?: string | null
  db_session_id?:  string
  [key: string]: unknown
}

/**
 * Inngest background job: designs all sessions for a newly generated curriculum plan.
 * Inserts sessions as status='draft' — invisible on the sessions screen until user approves.
 * Triggered by: curriculum-generator → fires "clio/plan.generated"
 */
export const sessionDesignerAuto = inngest.createFunction(
  {
    id: 'session-designer-auto',
    retries: 3,
    triggers: [{ event: 'clio/plan.generated' }],
  },
  async ({ event, step }: { event: PlanGeneratedEvent; step: Step }) => {
    const { planId, userId } = event.data
    const supabase = createSupabaseAdminClient()

    // ── Load plan + user ──────────────────────────────────────────────────────
    const { plan, user } = await step.run('load-plan-and-user', async () => {
      const [p, u] = await Promise.all([
        supabase.from('curriculum_plans').select('id, visible_sessions').eq('id', planId).single(),
        supabase.from('users').select('role, industry, ai_maturity, learning_goal').eq('id', userId).single(),
      ])
      return { plan: p.data, user: u.data }
    })

    if (!plan || !user) {
      console.error('[session-designer-auto] Plan or user not found', { planId, userId })
      return { error: 'not_found' }
    }

    // ── Check if draft sessions already exist for this plan ───────────────────
    const alreadyDesigned = await step.run('check-existing-sessions', async () => {
      const { count } = await supabase
        .from('sessions')
        .select('id', { count: 'exact', head: true })
        .eq('curriculum_plan_id', planId)
        .eq('status', 'draft')
      return (count ?? 0) > 0
    })

    if (alreadyDesigned) {
      console.log('[session-designer-auto] Sessions already exist for plan:', planId)
      return { skipped: true, reason: 'sessions_already_exist' }
    }

    const visibleSessions = (
      Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []
    ) as VisibleSession[]

    const maxMins = getSessionDuration((user as { learning_goal?: string }).learning_goal ?? null)
    const profile = {
      role:     ((user as { role?: string }).role)     ?? 'executive',
      industry: ((user as { industry?: string }).industry) ?? 'general',
      maturity: ((user as { ai_maturity?: string }).ai_maturity) ?? 'intermediate',
    }

    // ── Design sessions for each curriculum topic ─────────────────────────────
    const designResults = await step.run('design-all-sessions', async () => {
      const results = await Promise.all(
        visibleSessions.map(async (cs) => ({
          cs,
          designed: await designSessionsForTopic(
            {
              session_id:        cs.session_id,
              title:             cs.title,
              focus:             cs.focus,
              depth_level:       cs.depth_level,
              estimated_minutes: cs.estimated_minutes,
              subtopics:         cs.subtopics,
            },
            profile,
            maxMins
          ),
        }))
      )
      return results
    })

    // ── Insert sessions as draft ──────────────────────────────────────────────
    const updatedVisible = await step.run('insert-draft-sessions', async () => {
      let globalOrder = 0
      const updatedSessions: VisibleSession[] = []

      for (const { cs, designed } of designResults) {
        let firstDbSessionId: string | undefined

        for (const ds of designed) {
          globalOrder++
          const { data: inserted } = await supabase
            .from('sessions')
            .insert({
              user_id:               userId,
              session_title:         ds.session_title,
              topic_id:              cs.session_id,
              topics:                [cs.session_id],
              curriculum_plan_id:    planId,
              curriculum_session_id: cs.session_id,
              sub_sessions:          ds.subtopics,
              duration_mins:         ds.duration_mins,
              session_index:         globalOrder,
              status:                'draft',
            })
            .select('id')
            .single()

          if (inserted && !firstDbSessionId) firstDbSessionId = inserted.id
        }

        updatedSessions.push({ ...cs, db_session_id: firstDbSessionId })
      }

      return updatedSessions
    })

    // ── Embed db_session_ids back into the plan ───────────────────────────────
    await step.run('update-plan-with-session-ids', async () => {
      await supabase
        .from('curriculum_plans')
        .update({ visible_sessions: updatedVisible })
        .eq('id', planId)
    })

    console.log(`[session-designer-auto] ${visibleSessions.length} topics → sessions drafted for plan ${planId}`)
    return { success: true, planId, topicsDesigned: visibleSessions.length }
  }
)
