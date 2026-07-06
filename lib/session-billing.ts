import crypto from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'
import { fetchHumeChatDuration } from '@/lib/voice/hume-native/session-details'

/**
 * HUME-DURATION-02 — trivial setTimeout-based delay helper, no new npm package.
 * Used by finalizeHumeNativeBilling() to give Hume's chat-duration API time to
 * finalize before the first fetch attempt, and again before the single
 * conditional retry.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
  // HUME-GROUND-TRUTH-01 — written by app/api/webhooks/hume/route.ts when a
  // signed chat_ended event arrives and resolves to a known session. Read
  // back by finalizeHumeNativeBilling()'s webhook fast-path below.
  | 'hume_webhook_chat_ended'

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
  const allRows = await getAuditLog(sessionId)

  // BUGFIX (2026-07-05): a `sessions` row can be reused across many separate
  // connect/disconnect cycles (voice drop + reconnect, or repeated manual
  // testing on the same session id) — its audit log then contains more than
  // one `speak_verified` and/or `disconnected` row. `.find()` always returns
  // the FIRST match in the ascending-ordered log, so without scoping to the
  // current cycle, a stale `speak_verified` from hours/days earlier gets
  // paired with the current call's fresh `disconnected` timestamp, producing
  // a wildly inflated duration (only saved from being charged as billed by
  // the `Math.min(minutesUsed, balance)` cap in the callers, which silently
  // absorbs the bogus number instead of surfacing it).
  //
  // Fix: only consider rows belonging to the CURRENT cycle. Every caller of
  // this function writes a fresh `disconnected` row for the current cycle
  // BEFORE calling computeBilledMinutes (see forceEndSession and
  // /api/sessions/[id]/end). So among all `disconnected` rows in the log,
  // the current cycle's own end event is the LAST one, and the previous
  // cycle's end event (if any) is the second-to-last. The current cycle is
  // everything strictly after that second-to-last `disconnected` row. If
  // fewer than 2 `disconnected` rows exist, there is no prior cycle to
  // exclude and the whole log belongs to the current (first) cycle.
  const disconnects = allRows.filter((r) => r.event_type === 'disconnected')
  const priorCycleEndAt =
    disconnects.length >= 2 ? disconnects[disconnects.length - 2].occurred_at : null

  const rows = priorCycleEndAt ? allRows.filter((r) => r.occurred_at > priorCycleEndAt) : allRows

  const speakVerifiedRow = rows.find((r) => r.event_type === 'speak_verified')
  if (!speakVerifiedRow) {
    // AC-D3: never reached speak-readiness in the CURRENT cycle — zero
    // minutes, explicit branch. (A speak_verified from a prior, already
    // disconnected cycle must never be borrowed here.)
    return { minutesUsed: 0, reachedSpeakVerified: false, gapDurationMs: 0 }
  }

  const speakVerifiedAt = new Date(speakVerifiedRow.occurred_at).getTime()

  // Within the current cycle, use the LAST disconnected row (there should be
  // at most one, but be defensive) rather than the first.
  const currentCycleDisconnects = rows.filter((r) => r.event_type === 'disconnected')
  const disconnectedRow = currentCycleDisconnects[currentCycleDisconnects.length - 1]
  const disconnectedAt = options?.disconnectedAt
    ? new Date(options.disconnectedAt).getTime()
    : disconnectedRow
      ? new Date(disconnectedRow.occurred_at).getTime()
      : Date.now()

  // Sum gap durations: pair each gap_start with the next gap_end after it,
  // scoped to the current cycle only (see above).
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

export type FinalizeHumeNativeBillingResult =
  | { source: 'not_applicable' }
  | { source: 'hume'; minutesUsed: number; durationSeconds: number; retryUsed: boolean; totalWaitMs: number }
  | { source: 'fallback'; reason: string; retryUsed: boolean; totalWaitMs: number }

/**
 * HUME-GROUND-TRUTH-01 — checks whether a `hume_webhook_chat_ended` audit row
 * already exists for this session (written by app/api/webhooks/hume/route.ts)
 * and, if so, returns a ready-made `{ source: 'hume', ... }` result so
 * finalizeHumeNativeBilling() can skip its delay()/fetchHumeChatDuration()
 * sequence entirely.
 *
 * Returns `null` (never throws) whenever no usable row is found, so the
 * caller can fall through to the existing polling sequence unchanged — this
 * function is purely additive and must never itself become a new failure
 * mode that blocks billing (Section 8 Error States).
 *
 * Cycle-scoping (Section 9 edge case): a `sessions` row can be reused across
 * multiple connect/disconnect cycles. To avoid fast-pathing on a STALE
 * webhook row from an earlier, already-billed cycle, this reuses the exact
 * same `priorCycleEndAt` derivation already implemented and tested in
 * computeBilledMinutes() above (find the second-to-last `disconnected` row;
 * everything strictly after it belongs to the current cycle).
 */
