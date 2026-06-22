import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
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
export async function POST(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  // ── Load user ────────────────────────────────────────────────────────────────
  const { data: user } = await supabase
    .from('users')
    .select('id, email, role, industry, ai_maturity, phone, twilio_number_assigned, learning_goal, scheduling_prefs')
    .eq('id', userId!)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // ── Load active curriculum plan ───────────────────────────────────────────────
  const { data: plan } = await supabase
    .from('curriculum_plans')
    .select('id, visible_sessions')
    .eq('user_id', userId!)
    .is('superseded_at', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 404 })

  // ── Ensure draft sessions exist — design synchronously if Inngest hasn't run ──
  const { count: draftCount } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId!)
    .eq('curriculum_plan_id', plan.id)
    .eq('status', 'draft')

  console.log(`[plan/approve] planId=${plan.id} draftCount=${draftCount ?? 0} visibleSessions=${(plan.visible_sessions as unknown[])?.length ?? 0}`)

  let insertedCount = 0

  if ((draftCount ?? 0) === 0) {
    // Clear ALL non-final sessions for this user before inserting — the unique index
    // on (user_id, session_index) blocks inserts when any prior session occupies those
    // indices regardless of curriculum_plan_id or status. We only preserve sessions
    // that are completed or cancelled (terminal states worth keeping).
    const { error: cleanupErr } = await supabase
      .from('sessions')
      .delete()
      .eq('user_id', userId!)
      .not('status', 'in', '("completed","cancelled")')
    if (cleanupErr) console.error('[plan/approve] orphan cleanup failed:', cleanupErr.message)
    else console.log('[plan/approve] orphan sessions cleared')

    const visibleSessions = (
      Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []
    ) as VisibleSession[]

    console.log(`[plan/approve] designing ${visibleSessions.length} topics`)

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

    console.log(`[plan/approve] designResults: ${designResults.length} topics, total sessions: ${designResults.reduce((n, r) => n + r.designed.length, 0)}`)

    let globalOrder = 0
    for (const { cs, designed } of designResults) {
      for (const ds of designed) {
        globalOrder++
        const { data: inserted, error: insertErr } = await supabase.from('sessions').insert({
          user_id:               userId,
          session_title:         ds.session_title,
          topics:                [cs.session_id],
          curriculum_plan_id:    plan.id,
          curriculum_session_id: cs.session_id,
          subtopics:             ds.subtopics,
          sub_sessions:          ds.subtopics,
          duration_mins:         ds.duration_mins,
          session_index:         globalOrder,
          status:                'draft',
        }).select('id').single()
        if (insertErr) {
          console.error('[plan/approve] session insert failed:', insertErr.message, insertErr.code, { index: globalOrder })
        } else {
          insertedCount++
          console.log(`[plan/approve] inserted session ${globalOrder} id=${inserted?.id}`)
        }
      }
    }
    console.log(`[plan/approve] inserted ${insertedCount}/${designResults.reduce((n, r) => n + r.designed.length, 0)} sessions`)
  }

  // ── Flip draft → scheduled ───────────────────────────────────────────────────
  const { data: activatedData } = await supabase
    .from('sessions')
    .update({ status: 'scheduled' })
    .eq('user_id', userId!)
    .eq('curriculum_plan_id', plan.id)
    .eq('status', 'draft')
    .select('id')

  // ── Stamp scheduled_at from user's scheduling preferences ───────────────────
  interface SchedulingPrefs {
    selectedDays: number[]
    preferredHour: number
    preferredMinute: 0 | 15 | 30 | 45
    ampm: 'AM' | 'PM'
    maxDurationMins: 15 | 30
    timezone: string
  }
  const schedPrefs = (user as { scheduling_prefs?: SchedulingPrefs | null }).scheduling_prefs ?? null
  if (schedPrefs && activatedData && activatedData.length > 0) {
    const hour24 = schedPrefs.ampm === 'PM'
      ? (schedPrefs.preferredHour === 12 ? 12 : schedPrefs.preferredHour + 12)
      : (schedPrefs.preferredHour === 12 ? 0 : schedPrefs.preferredHour)
    const selectedDays = [...schedPrefs.selectedDays].sort((a, b) => a - b)

    const now = new Date()
    const dates: Date[] = []
    let cursor = new Date(now)
    cursor.setHours(hour24, schedPrefs.preferredMinute, 0, 0)
    if (cursor <= now) { cursor.setDate(cursor.getDate() + 1); cursor.setHours(hour24, schedPrefs.preferredMinute, 0, 0) }

    while (dates.length < activatedData.length) {
      const dow = cursor.getDay()
      const next = selectedDays.find((d) => d >= dow)
      if (next !== undefined) {
        const d = new Date(cursor)
        d.setDate(cursor.getDate() + (next - dow))
        d.setHours(hour24, schedPrefs.preferredMinute, 0, 0)
        dates.push(d)
        cursor = new Date(d); cursor.setDate(d.getDate() + 1)
      } else {
        cursor.setDate(cursor.getDate() + (7 - dow + selectedDays[0]))
      }
    }

    for (let i = 0; i < activatedData.length; i++) {
      await supabase.from('sessions').update({ scheduled_at: dates[i].toISOString() }).eq('id', activatedData[i].id)
    }
  }

  // ── Fire content generation for ALL sessions with subtopics ─────────────────
  // Session 1 gets high priority (user is waiting); the rest are background.
  // Content pipeline keys its cache by sessionId (DB UUID) — no topicId needed.
  try {
    const { data: allSessions } = await supabase
      .from('sessions')
      .select('id, session_index, sub_sessions')
      .eq('user_id', userId!)
      .eq('curriculum_plan_id', plan.id)
      .eq('status', 'scheduled')
      .order('session_index', { ascending: true })

    // Only fire content generation for Session 1 on approve.
    // Sessions 2–N are handled by the cron or triggered on-demand.
    const firstSession = (allSessions ?? []).find(
      (s) => Array.isArray(s.sub_sessions) && (s.sub_sessions as unknown[]).length > 0
    )

    if (firstSession) {
      await inngest.send({
        name: 'distill/session.content.generate' as const,
        data: { sessionId: firstSession.id, userId: userId!, priority: 'high' as const },
      })
      console.log(`[plan/approve] Fired content generation for Session 1 only (id=${firstSession.id}).`)
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
    .update({ plan_approved: true, active_plan_id: plan.id, plan_approved_at: new Date().toISOString() })
    .eq('id', userId!)

  // ── Notify ────────────────────────────────────────────────────────────────────
  const sends: Promise<unknown>[] = []

  if (user.email) {
    sends.push(sendPlanApprovedEmail(user as User).catch(console.error))
  }

  if (user.phone && user.twilio_number_assigned) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
    sends.push(
      sendSMS(
        user.phone as string,
        user.twilio_number_assigned as string,
        `Clio: Your learning plan is approved — start your first session: ${appUrl}/dashboard/plan`
      ).catch(console.error)
    )
  }

  await Promise.all(sends)

  console.log(`[plan/approve] flip activated=${activatedData?.length ?? 0} insertedCount=${insertedCount}`)

  return NextResponse.json({
    success:          true,
    sessions_created: activatedData?.length ?? 0,
  })
}

/**
 * PUT /api/plan/approve
 * Called after topic selection — notifies user their plan is ready.
 */
export async function PUT(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
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
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
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
