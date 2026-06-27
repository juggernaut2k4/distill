import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import type { TemplateSection } from '@/lib/templates/types'

// ─── GET ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/walkthrough-state/[userId]
 * Returns current walkthrough_state for a user. Public — no auth required.
 * Used by WalkthroughClient to poll for updates instead of Supabase Realtime,
 * which is unreliable in Recall.ai's headless browser environment.
 *
 * LIVE-05: Detects stale sections after content regeneration mid-session.
 * If any topic_content_cache row for the active topic has generated_at newer
 * than sections_loaded_at, sections are reloaded from cache and walkthrough_state
 * is updated in place before returning.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { userId: string } }
) {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('walkthrough_state')
    .select('*')
    .eq('user_id', params.userId)
    .single()

  if (data?.pending_transcript) {
    console.log('[walkthrough-state] GET returning pending_transcript:', (data.pending_transcript as string).slice(0, 80))
  }

  // LIVE-05: Stale section detection. Only runs when:
  //   - A session is active (topic_id + sections_loaded_at present)
  //   - The state row exists (no point checking on initial load)
  if (
    data &&
    typeof data.topic_id === 'string' &&
    data.topic_id.length > 0 &&
    typeof data.sections_loaded_at === 'string'
  ) {
    const { data: freshRows } = await supabase
      .from('topic_content_cache')
      .select('subtopic_slug, section_data, generated_at')
      .eq('topic_id', data.topic_id)
      .eq('pipeline_status', 'ready')
      .gt('generated_at', data.sections_loaded_at)
      .limit(1)

    if (freshRows && freshRows.length > 0) {
      // At least one cache row is newer than when sections were loaded — reload all.
      console.log(`[walkthrough-state] LIVE-05: stale sections detected for topic ${data.topic_id} — reloading from cache`)

      const { data: allRows } = await supabase
        .from('topic_content_cache')
        .select('subtopic_slug, subtopic_title, section_data')
        .eq('topic_id', data.topic_id)
        .eq('pipeline_status', 'ready')

      if (allRows && allRows.length > 0) {
        const reloadedSections: TemplateSection[] = allRows
          .map((row) => row.section_data as TemplateSection | null)
          .filter((s): s is TemplateSection => s !== null)

        const nowIso = new Date().toISOString()
        await supabase
          .from('walkthrough_state')
          .update({
            sections: reloadedSections,
            sections_loaded_at: nowIso,
          })
          .eq('user_id', params.userId)

        // Return with fresh sections so the current poll gets them immediately
        return NextResponse.json({ ...data, sections: reloadedSections, sections_loaded_at: nowIso })
      }
    }
  }

  return NextResponse.json(
    data ?? {
      user_id: params.userId,
      status: 'idle',
      visual_spec: null,
      pending_transcript: null,
      sections: null,
      current_section_index: 0,
    }
  )
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

/**
 * PATCH /api/walkthrough-state/[userId]
 * Clears pending_transcript after it has been sent to the ElevenLabs agent.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: { userId: string } }
) {
  const supabase = createSupabaseAdminClient()
  await supabase
    .from('walkthrough_state')
    .update({ pending_transcript: null })
    .eq('user_id', params.userId)
  console.log('[walkthrough-state] PATCH cleared pending_transcript for', params.userId)
  return NextResponse.json({ ok: true })
}

// ─── POST ─────────────────────────────────────────────────────────────────────

type ScrollToCommand = {
  command: 'scroll_to'
  section_index: number
}

type InsertSectionCommand = {
  command: 'insert_section'
  after_index: number
  section: TemplateSection
}

type SectionCommand = ScrollToCommand | InsertSectionCommand

/**
 * POST /api/walkthrough-state/[userId]
 * Accepts AI-driven section navigation commands.
 *
 * Commands:
 *   { command: 'scroll_to', section_index: number }
 *     — Updates current_section_index so SessionStack scrolls there on next poll.
 *
 *   { command: 'insert_section', after_index: number, section: TemplateSection }
 *     — Inserts a new TemplateSection into the sections array at after_index + 1.
 *       Useful for question-answer sections inserted mid-session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  let body: SectionCommand
  try {
    body = (await request.json()) as SectionCommand
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  if (body.command === 'scroll_to') {
    const { section_index } = body
    if (typeof section_index !== 'number' || section_index < 0) {
      return NextResponse.json({ error: 'section_index must be a non-negative number' }, { status: 400 })
    }

    const { error } = await supabase
      .from('walkthrough_state')
      .update({ current_section_index: section_index })
      .eq('user_id', params.userId)

    if (error) {
      console.error('[walkthrough-state] POST scroll_to error:', error)
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }

    console.log('[walkthrough-state] POST scroll_to', section_index, 'for', params.userId)
    return NextResponse.json({ ok: true, current_section_index: section_index })
  }

  if (body.command === 'insert_section') {
    const { after_index, section } = body
    if (typeof after_index !== 'number' || after_index < 0) {
      return NextResponse.json({ error: 'after_index must be a non-negative number' }, { status: 400 })
    }
    if (!section || typeof section !== 'object') {
      return NextResponse.json({ error: 'section must be a TemplateSection object' }, { status: 400 })
    }

    // Fetch current sections array
    const { data: current } = await supabase
      .from('walkthrough_state')
      .select('sections, current_section_index')
      .eq('user_id', params.userId)
      .single()

    const existingSections: TemplateSection[] = Array.isArray(current?.sections)
      ? (current.sections as TemplateSection[])
      : []

    // Insert the new section at after_index + 1
    const insertAt = Math.min(after_index + 1, existingSections.length)
    const updatedSections = [
      ...existingSections.slice(0, insertAt),
      { ...section, status: 'inserted' as const },
      ...existingSections.slice(insertAt),
    ]

    const { error } = await supabase
      .from('walkthrough_state')
      .update({ sections: updatedSections })
      .eq('user_id', params.userId)

    if (error) {
      console.error('[walkthrough-state] POST insert_section error:', error)
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }

    console.log('[walkthrough-state] POST insert_section after index', after_index, 'for', params.userId)
    return NextResponse.json({ ok: true, inserted_at: insertAt, total_sections: updatedSections.length })
  }

  return NextResponse.json({ error: 'Unknown command' }, { status: 400 })
}
