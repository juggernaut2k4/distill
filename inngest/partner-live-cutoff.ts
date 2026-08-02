import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'
import { recordBillableEvent } from '@/lib/partner/webhooks'
import { fetchHumeChatDuration, type FetchHumeChatDurationResult } from '@/lib/voice/hume-native/session-details'
import { emitPartnerSessionEndedEvent } from '@/lib/partner/live-render'

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
 *
 * B2B-34 Part D — Hume-verified adaptive cutoff, additive-only. This blind
 * countdown above never re-verifies elapsed time against Hume's own ground
 * truth. For the minority of sessions belonging to a partner account already
 * at/above 80% wallet usage (`partner_wallets.low_balance_alert_fired_at IS
 * NOT NULL`, reusing the existing checkLowBalanceAndAlert() mechanism
 * verbatim), a tiered Hume-verification loop (COURTESY_GRACE_MINUTES = 1)
 * replaces the blind two-phase sleep, then falls through into the exact same
 * nudge/force-end sequence below. Accounts below 80% usage get the ungated
 * path, byte-for-byte unchanged from before this Part. See
 * docs/specs/B2B-34-requirement-document.md Part D §6 for the full spec.
 */

/** §6.2 tiered polling schedule — keyed by *remaining* affordable minutes at
 * the start of each cycle (not the session's original starting budget), so a
 * session starting with e.g. 12 minutes begins directly in the matching tier. */
export function selectPollingIntervalSeconds(remainingMinutes: number): number {
  if (remainingMinutes > 30) return 30 * 60
  if (remainingMinutes >= 10) return 10 * 60
  if (remainingMinutes >= 5) return 5 * 60
  return 60
}

/**
 * §6.1 gate resolution, extracted for direct unit-testability (no Supabase
 * mock/Inngest harness required). §8 error-state: a gate-check query failure
 * is treated as gate-not-met — falls back to the already-proven-safe ungated
 * path rather than risking the new tiered-loop path on a query failure.
 */
export function resolveVerificationGate(
  walletRow: { low_balance_alert_fired_at: string | null } | null | undefined,
  error: { message: string } | null | undefined
): boolean {
  if (error) return false
  return walletRow?.low_balance_alert_fired_at != null
}

export const COURTESY_GRACE_MINUTES = 1

export interface CutoffCycleResult {
  /** True when real (or, on a failed Hume check, Inngest-clock-fallback)
   * remaining time has crossed the courtesy grace — caller should stop
   * looping and enter the existing nudge/force-end sequence directly. */
  shouldCutoffNow: boolean
  /** The remaining-minutes value to carry into the next cycle (or to log). */
  remainingMinutes: number
  /** True only when this cycle's decision was based on a real Hume fetch. */
  usedHumeVerification: boolean
}

/**
 * §6.2 point 3/4 + §6.3/§6.4 — evaluates a single tiered-loop cycle given the
 * result of a `fetchHumeChatDuration()` call (reused verbatim, no new
 * sibling function — its `{ok:false}` result, including the in-progress-call
 * "missing_timestamps" case, already IS the correct "unavailable, fall back
 * to the Inngest clock for this cycle" signal per §6.3).
 *
 * On success: recomputes remaining minutes from Hume's real elapsed time.
 * On failure: never force-ends on a failed check alone — falls back to
 * whatever the pre-existing blind countdown would have computed for this one
 * cycle (`inngestClockRemainingMinutes`), and defers verification to the next
 * cycle (§6.4 — bounded, small risk vs. false-positive-disconnect risk).
 */
