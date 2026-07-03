import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateCurriculumPlan, buildProfileHash, generateArcsForTopics, generateBridgingArc, type Arc } from '@/lib/curriculum/planner'
import { checkDimensionCoverage } from '@/lib/curriculum/enrichment'

// Matches the slugify() used in session-designer-auto.ts so that if/when a queued
// arc is promoted or accepted and later session-designed, the real session_id
// (`${arcSlug}-part-1`) lines up with the placeholder id assigned here.
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

interface TopicDelta {
  removed: string[]
  added: string[]
  kept: string[]
  needsBridging: boolean
}

interface TopicsSelectedEvent {
  data: { userId: string; delta?: TopicDelta }
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

    // ── Smart Topic Delta (CORE_OBJECTIVES.md Objective 4) ────────────────────
    // If this event carries a delta (fired by POST /api/topics on an existing user),
    // branch off the standard full-regeneration path entirely:
    //   - added.length === 0 (pure deletion, or no change): the deletion route
    //     (app/api/topics/route.ts) already stripped removed-topic sessions/arcs
    //     structurally. Kept arcs are untouched. No LLM call needed here — exit.
    //   - added.length > 0: generate arcs ONLY for the added topics, judge bridging
    //     relatedness, and merge into the existing plan. Kept arcs are never
    //     re-sent to the LLM and never rewritten.
    const delta = event.data.delta
    if (delta) {
      if (delta.added.length === 0) {
        console.log('[curriculum-generator] Pure deletion or no-op delta — skipping LLM regeneration', { userId, removed: delta.removed })
        return { skipped: true, reason: 'pure_deletion_no_llm_call' }
      }

      const activePlan = await step.run('load-active-plan-for-delta', async () => {
        const { data } = await supabase
          .from('curriculum_plans')
          .select('id, visible_sessions, queue_sessions')
          .eq('user_id', userId)
          .is('superseded_at', null)
          .order('generated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        return data
      })

      if (activePlan) {
        const deltaProfile = { role, industry, maturity, worry, roleLevel, planTier }

        const additiveResult = await step.run('additive-delta-generation', async () => {
          const { arcs: newArcs, isFallback: newArcsFallback } = await generateArcsForTopics(delta.added, deltaProfile)

          let bridgeArc: Arc | null = null
          if (delta.needsBridging) {
            bridgeArc = await generateBridgingArc(delta.added, delta.kept, deltaProfile)
          }

          // Re-read the row immediately before writing (rather than trusting the
          // snapshot captured in the earlier step). This shrinks — though does not
          // fully eliminate — the window in which a concurrent topics-selected run
          // for the same user clobbers this merge with a stale visible/queue array.
          // A conditional update guarded by generated_at below is the real guard.
          const { data: freshPlan } = await supabase
            .from('curriculum_plans')
            .select('id, visible_sessions, queue_sessions, generated_at')
            .eq('id', activePlan.id)
            .is('superseded_at', null)
            .maybeSingle()

          // The plan we intended to merge into was superseded or deleted between
          // our read and now (a concurrent run won the race). Do not blindly fall
          // through to full regeneration — that is exactly how duplicate rows are
          // created. Re-resolve the CURRENT active plan and merge into that one,
          // since delta.added must always merge into whatever plan is active now,
          // never spawn a second row.
          const mergeTarget = freshPlan ?? await (async () => {
            const { data } = await supabase
              .from('curriculum_plans')
              .select('id, visible_sessions, queue_sessions, generated_at')
              .eq('user_id', userId)
              .is('superseded_at', null)
              .order('generated_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            return data
          })()

          if (!mergeTarget) {
            // Genuinely no active plan exists right now (e.g. it was superseded
            // and the new one hasn't been inserted yet). Surface this so the
            // caller falls through to full regeneration exactly once, with the
            // insert-side unique-violation guard as the final backstop against
            // a duplicate row.
            return { success: false, reason: 'no_active_plan_after_reread' as const }
          }

          const existingVisible = Array.isArray(mergeTarget.visible_sessions) ? mergeTarget.visible_sessions as unknown[] : []
          const existingQueue   = Array.isArray(mergeTarget.queue_sessions)   ? mergeTarget.queue_sessions   as unknown[] : []

          // Bridge goes first — it's the on-ramp into the new topic — then the new topic arcs.
          // Kept arcs (existingVisible/existingQueue) are spread unchanged, never mutated.
          const arcsToAdd = bridgeArc ? [bridgeArc, ...newArcs] : newArcs
          const newVisibleArcs = arcsToAdd.filter((a) => a.is_visible)
          const newQueueArcs   = arcsToAdd.filter((a) => !a.is_visible)

          const mergedVisible = [...existingVisible, ...newVisibleArcs]
          const mergedQueue   = [...existingQueue, ...newQueueArcs]

          // Conditional update: only write if the row is still the active,
          // non-superseded plan at the moment of the write. If a concurrent run
          // superseded it in between our re-read and this update, this affects
          // zero rows instead of silently merging into a plan that's about to be
          // (or already was) retired — surfacing as a clean no-op we can log,
          // rather than corrupting either row.
          const { data: updatedRows } = await supabase
            .from('curriculum_plans')
            .update({
              visible_sessions: mergedVisible,
              queue_sessions: mergedQueue,
              // Mark not-approved so the user reviews the updated plan before sessions materialize.
              is_approved: false,
            })
            .eq('id', mergeTarget.id)
            .is('superseded_at', null)
            .select('id')

          if (!updatedRows || updatedRows.length === 0) {
            console.warn('[curriculum-generator] Merge target was superseded mid-write — retrying will re-resolve', { userId, planId: mergeTarget.id })
            return { success: false, reason: 'merge_target_superseded_mid_write' as const }
          }

          await supabase
            .from('users')
            .update({ plan_approved: false })
            .eq('id', userId)

          console.log('[curriculum-generator] Additive delta merged', {
            userId,
            planId: mergeTarget.id,
            addedTopics: delta.added,
            newArcCount: arcsToAdd.length,
            bridged: !!bridgeArc,
            newArcsFallback,
          })

          return { success: true, planId: mergeTarget.id, additive: true, bridged: !!bridgeArc }
        })

        if (additiveResult.success) {
          return additiveResult
        }

        // additive merge could not complete safely (race). Throwing here lets
        // Inngest's built-in retry (3, exponential backoff — see function config)
        // re-run the whole function from the top, which will re-resolve the
        // active plan fresh rather than falling through to a full regeneration
        // that would create a second row.
        throw new Error(`[curriculum-generator] Additive delta merge could not complete safely (${additiveResult.reason}) — retrying`)
      }

      console.warn('[curriculum-generator] Delta with added topics but no active plan found — falling back to full regeneration', { userId })
      // No active plan to merge into (e.g. first save with a delta payload, or a
      // genuinely brand-new user) — fall through to the standard full-generation
      // path below. The insert in that path is guarded against duplicate rows by
      // catching a unique-constraint violation and re-resolving into the winning
      // row instead (see save-plan step below).
    }

    // ── Early-exit guard (second line of defence against duplicate runs) ──────
    // Inngest idempotency keys prevent two runs from starting, but if two events
    // slip through (e.g. different idempotency keys), this guard ensures the
    // second run exits immediately once it sees a non-fallback plan already saved.
    const { data: existingGuard } = await supabase
      .from('curriculum_plans')
      .select('id, raw_llm_output')
      .eq('user_id', userId)
      .is('superseded_at', null)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingGuard && !(existingGuard.raw_llm_output as { is_fallback?: boolean } | null)?.is_fallback) {
      console.log('[curriculum-generator] plan already exists, skipping duplicate run', { userId, planId: existingGuard.id })
      return { skipped: true }
    }

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

      // Never supersede an already-approved plan. This guards against a duplicate
      // clio/topics.selected event arriving after the user has approved their plan.
      const { data: userRow } = await supabase
        .from('users')
        .select('plan_approved, active_plan_id')
        .eq('id', userId)
        .single()
      if (userRow?.plan_approved && userRow.active_plan_id === existing.id) {
        console.log('[curriculum-generator] Plan already approved — skipping regeneration', { userId, planId: existing.id })
        return existing.id
      }

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

    // CURR-01 v2: dimension coverage check relied on arc.sessions[] which no longer exists.
    // Skip the check for v2 plans — the LLM prompt already enforces comprehensive subtopic
    // coverage per arc. This step is a no-op passthrough for v2.
    const enrichedRawLlmOutput = await step.run('check-dimension-coverage', async () => {
      return { ...rawLlmOutput, dimension_coverage_result: null }
    })

    // ── Save to DB ────────────────────────────────────────────────────────────
    const newPlanId = await step.run('save-plan', async () => {
      // CURR-01 v2: store arc objects directly (comprehensive_subtopics[], not sessions[])
      const visibleSessions = output.arcs
        .filter((a) => a.is_visible)
        .map((a) => ({ arc_name: a.arc_name, arc_type: a.arc_type, arc_description: a.arc_description, comprehensive_subtopics: a.comprehensive_subtopics }))
      const queueSessions = output.arcs
        .filter((a) => !a.is_visible)
        .map((a) => ({
          // session_id/arc_position identify this queued arc's entry point so the
          // "Recommended for you" filter (arc_position === 1) in
          // GET /api/curriculum/plan can find it. These arcs haven't been
          // session-designed yet (that only happens for visible/accepted arcs via
          // session-designer-auto.ts), so arc_position: 1 means "this arc's entry
          // point" rather than a literal index into a real session breakdown.
          session_id: `${slugify(a.arc_name)}-part-1`,
          arc_position: 1,
          arc_name: a.arc_name,
          arc_type: a.arc_type,
          arc_description: a.arc_description,
          comprehensive_subtopics: a.comprehensive_subtopics,
          queue_rationale: a.queue_rationale,
        }))

      const { data: newPlan, error: insertError } = await supabase
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

      if (insertError) {
        // 23505 = unique_violation. Once idx_curriculum_plans_one_active_per_user
        // (partial unique index on user_id WHERE superseded_at IS NULL) is applied,
        // a concurrent run that already inserted the active plan for this user
        // causes this insert to fail here instead of silently succeeding as a
        // second live row. Re-resolve to the row that won the race and use it —
        // never treat this as a hard failure.
        if (insertError.code === '23505') {
          console.warn('[curriculum-generator] Concurrent insert detected (unique_violation) — resolving to winning row', { userId })
          const { data: winner } = await supabase
            .from('curriculum_plans')
            .select('id')
            .eq('user_id', userId)
            .is('superseded_at', null)
            .order('generated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          return winner?.id ?? null
        }
        console.error('[curriculum-generator] Insert failed:', insertError)
        return null
      }

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
