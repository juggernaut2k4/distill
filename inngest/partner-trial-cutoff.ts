import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'
import { recordBillableEvent } from '@/lib/partner/webhooks'
import { emitPartnerSessionEndedEvent } from '@/lib/partner/live-render'

/**
 * B2B-08 — server-side timer that force-ends a test-mode partner session at
 * its available-minutes boundary, regardless of client state. Scoped to
 * partner_sessions (not the legacy `sessions` table session-timer.ts covers).
 * Deliberately no graceful pre-cutoff nudge (unlike session-timer.ts's
 * two-phase warning) — the meeting belongs to the partner, not to Clio;
 * there is nothing for Clio to gracefully wrap up. A clean bot-leave at the
 * boundary is correct and sufficient. See Requirement Document for the full
 * reasoning — this is a considered deviation from the session-timer.ts
 * precedent, not an oversight.
 */
type CutoffStep = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>
}

/**
 * B2B-43 — the leave-bot/consume-minutes/mark-session-completed/record-billable-events sequence,
 * extracted from partnerTrialCutoffJob's own handler (below) so partnerTrialStuckSessionBackstopSweep
 * (also in this file) can force-complete a stuck session identically without duplicating it.
 * `idSuffix`, when provided, disambiguates step ids for callers that run this in a loop over multiple
 * sessions (the sweep passes the session id); the main job's own single-session handler calls this
 * with no suffix, so its step ids ('leave-bot', 'consume-minutes', 'mark-session-completed',
 * 'record-billable-events') are byte-identical to before this refactor — no behavior change for the
 * existing job. `providerBotId` is nullable here (unlike the main job's event payload, which always
 * has one) because a session the backstop sweep recovers may be stuck in `status='requested'`, before
 * a bot was ever dispatched — `leave-bot` is a no-op in that case.
 */
export async function runTrialCutoffSequence(
  step: CutoffStep,
  clioSessionRef: string,
  partnerAccountId: string,
  providerBotId: string | null,
  availableMinutes: number,
  idSuffix?: string
): Promise<void> {
  const suffix = idSuffix ? `-${idSuffix}` : ''

  await step.run(`leave-bot${suffix}`, async () => {
    if (!providerBotId) return
    try {
      await getMeetingBotProvider().deleteBot(providerBotId)
    } catch (err) {
      console.error('[partner-trial-cutoff] deleteBot failed (non-fatal — session is still force-ended below):', err)
    }
  })

  await step.run(`consume-minutes${suffix}`, async () => {
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.rpc('consume_trial_and_test_minutes', {
      p_partner_account_id: partnerAccountId,
      p_minutes: availableMinutes, // the session ran its full allowance, not a re-measured duration
    })
    if (error) console.error('[partner-trial-cutoff] consume_trial_and_test_minutes RPC failed:', error.message)
  })

  await step.run(`mark-session-completed${suffix}`, async () => {
    const supabase = createSupabaseAdminClient()
    await supabase
      .from('partner_sessions')
      .update({ status: 'completed', ended_at: new Date().toISOString(), end_reason: 'trial_limit_reached' })
      .eq('id', clioSessionRef)
    emitPartnerSessionEndedEvent(clioSessionRef)   // B2B-37
  })

  await step.run(`record-billable-events${suffix}`, async () => {
    // Mirrors handleSessionEnd()'s own two-call pattern (usage.voice_minute + session.completed)
    // so a partner's outbound webhook integration learns a forcibly-cutoff test session ended,
    // exactly as it would for a normal end — omitting session.completed here would be the one
    // observable inconsistency between the two end paths.
    await recordBillableEvent({
      partnerAccountId, eventType: 'usage.voice_minute', clioSessionRef,
      quantity: availableMinutes, unit: 'minutes', testMode: true, isMeteredTestUsage: true,
    })
    await recordBillableEvent({
      partnerAccountId, eventType: 'session.completed', clioSessionRef, testMode: true,
    })
  })
}

