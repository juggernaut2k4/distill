import crypto from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendLowBalanceAlertEmail } from '@/lib/delivery/email'
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

export type BillableEventType =
  | 'usage.voice_minute'
  | 'usage.llm_generation_call'
  | 'session.completed'
  | 'session.insights_ready' // B2B-09 — not billable; reuses this union purely for webhook_dispatch_log typing, same as the existing non-billable 'session.completed'

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
  // B2B-09 — additive. null/absent on every event type except
  // 'session.insights_ready'. architecture.md §16.7.
  extraction_status?: 'success' | 'success_empty' | 'failed' | null
  action_items?: { text: string }[] | null
  glitches?: { type: string; description?: string }[] | null
  psychology_keywords?: string[] | null
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
  /**
   * B2B-08 — additive, Clio-internal-only cost-visibility signal, orthogonal
   * to `testMode` (unchanged meaning: never billed to the partner). True for
   * usage_events rows produced by the trial/test-block metering mechanism
   * (architecture.md Section 15). Never read by any partner-facing response.
   */
  isMeteredTestUsage?: boolean
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

  // B2B-04 idempotency fix (architecture.md §13.3, Requirement Doc Section
  // 1/6/7/5.B.6) — `inserted` is null exactly when the upsert above hit the
  // ignoreDuplicates conflict path (an identical retry). The usage_events
  // insert AND the wallet decrement it triggers must both be skipped
  // entirely on a duplicate call — never run twice for the same logical
  // event. On a duplicate, look up and return the EXISTING dispatch-log
  // row's id (same conflict key) so the function's return contract stays
  // meaningful rather than returning an empty string.
  let dispatchLogId: string

  if (inserted?.id) {
    dispatchLogId = inserted.id as string

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
        const { data: insertedUsageEvent, error: usageEventsError } = await supabase
          .from('usage_events')
          .insert({
            partner_account_id: params.partnerAccountId,
            event_type: usageEventType,
            quantity: params.quantity,
            clio_session_ref: params.clioSessionRef ?? null,
            partner_reference: params.partnerReference ?? null,
            webhook_dispatch_log_id: inserted.id,
            test_mode: params.testMode ?? false,
            is_metered_test_usage: params.isMeteredTestUsage ?? false,
            occurred_at: occurredAt,
          })
          .select('id')
          .single()

        if (usageEventsError) {
          console.error('[partner/webhooks] Failed to record usage_events row:', usageEventsError.message)
          return { error: usageEventsError.message }
        }

        // B2B-04 — decrement the partner's wallet for this genuinely-new
        // billable event (Requirement Doc Section 5.B.1). Never blocks or
        // reverses the usage_events/webhook_dispatch_log writes above on
        // failure — applyWalletDecrement() already handles expected
        // (Supabase-returned) errors internally; this try/catch is the
        // outer backstop against an unexpected thrown exception, so a
        // billing hiccup can never take down the usage-recording path that
        // already succeeded.
        if (insertedUsageEvent?.id) {
          try {
            await applyWalletDecrement({
              usageEventId: insertedUsageEvent.id as string,
              partnerAccountId: params.partnerAccountId,
              eventType: usageEventType,
              quantity: params.quantity,
              occurredAt,
              testMode: params.testMode ?? false,
            })
          } catch (err) {
            console.error('[partner/webhooks] applyWalletDecrement threw unexpectedly (non-fatal):', err instanceof Error ? err.message : err)
          }
        }
      }
    }
  } else {
    const { data: existing } = await lookupExistingDispatchLog(supabase, {
      partnerAccountId: params.partnerAccountId,
      eventType: params.eventType,
      clioSessionRef: params.clioSessionRef ?? null,
      payloadHash,
    })
    dispatchLogId = (existing?.id as string) ?? ''
  }

  return { dispatchLogId }
}

/** Looks up the existing `webhook_dispatch_log` row by its own idempotency
 * unique index (`partner_account_id, event_type, clio_session_ref,
 * payload_hash`) — used when the upsert conflicted (a retried/duplicate
 * call), so `recordBillableEvent()` can still return a meaningful id. */
