/**
 * POST /api/sessions/audit-event
 * AUTOGEN-01 Part D — writes one row to the session billing audit log.
 *
 * Called from WalkthroughClient.tsx, which runs inside the Recall.ai bot's own
 * headless browser and only knows the userId (not the session id) — the same
 * constraint that already makes GET/POST /api/walkthrough-state/[userId] public
 * and userId-keyed rather than Clerk-cookie-gated (Recall's headless browser
 * environment does not reliably carry a Clerk session cookie). This route
 * follows that same precedent: it is public and resolves session_id itself via
 * walkthrough_state, rather than trusting a session id supplied by the caller.
 *
 * Only voice-adapter-observed event types may be written by the client. The
 * server-authoritative events (`bot_joined`, `disconnected`) are written
 * exclusively by /api/sessions/[id]/start, /api/sessions/[id]/end, and
 * lib/session-billing.ts's forceEndSession() — never from this route — so a
 * compromised client cannot fabricate a billing-end event.
 *
 * SECURITY (CEO review fix) — being "public and userId-keyed" previously meant
 * ANY caller who knew/guessed a userId could write events into that user's
 * session: fake gap_start/gap_end pairs to fraudulently zero out billed minutes,
 * or a fake gap_end to cancel the 30s gap watchdog on a dead/disconnected
 * session (letting an unbilled bot sit in the meeting indefinitely). Since this
 * route genuinely cannot use Clerk auth (the bot's browser has no session), it
 * now requires a per-session, unguessable `token` instead — minted in
 * /api/sessions/[id]/start and stored on walkthrough_state keyed by userId (see
 * lib/session-billing.ts's mintAuditToken/verifyAuditToken). A request with a
 * missing or mismatched token is rejected with 401 before any event is written
 * or any gap-watchdog event is emitted.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { writeAuditEvent, emitGapStarted, emitGapEnded, verifyAuditToken } from '@/lib/session-billing'

const ClientWritableEventType = z.enum([
  'voice_connect_attempt',
  'speak_verified',
  'gap_start',
  'gap_end',
  // RTV-03 (additive) — observe-only tracker audit events. See
  // requirement-docs/RTV-03-live-position-tracking.md Section 6.2/6.3.
  'rtv03_state_advance',
  'rtv03_quick_summary_cue',
  'rtv03_next_topic_cue',
])

const BodySchema = z.object({
  userId: z.string().min(1),
  eventType: ClientWritableEventType,
  provider: z.enum(['elevenlabs', 'hume']).optional(),
  token: z.string().min(1),
  // RTV-03 (additive, optional) — existing event types never send this and
  // default to {} exactly as they do today; only the new rtv03_* event types
  // populate it.
  metadata: z.record(z.unknown()).optional(),
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

  const { userId, eventType, provider, token, metadata } = parsed.data

  const supabase = createSupabaseAdminClient()
  const { data: wsRow } = await supabase
    .from('walkthrough_state')
    .select('session_id, audit_token')
    .eq('user_id', userId)
    .maybeSingle()

  // SECURITY: reject before resolving/using session_id at all if the caller
  // can't prove ownership of this user's active session. This is what closes
  // all three exploit paths described above — a caller without the correct
  // token cannot write any event, for their own session or anyone else's.
  if (!verifyAuditToken(token, (wsRow?.audit_token as string | null) ?? null)) {
    return NextResponse.json({ error: 'Invalid or missing audit token' }, { status: 401 })
  }

  const sessionId = wsRow?.session_id as string | null
  if (!sessionId) {
    // No active session tied to this user — nothing to log against. Non-fatal:
    // the caller (live voice session) must never break because of audit logging.
    return NextResponse.json({ ok: false, reason: 'No active session for user' }, { status: 200 })
  }

  const occurredAt = new Date().toISOString()

  await writeAuditEvent({
    sessionId,
    userId,
    eventType,
    voiceProvider: provider ?? null,
    metadata: metadata ?? {},
    occurredAt,
  })

  // AUTOGEN-01 Part D / Edge Case D2 / AC-D8 — a gap_start kicks off the
  // server-side 30-second watchdog (inngest/voice-gap-watchdog.ts); a gap_end
  // cancels it. This is independent of client state after the event is sent —
  // if the client/bot crashes entirely, the watchdog still force-ends the
  // session 30s after the gap started.
  if (eventType === 'gap_start') {
    emitGapStarted({ userId, sessionId, gapStartedAt: occurredAt })
  } else if (eventType === 'gap_end') {
    emitGapEnded({ userId, sessionId })
  }

  return NextResponse.json({ ok: true })
}
