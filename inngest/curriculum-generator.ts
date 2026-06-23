import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateCurriculumPlan, buildProfileHash } from '@/lib/curriculum/planner'
import { checkDimensionCoverage } from '@/lib/curriculum/enrichment'

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

    let topics: string[] = Array.isArray(user.topic_interests) ? user.topic_interests : []

    // Auto-select topics from catalog when user hasn't visited /topics yet.
    // Happens when payment fires immediately after onboarding (before topic selection).
    // Selects up to 5 catalog entries relevant to the user's industry + maturity.
    if (topics.length === 0) {
      console.warn('[curriculum-generator] No topic_interests — auto-selecting from catalog for user:', userId)
      const { data: catalogRows } = await supabase
        .from('topic_catalog')
        .select('slug')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(5)

      if (catalogRows && catalogRows.length > 0) {
        topics = catalogRows.map((r: { slug: string }) => r.slug)
        // Persist so future runs and the topics page reflect the auto-selection
        await supabase.from('users').update({ topic_interests: topics }).eq('id', userId)
        console.log('[curriculum-generator] Auto-selected topics:', topics)
      } else {
        // Hard fallback: use known starter slugs if catalog is empty
        topics = ['llm-basics', 'ai-strategy', 'evaluating-ai-vendors']
        await supabase.from('users').update({ topic_interests: topics }).eq('id', userId)
        console.log('[curriculum-generator] Used hardcoded fallback topics')
      }
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
      // Use order+limit+maybeSingle so multiple rows (race condition) never silently return null
      const { data: existing } = await supabase
        .from('curriculum_plans')
        .select('id, user_profile_hash, raw_llm_output')
        .eq('user_id', userId)
        .is('superseded_at', null)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

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

      // Supersede ALL non-superseded plans (handles race where multiple rows exist)
      await supabase
        .from('curriculum_plans')
        .update({ superseded_at: new Date().toISOString() })
        .eq('user_id', userId)
        .is('superseded_at', null)

      await supabase
        .from('users')
        .update({ active_plan_id: null, plan_approved: false })
        .eq('id', userId)

      // Delete all non-final sessions from the superseded plan so they don't
      // occupy (user_id, session_index) slots in the unique index and block
      // inserts for the new plan.
      await supabase
        .from('sessions')
        .delete()
        .eq('user_id', userId)
        .eq('curriculum_plan_id', existing.id)
        .not('status', 'in', '("completed","cancelled")')

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

    // ── CURR-01: 7-Dimension Coverage Check ──────────────────────────────────
    // Runs after enrichment, before save. Mutates visibleSessionsForCoverage in-place
    // if gap-fill sessions are added. Result is stored in raw_llm_output.
    const enrichedRawLlmOutput = await step.run('check-dimension-coverage', async () => {
      // Extract visible EnrichedSession objects from output.arcs
      // (enrichedPlan is embedded in rawLlmOutput by generateCurriculumPlan)
      const visibleSessions = output.arcs.flatMap((a) =>
        a.sessions
          .filter((s) => s.is_visible)
          .map((s) => ({ ...s, arc_name: a.arc_name, arc_type: a.arc_type }))
      )

      const coverageResult = await checkDimensionCoverage(
        // Cast to EnrichedSession[] — visibleSessions have the same shape
        visibleSessions as Parameters<typeof checkDimensionCoverage>[0],
        { role, roleLevel, industry, maturity },
      )

      // If gap-fill sessions were added, splice them into output.arcs
      // (gap-fill sessions are appended to visibleSessions in-place inside checkDimensionCoverage)
      if (coverageResult.gap_fill_sessions_added > 0) {
        const gapSessions = visibleSessions.slice(
          visibleSessions.length - coverageResult.gap_fill_sessions_added
        )
        for (const gs of gapSessions) {
          // Append gap-fill sessions to their arc (or create a new arc entry if arc not found)
          const targetArc = output.arcs.find((a) => a.arc_name === gs.arc_name)
          if (targetArc) {
            targetArc.sessions.push({ ...gs })
          } else {
            output.arcs.push({
              arc_name: gs.arc_name,
              arc_type: (gs.arc_type as 'domain' | 'integrated' | 'singleton') ?? 'singleton',
              sessions: [{ ...gs }],
            })
          }
        }
      }

      return { ...rawLlmOutput, dimension_coverage_result: coverageResult }
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
          raw_llm_output:    { ...enrichedRawLlmOutput, is_fallback: isFallback },
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
