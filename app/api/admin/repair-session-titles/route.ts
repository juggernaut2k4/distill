/**
 * POST /api/admin/repair-session-titles
 * Re-runs session-designer for a user's existing sessions and updates titles.
 * Use when sessions were created with the wrong title (plan topic title verbatim).
 *
 * Body: { userId: string, dryRun?: boolean }
 *
 * B2B-21 Requirement Doc §7 — this route previously had NO auth check at all
 * (reachable by the public internet), a P0 finding beyond the brief's own
 * initial list, closed under the same gate as every other internal/
 * cross-partner route: `requireSuperAdmin()`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { designSessionsForTopic, getSessionDuration } from '@/lib/curriculum/session-designer'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'

interface SubSession {
  title: string
  type: string
  duration_mins: number
  learning_objective: string
}

export async function POST(req: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const body = await req.json() as { userId?: string; dryRun?: boolean }
  const { userId, dryRun = false } = body

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const supabase = createSupabaseAdminClient()

  // Load user profile
  const { data: user } = await supabase
    .from('users')
    .select('role, industry, ai_maturity, learning_goal')
    .eq('id', userId)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Load approved plan
  const { data: plan } = await supabase
    .from('curriculum_plans')
    .select('id, visible_sessions')
    .eq('user_id', userId)
    .eq('is_approved', true)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!plan) return NextResponse.json({ error: 'No approved plan found' }, { status: 404 })

  // Load sessions for this plan
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, session_index, session_title, curriculum_session_id, sub_sessions, duration_mins')
    .eq('user_id', userId)
    .eq('curriculum_plan_id', plan.id)
    .not('status', 'in', '("cancelled","completed")')
    .order('session_index', { ascending: true })

  if (!sessions?.length) return NextResponse.json({ error: 'No sessions found' }, { status: 404 })

  const visibleSessions = (Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []) as Array<{
    session_id: string
    title: string
    focus: string
    depth_level: string
    estimated_minutes: number
    subtopics?: string[]
  }>

  const maxMins = getSessionDuration((user as { learning_goal?: string }).learning_goal ?? null)
  const profile = {
    role:     (user as { role?: string }).role     ?? 'executive',
    industry: (user as { industry?: string }).industry ?? 'general',
    maturity: (user as { ai_maturity?: string }).ai_maturity ?? 'intermediate',
  }

  const repairs: Array<{ sessionId: string; oldTitle: string; newTitle: string }> = []

  // Group sessions by curriculum_session_id to design each topic's sessions together
  const topicMap = new Map<string, typeof sessions>()
  for (const s of sessions) {
    const csId = (s as { curriculum_session_id?: string }).curriculum_session_id ?? ''
    if (!topicMap.has(csId)) topicMap.set(csId, [])
    topicMap.get(csId)!.push(s)
  }

  for (const [csId, topicSessions] of Array.from(topicMap.entries())) {
    const planTopic = visibleSessions.find((v) => v.session_id === csId)
    if (!planTopic) {
      console.warn(`[repair-session-titles] No plan topic found for curriculum_session_id=${csId}`)
      continue
    }

    // Re-run session designer for this topic with the same subtopics
    const designed = await designSessionsForTopic(
      {
        session_id:        planTopic.session_id,
        title:             planTopic.title,
        focus:             planTopic.focus,
        depth_level:       planTopic.depth_level,
        estimated_minutes: planTopic.estimated_minutes,
        subtopics:         planTopic.subtopics,
      },
      profile,
      maxMins
    )

    // Match designed sessions to DB sessions by position
    for (let i = 0; i < topicSessions.length; i++) {
      const dbSession = topicSessions[i]
      const designedSession = designed[i] ?? designed[designed.length - 1]
      const newTitle = designedSession.session_title

      repairs.push({
        sessionId: dbSession.id,
        oldTitle: dbSession.session_title as string,
        newTitle,
      })

      if (!dryRun) {
        await supabase
          .from('sessions')
          .update({ session_title: newTitle })
          .eq('id', dbSession.id)
      }
    }
  }

  return NextResponse.json({
    dryRun,
    repaired: repairs.length,
    repairs,
  })
}