async function lookupExistingDispatchLog(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  params: { partnerAccountId: string; eventType: BillableEventType; clioSessionRef: string | null; payloadHash: string }
) {
  let query = supabase
    .from('webhook_dispatch_log')
    .select('id')
    .eq('partner_account_id', params.partnerAccountId)
    .eq('event_type', params.eventType)
    .eq('payload_hash', params.payloadHash)

  query = params.clioSessionRef
    ? query.eq('clio_session_ref', params.clioSessionRef)
    : query.is('clio_session_ref', null)

  return query.maybeSingle()
}

// ─── B2B-04 — Wallet decrement mechanism (Requirement Doc Section 5.B.1) ─────
// architecture.md §13.3: new function, same file as recordBillableEvent().

/**
 * Resolves the currently-effective burn rate for a (partner, event_type,
 * occurredAt) triple: a partner-specific `billing_rate_versions` override
 * covering `occurredAt` takes priority; otherwise the platform-default
 * (`partner_account_id IS NULL`) row covering `occurredAt`; otherwise `null`
 * (no rate configured — the 7 unrated `llm_generation_*` types at launch,
 * Requirement Doc Section 6). Never mutated in place — a rate change closes
 * the old row (`effective_to`) and opens a new one, so this resolves the
 * rate genuinely in effect at `occurredAt`, even after later rate changes.
 */
