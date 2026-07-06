import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'

export const maxDuration = 300
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendPlanReadyEmail, sendPlanApprovedEmail, type User } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'
import { designSessionsForTopic, getSessionDuration, type CurriculumTopicInput } from '@/lib/curriculum/session-designer'
import { organizeSubtopicsIntoSessions } from '@/lib/curriculum/session-organizer'

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
    .select('id, email, role, industry, ai_maturity, role_level, phone, twilio_number_assigned, learning_goal, scheduling_prefs')
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

    const rawVisible = Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []
    const maxMins = getSessionDuration((user as { learning_goal?: string }).learning_goal ?? null)
    const profile = {
      role:      ((user as { role?: string }).role)               ?? 'executive',
      industry:  ((user as { industry?: string }).industry)       ?? 'general',
      maturity:  ((user as { ai_maturity?: string }).ai_maturity) ?? 'intermediate',
      roleLevel: ((user as { role_level?: string }).role_level)   ?? 'c-suite',
    }

    // CURR-01 v2 detection: v2 arcs have comprehensive_subtopics[]; v1 sessions have session_id + title.
    const isV2 = rawVisible.length > 0 && Array.isArray((rawVisible[0] as Record<string, unknown>).comprehensive_subtopics)

    let globalOrder = 0

    if (isV2) {
      // ── v2 path: organizer → designer ────────────────────────────────────────
      type V2Arc = { arc_name: string; arc_type: string; arc_description?: string; comprehensive_subtopics: string[] }
      const arcs = rawVisible as V2Arc[]
      console.log(`[plan/approve] v2 plan: organizing ${arcs.length} arcs into sessions (${maxMins}-min each)`)

      const plannedSessions = organizeSubtopicsIntoSessions(
        arcs.map((a) => ({ arc_name: a.arc_name, comprehensive_subtopics: a.comprehensive_subtopics, is_visible: true })),
        maxMins,
      )
      console.log(`[plan/approve] organizer produced ${plannedSessions.length} sessions`)

      const designResults = await Promise.all(
        plannedSessions.map(async (ps) => {
          const arcName = ps.arc_names[0] ?? 'Learning Session'
          const topicInput: CurriculumTopicInput = {
            session_id:        `v2-${ps.session_index}`,
            title:             arcName,
            focus:             arcName,
            depth_level:       'intermediate',
            estimated_minutes: ps.duration_mins,
            subtopics:         ps.subtopics,
          }
          const designed = await designSessionsForTopic(topicInput, profile, ps.duration_mins)
          return { ps, arcName, designed }
        })
      )

      for (const { ps, arcName, designed } of designResults) {
        for (const ds of designed) {
          globalOrder++
          const { data: inserted, error: insertErr } = await supabase.from('sessions').insert({
            user_id:               userId,
            session_title:         ds.session_title,
            topic_id:              arcName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            topics:                ps.arc_names,
            curriculum_plan_id:    plan.id,
            curriculum_session_id: `v2-arc-${ps.session_index}`,
            sub_sessions:          ds.subtopics,
            duration_mins:         ds.duration_mins,
            planned_duration_mins: ds.duration_mins,
            session_index:         globalOrder,
            status:                'draft',
          }).select('id').single()
          if (insertErr) {
            console.error('[plan/approve] v2 session insert failed:', insertErr.message, { index: globalOrder })
          } else {
            insertedCount++
            console.log(`[plan/approve] v2 inserted session ${globalOrder} id=${inserted?.id}`)
          }
        }
      }
      console.log(`[plan/approve] v2 inserted ${insertedCount} sessions from ${plannedSessions.length} planned`)
    } else {
      // ── v1 path: design directly from visible_sessions ────────────────────────
      const visibleSessions = rawVisible as VisibleSession[]
      console.log(`[plan/approve] v1 plan: designing ${visibleSessions.length} topics`)

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

      console.log(`[plan/approve] v1 designResults: ${designResults.length} topics, total sessions: ${designResults.reduce((n, r) => n + r.designed.length, 0)}`)

      for (const { cs, designed } of designResults) {
        for (const ds of designed) {
          globalOrder++
          const { data: inserted, error: insertErr } = await supabase.from('sessions').insert({
            user_id:               userId,
            session_title:         ds.session_title,
            topic_id:              cs.session_id,
            topics:                [cs.session_id],
            curriculum_plan_id:    plan.id,
            curriculum_session_id: cs.session_id,
            sub_sessions:          ds.subtopics,
            duration_mins:         ds.duration_mins,
            planned_duration_mins: ds.duration_mins,
            session_index:         globalOrder,
            status:                'draft',
          }).select('id').single()
          if (insertErr) {
            console.error('[plan/approve] v1 session insert failed:', insertErr.message, insertErr.code, { index: globalOrder })
          } else {
            insertedCount++
            console.log(`[plan/approve] v1 inserted session ${globalOrder} id=${inserted?.id}`)
          }
        }
      }
      console.log(`[plan/approve] v1 inserted ${insertedCount}/${designResults.reduce((n, r) => n + r.designed.length, 0)} sessions`)
    }
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

  // AUTOGEN-01 Part B: approval no longer triggers content generation at all.
  // Session 1 content is kicked off by session-designer-auto.ts as soon as its title/
  // subtopics are finalized (pre-approval). Sessions 2–N are picked up by the Part A
  // hourly cron (one not-ready session per user per hour), not by this route. This
  // removes the "fire content generation for ALL sessions" block that used to live here.

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