export const partnerTrialCutoffJob = inngest.createFunction(
  {
    id: 'partner-trial-cutoff',
    name: 'Partner Trial Cutoff',
    triggers: [{ event: 'clio/partner-trial.started' }],
    cancelOn: [{ event: 'clio/partner-trial.ended', match: 'data.clioSessionRef' }],
    concurrency: { key: 'event.data.clioSessionRef', limit: 1 },
    retries: 1,
  },
  async ({ event, step }: {
    event: { data: { clioSessionRef: string; partnerAccountId: string; providerBotId: string; availableMinutes: number } }
    step: { sleep: (id: string, duration: string) => Promise<void> } & CutoffStep
  }) => {
    const { clioSessionRef, partnerAccountId, providerBotId, availableMinutes } = event.data

    await step.sleep('wait-for-available-minutes', `${availableMinutes}m`)

    // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project (root cause doc
    // comment in app/api/demo/[slug]/performance/route.ts); replaced with array fetch + [0].
    const alreadyEnded = await step.run('check-session-status', async () => {
      const supabase = createSupabaseAdminClient()
      const { data: rows } = await supabase.from('partner_sessions').select('status').eq('id', clioSessionRef).limit(1)
      const data = rows?.[0] ?? null
      return data?.status === 'completed' || data?.status === 'failed'
    })
    // Race-safe no-op — cancelOn should already have caught a normal end; this is a second guard,
    // mirroring session-timer.ts's own "already ended — skipping" checks.
    if (alreadyEnded) return

    await runTrialCutoffSequence(step, clioSessionRef, partnerAccountId, providerBotId, availableMinutes)
  },
)

// ─── B2B-43 Fix 3 — backstop sweep for stuck test-mode sessions ─────────────

/**
 * Comfortably longer than any legitimate trial session can run (20-minute base trial plus any
 * realistic test-block top-up for a single session) — per the brief's own recommendation.
 */
const STUCK_SESSION_CEILING_MS = 60 * 60 * 1000

/**
 * B2B-76 §1.3 (item 3) — server-side max-call-duration backstop for widget sessions.
 *
 * Arun asked for a way to pass ElevenLabs a max call duration so it ends the session itself.
 * elevenlabs-docs (live-doc-verified, B2B-76 §0/§1.3) found no confirmed vendor field for this on
 * either the conversation_config_override surface or the token-mint query params — only
 * `max_conversation_duration_message`, which controls what the agent SAYS when some other limit
 * fires, not a duration limit itself. Sending an unconfirmed override field is not a safe no-op
 * (B2B-75 §0.B: ElevenLabs throws on an override for a field whose Security-tab toggle isn't
 * enabled) — so this is the closest real equivalent instead: genuinely server-side, survives a
 * killed tab or a dead client timer (unlike WidgetRenderClient.tsx's existing
 * `maxDurationTimeoutRef` client-side nudge, which cannot).
 *
 * VALUE: copied from WidgetRenderClient.tsx's own `MAX_CALL_DURATION_MS` (also 60 minutes) rather
 * than introducing a second, independent duration constant that could drift from the client's — the
 * two files can't share an import (one is a 'use client' browser bundle, the other a server-only
 * Inngest function), so this is a deliberately paired literal; if the client's nudge threshold ever
 * changes, this one must change with it (see the matching comment at that file's own constant).
 *
 * MERGED INTO THE EXISTING SWEEP BELOW, not a second parallel cron, and this is a considered
 * decision, not just following "don't build a second safety net" (that instruction was about item 2
 * specifically): STUCK_SESSION_CEILING_MS and MAX_WIDGET_CALL_DURATION_MS are numerically identical
 * today (60 min each), and nothing currently heartbeats partner_sessions.updated_at during an active
 * widget call (grep-confirmed — the only mid-call write on a widget row is the one-time
 * hume_chat_id set at connect), so `updated_at` effectively equals `created_at` for the entire life
 * of a widget_active row. A second cron on the identical every-15-minutes schedule, querying the same
 * table for a functionally-overlapping condition, would race this one on every tick — both could
 * observe the same `status='widget_active'` row before either writes, and both would then call
 * runTrialCutoffSequence() for it, double-consuming trial/test minutes and double-recording billable
 * events. Merging avoids that class of bug entirely, because the FIRST query result to reach
 * mark-session-completed flips status away from 'widget_active', which the SECOND query's own filter
 * then naturally excludes on its next run — there is no "next run" race within a single sweep
 * invocation since both queries execute in the same step before any writes happen, and the loop
 * below already dedupes by id.
 *
 * SCOPED TO test_mode=true, delivery_channel='widget' ONLY — deliberately, for the same reason
 * STUCK_SESSION_CEILING_MS's own sweep is test_mode-only (see that JSDoc immediately below):
 * runTrialCutoffSequence()'s `record-billable-events` step hardcodes `testMode: true` on every event
 * it emits (it is fundamentally a TRIAL-cutoff sequence), and its availableMinutes computation draws
 * from the trial/test wallet (Math.max(0, 20 - trial_minutes_used) + test_minutes_balance) — neither
 * is correct for a real, live-mode (test_mode=false) paid session. Extending this mechanism to
 * live-mode sessions would misrecord real usage as test usage and would need its own
 * availableMinutes/billing derivation — exactly the class of work B2B-76 §1.2 point 3 already named
 * and deferred (B2B-43-FF) for the abandoned-session sweep. A live-mode max-duration backstop is a
 * real gap but a separate piece of work, not silently built here — flagged to BACKLOG.md.
 */