async function resolveEffectiveRate(
  partnerAccountId: string,
  eventType: string,
  occurredAt: string
): Promise<{ id: string; rate_usd: number } | null> {
  const supabase = createSupabaseAdminClient()

  const { data: partnerRate } = await supabase
    .from('billing_rate_versions')
    .select('id, rate_usd')
    .eq('partner_account_id', partnerAccountId)
    .eq('event_type', eventType)
    .lte('effective_from', occurredAt)
    .or(`effective_to.is.null,effective_to.gt.${occurredAt}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (partnerRate) {
    return { id: partnerRate.id as string, rate_usd: Number(partnerRate.rate_usd) }
  }

  const { data: defaultRate } = await supabase
    .from('billing_rate_versions')
    .select('id, rate_usd')
    .is('partner_account_id', null)
    .eq('event_type', eventType)
    .lte('effective_from', occurredAt)
    .or(`effective_to.is.null,effective_to.gt.${occurredAt}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  return defaultRate ? { id: defaultRate.id as string, rate_usd: Number(defaultRate.rate_usd) } : null
}

/**
 * Implements the exact sequence in Requirement Doc Section 5.B.1. Called
 * from `recordBillableEvent()` immediately after a genuinely-new
 * `usage_events` insert succeeds (billable event types only).
 *
 * Never blocks or reverses the `usage_events`/`webhook_dispatch_log` writes
 * that already succeeded — a decrement failure here is logged and surfaced
 * via `usage_events.billed` staying `false` (its default), a recoverable,
 * queryable inconsistent state, matching this codebase's existing per-item-
 * error-tolerant convention.
 */
export async function applyWalletDecrement(params: {
  usageEventId: string
  partnerAccountId: string
  eventType: string
  quantity: number
  occurredAt: string
  testMode: boolean
}): Promise<void> {
  if (params.testMode) return // preserves the existing test_mode=FALSE-only-billable convention

  const supabase = createSupabaseAdminClient()

  const rate = await resolveEffectiveRate(params.partnerAccountId, params.eventType, params.occurredAt)

  if (!rate) {
    // No billing_rate_versions row covers this event_type yet — record the
    // event as unbilled, no wallet mutation, no alert check (Requirement Doc
    // Section 6: the 7 unrated llm_generation_* types at launch).
    const { error } = await supabase.from('usage_events').update({ billed: false }).eq('id', params.usageEventId)
    if (error) {
      console.error('[partner/webhooks] applyWalletDecrement: failed to mark usage_events unbilled:', error.message)
    }
    return
  }

  const amountUsd = params.quantity * rate.rate_usd

  const { data: newBalance, error: decrementError } = await supabase.rpc('decrement_wallet_balance', {
    p_partner_account_id: params.partnerAccountId,
    p_amount_usd: amountUsd,
  })

  if (decrementError) {
    console.error('[partner/webhooks] applyWalletDecrement: decrement_wallet_balance RPC failed:', decrementError.message)
    return
  }

  const { error: updateError } = await supabase
    .from('usage_events')
    .update({ billed: true, amount_usd: amountUsd, billing_rate_version_id: rate.id })
    .eq('id', params.usageEventId)

  if (updateError) {
    console.error('[partner/webhooks] applyWalletDecrement: failed to mark usage_events billed:', updateError.message)
  }

  // BILLING-LEDGER-01-style discipline (mirrors lib/session-billing.ts):
  // resulting_balance_usd is always the RPC's own returned value, never
  // independently recomputed.
  const { error: ledgerError } = await supabase.from('wallet_ledger').insert({
    partner_account_id: params.partnerAccountId,
    entry_type: 'usage_decrement',
    delta_usd: -amountUsd,
    resulting_balance_usd: newBalance,
    usage_events_id: params.usageEventId,
    billing_rate_version_id: rate.id,
  })

  if (ledgerError) {
    console.error('[partner/webhooks] applyWalletDecrement: wallet_ledger insert failed:', ledgerError.message)
  }

  await checkLowBalanceAndAlert(params.partnerAccountId, Number(newBalance))
}

/**
 * Requirement Doc Section 5.B.5. Fires the low-balance alert at most once
 * per depletion cycle via a compare-and-set update on
 * `low_balance_alert_fired_at` (race-safe: only the caller that flips it
 * from NULL to now() sends the alert). Re-armed only by a new top-up landing
 * (the three webhook credit paths in app/api/webhooks/stripe/route.ts) —
 * never by this function.
 */
async function checkLowBalanceAndAlert(partnerAccountId: string, newBalanceUsd: number): Promise<void> {
  const supabase = createSupabaseAdminClient()

  const { data: wallet } = await supabase
    .from('partner_wallets')
    .select('reference_topup_amount_usd')
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  const referenceTopupAmountUsd = wallet?.reference_topup_amount_usd ? Number(wallet.reference_topup_amount_usd) : 0
  if (!referenceTopupAmountUsd) return // no funded reference point yet — no alert is possible or expected

  const threshold = referenceTopupAmountUsd * 0.2
  if (newBalanceUsd > threshold) return // not yet at 80% consumed

  const { data: won } = await supabase
    .from('partner_wallets')
    .update({ low_balance_alert_fired_at: new Date().toISOString() })
    .eq('partner_account_id', partnerAccountId)
    .is('low_balance_alert_fired_at', null)
    .select('id')
    .maybeSingle()

  if (!won) return // already fired for this depletion cycle — no duplicate send

  const [{ data: account }, emails] = await Promise.all([
    supabase.from('partner_accounts').select('name, outbound_signing_secret').eq('id', partnerAccountId).maybeSingle(),
    getPartnerAdminEmails(partnerAccountId),
  ])

  await Promise.all(
    emails.map((email) =>
      sendLowBalanceAlertEmail(email, account?.name ?? 'your Clio account', newBalanceUsd, referenceTopupAmountUsd).catch(
        (err) => console.error('[partner/webhooks] sendLowBalanceAlertEmail failed:', err)
      )
    )
  )

  // Best-effort dispatch of a wallet.low_balance webhook row via the
  // existing HMAC/signature/retry mechanism (Requirement Doc 5.B.5).
  //
  // KNOWN GAP: webhook_dispatch_log.event_type's CHECK constraint (migration
  // 071, not modified by this brief) does not include 'wallet.low_balance' —
  // this insert fails until a follow-up migration extends that constraint.
  // Logged and non-fatal (matches this file's existing fire-and-forget
  // convention); the email alert above is the acceptance-test-covered path
  // and is unaffected by this gap.
  try {
    const payload = {
      event_id: crypto.randomUUID(),
      event_type: 'wallet.low_balance',
      partner_account_id: partnerAccountId,
      balance_usd: newBalanceUsd,
      reference_topup_amount_usd: referenceTopupAmountUsd,
      occurred_at: new Date().toISOString(),
    }
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    const signingSecret = (account?.outbound_signing_secret as string | null) ?? 'unconfigured-partner-signing-secret'
    const signature = buildSignatureHeader(signingSecret, JSON.stringify(payload))

    const { error: dispatchError } = await supabase.from('webhook_dispatch_log').insert({
      partner_account_id: partnerAccountId,
      event_type: 'wallet.low_balance',
      payload,
      payload_hash: payloadHash,
      signature,
      delivery_status: 'pending',
    })

    if (dispatchError) {
      console.error(
        '[partner/webhooks] wallet.low_balance dispatch-log insert failed (known schema gap, see comment above):',
        dispatchError.message
      )
    }
  } catch (err) {
    console.error('[partner/webhooks] wallet.low_balance dispatch attempt failed:', err instanceof Error ? err.message : err)
  }
}

/** Resolves the Clerk-registered email addresses of every `partner_admin_users` row for this account. */
async function getPartnerAdminEmails(partnerAccountId: string): Promise<string[]> {
  const supabase = createSupabaseAdminClient()
  const { data: admins } = await supabase
    .from('partner_admin_users')
    .select('clerk_user_id')
    .eq('partner_account_id', partnerAccountId)

  if (!admins || admins.length === 0) return []

  const { clerkClient } = await import('@clerk/nextjs/server')
  const emails: string[] = []

  for (const admin of admins) {
    try {
      const clerkUser = await clerkClient().users.getUser(admin.clerk_user_id as string)
      const primaryEmailId = clerkUser.primaryEmailAddressId
      const email = clerkUser.emailAddresses.find((e) => e.id === primaryEmailId)?.emailAddress
      if (email) emails.push(email)
    } catch (err) {
      console.error('[partner/webhooks] Failed to resolve Clerk email for admin', admin.clerk_user_id, err)
    }
  }

  return emails
}

// ─── B2B-09 — session.insights_ready reference-event recording ────────────────
// architecture.md §16.7.

/**
 * B2B-09 — inserts a REFERENCE-ONLY webhook_dispatch_log row for
 * session.insights_ready. Deliberately does NOT include
 * action_items/glitches/psychology_keywords in the stored payload — that
 * content is reconstructed live from partner_session_insights at each
 * delivery attempt (attemptDispatch(), below), per the Requirement Doc
 * Section 6 / Section 11 judgment call 2 (migration 071's own restriction on
 * this column). Never routed through recordBillableEvent() — this is not a
 * billable event and doesn't fit that function's usage_events/wallet-decrement
 * branches.
 *
 * Called from both call sites in
 * `inngest/partner-session-insights-extractor.ts`: the success path
 * (`extractInsightsForPartnerSession()`, which reads `partner_sessions.test_mode`
 * directly) and the failure path (`markInsightsExtractionFailed()`, which
 * resolves it via a `partner_sessions!inner(test_mode)` FK embed on its own
 * query, mirroring `fetchDueDispatches()`'s own `partner_accounts!inner(...)`
 * embed pattern below) — both callers MUST thread the session's real
 * `test_mode` value through `testMode`, never a hardcoded default (v1.1
 * correction, Requirement Doc Section 6 / Acceptance Test 11).
 */
export async function recordInsightsReadyEvent(params: {
  partnerSessionId: string
  partnerAccountId: string
  extractionStatus: 'success' | 'success_empty' | 'failed'
  testMode: boolean
}): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('id, outbound_signing_secret')
    .eq('id', params.partnerAccountId)
    .maybeSingle()
  if (!account) return

  const now = new Date().toISOString()
  const referencePayload = {
    event_id: crypto.randomUUID(),
    event_type: 'session.insights_ready' as const,
    clio_session_ref: params.partnerSessionId,
    partner_reference: null,
    occurred_at: now,
    dispatched_at: now,
    test_mode: params.testMode,
    extraction_status: params.extractionStatus,
    // action_items / glitches / psychology_keywords intentionally omitted — see function doc comment.
  }
  const payloadHash = crypto
    .createHash('sha256')
    .update(
      canonicalHashInput({
        event_type: 'session.insights_ready',
        clio_session_ref: params.partnerSessionId,
        partner_reference: null,
        quantity: null,
        unit: null,
        generation_type: null,
        occurred_at: now,
      })
    )
    .digest('hex')
  const signature = buildSignatureHeader(
    (account.outbound_signing_secret as string | null) ?? 'unconfigured-partner-signing-secret',
    JSON.stringify(referencePayload)
  )

  const { error } = await supabase.from('webhook_dispatch_log').upsert(
    {
      partner_account_id: params.partnerAccountId,
      event_type: 'session.insights_ready',
      clio_session_ref: params.partnerSessionId,
      payload: referencePayload,
      payload_hash: payloadHash,
      signature,
      delivery_status: 'pending',
    },
    { onConflict: 'partner_account_id,event_type,clio_session_ref,payload_hash', ignoreDuplicates: true }
  )
  if (error) {
    console.error('[partner/webhooks] recordInsightsReadyEvent insert failed:', error.message)
  }
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
  // B2B-09 — populated for every row (all event types); only read by
  // attemptDispatch()'s 'session.insights_ready' branch, which must sign the
  // live-reconstructed body fresh rather than reuse the stored `signature`
  // column. architecture.md §16.7.
  outbound_signing_secret: string | null
}

