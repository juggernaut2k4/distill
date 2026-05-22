import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

interface Params {
  params: { id: string }
}

/**
 * POST /api/sessions/[id]/end
 * Marks the session completed, calculates actual time used, and deducts from minutes_balance.
 * Called when the user clicks "End Session" or the timer hits zero.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('id, started_at, duration_mins, status')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Calculate actual minutes used (round up to nearest minute, cap at scheduled duration)
  let minutesUsed = session.duration_mins
  if (session.started_at) {
    const elapsedMs = Date.now() - new Date(session.started_at).getTime()
    const elapsedMins = Math.ceil(elapsedMs / (1000 * 60))
    minutesUsed = Math.min(elapsedMins, session.duration_mins)
  }

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

  return NextResponse.json({ minutesUsed, newBalance })
}
