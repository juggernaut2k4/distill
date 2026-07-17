import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'
import { recordBillableEvent } from '@/lib/partner/webhooks'

/**
 * B2B-19 — mid-session minute enforcement for the PAID wallet (Requirement Doc
 * Req 3.1, Q-C). Generalizes inngest/partner-trial-cutoff.ts (test-mode only) to
 * live/inline sessions, with one deliberate, required difference: a GRACEFUL
 * wrap-up nudge BEFORE the clean bot-leave — explicitly NOT the abrupt,
 * no-nudge test-mode cutoff (which B2B-08 correctly skipped for trial minutes).
 *
 * Two-phase timing (O-2, CEO-confirmed):
 *   phase 1 — sleep until (affordableMinutes − 45s); set wrap_up_pending so the
 *             render client's wrap-up poll delivers the nudge via sendWrapUpNudge().
 *   phase 2 — sleep a ~60s runway; if the session is still running, clean
 *             bot-leave + mark completed (end_reason: balance_limit_reached) +
 *             record the billable events, so the balance never overshoots.
 *
 * cancelOn clio/partner-live.ended cancels the whole job on a normal end
 * (emitted by handleSessionEnd for live sessions), mirroring the test-mode
 * clio/partner-trial.ended cancel.
 */
export const partnerLiveCutoffJob = inngest.createFunction(
  {
    id: 'partner-live-cutoff',
    name: 'Partner Live Wallet Cutoff',
    triggers: [{ event: 'clio/partner-live.started' }],
    cancelOn: [{ event: 'clio/partner-live.ended', match: 'data.clioSessionRef' }],
    concurrency: { key: 'event.data.clioSessionRef', limit: 1 },
    retries: 1,
  },
  async ({ event, step }: {
    event: { data: { clioSessionRef: string; partnerAccountId: string; providerBotId: string; affordableMinutes: number } }
    step: { sleep: (id: string, duration: string) => Promise<void>; run: <T>(id: string, fn: () => Promise<T>) => Promise<T> }
  }) => {
    const { clioSessionRef, partnerAccountId, providerBotId, affordableMinutes } = event.data

    // Phase 1 — wait until 45s before the true affordable-minutes boundary, then
    // arm the graceful wrap-up nudge. Floor at 0 so tiny budgets nudge immediately.
    const preNudgeSeconds = Math.max(0, Math.round(affordableMinutes * 60 - 45))
    await step.sleep('wait-until-wrap-up-window', `${preNudgeSeconds}s`)

    const endedBeforeNudge = await step.run('check-status-before-nudge', async () => {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase.from('partner_sessions').select('status').eq('id', clioSessionRef).maybeSingle()
      return data?.status === 'completed' || data?.status === 'failed'
    })
    if (endedBeforeNudge) return

    await step.run('arm-wrap-up-nudge', async () => {
      const supabase = createSupabaseAdminClient()
      const { error } = await supabase
        .from('partner_sessions')
        .update({
          wrap_up_pending: true,
          wrap_up_nudge_text:
            'You are almost out of session time. Wrap up now: deliver your brief two-sentence closing summary, ask if there is anything else, then say goodbye and call the end_session tool.',
        })
        .eq('id', clioSessionRef)
      if (error) console.error('[partner-live-cutoff] failed to arm wrap-up nudge:', error.message)
    })

    // Phase 2 — ~60s runway for the bot to close out naturally after the nudge.
    await step.sleep('wrap-up-runway', '60s')

    const alreadyEnded = await step.run('check-session-status', async () => {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase.from('partner_sessions').select('status').eq('id', clioSessionRef).maybeSingle()
      return data?.status === 'completed' || data?.status === 'failed'
    })
    // Bot closed out gracefully within the runway — nothing to force.
    if (alreadyEnded) return

    await step.run('leave-bot', async () => {
      try {
        await getMeetingBotProvider().deleteBot(providerBotId)
      } catch (err) {
        console.error('[partner-live-cutoff] deleteBot failed (non-fatal — session is still force-ended below):', err)
      }
    })

    await step.run('mark-session-completed', async () => {
      const supabase = createSupabaseAdminClient()
      await supabase
        .from('partner_sessions')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString(),
          end_reason: 'balance_limit_reached',
          wrap_up_pending: false,
          wrap_up_nudge_text: null,
          billed_duration_source: 'wall_clock_fallback',
        })
        .eq('id', clioSessionRef)
    })

    await step.run('record-billable-events', async () => {
      // Mirrors handleSessionEnd()'s two-call pattern (usage.voice_minute +
      // session.completed). testMode:false → applyWalletDecrement() decrements
      // the paid wallet by affordableMinutes at the effective voice_minute rate,
      // driving the balance to ~zero (the session ran its full allowance).
      await recordBillableEvent({
        partnerAccountId,
        eventType: 'usage.voice_minute',
        clioSessionRef,
        quantity: affordableMinutes,
        unit: 'minutes',
        testMode: false,
      })
      await recordBillableEvent({
        partnerAccountId,
        eventType: 'session.completed',
        clioSessionRef,
        testMode: false,
      })
    })
  },
)
