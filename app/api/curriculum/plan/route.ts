import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/curriculum/plan
 * Returns the current active curriculum plan for the authenticated user,
 * along with completion status for each session.
 * Optional ?check_generating=true to include is_generating flag.
 */
export async function GET(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()
  const checkGenerating = request.nextUrl.searchParams.get('check_generating') === 'true'

  const { data: plan } = await supabase
    .from('curriculum_plans')
    .select('id, visible_sessions, queue_sessions, dismissed_recs, is_approved, approved_at, user_profile_hash, generated_at, raw_llm_output')
    .eq('user_id', userId!)
    .is('superseded_at', null)
    .single()

  if (!plan) {
    return NextResponse.json({ plan: null, completions: [], is_generating: false })
  }

  const { data: completions } = await supabase
    .from('session_completions')
    .select('session_id, completed_at, completion_method')
    .eq('user_id', userId!)
    .eq('plan_id', plan.id)

  const completedIds = (completions ?? []).map((c: { session_id: string }) => c.session_id)

  // Check if a generation job is in progress: visible_sessions is empty but plan was just created
  const visibleSessions = Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []
  const isGenerating = checkGenerating && visibleSessions.length === 0
  const isFallback = !!(plan.raw_llm_output && (plan.raw_llm_output as { fallback?: boolean }).fallback === true)

  // Build recommendation list: first session of each arc in queue, not dismissed
  const dismissedRecs: string[] = Array.isArray(plan.dismissed_recs) ? plan.dismissed_recs : []
  const queueSessions = Array.isArray(plan.queue_sessions) ? plan.queue_sessions : []
  const recommendations = queueSessions
    .filter((s: { arc_position: number; session_id: string; queue_rationale?: string }) =>
      s.arc_position === 1 &&
      !dismissedRecs.includes(s.session_id) &&
      s.queue_rationale
    )
    .slice(0, 2)

  return NextResponse.json({
    plan: {
      id: plan.id,
      visible_sessions: visibleSessions,
      is_approved: plan.is_approved,
      approved_at: plan.approved_at,
      generated_at: plan.generated_at,
      is_fallback: isFallback,
    },
    completions: completedIds,
    recommendations,
    is_generating: isGenerating,
  })
}
