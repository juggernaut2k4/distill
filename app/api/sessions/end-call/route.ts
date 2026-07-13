/**
 * POST /api/sessions/end-call
 *
 * Public, userId+token-keyed endpoint that actually leaves/deletes the Recall.ai
 * bot when a live voice session ends. Mirrors the auth model already established
 * by /api/walkthrough-state/[userId] and /api/sessions/audit-event: WalkthroughClient
 * runs inside the Recall.ai bot's own headless browser, which has no Clerk session
 * cookie, so it can only identify itself by userId — never by a Clerk-authenticated
 * sessionId the way /api/sessions/[id]/end does.
 *
 * Bug this fixes: when Clio (Hume) calls the `end_session` client
 * tool (or the farewell-detection heuristic fires), WalkthroughClient today only
 * flips local UI state (`sessionComplete`) — nothing tells Recall.ai to leave the
 * meeting, so the bot lingers indefinitely and keeps accruing (unbilled, since
 * `disconnected` is never written either) meeting time. This route is the missing
 * link: it resolves session_id from walkthrough_state (keyed by userId), verifies
 * the per-session audit token, and calls the existing forceEndSession() — the same
 * idempotent teardown path already used by the wall-clock timer (D3) and the
 * voice-gap watchdog (D2/AC-D8) — which deletes the bot, tears down
 * walkthrough_state, deducts audit-log-derived minutes, and marks the session
 * completed.
 *
 * SECURITY: scope is deliberately minimal. This route can only end/leave the bot
 * for the given userId's own currently-active session (resolved server-side, never
 * trusted from the request body) — it cannot target any other user's session, and
 * it does nothing at all beyond that one teardown call. Same token-based ownership
 * proof as /api/sessions/audit-event; see lib/session-billing.ts mintAuditToken /
 * verifyAuditToken for how the token is minted and compared.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { verifyAuditToken, forceEndSession } from '@/lib/session-billing'

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
    .select('session_id, audit_token')
    .eq('user_id', userId)
    .maybeSingle()

  // SECURITY: reject before resolving/using session_id at all if the caller can't
  // prove ownership of this user's active session — same fail-closed check as
  // /api/sessions/audit-event, so a caller without the correct token can neither
  // read billing state nor now force-end someone else's live session.
  if (!verifyAuditToken(token, (wsRow?.audit_token as string | null) ?? null)) {
    return NextResponse.json({ error: 'Invalid or missing audit token' }, { status: 401 })
  }

  const sessionId = wsRow?.session_id as string | null
  if (!sessionId) {
    // No active session tied to this user — nothing to tear down. Non-fatal:
    // the caller (live voice session) must never break because of this call.
    return NextResponse.json({ ok: false, reason: 'No active session for user' }, { status: 200 })
  }

  try {
    const result = await forceEndSession({ userId, sessionId })
    console.log(`[end-call] forceEndSession for user=${userId} session=${sessionId}:`, result)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[end-call] forceEndSession failed:', err)
    // Non-fatal response shape — the caller (voice session) should not throw on this.
    return NextResponse.json({ ok: false, error: 'Failed to end session' }, { status: 200 })
  }
}