async function tryHumeWebhookFastPath(
  sessionId: string
): Promise<Extract<FinalizeHumeNativeBillingResult, { source: 'hume' }> | null> {
  try {
    const allRows = await getAuditLog(sessionId)
    const disconnects = allRows.filter((r) => r.event_type === 'disconnected')
    const priorCycleEndAt =
      disconnects.length >= 2 ? disconnects[disconnects.length - 2].occurred_at : null

    const supabase = createSupabaseAdminClient()
    let query = supabase
      .from('session_billing_audit_log')
      .select('metadata, occurred_at')
      .eq('session_id', sessionId)
      .eq('event_type', 'hume_webhook_chat_ended')
      .order('occurred_at', { ascending: false })
      .limit(1)

    if (priorCycleEndAt) {
      query = query.gt('occurred_at', priorCycleEndAt)
    }

    const { data, error } = await query.maybeSingle()

    if (error) {
      console.error(
        `[session-billing] tryHumeWebhookFastPath: audit-log read failed for session ${sessionId} — falling through to polling:`,
        error.message
      )
      return null
    }

    if (!data) {
      return null
    }

    const metadata = (data.metadata ?? {}) as Record<string, unknown>
    const durationSeconds = metadata.duration_seconds

    if (typeof durationSeconds !== 'number' || Number.isNaN(durationSeconds)) {
      console.warn(
        `[session-billing] tryHumeWebhookFastPath: session ${sessionId} has a hume_webhook_chat_ended row with malformed duration_seconds — falling through to polling`
      )
      return null
    }

    const minutesUsed = Math.max(0, Math.ceil(durationSeconds / 60))
    return { source: 'hume', minutesUsed, durationSeconds, retryUsed: false, totalWaitMs: 0 }
  } catch (err) {
    console.error(
      `[session-billing] tryHumeWebhookFastPath: unexpected error for session ${sessionId} — falling through to polling:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}

/**
 * HUME-DURATION-BILLING-01 — For Hume-native sessions, sources billed minutes
 * from Hume's own authoritative chat duration instead of our
 * speak_verified-to-disconnected audit-log calculation, so our billing can
 * never silently drift from what Hume itself will invoice us for compute.
 *
 * Per docs/specs/HUME-DURATION-BILLING-01-requirement-doc.md Section 4.1/6.2:
 * - Non-Hume-native sessions (ElevenLabs/Custom-LLM): returns
 *   `{ source: 'not_applicable' }` immediately, no Hume API call attempted.
 *   The caller falls through to the existing, completely unchanged
 *   `computeBilledMinutes()` path.
 * - Hume-native sessions with no `hume_chat_id`: returns
 *   `{ source: 'fallback', reason: 'no_hume_chat_id' }` immediately — no
 *   fetch attempted, since there is nothing to fetch.
 * - Hume-native sessions with a `hume_chat_id`: HUME-DURATION-02 — waits 3s
 *   before the first `fetchHumeChatDuration()` attempt (Hume frequently hasn't
 *   finalized its own chat record that quickly after we see `disconnected`).
 *   If that first attempt fails with `reason: 'missing_timestamps'`
 *   specifically, waits 4 more seconds and retries exactly once more (7s
 *   total elapsed); any other failure reason, or a second failure on the
 *   retry, falls back immediately with no further retries. On success,
 *   returns `{ source: 'hume', minutesUsed, durationSeconds, retryUsed,
 *   totalWaitMs }` where `minutesUsed = ceil(durationSeconds / 60)`. On
 *   failure, returns `{ source: 'fallback', reason, retryUsed, totalWaitMs }`
 *   and the caller proceeds to `computeBilledMinutes()` exactly as today.
 *   `totalWaitMs` is 3000 if no retry ran, 7000 if it did.
 *
 * Billing is NEVER silently skipped by this function — it only ever decides
 * which of the two minute-computation sources to use; both callers still
 * write the ledger/deduction exactly as before.
 */
export async function finalizeHumeNativeBilling(params: {
  sessionId: string
  humeNativeEnabled?: boolean
  humeChatId?: string | null
}): Promise<FinalizeHumeNativeBillingResult> {
  const { sessionId } = params
  let humeNativeEnabled = params.humeNativeEnabled
  let humeChatId = params.humeChatId

  if (humeNativeEnabled === undefined || humeChatId === undefined) {
    const supabase = createSupabaseAdminClient()
    const { data } = await supabase
      .from('sessions')
      .select('hume_native_enabled, hume_chat_id')
      .eq('id', sessionId)
      .maybeSingle()

    humeNativeEnabled = data?.hume_native_enabled ?? false
    humeChatId = (data?.hume_chat_id as string | null) ?? null
  }

  if (!humeNativeEnabled) {
    return { source: 'not_applicable' }
  }

  if (!humeChatId) {
    console.warn(
      `[session-billing] finalizeHumeNativeBilling: session ${sessionId} is hume_native_enabled but has no hume_chat_id — falling back to computeBilledMinutes`
    )
    return { source: 'fallback', reason: 'no_hume_chat_id', retryUsed: false, totalWaitMs: 0 }
  }

  // HUME-GROUND-TRUTH-01 — webhook fast path. If Hume's own chat_ended
  // webhook has already arrived and been logged (app/api/webhooks/hume/route.ts),
  // use its authoritative duration_seconds directly and skip delay()/
  // fetchHumeChatDuration() entirely — no outbound Hume API call, no wait.
  // Falls through to the existing, byte-for-byte-unchanged polling sequence
  // below whenever no usable row is found, or the check itself errors.
  const webhookFastPathResult = await tryHumeWebhookFastPath(sessionId)
  if (webhookFastPathResult) {
    return webhookFastPathResult
  }

  // HUME-DURATION-02 — give Hume's chat record time to finalize before asking.
  await delay(3000)
  let result = await fetchHumeChatDuration(humeChatId)
  let retryUsed = false

  if (!result.ok && result.reason === 'missing_timestamps') {
    retryUsed = true
    await delay(4000)
    result = await fetchHumeChatDuration(humeChatId)
  }

  const totalWaitMs = retryUsed ? 7000 : 3000

  if (!result.ok) {
    console.warn(
      `[session-billing] finalizeHumeNativeBilling: Hume duration fetch failed for session ${sessionId} (chat ${humeChatId}), reason=${result.reason}, retryUsed=${retryUsed} — falling back to computeBilledMinutes`
    )
    return { source: 'fallback', reason: result.reason, retryUsed, totalWaitMs }
  }

  const minutesUsed = Math.max(0, Math.ceil(result.durationSeconds / 60))
  return { source: 'hume', minutesUsed, durationSeconds: result.durationSeconds, retryUsed, totalWaitMs }
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

  // HUME-DURATION-BILLING-01 — for Hume-native sessions, prefer Hume's own
  // authoritative chat duration over the audit-log calculation. Falls back
  // to the existing, unmodified computeBilledMinutes() for ElevenLabs/
  // Custom-LLM sessions and whenever the Hume fetch is unavailable/fails.
  const humeResult = await finalizeHumeNativeBilling({ sessionId })

  let minutesUsed: number
  let billingSource: 'hume' | 'fallback_audit_log'
  let billingSourceMetadata: Record<string, unknown>

  if (humeResult.source === 'hume') {
    minutesUsed = humeResult.minutesUsed
    billingSource = 'hume'
    billingSourceMetadata = {
      hume_duration_seconds: humeResult.durationSeconds,
      retry_used: humeResult.retryUsed,
      total_wait_ms: humeResult.totalWaitMs,
    }
  } else {
    const computed = await computeBilledMinutes(sessionId, { disconnectedAt: now })
    minutesUsed = computed.minutesUsed
    billingSource = 'fallback_audit_log'
    billingSourceMetadata =
      humeResult.source === 'fallback'
        ? {
            fallback_reason: humeResult.reason,
            retry_used: humeResult.retryUsed,
            total_wait_ms: humeResult.totalWaitMs,
          }
        : {}
  }

  const cappedMinutes = Math.min(minutesUsed, userRow?.minutes_balance ?? minutesUsed)

  const [deductResult] = await Promise.all([
    supabase.rpc('deduct_minutes', { p_user_id: userId, p_minutes: cappedMinutes }),
    supabase.from('sessions').update({
      ended_at: now,
      status: 'completed',
      duration_mins: cappedMinutes,
    }).eq('id', sessionId),
  ])

  // BILLING-LEDGER-01 — reuse the RPC's own returned balance (never recompute
  // independently); fall back to the pre-fetched balance minus the deduction
  // only if the RPC unexpectedly returned no data, so a ledger write is never
  // dropped even in that edge case.
  const resultingBalance =
    (deductResult.data as number | null) ?? (userRow?.minutes_balance ?? 0) - cappedMinutes

  await writeMinutesLedgerEvent({
    userId,
    eventType: 'session_deduction',
    deltaMinutes: -cappedMinutes,
    resultingBalance,
    sessionId,
    metadata: {
      reached_speak_verified: minutesUsed > 0 || cappedMinutes > 0,
      billing_source: billingSource,
      ...billingSourceMetadata,
    },
  })

  console.log(`[session-billing] Force-ended session ${sessionId} — ${cappedMinutes} minutes deducted (audit-log derived)`)

  return { skipped: false, minutesUsed: cappedMinutes }
}

/**
 * BILLING-LEDGER-01 — Appends one row to the durable, append-only minutes
 * ledger (recharges + session deductions). This is the ONLY function in the
 * codebase that may write to `minutes_ledger` — same convention as
 * `writeAuditEvent()` above for `session_billing_audit_log`.
 *
 * Purely additive observability: never call this in place of, or before,
 * the existing `add_minutes`/`deduct_minutes` RPC calls — only immediately
 * after they succeed, reusing their own returned balance (never recomputed
 * independently, to avoid any drift between the ledger and the RPC's actual
 * mutation).
 *
 * Non-fatal on failure by the same convention as `writeAuditEvent()`: must
 * never take down the billing routes that call it. A missing row degrades
 * diagnosability for that one event but never blocks or reverses the actual
 * balance change.
 */
export async function writeMinutesLedgerEvent(params: {
  userId: string
  eventType: 'recharge' | 'session_deduction'
  deltaMinutes: number // signed: +N recharge, -N deduction
  resultingBalance: number
  sessionId?: string | null
  stripeCheckoutSessionId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase.from('minutes_ledger').insert({
    user_id: params.userId,
    event_type: params.eventType,
    delta_minutes: params.deltaMinutes,
    resulting_balance: params.resultingBalance,
    session_id: params.sessionId ?? null,
    stripe_checkout_session_id: params.stripeCheckoutSessionId ?? null,
    metadata: params.metadata ?? {},
  })

  if (error) {
    console.error('[minutes-ledger] Failed to write ledger event:', params.eventType, error.message)
  }
}

/**
 * BILLING-LEDGER-01 — Sums all `session_deduction` rows for a user to produce
 * their all-time total minutes consumed (billing page display, Section 4.2 of
 * the requirement doc). Deliberately a plain SUM/reduce over ledger rows —
 * no pagination or aggregation-table optimization in scope for this ship.
 */
export async function getTotalMinutesConsumed(userId: string): Promise<number> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('minutes_ledger')
    .select('delta_minutes')
    .eq('user_id', userId)
    .eq('event_type', 'session_deduction')

  const total = (data ?? []).reduce((sum, row) => sum + Math.abs(row.delta_minutes as number), 0)
  return total
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
