import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'

const BodySchema = z.object({
  session_id: z.string().min(1).max(128),
})

/**
 * POST /api/curriculum/accept-recommendation
 * User accepts a recommended topic. Emits an Inngest event to generate
 * additional sessions for the accepted topic asynchronously.
 * Immediately moves the accepted session to visible plan.
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
    .select('id, visible_sessions, queue_sessions')
    .eq('user_id', userId!)
    .is('superseded_at', null)
    .single()

  if (!plan) {
    return NextResponse.json({ error: 'No active plan found', code: 'NO_PLAN' }, { status: 404 })
  }

  const queueSessions: Array<{ session_id: string }> = Array.isArray(plan.queue_sessions) ? plan.queue_sessions : []
  const visibleSessions = Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []

  const acceptedSession = queueSessions.find((s) => s.session_id === session_id)
  if (!acceptedSession) {
    return NextResponse.json({ error: 'Session not found in queue', code: 'NOT_IN_QUEUE' }, { status: 404 })
  }

  // Move accepted session to visible plan immediately
  const newQueue = queueSessions.filter((s) => s.session_id !== session_id)
  const newVisible = [...visibleSessions, acceptedSession]

  await supabase
    .from('curriculum_plans')
    .update({ visible_sessions: newVisible, queue_sessions: newQueue })
    .eq('id', plan.id)

  // Emit event for async generation of follow-on sessions for this topic
  await inngest.send({
    name: 'clio/recommendation.accepted',
    data: { user_id: userId!, plan_id: plan.id, session_id },
  })

  return NextResponse.json({ success: true, generating: true })
}
