/**
 * POST /api/sessions/relay-blocked
 *
 * RTV-01 — Fail-Closed Live-Transcript Relay Pre-Flight Gate
 * (requirement-docs/RTV-01-relay-preflight-gate.md).
 *
 * Called by WalkthroughClient.tsx when the relay pre-flight gate's 20s
 * relay-confirm timeout elapses without Clio's live transcript ever reaching
 * the app (Section 4, State 4). This is the teardown+reschedule half of the
 * gate: it deletes the Recall.ai bot, tears down walkthrough_state, and
 * reverts the session `active → scheduled` with `started_at = null` —
 * writing NO billing event and deducting NO minutes, because a relay-blocked
 * session never truly ran (it is "un-started," not "completed").
 *
 * Auth model mirrors app/api/sessions/end-call/route.ts byte-for-byte: this
 * component runs inside the Recall.ai bot's own headless browser, which has
 * no Clerk session cookie, so it can only identify itself by userId — proven
 * via the per-session audit token minted by POST /api/sessions/[id]/start
 * (see lib/session-billing.ts mintAuditToken / verifyAuditToken).
 *
 * Deliberately does NOT call forceEndSession() (lib/session-billing.ts) —
 * that path bills and completes the session, which is the opposite of what a
 * relay-blocked session should do. Instead it reuses forceEndSession's own
 * primitives (verifyAuditToken, getMeetingBotProvider().deleteBot, and the
 * same walkthrough_state teardown shape) and performs the reschedule-specific
 * `sessions` write directly.
 *
 * Non-fatal contract, same as end-call: never throws to the caller. The
 * caller (WalkthroughClient) fires this fire-and-forget and renders the
 * "Session Rescheduled" overlay independently of this endpoint's result — the
 * wall-clock session-timer.ts backstop remains the ultimate cleanup if this
 * request never lands.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { verifyAuditToken } from '@/lib/session-billing'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'

const BodySchema = z.object({
  userId: z.string().min(1),
  token: z.string().min(1),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { userId, token } = parsed.data

  const supabase = createSupabaseAdminClient()
  const { data: wsRow } = await supabase
    .from('walkthrough_state')
    .select('session_id, audit_token, bot_id')
    .eq('user_id', userId)
    .maybeSingle()

  // SECURITY: reject before resolving/using session_id or bot_id at all if the
  // caller can't prove ownership of this user's active session — identical
  // fail-closed check to /api/sessions/end-call and /api/sessions/audit-event.
  // No bot deletion, no walkthrough_state teardown, no sessions status change
  // happens before this check passes (AC-9).
  if (!verifyAuditToken(token, (wsRow?.audit_token as string | null) ?? null)) {
    return NextResponse.json({ error: 'Invalid or missing audit token' }, { status: 401 })
  }

  const sessionId = wsRow?.session_id as string | null
  const botId = wsRow?.bot_id as string | null

  try {
    // Delete the Recall.ai bot — the exact primitive forceEndSession already
    // uses (lib/session-billing.ts). Non-fatal on error (log, continue), same
    // as forceEndSession: the reschedule writes below must proceed regardless.
    if (botId) {
      try {
        await getMeetingBotProvider().deleteBot(botId)
      } catch (err) {
        console.error('[relay-blocked] Bot deletion failed (non-fatal):', err)
      }
    }

    // Reschedule-specific sessions write — deliberately NOT forceEndSession's
    // completion path. No ended_at, no duration_mins, no deduct_minutes RPC,
    // no `disconnected` audit event: this session is "un-started," not
    // "completed," so nothing about it touches billing (AC-5, AC-6).
    if (sessionId) {
      const { error: sessionsError } = await supabase
        .from('sessions')
        .update({ status: 'scheduled', started_at: null })
        .eq('id', sessionId)

      if (sessionsError) {
        console.error('[relay-blocked] Failed to revert session status:', sessionsError.message)
      }
    }

    // Same walkthrough_state teardown shape forceEndSession already writes —
    // including rotating audit_token out so it can never be replayed.
    const { error: wsError } = await supabase
      .from('walkthrough_state')
      .update({
        bot_id: null,
        meeting_url: null,
        status: 'idle',
        visual_spec: null,
        topic_title: null,
        topic_id: null,
        sections: null,
        training_scripts: null,
        session_brief: null,
        topic_context: null,
        session_script: null,
        clio_session_context: null,
        current_section_index: 0,
        pending_transcript: null,
        audit_token: null,
      })
      .eq('user_id', userId)

    if (wsError) {
      console.error('[relay-blocked] Failed to tear down walkthrough_state:', wsError.message)
    }

    console.log(`[relay-blocked] Reverted session ${sessionId ?? '(none)'} to scheduled for user=${userId}`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[relay-blocked] Unexpected failure:', err)
    // Non-fatal response shape — the caller (live voice session) must never
    // throw on this; the wall-clock backstop covers any remaining cleanup.
    return NextResponse.json({ ok: false, error: 'Failed to process relay-blocked teardown' }, { status: 200 })
  }
}