const MAX_WIDGET_CALL_DURATION_MS = 60 * 60 * 1000 // MUST match WidgetRenderClient.tsx's MAX_CALL_DURATION_MS — see that file's paired comment

/**
 * B2B-43 Fix 3 — the ONLY thing that arms a test-mode session's cutoff timer is a single
 * fire-and-forget `inngest.send('clio/partner-trial.started')` call in
 * app/api/partner/v1/sessions/route.ts, with no retry and no DB flag marking "cutoff armed." If that
 * event is ever silently dropped (confirmed to have happened at least once, 2026-07-27), nothing else
 * in the codebase ever recovers the session — confirmed by grepping every file that writes
 * partner_sessions.status; partnerSessionInsightsBackstopSweep's own 30-minute sweep only re-attempts
 * insights extraction for sessions already `status='completed'`, it never touches
 * `'requested'`/`'bot_active'` rows.
 *
 * This sweep closes that gap generally (not a one-off patch for the single session that surfaced it):
 * it finds any test_mode session stuck in `'requested'`/`'bot_active'` past STUCK_SESSION_CEILING_MS
 * and force-completes it via runTrialCutoffSequence() above — the exact same sequence
 * partnerTrialCutoffJob runs on a normal cutoff, reused rather than duplicated.
 *
 * Scoped to test_mode only, per the brief's own recommendation (matches the observed bug and the
 * demo account's test_mode:true) — live-mode (non-test_mode) `bot_active` stuck-session coverage via
 * partner-live-cutoff.ts's own event is logged as a BACKLOG.md fast-follow, not built here.
 *
 * `availableMinutes` is never persisted on partner_sessions — it's computed fresh at
 * session-creation time in the route handler and only ever carried as the ephemeral
 * clio/partner-trial.started event payload this sweep exists to recover from when that event never
 * arrived. Recomputed here the same way the route handler computes it
 * (Math.max(0, 20 - trial_minutes_used) + test_minutes_balance) — matching the main job's own
 * existing assumption for a normal cutoff, that the session ran its full available allowance.
 */
