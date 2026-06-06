import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateCurriculumPlan, buildProfileHash } from '@/lib/curriculum/planner'

interface TopicsSelectedEvent {
  data: { userId: string }
}
type Step = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T>; sendEvent: (name: string, event: { name: string; data: object }) => Promise<void> }

/**
 * Inngest background job: generates the LLM curriculum plan when topics are saved.
 * Triggered by: POST /api/topics → fires "clio/topics.selected"
 *
 * On completion fires "clio/plan.generated" → session-designer-auto picks it up.
 */
export const curriculumGenerator = inngest.createFunction(
  {
    id: 'curriculum-generator',
    retries: 3,
    triggers: [{ event: 'clio/topics.selected' }],
  },
  async ({ event, step }: { event: TopicsSelectedEvent; step: Step }) => {
    const { userId } = event.data
    const supabase = createSupabaseAdminClient()

    // ── Load user profile ─────────────────────────────────────────────────────
    const user = await step.run('load-user', async () => {
      const { data } = await supabase
        .from('users')
        .select('id, role, industry, ai_maturity, role_level, topic_interests, plan_tier, worry_tags')
        .eq('id', userId)
        .single()
      return data
    })

    if (!user) {
      console.error('[curriculum-generator] User not found:', userId)
      return { error: 'user_not_found' }
    }

    const topics: string[] = Array.isArray(user.topic_interests) ? user.topic_interests : []
    if (topics.length === 0) {
      console.warn('[curriculum-generator] No topics for user:', userId)
      return { error: 'no_topics' }
    }

    const role      = (user.role        as string | null) ?? 'executive'
    const industry  = (user.industry    as string | null) ?? 'general'
    const maturity  = (user.ai_maturity as string | null) ?? 'intermediate'
    const roleLevel = (user.role_level  as string | null) ?? 'c-suite'
    const worry     = Array.isArray(user.worry_tags) ? user.worry_tags.join(', ') : ''
    const planTier  = (user.plan_tier   as string | null) ?? null
    const profileHash = buildProfileHash(role, maturity, topics, roleLevel)

    // ── Supersede existing plan if profile changed ────────────────────────────
    const existingPlanId = await step.run('supersede-old-plan', async () => {
      const { data: existing } = await supabase
        .from('curriculum_plans')
        .select('id, user_profile_hash, raw_llm_output')
        .eq('user_id', userId)
        .is('superseded_at', null)
        .single()

      if (!existing) return null

      const isFallback = existing.raw_llm_output
        ? (existing.raw_llm_output as { is_fallback?: boolean }).is_fallback === true
        : false
      const apiKeyAvailable = (process.env.ANTHROPIC_API_KEY ?? '').length > 0 &&
        !(process.env.ANTHROPIC_API_KEY ?? '').startsWith('PLACEHOLDER_')

      // Cache hit — same profile, not a fallback (or still no API key to improve it)
      if (existing.user_profile_hash === profileHash && (!isFallback || !apiKeyAvailable)) {
        return existing.id
      }

      // Profile changed or was fallback — supersede
      await supabase
        .from('curriculum_plans')
        .update({ superseded_at: new Date().toISOString() })
        .eq('id', existing.id)

      await supabase
        .from('users')
        .update({ active_plan_id: null, plan_approved: false })
        .eq('id', userId)

      // Delete draft sessions belonging to the superseded plan
      await supabase
        .from('sessions')
        .delete()
        .eq('user_id', userId)
        .eq('curriculum_plan_id', existing.id)
        .eq('status', 'draft')

      return null
    })

    // Cache hit — plan already exists and is valid
    if (existingPlanId) {
      console.log('[curriculum-generator] Cache hit — plan already valid:', existingPlanId)

      // Still fire plan.generated so session-designer-auto can check if sessions exist
      await step.sendEvent('fire-plan-generated', {
        name: 'clio/plan.generated',
        data: { planId: existingPlanId, userId, cached: true },
      })
      return { cached: true, planId: existingPlanId }
    }

    // ── Generate new curriculum plan ──────────────────────────────────────────
    const { output, isFallback, rawLlmOutput } = await step.run('generate-plan', async () => {
      return generateCurriculumPlan({ userId, role, industry, maturity, worry, topics, planTier, roleLevel })
    })

    // ── Save to DB ────────────────────────────────────────────────────────────
    const newPlanId = await step.run('save-plan', async () => {
      const visibleSessions = output.arcs.flatMap((a) =>
        a.sessions.filter((s) => s.is_visible).map((s) => ({ ...s, arc_name: a.arc_name, arc_type: a.arc_type }))
      )
      const queueSessions = output.arcs.flatMap((a) =>
        a.sessions.filter((s) => !s.is_visible).map((s) => ({ ...s, arc_name: a.arc_name, arc_type: a.arc_type }))
      )

      const { data: newPlan } = await supabase
        .from('curriculum_plans')
        .insert({
          user_id:           userId,
          raw_llm_output:    { ...rawLlmOutput, is_fallback: isFallback },
          visible_sessions:  visibleSessions,
          queue_sessions:    queueSessions,
          user_profile_hash: profileHash,
          generated_at:      new Date().toISOString(),
        })
        .select('id')
        .single()

      return newPlan?.id ?? null
    })

    if (!newPlanId) {
      console.error('[curriculum-generator] Failed to save plan for user:', userId)
      return { error: 'db_insert_failed' }
    }

    console.log(`[curriculum-generator] Plan generated for user ${userId}: ${newPlanId}`)

    // ── Fire plan.generated → triggers session-designer-auto ─────────────────
    await step.sendEvent('fire-plan-generated', {
      name: 'clio/plan.generated',
      data: { planId: newPlanId, userId, cached: false },
    })

    return { success: true, planId: newPlanId, isFallback }
  }
)
