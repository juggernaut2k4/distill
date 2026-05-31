import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

const BodySchema = z.object({
  session_id: z.string().min(1).max(128),
})

/**
 * POST /api/curriculum/dismiss-recommendation
 * Permanently dismisses a recommendation from the user's plan.
 * The session_id is added to the dismissed_recs array on curriculum_plans.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  const { session_id } = parsed.data
  const supabase = createSupabaseAdminClient()

  const { data: plan } = await supabase
    .from('curriculum_plans')
    .select('id, dismissed_recs')
    .eq('user_id', userId!)
    .is('superseded_at', null)
    .single()

  if (!plan) {
    return NextResponse.json({ error: 'No active plan found', code: 'NO_PLAN' }, { status: 404 })
  }

  const dismissed: string[] = Array.isArray(plan.dismissed_recs) ? plan.dismissed_recs : []
  if (!dismissed.includes(session_id)) {
    dismissed.push(session_id)
    await supabase
      .from('curriculum_plans')
      .update({ dismissed_recs: dismissed })
      .eq('id', plan.id)
  }

  return NextResponse.json({ success: true })
}
