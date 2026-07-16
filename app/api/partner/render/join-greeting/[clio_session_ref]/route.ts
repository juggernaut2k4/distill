import { NextRequest, NextResponse } from 'next/server'
import { getPartnerSession } from '@/lib/partner/live-render'
import { getPromptConfig, DEFAULT_JOIN_GREETING } from '@/lib/partner/prompt-config'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET/PATCH /api/partner/render/join-greeting/[clio_session_ref]
 *
 * B2B-11 (Requirement Doc Section 6.3). Follows
 * /api/partner/render/end-session/route.ts's exact trust boundary:
 * unauthenticated, validated only by the opaque `clio_session_ref` resolving
 * to a real `partner_sessions` row — this route runs inside the meeting
 * bot's headless browser, with no Clerk session and no partner API key
 * available, identical precedent to every other client-side partner-render
 * call site.
 *
 * v1.1 fix (CEO Agent review, confirmed against Hume's own docs at
 * dev.hume.ai/docs/speech-to-speech-evi/configuration/session-settings):
 * a `session_settings` message with a `system_prompt` field FULLY REPLACES,
 * never merges or appends to, the EVI session's active prompt. Sending the
 * greeting fragment alone here would wipe Clio's entire active prompt (all
 * 12 fixed rules, tool mechanics, the AI-disclosure rule, the mandatory
 * end_session requirement, and the session content itself) for the rest of
 * the call. The full snapshot persisted at render time
 * (lib/partner/live-render.ts, Section 5.3/6.1a) MUST be present and MUST be
 * sent as the prefix of every greeting send — never the addendum alone.
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
    .select('join_greeting_pending, join_greeting_participant_first_name, assembled_prompt_snapshot')
    .eq('id', session.id)
    .maybeSingle()

  if (!data?.join_greeting_pending) {
    return NextResponse.json({ pending: false, greeting_text: null })
  }

  const fullAssembledPrompt = (data.assembled_prompt_snapshot as string | null) ?? null

  if (!fullAssembledPrompt) {
    // Defensive fallback only — expected to be rare/never in practice, since
    // the snapshot is written at render time, before any participant can
    // join. If it's missing anyway (a pre-migration row, or a render whose
    // snapshot write failed), do NOT send a greeting-only fragment: that
    // would still trigger the exact prompt-wipe this fix exists to prevent.
    // Give up silently for this join event rather than risk corrupting the
    // live session's prompt.
    console.warn('[join-greeting] assembled_prompt_snapshot missing — skipping send to avoid replacing the active Hume prompt with a fragment', { sessionId: session.id })
    await supabase
      .from('partner_sessions')
      .update({ join_greeting_pending: false, join_greeting_participant_first_name: null })
      .eq('id', session.id)
    return NextResponse.json({ pending: false, greeting_text: null })
  }

  const promptConfig = await getPromptConfig(session.partnerAccountId)
  const firstName = (data.join_greeting_participant_first_name as string | null) ?? 'there'
  const field = promptConfig.joinGreeting ?? DEFAULT_JOIN_GREETING

  const substituted = field.text.split('{firstName}').join(firstName)
  const directive = field.mode === 'literal'
    ? `Say exactly the following, verbatim and naturally: "${substituted}"`
    : substituted

  // [SYSTEM] prefix and "do not restart" framing mirror
  // HUME_WRAPUP_NUDGE_TEXT's own established convention
  // (WalkthroughClient.tsx) — this framing governs Clio's immediate next
  // utterance only; it does NOT restore a wiped prompt for subsequent turns,
  // which is why the full prompt below is what actually keeps the session
  // correct after this send, not this framing sentence.
  const greetingAddendum = `[SYSTEM] A participant just joined the call. Do not restart, re-introduce yourself, or repeat anything already said — this is happening live, mid-session. Right now, before continuing with anything else: ${directive}`

  // The send carries the FULL already-assembled prompt (session content, all
  // 12 fixed rules, tool mechanics, partner guidance if any) with the
  // greeting instruction appended as an addendum — never the addendum alone.
  // This is what keeps Clio's behavior intact for the rest of the call under
  // Hume's confirmed full-replace `session_settings.system_prompt` semantics.
  const greetingText = `${fullAssembledPrompt}\n\n${greetingAddendum}`

  return NextResponse.json({ pending: true, greeting_text: greetingText })
}

export async function PATCH(
  _req: NextRequest,
  { params }: { params: { clio_session_ref: string } }
) {
  const session = await getPartnerSession(params.clio_session_ref)
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const supabase = createSupabaseAdminClient()
  await supabase.from('partner_sessions')
    .update({ join_greeting_pending: false, join_greeting_participant_first_name: null })
    .eq('id', session.id)

  return NextResponse.json({ ok: true })
}
