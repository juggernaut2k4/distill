import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'

const Body = z.object({
  userId: z.string().min(1),
  question: z.string().min(1).max(1000),
})

interface DeferredQuestion {
  question: string
  deferred_at: string
}

/**
 * POST /api/defer-question
 * Called by the WalkthroughClient's ElevenLabs client tool (defer_question).
 * Appends a deferred question to sessions.deferred_questions via walkthrough_state.session_id.
 * Public — called from the Recall.ai headless browser, no Clerk session.
 * Never returns 5xx — always 200 so the agent tool call doesn't error.
 */
export async function POST(request: NextRequest) {
  let body: z.infer<typeof Body>
  try {
    body = Body.parse(await request.json())
  } catch (err) {
    console.error('[defer-question] Invalid body:', err)
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const { userId, question } = body
  const supabase = createSupabaseAdminClient()

  // Look up active session from walkthrough_state
  const { data: walkthroughState } = await supabase
    .from('walkthrough_state')
    .select('session_id')
    .eq('user_id', userId)
    .single()

  const sessionId = walkthroughState?.session_id
  if (!sessionId) {
    console.warn('[defer-question] No active session for user', userId)
    return NextResponse.json({ ok: false, error: 'No active session' })
  }

  // Fetch existing deferred_questions array
  const { data: sessionRow } = await supabase
    .from('sessions')
    .select('deferred_questions')
    .eq('id', sessionId)
    .single()

  const existing: DeferredQuestion[] = Array.isArray(sessionRow?.deferred_questions)
    ? (sessionRow.deferred_questions as DeferredQuestion[])
    : []

  const newEntry: DeferredQuestion = {
    question,
    deferred_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('sessions')
    .update({ deferred_questions: [...existing, newEntry] })
    .eq('id', sessionId)

  if (error) {
    console.error('[defer-question] DB update error:', error)
    return NextResponse.json({ ok: false, error: 'Failed to save question' })
  }

  console.log('[defer-question] Saved deferred question for session', sessionId, '—', question.slice(0, 80))
  return NextResponse.json({ ok: true })
}
