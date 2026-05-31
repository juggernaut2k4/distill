import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'

const BodySchema = z.object({
  session_id: z.string().min(1).max(128),
  time_spent_seconds: z.number().int().min(0).default(0),
  method: z.enum(['explicit', 'time_threshold']),
})

const VISIBLE_MIN_THRESHOLD = 3
const VISIBLE_TARGET = 5

/**
 * POST /api/curriculum/complete-session
 * Records a session completion and triggers queue promotion if visible plan
 * drops below the threshold.
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
    return NextResponse.json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 })
  }

  const { session_id, time_spent_seconds, method } = parsed.data
  const supabase = createSupabaseAdminClient()

  // Get the active plan
  const { data: plan } = await supabase
    .from('curriculum_plans')
    .select('id, visible_sessions, queue_sessions')
    .eq('user_id', userId!)
    .is('superseded_at', null)
    .single()

  if (!plan) {
    return NextResponse.json({ error: 'No active plan found', code: 'NO_PLAN' }, { status: 404 })
  }

  // Record completion — unique constraint prevents duplicates
  const { error: insertError } = await supabase
    .from('session_completions')
    .insert({
      user_id: userId!,
      plan_id: plan.id,
      session_id,
      time_spent_seconds,
      completion_method: method,
    })

  // Unique constraint violation = already completed — treat as success
  if (insertError && !insertError.message.includes('unique')) {
    return NextResponse.json({ error: 'Failed to record completion', code: 'DB_ERROR' }, { status: 500 })
  }

  // Get current completions to compute remaining visible sessions
  const { data: completions } = await supabase
    .from('session_completions')
    .select('session_id')
    .eq('user_id', userId!)
    .eq('plan_id', plan.id)

  const completedIds = new Set((completions ?? []).map((c: { session_id: string }) => c.session_id))
  const visibleSessions: Array<{ session_id: string }> = Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []
  const remainingVisible = visibleSessions.filter((s) => !completedIds.has(s.session_id))

  let promotedSessions: unknown[] = []

  // Promote sessions from queue if below threshold
  if (remainingVisible.length < VISIBLE_MIN_THRESHOLD) {
    const queueSessions: unknown[] = Array.isArray(plan.queue_sessions) ? plan.queue_sessions : []
    const toPromote = Math.max(0, VISIBLE_TARGET - remainingVisible.length)
    const promoting = queueSessions.slice(0, toPromote)
    const newQueue = queueSessions.slice(toPromote)
    const newVisible = [...visibleSessions, ...promoting]

    await supabase
      .from('curriculum_plans')
      .update({ visible_sessions: newVisible, queue_sessions: newQueue })
      .eq('id', plan.id)

    promotedSessions = promoting

    // Trigger queue regeneration if queue drops below 5
    if (newQueue.length < 5) {
      await inngest.send({ name: 'clio/queue.regenerate', data: { user_id: userId!, plan_id: plan.id } })
    }
  }

  return NextResponse.json({ success: true, promoted_sessions: promotedSessions })
}
