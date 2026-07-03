import crypto from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'

/**
 * AUTOGEN-01 Part D — verified minute billing.
 *
 * Billing starts at the `speak_verified` audit event (the voice adapter's confirmed,
 * working connection), not at bot-join. Billing ends at the `disconnected` audit
 * event. Minutes = (disconnected − speak_verified) − Σ(gap durations), never derived
 * from `sessions.started_at`. If a session never reaches `speak_verified`, zero
 * minutes are billed — this is an explicit branch (AC-D3), not an accidental
 * side-effect of a null timestamp.
 */

/**
 * SECURITY (CEO review fix) — /api/sessions/audit-event is public and
 * userId-keyed (the Recall.ai bot's headless browser has no Clerk session — see
 * that route's file comment for the full constraint). Without proof of session
 * ownership, anyone who knew/guessed a userId could write fabricated
 * gap_start/gap_end pairs to zero out billed minutes, or a fake gap_end to
 * cancel the 30s gap watchdog on a dead session.
 *
 * Fix: a per-session, unguessable, cryptographically random token, minted here
 * when the session actually starts (POST /api/sessions/[id]/start) and stored
 * on walkthrough_state keyed by user_id — the same key audit-event already uses
 * to resolve session_id. WalkthroughClient.tsx picks it up for free from its
 * initial server-rendered walkthrough_state read and must present it on every
 * write. mintAuditToken upserts (rather than requiring an existing row) because
 * /start can run before the bot's first page load has created a walkthrough_state
 * row for this user.
 */
export async function mintAuditToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex')
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('walkthrough_state')
    .upsert({ user_id: userId, audit_token: token }, { onConflict: 'user_id' })

  if (error) {
    // Non-fatal by the same convention as writeAuditEvent — but note that if this
    // fails, audit-event writes for this session will be rejected (no stored
    // token to match against), which is the fail-closed behaviour we want.
    console.error('[session-billing] Failed to store audit token:', error.message)
  }

  return token
}

/** Constant-time comparison — mirrors the pattern already used in lib/session-auth.ts. */
export function verifyAuditToken(provided: string | null | undefined, stored: string | null | undefined): boolean {
  if (!provided || !stored) return false
  const providedBuf = Buffer.from(provided)
  const storedBuf = Buffer.from(stored)
  if (providedBuf.length !== storedBuf.length) return false
  return crypto.timingSafeEqual(providedBuf, storedBuf)
}

/**
 * Strips the `token` query param value before logging a walkthroughUrl.
 * The URL carries the audit token (see app/api/recall/bot/route.ts) — it must
 * never be written to console/log output (CLAUDE.md: never log secrets), even
 * in the mock/dev-mode provider logs that print this URL for debugging.
 */
export function redactAuditTokenFromUrl(url: string): string {
  return url.replace(/([?&]token=)[^&]+/, '$1[redacted]')
}

export type BillingAuditEventType =
  | 'bot_joined'
  | 'voice_connect_attempt'
  | 'speak_verified'
  | 'gap_start'
  | 'gap_end'
  | 'disconnected'

export type VoiceProvider = 'elevenlabs' | 'hume'

interface AuditRow {
  event_type: BillingAuditEventType
  occurred_at: string
  voice_provider: VoiceProvider | null
  metadata: Record<string, unknown>
}

/**
 * Appends one row to the session billing audit log. This is the ONLY function in
 * the codebase that may write to `session_billing_audit_log` — no update/delete
 * path exists anywhere, which is what makes the log dispute-defensible (AC-D7).
 */
export async function writeAuditEvent(params: {
  sessionId: string
  userId: string
  eventType: BillingAuditEventType
  voiceProvider?: VoiceProvider | null
  metadata?: Record<string, unknown>
  occurredAt?: string
}): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase.from('session_billing_audit_log').insert({
    session_id: params.sessionId,
    user_id: params.userId,
    event_type: params.eventType,
    voice_provider: params.voiceProvider ?? null,
    metadata: params.metadata ?? {},
    occurred_at: params.occurredAt ?? new Date().toISOString(),
  })

  if (error) {
    // Audit logging must never take down the live session or the billing routes
    // that call it — log loudly and continue. A missing row degrades dispute
    // defensibility for this one event but must not crash billing-critical flows.
    console.error('[session-billing] Failed to write audit event:', params.eventType, error.message)
  }
}

/**
 * Fetches the full ordered audit trail for a session (support/dispute resolution,
 * and the future user-facing minute-breakdown view once its BA follow-up spec
 * exists — Section 8/AC-D9).
 */
export async function getAuditLog(sessionId: string): Promise<AuditRow[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('session_billing_audit_log')
    .select('event_type, occurred_at, voice_provider, metadata')
    .eq('session_id', sessionId)
    .order('occurred_at', { ascending: true })

  return (data ?? []) as AuditRow[]
}

export interface BilledMinutesResult {
  /** Whole minutes to deduct, rounded up per existing convention. Zero if speak_verified never occurred. */
  minutesUsed: number
  /** True if this session ever reached speak_verified (billing actually started). */
  reachedSpeakVerified: boolean
  /** Total gap duration subtracted, in milliseconds. */
  gapDurationMs: number
}

