import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'
import { regenerateWithFeedback } from '@/lib/templates/generator'
import type { TemplateSection } from '@/lib/templates/types'

interface Params { params: { topicId: string; subtopicSlug: string } }

const Body = z.object({ feedback: z.string().min(1).max(2000) })

/**
 * POST /api/kb/topics/[topicId]/sections/[subtopicSlug]/feedback
 * Applies user feedback: saves current section as previous, generates new current.
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

  const body = Body.safeParse(await request.json())
  if (!body.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  const { feedback } = body.data

  // Fetch the current section row
  const { data: row } = await supabase
    .from('topic_content_cache')
    .select('id, section_data')
    .eq('topic_id', params.topicId)
    .eq('subtopic_slug', params.subtopicSlug)
    .maybeSingle()

  if (!row) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 })
  }

  const currentSection = row.section_data as TemplateSection

  try {
    const updatedSection = await regenerateWithFeedback(currentSection, feedback)

    // Shift current → previous, save new as current
    await supabase
      .from('topic_content_cache')
      .update({
        previous_section_data: currentSection,
        section_data: updatedSection,
        kb_feedback: feedback,
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days
      })
      .eq('id', row.id)

    return NextResponse.json({ section: updatedSection })
  } catch (err) {
    console.error('[kb-feedback] Regeneration failed:', err)
    return NextResponse.json(
      { error: 'Regeneration failed. Please try again.' },
      { status: 500 }
    )
  }
}