/** Fetches pending dispatch-log rows whose next retry is due (or that have never been attempted). */
export async function fetchDueDispatches(limit = 50): Promise<DueDispatchRow[]> {
  const supabase = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from('webhook_dispatch_log')
    .select(
      'id, partner_account_id, event_type, payload, signature, retry_count, partner_accounts!inner(outbound_base_url, outbound_signing_secret)'
    )
    .eq('delivery_status', 'pending')
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .limit(limit)

  if (error) {
    console.error('[partner/webhooks] fetchDueDispatches query failed:', error.message)
    return []
  }

  return (data ?? []).map((row) => {
    const partnerAccount = row.partner_accounts as unknown as {
      outbound_base_url: string | null
      outbound_signing_secret: string | null
    } | null
    return {
      id: row.id as string,
      partner_account_id: row.partner_account_id as string,
      event_type: row.event_type as BillableEventType,
      payload: row.payload as WebhookPayload,
      signature: row.signature as string,
      retry_count: row.retry_count as number,
      outbound_base_url: partnerAccount?.outbound_base_url ?? null,
      outbound_signing_secret: partnerAccount?.outbound_signing_secret ?? null,
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

  let rawBody: string
  let signatureHeader: string

  if (row.event_type === 'session.insights_ready') {
    // B2B-09 — reconstruct live from partner_session_insights; never replay
    // the stored reference payload (Requirement Doc Section 6 / Section 11
    // judgment call 2). Reads WHATEVER is currently in
    // partner_session_insights: full detail if within the 30-day retention
    // window, the purged (type-only glitches, null action_items/psychology)
    // shape if not — graceful degradation, not a special-cased error
    // (Requirement Doc Section 9). architecture.md §16.7.
    const { data: live } = await supabase
      .from('partner_session_insights')
      .select('action_items, glitches, psychology_keywords')
      .eq('partner_session_id', row.payload.clio_session_ref as string)
      .maybeSingle()

    const fullPayload = {
      ...row.payload,
      action_items: (live?.action_items as WebhookPayload['action_items']) ?? null,
      glitches: (live?.glitches as WebhookPayload['glitches']) ?? null,
      psychology_keywords: (live?.psychology_keywords as WebhookPayload['psychology_keywords']) ?? null,
    }
    rawBody = JSON.stringify(fullPayload)
    // Signed FRESH here, never reused from insert time — the wire body no
    // longer matches the stored reference payload, so the pre-computed
    // `signature` column cannot be reused for this event type without
    // producing an HMAC that fails the partner's own verification.
    signatureHeader = buildSignatureHeader(row.outbound_signing_secret ?? 'unconfigured-partner-signing-secret', rawBody)
  } else {
    rawBody = JSON.stringify(row.payload) // unchanged — every other event type
    signatureHeader = row.signature // unchanged — every other event type
  }

  const url = `${row.outbound_base_url.replace(/\/$/, '')}/webhooks/usage`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CLIO_SIGNATURE_HEADER]: signatureHeader,
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
