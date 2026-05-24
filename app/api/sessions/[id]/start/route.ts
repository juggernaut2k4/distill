import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

interface Params {
  params: { id: string }
}

/**
 * POST /api/sessions/[id]/start
 * Marks the session as active and returns the effective duration (capped by minutes_balance).
 * Called when the Recall.ai bot successfully joins the meeting.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
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

  // Timer runs from the full balance — the session can continue until the balance
  // is exhausted, not just until the planned session duration elapses.
  const effectiveDurationMins = minutesBalance

  await supabase
    .from('sessions')
    .update({ started_at: new Date().toISOString(), status: 'active' })
    .eq('id', params.id)
    .eq('user_id', userId!)

  return NextResponse.json({ effectiveDurationMins, minutesBalance })
}
