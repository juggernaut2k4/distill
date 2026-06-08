import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'
import type { TemplateSection } from '@/lib/templates/types'

interface Params { params: { topicId: string; subtopicSlug: string } }

/**
 * POST /api/kb/topics/[topicId]/sections/[subtopicSlug]/revert
 * Swaps current_section_data ↔ previous_section_data.
 * After revert: current becomes the old version, previous becomes the feedback version.
 * This lets the user toggle back if they change their mind.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const { data: row } = await supabase
    .from('topic_content_cache')
    .select('id, section_data, previous_section_data')
    .eq('topic_id', params.topicId)
    .eq('subtopic_slug', params.subtopicSlug)
    .maybeSingle()

  if (!row) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 })
  }

  if (!row.previous_section_data) {
    return NextResponse.json({ error: 'No previous version to revert to' }, { status: 400 })
  }

  const current = row.section_data as TemplateSection
  const previous = row.previous_section_data as TemplateSection

  // Swap: previous becomes current, current becomes previous
  await supabase
    .from('topic_content_cache')
    .update({
      section_data: previous,
      previous_section_data: current,
      kb_feedback: null,
    })
    .eq('id', row.id)

  return NextResponse.json({ section: previous })
}
