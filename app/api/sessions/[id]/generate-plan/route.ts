import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'

interface Params {
  params: { id: string }
}

/**
 * POST /api/sessions/[id]/generate-plan
 * Triggers Inngest plan generation for the session.
 * Called as fallback if the schedule API event was missed, or for manual regeneration.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('id, session_title, topic_id, topics, session_plan')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (session.session_plan?.plan_status === 'ready') {
    return NextResponse.json({ ok: true, status: 'already_ready' })
  }

  // Fetch subtopics from catalog via topic_id
  const { TOPIC_CATALOG } = await import('@/lib/content/curriculum').then((m) => ({
    TOPIC_CATALOG: (m as unknown as { TOPIC_CATALOG?: unknown[] }).TOPIC_CATALOG,
  }))

  // Fallback: look up subtopics from the existing session data or catalog
  let subtopics: string[] = []
  if (session.topic_id && Array.isArray(TOPIC_CATALOG)) {
    const topic = (TOPIC_CATALOG as Array<{ id: string; subtopics?: string[] }>)
      .find((t) => t.id === session.topic_id)
    subtopics = topic?.subtopics ?? []
  }

  await inngest.send({
    name: 'distill/session.scheduled',
    data: {
      sessionId: session.id,
      topicId: session.topic_id ?? '',
      topicTitle: session.session_title ?? '',
      subtopics,
      userId: userId!,
    },
  })

  return NextResponse.json({ ok: true, status: 'generating' })
}

/**
 * GET /api/sessions/[id]/generate-plan
 * Returns the current session_plan so the UI can poll for progress.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('session_plan')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json({ session_plan: session.session_plan ?? null })
}
