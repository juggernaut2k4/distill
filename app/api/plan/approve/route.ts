import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendPlanReadyEmail, sendPlanApprovedEmail, type User } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'
import { designSessionsForTopic, getSessionDuration, type CurriculumTopicInput } from '@/lib/curriculum/session-designer'
import { inngest } from '@/inngest/client'

interface VisibleSession extends CurriculumTopicInput {
  arc_name:        string
  arc_type:        string
  arc_position:    number
  arc_length:      number
  is_visible:      boolean
  db_session_id?:  string
  [key: string]: unknown
}

/**
 * POST /api/plan/approve
 * Activates a curriculum plan. If sessions haven't been pre-designed by Inngest,
 * designs them synchronously here so approve always succeeds on first attempt.
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

  // ── Ensure draft sessions exist — design synchronously if Inngest hasn't run ──
  const { count: draftCount } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId!)
    .eq('curriculum_plan_id', plan.id)
    .eq('status', 'draft')

  if ((draftCount ?? 0) === 0) {
    const visibleSessions = (
      Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []
    ) as VisibleSession[]

    const maxMins = getSessionDuration((user as { learning_goal?: string }).learning_goal ?? null)
    const profile = {
      role:     ((user as { role?: string }).role)         ?? 'executive',
      industry: ((user as { industry?: string }).industry) ?? 'general',
      maturity: ((user as { ai_maturity?: string }).ai_maturity) ?? 'intermediate',
    }

    // Design all topics concurrently — designSessionsForTopic has its own LLM+fallback logic
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
            subtopics:         cs.subtopics as string[] | undefined,
          },
          profile,
          maxMins
        ),
      }))
    )

    let globalOrder = 0
    for (const { cs, designed } of designResults) {
      for (const ds of designed) {
        globalOrder++
        await supabase.from('sessions').insert({
          user_id:               userId,
          session_title:         ds.session_title,
          topics:                [cs.session_id],
          curriculum_plan_id:    plan.id,
          curriculum_session_id: cs.session_id,
          subtopics:             ds.subtopics,
          duration_mins:         ds.duration_mins,
          session_index:         globalOrder,
          status:                'draft',
        })
      }
    }
  }

  // ── Flip draft → scheduled ───────────────────────────────────────────────────
  const { count: activatedCount } = await supabase
    .from('sessions')
    .update({ status: 'scheduled' })
    .eq('user_id', userId!)
    .eq('curriculum_plan_id', plan.id)
    .eq('status', 'draft')
    .select('id')

  // ── Fire content generation for all newly activated curriculum sessions ──────
  // Non-fatal — hourly cron will catch any sessions missed here.
  try {
    const { data: activatedSessions } = await supabase
      .from('sessions')
      .select('id, curriculum_session_id')
      .eq('user_id', userId!)
      .eq('curriculum_plan_id', plan.id)
      .eq('status', 'scheduled')
      .not('curriculum_session_id', 'is', null)

    if (activatedSessions && activatedSessions.length > 0) {
      const events = activatedSessions.map((s) => ({
        name: 'distill/session.content.generate' as const,
        data: {
          sessionId: s.id,
          userId: userId!,
          topicId: s.curriculum_session_id!,
          priority: 'high',
        },
      }))
      await inngest.send(events)
      console.log(`[plan/approve] Fired content generation for ${events.length} curriculum sessions`)
    }
  } catch (err) {
    console.error('[plan/approve] Content generation trigger failed (non-fatal):', err)
  }

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
    sessions_created: activatedCount ?? 0,
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
