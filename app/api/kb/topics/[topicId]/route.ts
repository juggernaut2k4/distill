import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'

interface Params { params: { topicId: string } }

/** Mirrors the slugify function in session-content-generator.ts — must stay in sync. */
function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 60)
}

interface SessionSubtopic {
  title: string
  type?: string
  duration_mins?: number
  learning_objective?: string
}

interface SessionRow {
  id: string
  session_title: string | null
  session_index: number
  sub_sessions: SessionSubtopic[] | null
  status: string | null
  duration_mins: number | null
  planned_duration_mins: number | null
}

interface ArcSession {
  session_id: string
  title: string
  session_index: number
  subtopic_count: number
  status: string
}

interface Arc {
  title: string
  focus: string | null
  sessions: ArcSession[]
  total_sub_sessions: number
  total_sessions: number
  completed_sessions: number
}

/**
 * Builds an ordered list of subtopic slugs from the sessions belonging to this topic.
 * Sessions are ordered by session_index; within each session the subtopics array is
 * already in teaching order.
 */
function buildOrderedSlugs(sessions: SessionRow[]): string[] {
  const slugs: string[] = []
  for (const session of sessions) {
    if (!Array.isArray(session.sub_sessions)) continue
    for (const sub of session.sub_sessions) {
      if (sub.title) slugs.push(slugify(sub.title))
    }
  }
  return slugs
}

/**
 * GET /api/kb/topics/[topicId]
 * Returns all sections for a topic in session/subtopic teaching order,
 * plus arc metadata for the Overview card.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Fetch cache rows and sessions in parallel
  const [cacheResult, sessionsResult] = await Promise.all([
    supabase
      .from('topic_content_cache')
      .select('id, subtopic_slug, subtopic_title, template_type, section_data, previous_section_data, kb_feedback, generated_at, qa_score, qa_result, qa_run_at, training_script, content_outline, tab_manifest')
      .eq('topic_id', params.topicId)
      .gt('expires_at', new Date().toISOString()),
    supabase
      .from('sessions')
      .select('id, session_title, session_index, sub_sessions, status, curriculum_session_id, duration_mins, planned_duration_mins')
      .eq('id', params.topicId)
      .limit(1),
  ])

  if (cacheResult.error) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  const rows = cacheResult.data ?? []
  const thisSession = (sessionsResult.data?.[0] ?? null) as (SessionRow & { curriculum_session_id?: string | null }) | null

  // Fetch sibling sessions for the arc overview (all sessions in the same curriculum topic)
  let sessions: SessionRow[] = thisSession ? [thisSession] : []
  if (thisSession?.curriculum_session_id) {
    const { data: siblingData } = await supabase
      .from('sessions')
      .select('id, session_title, session_index, sub_sessions, status')
      .eq('curriculum_session_id', thisSession.curriculum_session_id)
      .order('session_index', { ascending: true })
    sessions = (siblingData ?? []) as SessionRow[]
  }

  // ── KB-02: Re-order sections by session_index + subtopic position ─────────
  let orderedRows = rows
  if (thisSession) {
    const orderedSlugs = buildOrderedSlugs([thisSession])
    const slugIndex = new Map(orderedSlugs.map((slug, i) => [slug, i]))

    orderedRows = [...rows].sort((a, b) => {
      const ai = slugIndex.get(a.subtopic_slug) ?? Number.MAX_SAFE_INTEGER
      const bi = slugIndex.get(b.subtopic_slug) ?? Number.MAX_SAFE_INTEGER
      if (ai !== bi) return ai - bi
      // Fall back to generated_at for rows not found in the order map
      return new Date(a.generated_at).getTime() - new Date(b.generated_at).getTime()
    })
  }

  // ── KB-03: Build arc metadata ─────────────────────────────────────────────
  let arc: Arc | null = null
  if (sessions.length > 0) {
    // Derive arc title: strip ": Part N" / ": Session N" suffix from the first session title
    const firstTitle = sessions[0].session_title ?? params.topicId
    const arcTitle = firstTitle.replace(/[:\s]+(?:Part|Session)\s+\d+\s*$/i, '').trim()

    // Fetch focus from curriculum_plans.visible_sessions for this topicId
    let focus: string | null = null
    try {
      // Find any curriculum plan that contains this topicId in visible_sessions
      const { data: plans } = await supabase
        .from('curriculum_plans')
        .select('visible_sessions')
        .eq('user_id', userId!)
        .is('superseded_at', null)
        .limit(1)
        .single()

      if (plans?.visible_sessions) {
        const visibleSessions = plans.visible_sessions as Array<{
          session_id: string
          focus?: string
          [key: string]: unknown
        }>
        const match = visibleSessions.find((s) => s.session_id === (thisSession?.curriculum_session_id ?? params.topicId))
        focus = match?.focus ?? null
      }
    } catch {
      // Non-critical — focus remains null
    }

    const arcSessions: ArcSession[] = sessions.map((s) => ({
      session_id: s.id,
      title: s.session_title ?? s.id,
      session_index: s.session_index,
      subtopic_count: Array.isArray(s.sub_sessions) ? s.sub_sessions.length : 0,
      status: s.status ?? 'scheduled',
    }))

    const completedSessions = arcSessions.filter((s) => s.status === 'completed').length
    const totalSubtopics = arcSessions.reduce((sum, s) => sum + s.subtopic_count, 0)

    arc = {
      title: arcTitle,
      focus,
      sessions: arcSessions,
      total_sub_sessions: totalSubtopics,
      total_sessions: arcSessions.length,
      completed_sessions: completedSessions,
    }
  }

  const sessionOut = thisSession
    ? {
        id: thisSession.id,
        title: thisSession.session_title,
        sub_sessions: thisSession.sub_sessions,
        duration_mins: thisSession.duration_mins,
        planned_duration_mins: thisSession.planned_duration_mins,
      }
    : null

  return NextResponse.json({ sections: orderedRows, arc, session: sessionOut })
}

/**
 * DELETE /api/kb/topics/[topicId]
 * Hard-deletes all cache entries for this topic so it regenerates fresh next session.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const { error: delError } = await supabase
    .from('topic_content_cache')
    .delete()
    .eq('topic_id', params.topicId)

  if (delError) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
