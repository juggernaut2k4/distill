import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { releaseAgent } from '@/lib/elevenlabs-pool'
import { inngest } from '@/inngest/client'

interface Params {
  params: { id: string }
}

/**
 * POST /api/sessions/[id]/end
 * Marks the session completed, calculates actual time used, and deducts from minutes_balance.
 * Called when the user clicks "End Session" or the timer hits zero.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const [{ data: session }, { data: userRow }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, started_at, duration_mins, status')
      .eq('id', params.id)
      .eq('user_id', userId!)
      .single(),
    supabase
      .from('users')
      .select('minutes_balance')
      .eq('id', userId!)
      .single(),
  ])

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Deduct actual elapsed time (rounded up to nearest minute), capped at current balance.
  // session.duration_mins is the planned length — not a cap. Users run until balance runs out.
  let minutesUsed = 1
  if (session.started_at) {
    const elapsedMs = Date.now() - new Date(session.started_at).getTime()
    minutesUsed = Math.max(1, Math.ceil(elapsedMs / (1000 * 60)))
  }
  minutesUsed = Math.min(minutesUsed, userRow?.minutes_balance ?? minutesUsed)

  const now = new Date().toISOString()

  // Deduct minutes and mark session completed in parallel
  const [deductResult] = await Promise.all([
    supabase.rpc('deduct_minutes', {
      p_user_id: userId!,
      p_minutes: minutesUsed,
    }),
    supabase
      .from('sessions')
      .update({
        ended_at: now,
        status: 'completed',
        duration_mins: minutesUsed,
      })
      .eq('id', params.id)
      .eq('user_id', userId!),
  ])

  const newBalance = (deductResult.data as number) ?? 0

  // Cancel the server-side timer — session is ending manually so the Inngest job
  // should not also try to force-end it after the planned duration elapses.
  inngest.send({
    name: 'clio/session.ended',
    data: { userId: userId!, sessionId: params.id },
  }).catch((err) => console.error('[session/end] Failed to emit clio/session.ended:', err))

  // AGENT-POOL-01: release pool agent back to available (no-op when pool mode off)
  const { data: wsRow } = await supabase
    .from('walkthrough_state')
    .select('agent_id')
    .eq('session_id', params.id)
    .single()

  if (wsRow?.agent_id) {
    releaseAgent(wsRow.agent_id as string).catch((err) =>
      console.error('[session/end] agent release failed (non-fatal):', err)
    )
  }

  return NextResponse.json({ minutesUsed, newBalance })
}
