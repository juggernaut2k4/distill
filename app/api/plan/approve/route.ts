import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendPlanReadyEmail, sendPlanApprovedEmail, type User } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'
import {
  designSessionsForTopic,
  getSessionDuration,
  type CurriculumTopicInput,
} from '@/lib/curriculum/session-designer'

interface VisibleSession extends CurriculumTopicInput {
  arc_name:         string
  arc_type:         string
  arc_position:     number
  arc_length:       number
  is_visible:       boolean
  queue_rationale?: string | null
  db_session_id?:   string
  [key: string]: unknown
}

/**
 * POST /api/plan/approve
 * 1. Designs actual learning sessions (LLM) from the curriculum plan, respecting
 *    the user's stated time preference (learning_goal → max session minutes).
 * 2. Inserts rows into the sessions table.
 * 3. Embeds db_session_id into each visible_session so the plan page can link
 *    directly to /dashboard/sessions/[id].
 * 4. Marks the curriculum plan and user as approved.
 * 5. Sends approval email / SMS.
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

  const maxMins = getSessionDuration(user.learning_goal as string | null)
  const visibleSessions = (
    Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []
  ) as VisibleSession[]

  const profile = {
    role:     (user.role         as string | null) ?? 'executive',
    industry: (user.industry     as string | null) ?? 'general',
    maturity: (user.ai_maturity  as string | null) ?? 'intermediate',
  }

  // ── Design sessions in parallel ───────────────────────────────────────────────
  const designResults = await Promise.all(
    visibleSessions.map(async (cs) => ({
      cs,
      designed: await designSessionsForTopic(
        {
          session_id:        cs.session_id,
          title:             cs.title,
          focus:             cs.focus,
          depth_level:       cs.depth_level,
          estimated_minutes: cs.estimated_minutes,
          subtopics:         cs.subtopics,
        },
        profile,
        maxMins
      ),
    }))
  )

  // ── Insert sessions into DB ───────────────────────────────────────────────────
  let globalOrder = 0
  const updatedVisible: VisibleSession[] = []

  for (const { cs, designed } of designResults) {
    let firstDbSessionId: string | undefined

    for (const ds of designed) {
      globalOrder++
      const { data: inserted } = await supabase
        .from('sessions')
        .insert({
          user_id:               userId!,
          session_title:         ds.session_title,
          topics:                [cs.session_id],
          curriculum_plan_id:    plan.id,
          curriculum_session_id: cs.session_id,
          subtopics:             ds.subtopics,
          duration_mins:         ds.duration_mins,
          session_index:         globalOrder,
          status:                'scheduled',
        })
        .select('id')
        .single()

      if (inserted && !firstDbSessionId) firstDbSessionId = inserted.id
    }

    updatedVisible.push({ ...cs, db_session_id: firstDbSessionId })
  }

  // ── Update curriculum plan ────────────────────────────────────────────────────
  await supabase
    .from('curriculum_plans')
    .update({
      is_approved:      true,
      approved_at:      new Date().toISOString(),
      visible_sessions: updatedVisible,
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
    sessions_created: globalOrder,
    max_session_mins: maxMins,
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
