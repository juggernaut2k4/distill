import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'

interface Params {
  params: { id: string }
}

/**
 * POST /api/sessions/[id]/start
 * Marks the session as active and returns the effective duration (capped by minutes_balance).
 * Called when the Recall.ai bot successfully joins the meeting.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  // Fetch session and user balance together
  const [{ data: session }, { data: user }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, status, duration_mins')
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

  const minutesBalance = user?.minutes_balance ?? 0
  if (minutesBalance <= 0) {
    return NextResponse.json(
      { error: 'No minutes remaining. Please top up or upgrade your plan.' },
      { status: 403 }
    )
  }

  if (minutesBalance < session.duration_mins) {
    return NextResponse.json(
      { error: `Insufficient minutes. This session requires ${session.duration_mins} minutes but you have ${minutesBalance} remaining.` },
      { status: 403 }
    )
  }

  // Timer runs for the planned session duration (not the full balance).
  // The server-side Inngest timer enforces this — it fires a warning at T-1min and
  // force-ends the session at T, regardless of client state.
  const effectiveDurationMins = session.duration_mins

  const startedAt = new Date().toISOString()
  await supabase
    .from('sessions')
    .update({ started_at: startedAt, status: 'active' })
    .eq('id', params.id)
    .eq('user_id', userId!)

  // Start server-side timer — cancels automatically when session ends
  inngest.send({
    name: 'clio/session.started',
    data: { userId: userId!, sessionId: params.id, durationMins: effectiveDurationMins },
  }).catch((err) => console.error('[session/start] Failed to emit clio/session.started:', err))

  return NextResponse.json({ effectiveDurationMins, minutesBalance })
}