export const partnerTrialStuckSessionBackstopSweep = inngest.createFunction(
  {
    id: 'partner-trial-stuck-session-backstop-sweep',
    name: 'Partner Trial — Stuck Test-Mode Session Backstop Sweep',
    retries: 3,
    triggers: [{ cron: '*/15 * * * *' }],
  },
  async ({ step }: { step: CutoffStep }) => {
    const supabase = createSupabaseAdminClient()

    const stuckSessions = await step.run('find-stuck-sessions', async () => {
      const cutoff = new Date(Date.now() - STUCK_SESSION_CEILING_MS).toISOString()
      // B2B-70 (docs/specs/B2B-70-requirement-document.md §6.11) — 'widget_active' added so an
      // abandoned widget tab (closed without the pagehide beacon firing — e.g. a hard crash) is
      // recovered the same way a stuck meeting-bot session already is. runTrialCutoffSequence()'s
      // leave-bot step already no-ops when provider_bot_id is null (true for every widget session),
      // so this addition needed no other change in this file.
      const { data: staleData, error: staleError } = await supabase
        .from('partner_sessions')
        .select('id, partner_account_id, provider_bot_id')
        .in('status', ['requested', 'bot_active', 'widget_active'])
        .eq('test_mode', true)
        .lt('updated_at', cutoff)

      if (staleError) {
        console.error('[partner-trial-backstop] Failed to query stuck sessions:', staleError.message)
        throw new Error(`Stuck-session backstop sweep query failed: ${staleError.message}`)
      }

      // B2B-76 §1.3 (item 3) — max-call-duration overrun, merged into this same query/step rather
      // than a second cron (see MAX_WIDGET_CALL_DURATION_MS's own JSDoc above for why). Keyed off
      // `created_at` (call start), not `updated_at` (last write) — the two happen to coincide for a
      // widget_active row today (nothing heartbeats updated_at mid-call), but created_at is the
      // semantically correct signal for "this call has run too long" and stays correct even if a
      // future change (a glitch log write, a mid-call nudge write) touches the row and would
      // otherwise reset a staleness-based clock without the call actually being shorter.
      const durationCutoff = new Date(Date.now() - MAX_WIDGET_CALL_DURATION_MS).toISOString()
      const { data: overrunData, error: overrunError } = await supabase
        .from('partner_sessions')
        .select('id, partner_account_id, provider_bot_id')
        .eq('status', 'widget_active')
        .eq('delivery_channel', 'widget')
        .eq('test_mode', true)
        .lt('created_at', durationCutoff)

      if (overrunError) {
        console.error('[partner-trial-backstop] Failed to query max-duration overrun sessions:', overrunError.message)
        throw new Error(`Max-duration backstop sweep query failed: ${overrunError.message}`)
      }

      // Dedupe by id — a session can legitimately satisfy both conditions at once (today, always,
      // per the JSDoc above), and must only be force-completed once.
      const byId = new Map<string, { id: string; partner_account_id: string; provider_bot_id: string | null }>()
      for (const row of (staleData ?? []) as { id: string; partner_account_id: string; provider_bot_id: string | null }[]) {
        byId.set(row.id, row)
      }
      for (const row of (overrunData ?? []) as { id: string; partner_account_id: string; provider_bot_id: string | null }[]) {
        byId.set(row.id, row)
      }
      return Array.from(byId.values())
    })

    console.log(`[partner-trial-backstop] Stuck test-mode sessions found: ${stuckSessions.length}`)

    let recovered = 0
    let failed = 0

    for (const session of stuckSessions) {
      try {
        const availableMinutes = await step.run(`compute-available-minutes-${session.id}`, async () => {
          // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project; array fetch + [0].
          const { data: walletRows } = await supabase
            .from('partner_wallets')
            .select('trial_minutes_used, test_minutes_balance')
            .eq('partner_account_id', session.partner_account_id)
            .limit(1)
          const wallet = walletRows?.[0] ?? null
          const trialMinutesUsed = wallet ? Number(wallet.trial_minutes_used) : 0
          const testMinutesBalance = wallet ? Number(wallet.test_minutes_balance) : 0
          return Math.max(0, 20 - trialMinutesUsed) + testMinutesBalance
        })

        await runTrialCutoffSequence(step, session.id, session.partner_account_id, session.provider_bot_id, availableMinutes, session.id)
        recovered++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[partner-trial-backstop] Force-complete failed for stuck session ${session.id}:`, message)
        failed++
      }
    }

    return { checked: stuckSessions.length, recovered, failed }
  }
)