/**
 * Computes billed minutes for a session strictly from its audit log:
 *   minutesUsed = ceil( ((disconnectedAt ?? now) − speakVerifiedAt − Σgaps) / 60000 ), min 0
 *
 * AC-D2 / AC-D3: if no `speak_verified` row exists, returns { minutesUsed: 0,
 * reachedSpeakVerified: false } as an explicit branch — never falls through to a
 * wall-clock calculation.
 */
export async function computeBilledMinutes(
  sessionId: string,
  options?: { disconnectedAt?: string }
): Promise<BilledMinutesResult> {
  const rows = await getAuditLog(sessionId)

  const speakVerifiedRow = rows.find((r) => r.event_type === 'speak_verified')
  if (!speakVerifiedRow) {
    // AC-D3: never reached speak-readiness — zero minutes, explicit branch.
    return { minutesUsed: 0, reachedSpeakVerified: false, gapDurationMs: 0 }
  }

  const speakVerifiedAt = new Date(speakVerifiedRow.occurred_at).getTime()

  const disconnectedRow = rows.find((r) => r.event_type === 'disconnected')
  const disconnectedAt = options?.disconnectedAt
    ? new Date(options.disconnectedAt).getTime()
    : disconnectedRow
      ? new Date(disconnectedRow.occurred_at).getTime()
      : Date.now()

  // Sum gap durations: pair each gap_start with the next gap_end after it.
  // An unclosed trailing gap_start (no matching gap_end before disconnect) is
  // treated as extending to disconnectedAt — the user is never billed for
  // silence between a gap starting and the session ending.
  let gapDurationMs = 0
  let openGapStart: number | null = null
  for (const row of rows) {
    if (row.event_type === 'gap_start' && openGapStart === null) {
      openGapStart = new Date(row.occurred_at).getTime()
    } else if (row.event_type === 'gap_end' && openGapStart !== null) {
      const gapEndAt = new Date(row.occurred_at).getTime()
      gapDurationMs += Math.max(0, gapEndAt - openGapStart)
      openGapStart = null
    }
  }
  if (openGapStart !== null) {
    gapDurationMs += Math.max(0, disconnectedAt - openGapStart)
  }

  const billedMs = Math.max(0, disconnectedAt - speakVerifiedAt - gapDurationMs)
  const minutesUsed = Math.max(0, Math.ceil(billedMs / (1000 * 60)))

  return { minutesUsed, reachedSpeakVerified: true, gapDurationMs }
}

/**
 * Shared force-end path used by both the wall-clock session timer (D3 backstop)
 * and the voice-gap watchdog (D2/AC-D8). Writes the `disconnected` audit event,
 * computes minutes strictly from the audit log, deducts them, tears down the bot
 * and walkthrough_state, and marks the session completed.
 *
 * Idempotent: if the session is already completed, this is a no-op.
 */
export async function forceEndSession(params: {
  userId: string
  sessionId: string
}): Promise<{ skipped: true } | { skipped: false; minutesUsed: number }> {
  const { userId, sessionId } = params
  const supabase = createSupabaseAdminClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('status')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session || session.status === 'completed') {
    return { skipped: true }
  }

  const [{ data: wsRow }, { data: userRow }] = await Promise.all([
    supabase.from('walkthrough_state').select('bot_id').eq('user_id', userId).maybeSingle(),
    supabase.from('users').select('minutes_balance').eq('id', userId).single(),
  ])

  const botId = wsRow?.bot_id as string | null
  if (botId) {
    try {
      await getMeetingBotProvider().deleteBot(botId)
    } catch (err) {
      console.error('[session-billing] Bot deletion failed (non-fatal):', err)
    }
  }

  await supabase.from('walkthrough_state').update({
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
    // Rotate the audit token out on teardown so it can never be replayed
    // against a future session for this user.
    audit_token: null,
  }).eq('user_id', userId)

  const now = new Date().toISOString()
  await writeAuditEvent({ sessionId, userId, eventType: 'disconnected', occurredAt: now })

  const { minutesUsed } = await computeBilledMinutes(sessionId, { disconnectedAt: now })
  const cappedMinutes = Math.min(minutesUsed, userRow?.minutes_balance ?? minutesUsed)

  await Promise.all([
    supabase.rpc('deduct_minutes', { p_user_id: userId, p_minutes: cappedMinutes }),
    supabase.from('sessions').update({
      ended_at: now,
      status: 'completed',
      duration_mins: cappedMinutes,
    }).eq('id', sessionId),
  ])

  console.log(`[session-billing] Force-ended session ${sessionId} — ${cappedMinutes} minutes deducted (audit-log derived)`)

  return { skipped: false, minutesUsed: cappedMinutes }
}

/**
 * Fires the Inngest event that starts the 30-second voice-gap watchdog
 * (inngest/voice-gap-watchdog.ts). Non-fatal on failure — logged only.
 */
export function emitGapStarted(params: { userId: string; sessionId: string; gapStartedAt: string }): void {
  inngest.send({
    name: 'distill/voice.gap.started',
    data: params,
  }).catch((err) => console.error('[session-billing] Failed to emit distill/voice.gap.started:', err))
}

/** Fires the Inngest event that cancels the voice-gap watchdog for this session. */
export function emitGapEnded(params: { userId: string; sessionId: string }): void {
  inngest.send({
    name: 'distill/voice.gap.ended',
    data: params,
  }).catch((err) => console.error('[session-billing] Failed to emit distill/voice.gap.ended:', err))
}
