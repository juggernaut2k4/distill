import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateCurriculumPlan, buildProfileHash } from '@/lib/curriculum/planner'
import { applyEnrichmentVisibility } from '@/lib/curriculum/enrichment'
import { inferRoleLevel } from '@/lib/curriculum/role-utils'
import type { RawLlmOutput } from '@/lib/curriculum/types'

// 1 plan call (90s cap) + up to 3 enrichment calls (15s each) = ~135s max
// Use 300 to leave a safety margin; retries removed so this is a hard ceiling
export const maxDuration = 300

/**
 * POST /api/curriculum/generate
 * Generates an LLM-powered curriculum plan for the authenticated user.
 * If a non-superseded plan already exists for the current profile hash, returns it.
 * Otherwise generates a new plan and saves it.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: user, error: dbError } = await supabase
    .from('users')
    .select('id, role, industry, ai_maturity, role_level, topic_interests, plan_tier, worry_tags, learning_goal')
    .eq('id', userId!)
    .single()

  if (!user) {
    console.error('[curriculum/generate] user not found', { userId: userId?.slice(0, 12), code: dbError?.code })
    return NextResponse.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, { status: 404 })
  }

  const topics: string[] = Array.isArray(user.topic_interests) ? user.topic_interests : []
  if (topics.length === 0) {
    return NextResponse.json({ error: 'No topics selected', code: 'NO_TOPICS' }, { status: 400 })
  }

  const role = user.role ?? 'executive'
  const industry = user.industry ?? 'general'
  const maturity = user.ai_maturity ?? 'intermediate'
  // Infer roleLevel from role name when role_level is missing — avoids defaulting
  // everyone to 'c-suite' which produces executive framing for ICs and managers.
  // inferRoleLevel is imported from lib/curriculum/role-utils (shared with topics page).
  const roleLevel = (user.role_level as string | null) ?? inferRoleLevel(user.role ?? '')
  const worry = Array.isArray(user.worry_tags) ? user.worry_tags.join(', ') : ''
  const planTier = user.plan_tier ?? null
  const profileHash = buildProfileHash(role, maturity, topics, roleLevel)

  // Use order+limit+maybeSingle so multiple rows (race condition) never silently return null
  const { data: existing } = await supabase
    .from('curriculum_plans')
    .select('id, visible_sessions, queue_sessions, is_approved, user_profile_hash, raw_llm_output')
    .eq('user_id', userId!)
    .is('superseded_at', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const existingIsFallback = existing?.raw_llm_output
    ? (existing.raw_llm_output as RawLlmOutput).fallback === true
    : false
  const apiKeyAvailable = (process.env.ANTHROPIC_API_KEY ?? '').length > 0 &&
    !(process.env.ANTHROPIC_API_KEY ?? '').startsWith('PLACEHOLDER_')

  // Cache hit: same profile hash AND (real plan OR still no API key to improve it)
  if (existing && existing.user_profile_hash === profileHash && (!existingIsFallback || !apiKeyAvailable)) {
    return NextResponse.json({
      plan_id: existing.id,
      visible_sessions: existing.visible_sessions,
      is_approved: existing.is_approved,
      arc_count: 0,
      total_visible: Array.isArray(existing.visible_sessions) ? existing.visible_sessions.length : 0,
      is_fallback: existingIsFallback,
      cached: true,
    })
  }

  // Supersede ALL non-superseded plans (handles race where multiple rows exist)
  if (existing) {
    await supabase
      .from('curriculum_plans')
      .update({ superseded_at: new Date().toISOString() })
      .eq('user_id', userId!)
      .is('superseded_at', null)

    await supabase
      .from('users')
      .update({ active_plan_id: null, plan_approved: false })
      .eq('id', userId!)
  }

  const { output, isFallback, rawLlmOutput, enrichedPlan } = await generateCurriculumPlan({
    userId: userId!,
    role,
    industry,
    maturity,
    worry,
    topics,
    planTier,
    roleLevel,
    learningGoal: (user as { learning_goal?: string }).learning_goal ?? undefined,
  })

  // FB-007: when enrichment succeeded, apply layer-based visibility rules
  // (L1 skip for advanced/expert; quality threshold < 5.5 → queue).
  // When enrichment failed (null), fall back to the base plan's is_visible flags unchanged.
  let visibleSessions: object[]
  let queueSessions: object[]

  if (enrichedPlan && !isFallback) {
    const { visible, queued } = applyEnrichmentVisibility(enrichedPlan)
    visibleSessions = visible
    queueSessions = queued
  } else {
    // CURR-01 v2: arcs have comprehensive_subtopics[], not sessions[].
    // Store arcs directly — the session organizer divides them into sessions at approve time.
    visibleSessions = output.arcs
      .filter((a) => a.is_visible)
      .map((a) => ({ arc_name: a.arc_name, arc_type: a.arc_type, arc_description: a.arc_description, comprehensive_subtopics: a.comprehensive_subtopics }))
    queueSessions = output.arcs
      .filter((a) => !a.is_visible)
      .map((a) => ({ arc_name: a.arc_name, arc_type: a.arc_type, arc_description: a.arc_description, comprehensive_subtopics: a.comprehensive_subtopics, queue_rationale: a.queue_rationale }))
  }

  // Store enriched_plan inside raw_llm_output JSONB — no new DB column needed.
  const rawLlmOutputWithEnrichment = {
    ...rawLlmOutput,
    is_fallback: isFallback,
    ...(enrichedPlan ? { enriched_plan: enrichedPlan } : {}),
  }

  const { data: newPlan, error: insertError } = await supabase
    .from('curriculum_plans')
    .insert({
      user_id: userId!,
      raw_llm_output: rawLlmOutputWithEnrichment,
      visible_sessions: visibleSessions,
      queue_sessions: queueSessions,
      user_profile_hash: profileHash,
      generated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (insertError || !newPlan) {
    return NextResponse.json({ error: 'Failed to save plan', code: 'DB_ERROR' }, { status: 500 })
  }

  return NextResponse.json({
    plan_id: newPlan.id,
    visible_sessions: visibleSessions,
    is_approved: false,
    arc_count: output.arcs.length,
    total_visible: visibleSessions.length,
    is_fallback: isFallback,
    enriched: enrichedPlan !== null,
    cached: false,
  })
}
