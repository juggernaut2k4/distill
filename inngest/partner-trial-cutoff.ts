import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'
import { recordBillableEvent } from '@/lib/partner/webhooks'

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
    step: { sleep: (id: string, duration: string) => Promise<void>; run: <T>(id: string, fn: () => Promise<T>) => Promise<T> }
  }) => {
    const { clioSessionRef, partnerAccountId, providerBotId, availableMinutes } = event.data

    await step.sleep('wait-for-available-minutes', `${availableMinutes}m`)

    const alreadyEnded = await step.run('check-session-status', async () => {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase.from('partner_sessions').select('status').eq('id', clioSessionRef).maybeSingle()
      return data?.status === 'completed' || data?.status === 'failed'
    })
    // Race-safe no-op — cancelOn should already have caught a normal end; this is a second guard,
    // mirroring session-timer.ts's own "already ended — skipping" checks.
    if (alreadyEnded) return

    await step.run('leave-bot', async () => {
      try {
        await getMeetingBotProvider().deleteBot(providerBotId)
      } catch (err) {
        console.error('[partner-trial-cutoff] deleteBot failed (non-fatal — session is still force-ended below):', err)
      }
    })

    await step.run('consume-minutes', async () => {
      const supabase = createSupabaseAdminClient()
      const { error } = await supabase.rpc('consume_trial_and_test_minutes', {
        p_partner_account_id: partnerAccountId,
        p_minutes: availableMinutes, // the session ran its full allowance, not a re-measured duration
      })
      if (error) console.error('[partner-trial-cutoff] consume_trial_and_test_minutes RPC failed:', error.message)
    })

    await step.run('mark-session-completed', async () => {
      const supabase = createSupabaseAdminClient()
      await supabase
        .from('partner_sessions')
        .update({ status: 'completed', ended_at: new Date().toISOString(), end_reason: 'trial_limit_reached' })
        .eq('id', clioSessionRef)
    })

    await step.run('record-billable-events', async () => {
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
  },
)
