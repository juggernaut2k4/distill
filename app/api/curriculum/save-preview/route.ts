import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { buildProfileHash } from '@/lib/curriculum/planner'
import { inngest } from '@/inngest/client'

const BodySchema = z.object({
  profile_hash: z.string().min(8).max(64),
})

const TIER_VISIBLE_LIMIT: Record<string, number> = {
  starter:   5,
  pro:       10,
  executive: 10,
}
const DEFAULT_VISIBLE_LIMIT = 5  // starter (no free tier)

/**
 * POST /api/curriculum/save-preview
 *
 * Auth required. Called from the dashboard on first load when the browser has
 * a cached curriculum plan in localStorage (clio_plan_preview).
 *
 * Copies the shared plan template to the authenticated user's curriculum_plans
 * table, enforcing their actual tier limits. Fires clio/plan.generated so
 * session-designer-auto can design sessions in the background (as draft).
 *
 * Idempotent: if the user already has a valid plan with the same profile hash,
 * returns it without creating a duplicate.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  const { profile_hash } = parsed.data
  const supabase = createSupabaseAdminClient()

  // ── Load the shared template ───────────────────────────────────────────────
  const { data: template } = await supabase
    .from('curriculum_plan_templates')
    .select('visible_sessions, queue_sessions, is_fallback')
    .eq('profile_hash', profile_hash)
    .maybeSingle()

  if (!template) {
    return NextResponse.json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' }, { status: 404 })
  }

  // Never copy a fallback template — it has 1 session per topic (no LLM expansion).
  // Return 404 so the caller falls through to the normal Inngest-based generation.
  if (template.is_fallback) {
    return NextResponse.json({ error: 'Template is a fallback — skipping', code: 'TEMPLATE_FALLBACK' }, { status: 404 })
  }

  // ── Check if user already has a valid plan with the same hash ─────────────
  const { data: existing } = await supabase
    .from('curriculum_plans')
    .select('id, is_approved')
    .eq('user_id', userId!)
    .eq('user_profile_hash', profile_hash)
    .is('superseded_at', null)
    .maybeSingle()

  if (existing) {
    // Plan already saved — fire plan.generated in case sessions weren't designed yet
    await inngest.send({ name: 'clio/plan.generated', data: { planId: existing.id, userId: userId!, cached: true } })
    return NextResponse.json({ plan_id: existing.id, already_exists: true })
  }

  // ── Load user to get plan_tier ─────────────────────────────────────────────
  const { data: user } = await supabase
    .from('users')
    .select('plan_tier, topic_interests, role, ai_maturity, role_level')
    .eq('id', userId!)
    .single()

  // ── Supersede any existing plan with a different hash ─────────────────────
  const { data: oldPlan } = await supabase
    .from('curriculum_plans')
    .select('id')
    .eq('user_id', userId!)
    .is('superseded_at', null)
    .maybeSingle()

  if (oldPlan) {
    await supabase
      .from('curriculum_plans')
      .update({ superseded_at: new Date().toISOString() })
      .eq('id', oldPlan.id)

    // Delete draft sessions from the superseded plan
    await supabase
      .from('sessions')
      .delete()
      .eq('user_id', userId!)
      .eq('curriculum_plan_id', oldPlan.id)
      .eq('status', 'draft')

    await supabase
      .from('users')
      .update({ active_plan_id: null, plan_approved: false })
      .eq('id', userId!)
  }

  // ── Enforce tier limits when copying from template ─────────────────────────
  const planTier = (user?.plan_tier as string | null) ?? 'starter'
  const visibleLimit = TIER_VISIBLE_LIMIT[planTier] ?? DEFAULT_VISIBLE_LIMIT

  const allVisible = Array.isArray(template.visible_sessions) ? template.visible_sessions : []
  const allQueue = Array.isArray(template.queue_sessions) ? template.queue_sessions : []

  const visibleSessions = allVisible.slice(0, visibleLimit)
  // Sessions cut from visible due to tier go into the queue
  const overflowSessions = allVisible.slice(visibleLimit).map((s: Record<string, unknown>) => ({
    ...s,
    is_visible: false,
    queue_rationale: 'Deferred to queue — upgrade your plan to unlock more sessions.',
  }))
  const queueSessions = [...overflowSessions, ...allQueue]

  // Also save the user's topics if not already set (first sign-in path)
  const topics: string[] = Array.isArray(user?.topic_interests) && user.topic_interests.length > 0
    ? user.topic_interests as string[]
    : []

  const actualProfileHash = topics.length > 0 && user?.role && user?.ai_maturity
    ? buildProfileHash(user.role as string, user.ai_maturity as string, topics, (user.role_level as string | null) ?? 'c-suite')
    : profile_hash

  // ── Insert the user's curriculum plan ─────────────────────────────────────
  const { data: newPlan } = await supabase
    .from('curriculum_plans')
    .insert({
      user_id:           userId!,
      raw_llm_output:    { from_template: true, profile_hash, is_fallback: template.is_fallback },
      visible_sessions:  visibleSessions,
      queue_sessions:    queueSessions,
      user_profile_hash: actualProfileHash,
      generated_at:      new Date().toISOString(),
    })
    .select('id')
    .single()

  if (!newPlan) {
    return NextResponse.json({ error: 'Failed to save plan' }, { status: 500 })
  }

  // ── Fire plan.generated → session-designer-auto will design sessions ───────
  await inngest.send({
    name: 'clio/plan.generated',
    data: { planId: newPlan.id, userId: userId!, cached: false },
  })

  return NextResponse.json({ plan_id: newPlan.id, already_exists: false })
}
