import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'

interface Params { params: { topicId: string } }

/**
 * GET /api/kb/topics/[topicId]
 * Returns all sections for a topic in order.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const { data: rows, error: dbError } = await supabase
    .from('topic_content_cache')
    .select('id, subtopic_slug, subtopic_title, template_type, section_data, previous_section_data, kb_feedback, generated_at, qa_score, qa_result, qa_run_at, training_script, content_outline, tab_manifest')
    .eq('topic_id', params.topicId)
    .gt('expires_at', new Date().toISOString())
    .order('generated_at', { ascending: true })

  if (dbError) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ sections: rows ?? [] })
}

/**
 * DELETE /api/kb/topics/[topicId]
 * Hard-deletes all cache entries for this topic so it regenerates fresh next session.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
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