export function evaluateCutoffCycle(params: {
  affordableMinutes: number
  inngestClockRemainingMinutes: number
  humeResult: FetchHumeChatDurationResult
  courtesyGraceMinutes?: number
}): CutoffCycleResult {
  const { affordableMinutes, inngestClockRemainingMinutes, humeResult } = params
  const grace = params.courtesyGraceMinutes ?? COURTESY_GRACE_MINUTES

  if (humeResult.ok) {
    const realElapsedMinutes = humeResult.durationSeconds / 60
    const remainingMinutes = affordableMinutes - realElapsedMinutes
    return {
      shouldCutoffNow: remainingMinutes <= grace,
      remainingMinutes,
      usedHumeVerification: true,
    }
  }

  // Failed/unavailable fetch — fall back to the Inngest clock for this cycle
  // only. Never force-end on this signal alone.
  return {
    shouldCutoffNow: false,
    remainingMinutes: inngestClockRemainingMinutes,
    usedHumeVerification: false,
  }
}
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

    // B2B-34 Part D §6.1 — the gate. Below-80%-usage accounts (flag not set,
    // or the gate query itself fails — per §8, a gate-check failure is
    // treated as gate-not-met, falling back to the already-proven-safe
    // ungated path rather than risking an unverified new code path on a
    // query failure) get the EXACT existing behavior below, byte-for-byte.
    const humeVerificationGated = await step.run('check-verification-gate', async () => {
      // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project (root cause doc
      // comment in app/api/demo/[slug]/performance/route.ts); replaced with array fetch + [0].
      // This is a billing-cutoff job, so this was a priority fix, not just routine cleanup.
      const supabase = createSupabaseAdminClient()
      const { data: rows, error } = await supabase
        .from('partner_wallets')
        .select('low_balance_alert_fired_at')
        .eq('partner_account_id', partnerAccountId)
        .limit(1)
      const data = rows?.[0] ?? null
      if (error) {
        console.error('[partner-live-cutoff] gate-check query failed — treating as gate-not-met:', error.message)
      }
      return resolveVerificationGate(data, error)
    })

    if (!humeVerificationGated) {
      // EXACT existing two-phase logic, byte-for-byte unchanged from before
      // this Part — no Hume verification, no behavior change.

      // Phase 1 — wait until 45s before the true affordable-minutes boundary, then
      // arm the graceful wrap-up nudge. Floor at 0 so tiny budgets nudge immediately.
      const preNudgeSeconds = Math.max(0, Math.round(affordableMinutes * 60 - 45))
      await step.sleep('wait-until-wrap-up-window', `${preNudgeSeconds}s`)

      const endedBeforeNudge = await step.run('check-status-before-nudge', async () => {
        // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project; array fetch + [0].
        const supabase = createSupabaseAdminClient()
        const { data: rows } = await supabase.from('partner_sessions').select('status').eq('id', clioSessionRef).limit(1)
        const data = rows?.[0] ?? null
        return data?.status === 'completed' || data?.status === 'failed'
      })
      if (endedBeforeNudge) return
    } else {
      // B2B-34 Part D §6.2 — tiered Hume-verification loop, replacing the
      // blind two-phase sleep above. Falls through into the exact same
      // nudge/force-end sequence below (entered directly at
      // 'arm-wrap-up-nudge' — the loop itself replaces the "wait until
      // wrap-up window" phase, per §6.5).
      let remainingMinutes = affordableMinutes
      let cycle = 0

      // Safety bound on loop iterations — not part of the spec's logic, just
      // a defensive guard against an unforeseen infinite loop; a session's
      // budget always eventually crosses the courtesy grace given
      // monotonically-decreasing remainingMinutes each cycle.
      while (remainingMinutes > COURTESY_GRACE_MINUTES && cycle < 500) {
        const intervalSeconds = selectPollingIntervalSeconds(remainingMinutes)
        const graceSeconds = COURTESY_GRACE_MINUTES * 60
        const sleepSeconds = Math.max(0, Math.min(intervalSeconds, Math.round(remainingMinutes * 60 - graceSeconds)))

        await step.sleep(`hume-check-wait-${cycle}`, `${sleepSeconds}s`)

        const endedDuringLoop = await step.run(`check-status-cycle-${cycle}`, async () => {
          // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project; array fetch + [0].
          const supabase = createSupabaseAdminClient()
          const { data: rows } = await supabase.from('partner_sessions').select('status').eq('id', clioSessionRef).limit(1)
          const data = rows?.[0] ?? null
          return data?.status === 'completed' || data?.status === 'failed'
        })
        if (endedDuringLoop) return

        const cycleResult = await step.run(`hume-verify-cycle-${cycle}`, async () => {
          const inngestClockRemainingMinutes = remainingMinutes - sleepSeconds / 60

          // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project; array fetch + [0].
          const supabase = createSupabaseAdminClient()
          const { data: sessionRows } = await supabase
            .from('partner_sessions')
            .select('hume_chat_id')
            .eq('id', clioSessionRef)
            .limit(1)
          const sessionRow = sessionRows?.[0] ?? null
          const humeChatId = sessionRow?.hume_chat_id as string | null | undefined

          // No hume_chat_id yet (e.g. not persisted this early) — same safe
          // "unavailable, fall back to Inngest clock" outcome as a failed fetch.
          const humeResult = humeChatId
            ? await fetchHumeChatDuration(humeChatId)
            : ({ ok: false, reason: 'no_hume_chat_id' } as const)

          const result = evaluateCutoffCycle({ affordableMinutes, inngestClockRemainingMinutes, humeResult })
          if (!result.usedHumeVerification) {
            console.warn(
              `[partner-live-cutoff] Hume verification unavailable for session ${clioSessionRef} (cycle ${cycle}) — falling back to Inngest clock for this cycle:`,
              humeResult.ok ? 'ok' : humeResult.reason
            )
          }
          return result
        })

        remainingMinutes = cycleResult.remainingMinutes
        if (cycleResult.shouldCutoffNow) break
        cycle++
      }
    }

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
      // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project; array fetch + [0].
      const supabase = createSupabaseAdminClient()
      const { data: rows } = await supabase.from('partner_sessions').select('status').eq('id', clioSessionRef).limit(1)
      const data = rows?.[0] ?? null
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
      const { error } = await supabase
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
      // Found live 2026-07-29: this write was silently failing a CHECK constraint (migration 087
      // regression, fixed in migration 103) with no visibility anywhere. Never swallow this again —
      // a session that fails to reach 'completed' here stays stuck at whatever status it was in,
      // even though the bot has already been told to leave above.
      if (error) {
        console.error('[partner-live-cutoff] mark-session-completed failed:', { clioSessionRef, error })
      }
      emitPartnerSessionEndedEvent(clioSessionRef)   // NEW — B2B-37
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
