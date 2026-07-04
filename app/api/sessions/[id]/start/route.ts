import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'
import { writeAuditEvent, mintAuditToken } from '@/lib/session-billing'

interface Params {
  params: { id: string }
}

/**
 * POST /api/sessions/[id]/start
 * Marks the session as active and returns the effective duration (capped by minutes_balance).
 * Called when the Recall.ai bot successfully joins the meeting.
 *
 * AUTOGEN-01 Part D: this route no longer starts the billing clock. It only
 * records an informational `bot_joined` audit event. Billing starts later, at
 * whatever moment the voice adapter fires `onSpeakVerified` (see
 * /api/sessions/audit-event and lib/session-billing.ts).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  // Fetch session and user balance together
  const [{ data: session }, { data: user }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, status, duration_mins, curriculum_plan_id')
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

  // AUTOGEN-01 §11 Q5 / §3 Part C: /start requires curriculum_plan.is_approved = true.
  if (session.curriculum_plan_id) {
    const { data: plan } = await supabase
      .from('curriculum_plans')
      .select('is_approved')
      .eq('id', session.curriculum_plan_id)
      .maybeSingle()

    if (!plan?.is_approved) {
      return NextResponse.json(
        { error: 'This session\'s plan has not been approved yet.' },
        { status: 403 }
      )
    }
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

  // Informational only — NOT the billing-start instant. Billing starts at
  // `speak_verified`, written separately once the voice adapter confirms it can
  // actually produce audio (AC-D1).
  await writeAuditEvent({
    sessionId: params.id,
    userId: userId!,
    eventType: 'bot_joined',
    occurredAt: startedAt,
  })

  // SECURITY (CEO review fix): mint the per-session audit token here, the moment
  // the session actually starts. Stored on walkthrough_state (keyed by userId) —
  // WalkthroughClient.tsx (running in the bot's headless browser, no Clerk
  // session) picks it up for free from its server-rendered initial state and
  // must present it on every /api/sessions/audit-event write. See
  // lib/session-billing.ts's mintAuditToken/verifyAuditToken for the full
  // rationale.
  await mintAuditToken(userId!)

  // LIVE-01 bug fix (2026-07-04): walkthrough_state.live_conductor_tab_index /
  // live_conductor_visual / live_conductor_tab_turn_count are a per-USER
  // singleton (see migration 054_live_conductor_state.sql), not per-session —
  // there is exactly one walkthrough_state row per user, reused across every
  // session. Nothing previously reset this row back to "tab 1" when a NEW
  // session started, so any session after the user's first ever live-conductor
  // session inherited whatever tab index/visual was left over from the last
  // one — e.g. starting on tab 2+ with a stale/null visual, meaning the tab-1
  // agenda screen (getLiveConductorState's `clampedTabIndex === 0` guard in
  // lib/voice/live-conductor-bridge.ts) never fires because the index is never
  // actually 0 again. Root cause of "I don't see a difference / static page"
  // symptom reported after this session (session=2f04bdb6-...): confirmed via
  // Vercel logs (chat completions opened at tab=2/4 turn=0) + direct DB read
  // (walkthrough_state row created at an earlier test, live_conductor_visual
  // was null the whole session). Reset here, at the one place every session
  // unambiguously begins, so each session starts fresh on tab 1 with the
  // agenda visual able to generate again.
  await supabase
    .from('walkthrough_state')
    .update({
      live_conductor_tab_index: 0,
      live_conductor_visual: null,
      live_conductor_tab_turn_count: 0,
    })
    .eq('user_id', userId!)

  // Start server-side timer — cancels automatically when session ends
  inngest.send({
    name: 'clio/session.started',
    data: { userId: userId!, sessionId: params.id, durationMins: effectiveDurationMins },
  }).catch((err) => console.error('[session/start] Failed to emit clio/session.started:', err))

  return NextResponse.json({ effectiveDurationMins, minutesBalance })
}
