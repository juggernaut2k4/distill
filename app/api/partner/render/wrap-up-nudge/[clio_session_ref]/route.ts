import { NextRequest, NextResponse } from 'next/server'
import { getPartnerSession } from '@/lib/partner/live-render'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET/PATCH /api/partner/render/wrap-up-nudge/[clio_session_ref]  (B2B-19)
 *
 * Mirrors the B2B-11 join-greeting route's exact trust boundary and prompt-
 * replacement discipline. The mid-session `partner-live-cutoff` Inngest job sets
 * `wrap_up_pending = true` + `wrap_up_nudge_text` on the session when the
 * affordable-minutes-minus-buffer boundary is reached; PartnerRenderClient's
 * wrap-up poll delivers it via sendWrapUpNudge(). This is a GRACEFUL wrap-up
 * cue, NOT a hard cut.
 *
 * Hume's `session_settings.system_prompt` FULLY REPLACES the active prompt, so —
 * exactly like the join-greeting route — the send must carry the full assembled
 * prompt snapshot with the wrap-up directive appended, never the directive
 * alone (which would wipe all 12 fixed rules, tool mechanics, and session
 * content for the remainder of the call).
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: { clio_session_ref: string } }
) {
  const session = await getPartnerSession(params.clio_session_ref)
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_sessions')
    .select('wrap_up_pending, wrap_up_nudge_text, assembled_prompt_snapshot')
    .eq('id', session.id)
    .maybeSingle()

  if (!data?.wrap_up_pending) {
    return NextResponse.json({ pending: false, nudge_text: null })
  }

  const fullAssembledPrompt = (data.assembled_prompt_snapshot as string | null) ?? null
  if (!fullAssembledPrompt) {
    // Defensive: never send a fragment alone (would wipe the active prompt).
    console.warn('[wrap-up-nudge] assembled_prompt_snapshot missing — skipping send to avoid replacing the active Hume prompt with a fragment', { sessionId: session.id })
    await supabase
      .from('partner_sessions')
      .update({ wrap_up_pending: false, wrap_up_nudge_text: null })
      .eq('id', session.id)
    return NextResponse.json({ pending: false, nudge_text: null })
  }

  const directive =
    (data.wrap_up_nudge_text as string | null) ??
    'You are almost out of session time. Begin wrapping up now: give your brief two-sentence closing summary, ask if there is anything else, then say goodbye and call the end_session tool.'

  const addendum = `[SYSTEM] The session is almost out of allotted time. Do not restart or re-introduce anything. Right now, before continuing with anything else: ${directive}`

  const nudgeText = `${fullAssembledPrompt}\n\n${addendum}`
  return NextResponse.json({ pending: true, nudge_text: nudgeText })
}

export async function PATCH(
  _req: NextRequest,
  { params }: { params: { clio_session_ref: string } }
) {
  const session = await getPartnerSession(params.clio_session_ref)
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const supabase = createSupabaseAdminClient()
  await supabase
    .from('partner_sessions')
    .update({ wrap_up_pending: false, wrap_up_nudge_text: null })
    .eq('id', session.id)

  return NextResponse.json({ ok: true })
}
