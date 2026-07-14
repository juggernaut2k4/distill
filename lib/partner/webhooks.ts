import crypto from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { buildSignatureHeader, CLIO_SIGNATURE_HEADER } from './webhook-signature'

/**
 * B2B-02 — Usage-metering & signed webhook mechanism (architecture.md Section
 * 7). Two responsibilities live here:
 *
 *  1. `recordBillableEvent()` — called at the point a billable (or
 *     lifecycle) event occurs. Inserts one `webhook_dispatch_log` row
 *     (always), and, for billable event types, an aggregating
 *     `usage_events` row (always) — F-01 is resolved as Resolution A:
 *     Clio keeps its own usage ledger. Migration 072
 *     (`072_b2b02_usage_events_resolution_a.sql`) is applied and live, so
 *     this is unconditional, unflagged behavior, not an optional path.
 *
 *  2. Dispatch-worker helpers (`fetchDueDispatches`, `attemptDispatch`) used
 *     by `inngest/partner-webhook-dispatcher.ts` to actually deliver pending
 *     rows with retry/backoff.
 *
 * Wiring real voice-minute/LLM-generation call sites into
 * `recordBillableEvent()` is explicitly out of this brief's scope
 * (docs/specs/B2B-02-requirement-document.md Section 10) — this module
 * defines the event contract and delivery mechanism those future call sites
 * will emit into.
 */

export type BillableEventType = 'usage.voice_minute' | 'usage.llm_generation_call' | 'session.completed'

export interface WebhookPayload {
  event_id: string
  event_type: BillableEventType
  clio_session_ref: string | null
  partner_reference: string | null
  quantity: number | null
  unit: 'minutes' | 'calls' | null
  generation_type: 'topic' | 'content' | 'prerequisite' | 'skeleton' | 'discovery' | 'sample_fill' | 'new_template' | null
  occurred_at: string
  dispatched_at: string
  /**
   * Additive field beyond architecture.md Section 7.3's literal shape —
   * required to satisfy the Section 9 edge case ("test-mode usage webhook is
   * marked such that a partner's own billing logic can filter it out").
   * Every other field in this payload is byte-for-byte identical to Section
   * 7.3; this is the one deliberate, documented addition.
   */
  test_mode: boolean
}

/** Deterministic subset used for the idempotency index — excludes event_id/dispatched_at, which vary per attempt. */
function canonicalHashInput(p: Pick<WebhookPayload, 'event_type' | 'clio_session_ref' | 'partner_reference' | 'quantity' | 'unit' | 'generation_type' | 'occurred_at'>): string {
  return JSON.stringify({
    event_type: p.event_type,
    clio_session_ref: p.clio_session_ref,
    partner_reference: p.partner_reference,
    quantity: p.quantity,
    unit: p.unit,
    generation_type: p.generation_type,
    occurred_at: p.occurred_at,
  })
}

export interface RecordBillableEventParams {
  partnerAccountId: string
  eventType: BillableEventType
  clioSessionRef?: string | null
  partnerReference?: string | null
  quantity?: number | null
  unit?: 'minutes' | 'calls' | null
  generationType?: 'topic' | 'content' | 'prerequisite' | 'skeleton' | 'discovery' | 'sample_fill' | 'new_template' | null
  occurredAt?: string
  testMode?: boolean
}

/**
 * Records a billable/lifecycle event: inserts a signed `webhook_dispatch_log`
 * row (picked up by the Inngest dispatch worker) and, for billable event
 * types, an aggregating `usage_events` row (F-01 Resolution A — see module
 * header). Both writes are required; a failed `usage_events` insert is a
 * real, surfaced error (returned to the caller), not silently swallowed.
 */
export async function recordBillableEvent(
  params: RecordBillableEventParams
): Promise<{ dispatchLogId: string } | { error: string }> {
  const supabase = createSupabaseAdminClient()

  const { data: account } = await supabase
    .from('partner_accounts')
    .select('id, outbound_signing_secret')
    .eq('id', params.partnerAccountId)
    .maybeSingle()

  if (!account) {
    return { error: 'partner_account_not_found' }
  }

  const now = new Date().toISOString()
  const occurredAt = params.occurredAt ?? now
  const eventId = crypto.randomUUID()

  const payload: WebhookPayload = {
    event_id: eventId,
    event_type: params.eventType,
    clio_session_ref: params.clioSessionRef ?? null,
    partner_reference: params.partnerReference ?? null,
    quantity: params.eventType === 'session.completed' ? null : (params.quantity ?? null),
    unit: params.eventType === 'session.completed' ? null : (params.unit ?? null),
    generation_type: params.eventType === 'session.completed' ? null : (params.generationType ?? null),
    occurred_at: occurredAt,
    dispatched_at: now,
    test_mode: params.testMode ?? false,
  }

  const payloadHash = crypto.createHash('sha256').update(canonicalHashInput(payload)).digest('hex')

  const signingSecret = account.outbound_signing_secret as string | null
  const signature = signingSecret
    ? buildSignatureHeader(signingSecret, JSON.stringify(payload))
    : buildSignatureHeader('unconfigured-partner-signing-secret', JSON.stringify(payload))

  const { data: inserted, error } = await supabase
    .from('webhook_dispatch_log')
    .upsert(
      {
        partner_account_id: params.partnerAccountId,
        event_type: params.eventType,
        clio_session_ref: params.clioSessionRef ?? null,
        partner_reference: params.partnerReference ?? null,
        payload,
        payload_hash: payloadHash,
        signature,
        delivery_status: 'pending',
      },
      { onConflict: 'partner_account_id,event_type,clio_session_ref,payload_hash', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[partner/webhooks] Failed to record billable event:', error.message)
    return { error: error.message }
  }

  // F-01 Resolution A: usage_events is Clio's own aggregating usage ledger —
  // unconditional for billable event types (session.completed is a
  // lifecycle event, not billable, and carries no quantity to record).
  if (params.eventType !== 'session.completed') {
    const usageEventType =
      params.eventType === 'usage.voice_minute'
        ? 'voice_minute'
        : params.generationType
          ? (`llm_generation_${params.generationType}` as const)
          : null

    if (usageEventType && params.quantity) {
      const { error: usageEventsError } = await supabase.from('usage_events').insert({
        partner_account_id: params.partnerAccountId,
        event_type: usageEventType,
        quantity: params.quantity,
        clio_session_ref: params.clioSessionRef ?? null,
        partner_reference: params.partnerReference ?? null,
        webhook_dispatch_log_id: inserted?.id ?? null,
        test_mode: params.testMode ?? false,
        occurred_at: occurredAt,
      })

      if (usageEventsError) {
        console.error('[partner/webhooks] Failed to record usage_events row:', usageEventsError.message)
        return { error: usageEventsError.message }
      }
    }
  }

  return { dispatchLogId: (inserted?.id as string) ?? '' }
}

// ─── Dispatch worker helpers (used by inngest/partner-webhook-dispatcher.ts) ──

/** Backoff schedule per architecture.md Section 7.2: 1m, 5m, 30m, 2h, 6h — 5 attempts total. */
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600]
const MAX_ATTEMPTS = BACKOFF_SECONDS.length

