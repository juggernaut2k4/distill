import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateCurriculumPlan, buildProfileHash } from '@/lib/curriculum/planner'

/**
 * POST /api/curriculum/generate
 * Generates an LLM-powered curriculum plan for the authenticated user.
 * If a non-superseded plan already exists for the current profile hash, returns it.
 * Otherwise generates a new plan and saves it.
 */
export async function POST() {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: user, error: dbError } = await supabase
    .from('users')
    .select('id, role, industry, ai_maturity, topic_interests, plan_tier, worry_tags')
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
  const worry = Array.isArray(user.worry_tags) ? user.worry_tags.join(', ') : ''
  const planTier = user.plan_tier ?? null
  const profileHash = buildProfileHash(role, maturity, topics)

  // Return existing plan if profile has not changed AND it is not a fallback plan
  const { data: existing } = await supabase
    .from('curriculum_plans')
    .select('id, visible_sessions, queue_sessions, is_approved, user_profile_hash, raw_llm_output')
    .eq('user_id', userId!)
    .is('superseded_at', null)
    .single()

  const existingIsFallback = existing?.raw_llm_output
    ? (existing.raw_llm_output as { is_fallback?: boolean }).is_fallback === true
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

  // Supersede the old plan if profile changed
  if (existing) {
    await supabase
      .from('curriculum_plans')
      .update({ superseded_at: new Date().toISOString() })
      .eq('id', existing.id)

    await supabase
      .from('users')
      .update({ active_plan_id: null, plan_approved: false })
      .eq('id', userId!)
  }

  const { output, isFallback, rawLlmOutput } = await generateCurriculumPlan({
    userId: userId!,
    role,
    industry,
    maturity,
    worry,
    topics,
    planTier,
  })

  const visibleSessions = output.arcs.flatMap((a) =>
    a.sessions.filter((s) => s.is_visible).map((s) => ({ ...s, arc_name: a.arc_name, arc_type: a.arc_type }))
  )
  const queueSessions = output.arcs.flatMap((a) =>
    a.sessions.filter((s) => !s.is_visible).map((s) => ({ ...s, arc_name: a.arc_name, arc_type: a.arc_type }))
  )

  const { data: newPlan, error: insertError } = await supabase
    .from('curriculum_plans')
    .insert({
      user_id: userId!,
      raw_llm_output: { ...rawLlmOutput, is_fallback: isFallback },
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
    total_visible: output.total_visible,
    is_fallback: isFallback,
    cached: false,
  })
}
