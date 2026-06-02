import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendPlanReadyEmail, sendPlanApprovedEmail, type User } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'
import { inngest } from '@/inngest/client'

interface VisibleSession {
  session_id:      string
  title:           string
  arc_name:        string
  arc_type:        string
  arc_position:    number
  arc_length:      number
  db_session_id?:  string
  [key: string]: unknown
}

/**
 * POST /api/plan/approve
 * Lightweight activation — no LLM work.
 * Sessions are pre-designed by the session-designer-auto Inngest job (status='draft').
 * This route flips them to 'scheduled', marks the plan approved, and notifies the user.
 */
export async function POST() {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  // ── Load user ────────────────────────────────────────────────────────────────
  const { data: user } = await supabase
    .from('users')
    .select('id, email, role, industry, ai_maturity, phone, twilio_number_assigned, learning_goal')
    .eq('id', userId!)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // ── Load active curriculum plan ───────────────────────────────────────────────
  const { data: plan } = await supabase
    .from('curriculum_plans')
    .select('id, visible_sessions')
    .eq('user_id', userId!)
    .is('superseded_at', null)
    .single()

  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 404 })

  // ── Activate draft sessions → scheduled ──────────────────────────────────────
  // Sessions were pre-designed by session-designer-auto Inngest job (status='draft').
  // Approve just flips them visible — no LLM work here.
  const { count: draftCount } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId!)
    .eq('curriculum_plan_id', plan.id)
    .eq('status', 'draft')

  if ((draftCount ?? 0) === 0) {
    // Re-fire plan.generated so session-designer-auto retries (handles exhausted Inngest retries)
    await inngest.send({ name: 'clio/plan.generated', data: { planId: plan.id, userId: userId!, cached: true } })
    return NextResponse.json(
      { error: 'Sessions not ready yet — plan is still being generated. Please wait a moment and try again.', code: 'SESSIONS_NOT_READY' },
      { status: 409 }
    )
  }

  await supabase
    .from('sessions')
    .update({ status: 'scheduled' })
    .eq('user_id', userId!)
    .eq('curriculum_plan_id', plan.id)
    .eq('status', 'draft')

  const sessionsCreated = draftCount ?? 0

  // ── Update curriculum plan ────────────────────────────────────────────────────
  await supabase
    .from('curriculum_plans')
    .update({
      is_approved: true,
      approved_at: new Date().toISOString(),
    })
    .eq('id', plan.id)

  // ── Update user ───────────────────────────────────────────────────────────────
  await supabase
    .from('users')
    .update({ plan_approved: true, active_plan_id: plan.id })
    .eq('id', userId!)

  // ── Notify ────────────────────────────────────────────────────────────────────
  const sends: Promise<unknown>[] = []

  if (user.email) {
    sends.push(sendPlanApprovedEmail(user as User).catch(console.error))
  }

  if (user.phone && user.twilio_number_assigned) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
    sends.push(
      sendSMS(
        user.phone as string,
        user.twilio_number_assigned as string,
        `Clio: Your learning plan is approved — start your first session: ${appUrl}/dashboard/plan`
      ).catch(console.error)
    )
  }

  await Promise.all(sends)

  return NextResponse.json({
    success:          true,
    sessions_created: sessionsCreated,
  })
}

/**
 * PUT /api/plan/approve
 * Called after topic selection — notifies user their plan is ready.
 */
export async function PUT() {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  await supabase
    .from('users')
    .update({ plan_generated_at: new Date().toISOString() })
    .eq('id', userId!)

  const { data: user } = await supabase
    .from('users')
    .select('id, email, role, industry, ai_maturity, phone, twilio_number_assigned')
    .eq('id', userId!)
    .single()

  const sends2: Promise<unknown>[] = []

  if (user?.email) {
    sends2.push(sendPlanReadyEmail(user as User).catch(console.error))
  }

  if (user?.phone && user.twilio_number_assigned) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
    sends2.push(
      sendSMS(
        user.phone,
        user.twilio_number_assigned,
        `Your Clio learning plan is ready! Review and approve it here: ${appUrl}/dashboard/plan — Clio`
      ).catch(console.error)
    )
  }

  await Promise.all(sends2)

  return NextResponse.json({ success: true })
}
