import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'

/**
 * GET /api/kb/topics
 *
 * SESS-05 / TITLE-01: Returns one KB entry per DB session (not per curriculum topic).
 * The content pipeline writes topic_content_cache rows with topic_id = sessions.id (UUID).
 * We query the user's sessions first, then join to the cache by session UUID so each
 * KB card maps 1:1 to a DB session and carries the canonical session_title.
 *
 * Entries are ordered by session_index so the KB list matches the session order.
 * Sessions with no cache rows are excluded (content not yet generated).
 */
export async function GET(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  // Check KB access (email lookup for admin-only mode)
  const { data: user } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId!)
    .single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Step 1: Fetch the user's sessions ordered by session_index.
  // These are our KB "topics" — one entry per DB session.
  const { data: sessionRows, error: sessionsError } = await supabase
    .from('sessions')
    .select('id, session_title, session_index, curriculum_session_id, status')
    .eq('user_id', userId!)
    .neq('status', 'draft')
    .order('session_index', { ascending: true })

  if (sessionsError) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  if (!sessionRows || sessionRows.length === 0) {
    return NextResponse.json({ topics: [] })
  }

  const sessionIds = sessionRows.map((s) => s.id)

  // Step 2: Fetch all non-expired cache rows whose topic_id is a session UUID.
  // The pipeline writes topic_id = sessionId (UUID) so this join is exact.
  const { data: cacheRows, error: cacheError } = await supabase
    .from('topic_content_cache')
    .select('topic_id, subtopic_title, subtopic_slug, template_type, generated_at, expires_at')
    .in('topic_id', sessionIds)
    .gt('expires_at', new Date().toISOString())
    .order('generated_at', { ascending: false })

  if (cacheError) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // Step 3: Group cache rows by session UUID.
  const cacheBySession = new Map<string, {
    section_count: number
    last_updated: string
    sub_sessions: Array<{ slug: string; title: string; type: string }>
  }>()

  for (const row of (cacheRows ?? [])) {
    if (!cacheBySession.has(row.topic_id)) {
      cacheBySession.set(row.topic_id, {
        section_count: 0,
        last_updated: row.generated_at,
        sub_sessions: [],
      })
    }
    const entry = cacheBySession.get(row.topic_id)!
    entry.section_count++
    entry.sub_sessions.push({
      slug: row.subtopic_slug,
      title: row.subtopic_title ?? row.subtopic_slug,
      type: row.template_type,
    })
    if (row.generated_at > entry.last_updated) {
      entry.last_updated = row.generated_at
    }
  }

  // Step 4: Build the response — one entry per session that has cache rows.
  // Order is preserved from the session_index sort above (DB session order).
  const topics = sessionRows
    .filter((s) => cacheBySession.has(s.id))
    .map((s) => {
      const cache = cacheBySession.get(s.id)!
      return {
        // topic_id is the DB session UUID — used as the KB detail page URL key
        topic_id: s.id,
        // TITLE-01: use sessions.session_title as the canonical title
        topic_title: s.session_title ?? `Session ${s.session_index}`,
        section_count: cache.section_count,
        last_updated: cache.last_updated,
        sub_sessions: cache.sub_sessions,
        session_index: s.session_index,
        session_status: s.status,
      }
    })

  return NextResponse.json({ topics })
}
