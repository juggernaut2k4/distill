import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'

/**
 * GET /api/kb/topics
 * Returns all distinct topics stored in topic_content_cache,
 * grouped by topic_id with section count and last updated time.
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

  // Group by topic_id — aggregate section count and latest timestamp
  const { data: rows, error: dbError } = await supabase
    .from('topic_content_cache')
    .select('topic_id, subtopic_title, subtopic_slug, template_type, generated_at, expires_at')
    .gt('expires_at', new Date().toISOString())
    .order('generated_at', { ascending: false })

  if (dbError) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // Group rows by topic_id
  const topicMap = new Map<string, {
    topic_id: string
    topic_title: string
    section_count: number
    last_updated: string
    subtopics: Array<{ slug: string; title: string; type: string }>
  }>()

  for (const row of (rows ?? [])) {
    const topicTitle = row.subtopic_title?.split('—')[0]?.trim() ?? row.topic_id

    if (!topicMap.has(row.topic_id)) {
      topicMap.set(row.topic_id, {
        topic_id: row.topic_id,
        topic_title: topicTitle,
        section_count: 0,
        last_updated: row.generated_at,
        subtopics: [],
      })
    }

    const entry = topicMap.get(row.topic_id)!
    entry.section_count++
    entry.subtopics.push({
      slug: row.subtopic_slug,
      title: row.subtopic_title ?? row.subtopic_slug,
      type: row.template_type,
    })
    if (row.generated_at > entry.last_updated) {
      entry.last_updated = row.generated_at
    }
  }

  const topics = Array.from(topicMap.values()).sort(
    (a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
  )

  return NextResponse.json({ topics })
}
