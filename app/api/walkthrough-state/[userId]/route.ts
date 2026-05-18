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
 * Response includes:
 *   - visual_spec (legacy flow diagram, kept for backward compatibility)
 *   - sections (TemplateSection[], new template-based system)
 *   - current_section_index (number, AI-controlled scroll position)
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
