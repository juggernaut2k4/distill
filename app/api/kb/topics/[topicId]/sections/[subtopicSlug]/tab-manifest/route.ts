import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'
import type { TabManifest } from '@/lib/templates/types'

interface Params { params: { topicId: string; subtopicSlug: string } }

/**
 * PATCH /api/kb/topics/[topicId]/sections/[subtopicSlug]/tab-manifest
 * Saves a tab manifest for a specific subtopic cache row.
 * Body: { tab_manifest: TabManifest }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  let body: { tab_manifest: TabManifest }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.tab_manifest || typeof body.tab_manifest !== 'object') {
    return NextResponse.json({ error: 'tab_manifest is required' }, { status: 400 })
  }

  if (!Array.isArray(body.tab_manifest.tabs)) {
    return NextResponse.json({ error: 'tab_manifest.tabs must be an array' }, { status: 400 })
  }

  const { error: dbError } = await supabase
    .from('topic_content_cache')
    .update({ tab_manifest: body.tab_manifest })
    .eq('topic_id', params.topicId)
    .eq('subtopic_slug', params.subtopicSlug)

  if (dbError) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
