/**
 * GET /api/admin/session-markers?sessionId=<uuid>
 *
 * RTV-02 — read-only inspectability surface (Section 4.4 / Q6 of the approved
 * spec). Returns the stored session_markers JSON + rtv_eligible, plus a
 * flattened, human-readable per-topic summary so a QA engineer or the product
 * owner can review golden-word marker quality before RTV-03 is ever switched
 * on. Auth guard mirrors the existing app/api/admin/qa-session-context/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import type { SessionMarkers } from '@/lib/content/session-markers'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'

/** B2B-21 Requirement Doc §7 — gated `requireSuperAdmin()` (previously bare `auth()`). */
export async function GET(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const sessionId = request.nextUrl.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing required query param: sessionId' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id, session_markers, rtv_eligible')
    .eq('id', sessionId)
    .single()

  if (error || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const sessionMarkers = session.session_markers as SessionMarkers | null

  if (!sessionMarkers) {
    return NextResponse.json(
      { error: 'No session_markers stored for this session (marker generation toggle was OFF, or this session predates the feature)' },
      { status: 404 }
    )
  }

  const summary = sessionMarkers.topics.map((topic) => ({
    section_index: topic.section_index,
    type: topic.type,
    subtopic_title: topic.subtopic_title ?? null,
    is_bookend: topic.is_bookend,
    source_level: topic.source_level ?? null,
    golden_word: topic.golden_word,
    marker_count: topic.markers.length,
    markers: topic.markers.map((m) => m.word),
  }))

  return NextResponse.json({
    session_id: sessionId,
    rtv_eligible: session.rtv_eligible as boolean | null,
    session_markers: sessionMarkers,
    summary,
  })
}
