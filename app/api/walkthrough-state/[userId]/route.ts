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

  // SECURITY (CEO review fix): this route is fully public and userId-keyed — never
  // return audit_token here. It's the credential /api/sessions/audit-event requires
  // to write billing events; if it were readable via this endpoint, anyone who
  // knew/guessed a userId could fetch it and defeat that fix entirely. The token is
  // instead delivered to the bot's browser out-of-band, via a query param on the
  // walkthroughUrl (see app/api/recall/bot/route.ts + app/walkthrough/[userId]/page.tsx).
  if (data && 'audit_token' in data) {
    delete (data as Record<string, unknown>).audit_token
  }

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
 * Clears pending_transcript after it has been consumed by the client.
 *
 * HUME-NATIVE-01 (Graceful Session End) — additive: also accepts an optional
 * `{ clear: 'hume_wrapup_nudge_pending' }` body to clear the new Hume-specific
 * flag once the wrap-up nudge has been sent over the WebSocket (or once a
 * retry has been attempted and given up on — the flag must be cleared either
 * way, per the requirement doc, so a failed nudge is never silently re-sent
 * forever on subsequent polls). Always clearing pending_transcript alongside
 * it is a no-op for Hume-native sessions (that field is never set for them),
 * so no branching is needed on which field(s) to touch.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  const supabase = createSupabaseAdminClient()

  let clearNudge = false
  try {
    const body = await request.json() as { clear?: string } | null
    clearNudge = body?.clear === 'hume_wrapup_nudge_pending'
  } catch {
    // No/invalid JSON body — existing callers (pending_transcript clear) send
    // no body at all. Not an error; just means "clear pending_transcript only".
  }

  await supabase
    .from('walkthrough_state')
    .update({
      pending_transcript: null,
      ...(clearNudge ? { hume_wrapup_nudge_pending: false } : {}),
    })
    .eq('user_id', params.userId)

  console.log(
    '[walkthrough-state] PATCH cleared pending_transcript',
    clearNudge ? '+ hume_wrapup_nudge_pending' : '',
    'for',
    params.userId
  )
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

// RTV-05 (Section 6.3) — new third command, following the identical
// fetch-then-write-back shape already used by insert_section above. Replaces
// only one section's `data` field in place, preserving id/type/meta/status,
// and never touches current_section_index. Used by the new
// POST /api/rtv05/prefetch-section route to write freshly live-generated
// content into this one session's own walkthrough_state row.
type UpdateSectionDataCommand = {
  command: 'update_section_data'
  section_index: number
  data: TemplateSection['data']
}

type SectionCommand = ScrollToCommand | InsertSectionCommand | UpdateSectionDataCommand

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
 *
 *   { command: 'update_section_data', section_index: number, data: TemplateSection['data'] }
 *     — RTV-05 (Section 6.3): overwrites only sections[section_index].data in
 *       place, preserving id/type/meta/status unchanged. Never touches
 *       current_section_index. Used by /api/rtv05/prefetch-section to write
 *       freshly live-generated content for one topic ahead of its display.
 *       Refuses to touch a SessionOverview/SessionSummary bookend even if
 *       called incorrectly (defense in depth — bookends are never
 *       overwritten, Section 4.6).
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

  if (body.command === 'update_section_data') {
    const { section_index, data } = body
    if (typeof section_index !== 'number' || section_index < 0) {
      return NextResponse.json({ error: 'section_index must be a non-negative number' }, { status: 400 })
    }
    if (data === undefined || data === null || typeof data !== 'object') {
      return NextResponse.json({ error: 'data must be a TemplateSection[\'data\'] object' }, { status: 400 })
    }

    // Fetch current sections array — same fetch-then-write-back shape as
    // insert_section above (Section 6.3).
    const { data: current } = await supabase
      .from('walkthrough_state')
      .select('sections')
      .eq('user_id', params.userId)
      .single()

    const existingSections: TemplateSection[] = Array.isArray(current?.sections)
      ? (current.sections as TemplateSection[])
      : []

    if (section_index >= existingSections.length) {
      return NextResponse.json({ error: 'section_index out of bounds' }, { status: 400 })
    }

    const target = existingSections[section_index]

    // Defense in depth (Section 6.3) — bookends are never overwritten even
    // if this route were ever called incorrectly, regardless of caller.
    if (target.type === 'SessionOverview' || target.type === 'SessionSummary') {
      console.warn('[walkthrough-state] POST update_section_data refused — target is a bookend:', target.type, 'for', params.userId)
      return NextResponse.json({ error: 'Cannot overwrite a bookend section' }, { status: 400 })
    }

    // Replace only this element's data field, preserving id/type/meta/status.
    const updatedSections = existingSections.map((section, idx) =>
      idx === section_index ? { ...section, data } as TemplateSection : section
    )

    const { error } = await supabase
      .from('walkthrough_state')
      .update({ sections: updatedSections })
      .eq('user_id', params.userId)

    if (error) {
      console.error('[walkthrough-state] POST update_section_data error:', error)
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }

    console.log('[walkthrough-state] POST update_section_data for section', section_index, 'for', params.userId)
    return NextResponse.json({ ok: true, section_index })
  }

  return NextResponse.json({ error: 'Unknown command' }, { status: 400 })
}