export interface DueDispatchRow {
  id: string
  partner_account_id: string
  event_type: BillableEventType
  payload: WebhookPayload
  signature: string
  retry_count: number
  outbound_base_url: string | null
}

/** Fetches pending dispatch-log rows whose next retry is due (or that have never been attempted). */
export async function fetchDueDispatches(limit = 50): Promise<DueDispatchRow[]> {
  const supabase = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from('webhook_dispatch_log')
    .select('id, partner_account_id, event_type, payload, signature, retry_count, partner_accounts!inner(outbound_base_url)')
    .eq('delivery_status', 'pending')
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .limit(limit)

  if (error) {
    console.error('[partner/webhooks] fetchDueDispatches query failed:', error.message)
    return []
  }

  return (data ?? []).map((row) => {
    const partnerAccount = row.partner_accounts as unknown as { outbound_base_url: string | null } | null
    return {
      id: row.id as string,
      partner_account_id: row.partner_account_id as string,
      event_type: row.event_type as BillableEventType,
      payload: row.payload as WebhookPayload,
      signature: row.signature as string,
      retry_count: row.retry_count as number,
      outbound_base_url: partnerAccount?.outbound_base_url ?? null,
    }
  })
}

/**
 * Attempts delivery of one dispatch-log row. Never throws — always updates
 * the row's own status and returns the outcome, so the Inngest step calling
 * this can log/continue rather than fail the whole batch on one partner's
 * unreachable endpoint (matches the codebase's existing per-item-error-
 * tolerant convention, e.g. daily-delivery's "log error, continue").
 */
export async function attemptDispatch(row: DueDispatchRow): Promise<'delivered' | 'retrying' | 'exhausted' | 'skipped_no_endpoint'> {
  const supabase = createSupabaseAdminClient()

  if (!row.outbound_base_url) {
    // Partner hasn't configured outbound_base_url yet (Section 9 edge case:
    // "first-ever session ... outbound config unset ... fails cleanly rather
    // than crashing"). Leave as pending indefinitely — not a failed attempt,
    // no retry_count increment — until the partner configures their endpoint.
    return 'skipped_no_endpoint'
  }

  const rawBody = JSON.stringify(row.payload)
  const url = `${row.outbound_base_url.replace(/\/$/, '')}/webhooks/usage`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CLIO_SIGNATURE_HEADER]: row.signature,
      },
      body: rawBody,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    if (res.ok) {
      await supabase
        .from('webhook_dispatch_log')
        .update({ delivery_status: 'delivered', http_status_code: res.status, delivered_at: new Date().toISOString() })
        .eq('id', row.id)
      return 'delivered'
    }

    return await handleFailedAttempt(row, res.status)
  } catch (err) {
    console.error(`[partner/webhooks] Dispatch attempt failed for ${row.id}:`, err instanceof Error ? err.message : err)
    return await handleFailedAttempt(row, null)
  }
}

async function handleFailedAttempt(row: DueDispatchRow, httpStatusCode: number | null): Promise<'retrying' | 'exhausted'> {
  const supabase = createSupabaseAdminClient()
  const nextRetryCount = row.retry_count + 1

  if (nextRetryCount >= MAX_ATTEMPTS) {
    await supabase
      .from('webhook_dispatch_log')
      .update({ delivery_status: 'exhausted', http_status_code: httpStatusCode, retry_count: nextRetryCount })
      .eq('id', row.id)
    return 'exhausted'
  }

  const backoffSeconds = BACKOFF_SECONDS[row.retry_count] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]
  const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000).toISOString()

  await supabase
    .from('webhook_dispatch_log')
    .update({
      delivery_status: 'pending',
      http_status_code: httpStatusCode,
      retry_count: nextRetryCount,
      next_retry_at: nextRetryAt,
    })
    .eq('id', row.id)

  return 'retrying'
}
