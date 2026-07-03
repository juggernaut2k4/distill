import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { releaseAgent } from '@/lib/elevenlabs-pool'
import { inngest } from '@/inngest/client'
import { writeAuditEvent, computeBilledMinutes } from '@/lib/session-billing'

interface Params {
  params: { id: string }
}

/**
 * POST /api/sessions/[id]/end
 * Marks the session completed, calculates actual time used, and deducts from minutes_balance.
 * Called when the user clicks "End Session" or the timer hits zero.
 *
 * AUTOGEN-01 Part D: minutes are now computed strictly from the billing audit log
 * — (disconnected_at − speak_verified_at) − Σ(gap durations) — never from
 * session.started_at (bot-join time). If the session never reached
 * `speak_verified`, zero minutes are deducted (AC-D3, explicit branch below).
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

  const now = new Date().toISOString()

  // Billing-end audit event — this timestamp is what minutes are computed up to.
  await writeAuditEvent({
    sessionId: params.id,
    userId: userId!,
    eventType: 'disconnected',
    occurredAt: now,
  })

  // AC-D2 / AC-D3: computeBilledMinutes returns an explicit zero when this
  // session's audit log never contains a `speak_verified` row — never a raw
  // wall-clock fallback.
  const { minutesUsed: rawMinutesUsed, reachedSpeakVerified } = await computeBilledMinutes(
    params.id,
    { disconnectedAt: now }
  )
  if (!reachedSpeakVerified) {
    console.log(`[session/end] Session ${params.id} never reached speak_verified — billing 0 minutes`)
  }
  const minutesUsed = Math.min(rawMinutesUsed, userRow?.minutes_balance ?? rawMinutesUsed)

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
