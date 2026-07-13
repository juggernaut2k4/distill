import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'
import {
  writeAuditEvent,
  computeBilledMinutes,
  writeMinutesLedgerEvent,
  finalizeHumeNativeBilling,
} from '@/lib/session-billing'

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
      .select('id, started_at, duration_mins, status, hume_native_enabled, hume_chat_id')
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

  // HUME-DURATION-BILLING-01 — idempotency guard (mirrors forceEndSession()'s
  // existing `session.status === 'completed'` check). Without this, a manual
  // "End Session" click racing with a watchdog/timer force-end for the same
  // session could independently write a second deduction. If the session is
  // already completed, no further writes happen — no audit event, no
  // deduction, no ledger row.
  if (session.status === 'completed') {
    return NextResponse.json({
      minutesUsed: 0,
      newBalance: userRow?.minutes_balance ?? 0,
      alreadyCompleted: true,
    })
  }

  const now = new Date().toISOString()

  // Billing-end audit event — this timestamp is what minutes are computed up to.
  await writeAuditEvent({
    sessionId: params.id,
    userId: userId!,
    eventType: 'disconnected',
    occurredAt: now,
  })

  // HUME-DURATION-BILLING-01 — for Hume-native sessions, prefer Hume's own
  // authoritative chat duration over the audit-log calculation. Falls back
  // to the existing, unmodified computeBilledMinutes() for Hume
  // Custom-LLM sessions and whenever the Hume fetch is unavailable/fails.
  const humeResult = await finalizeHumeNativeBilling({
    sessionId: params.id,
    humeNativeEnabled: session.hume_native_enabled as boolean,
    humeChatId: (session.hume_chat_id as string | null) ?? null,
  })

  let rawMinutesUsed: number
  let reachedSpeakVerified = false
  let billingSource: 'hume' | 'fallback_audit_log'
  let billingSourceMetadata: Record<string, unknown>

  if (humeResult.source === 'hume') {
    rawMinutesUsed = humeResult.minutesUsed
    billingSource = 'hume'
    billingSourceMetadata = { hume_duration_seconds: humeResult.durationSeconds }
  } else {
    // AC-D2 / AC-D3: computeBilledMinutes returns an explicit zero when this
    // session's audit log never contains a `speak_verified` row — never a raw
    // wall-clock fallback.
    const computed = await computeBilledMinutes(params.id, { disconnectedAt: now })
    rawMinutesUsed = computed.minutesUsed
    reachedSpeakVerified = computed.reachedSpeakVerified
    billingSource = 'fallback_audit_log'
    billingSourceMetadata =
      humeResult.source === 'fallback' ? { fallback_reason: humeResult.reason } : {}

    if (!reachedSpeakVerified) {
      console.log(`[session/end] Session ${params.id} never reached speak_verified — billing 0 minutes`)
    }
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

  // BILLING-LEDGER-01 — purely additive: log this session deduction alongside
  // the already-succeeded deduct_minutes RPC, reusing its returned balance.
  // Non-fatal on failure (writeMinutesLedgerEvent never throws).
  await writeMinutesLedgerEvent({
    userId: userId!,
    eventType: 'session_deduction',
    deltaMinutes: -minutesUsed,
    resultingBalance: newBalance,
    sessionId: params.id,
    metadata: {
      reached_speak_verified: reachedSpeakVerified,
      billing_source: billingSource,
      ...billingSourceMetadata,
    },
  })

  // Cancel the server-side timer — session is ending manually so the Inngest job
  // should not also try to force-end it after the planned duration elapses.
  inngest.send({
    name: 'clio/session.ended',
    data: { userId: userId!, sessionId: params.id },
  }).catch((err) => console.error('[session/end] Failed to emit clio/session.ended:', err))

  return NextResponse.json({ minutesUsed, newBalance })
}
