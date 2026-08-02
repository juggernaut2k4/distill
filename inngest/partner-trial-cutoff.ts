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
      const { data, error } = await supabase
        .from('partner_sessions')
        .select('id, partner_account_id, provider_bot_id')
        .in('status', ['requested', 'bot_active'])
        .eq('test_mode', true)
        .lt('updated_at', cutoff)

      if (error) {
        console.error('[partner-trial-backstop] Failed to query stuck sessions:', error.message)
        throw new Error(`Stuck-session backstop sweep query failed: ${error.message}`)
      }
      return (data ?? []) as { id: string; partner_account_id: string; provider_bot_id: string | null }[]
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
