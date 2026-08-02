import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { checkDemoLowBalanceAndAlert } from '@/lib/partner/webhooks'
import { DEMO_ADMIN_PARTNER_ACCOUNT_ID } from '@/lib/demo/passcode-accounts'

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §6.7). Listens to the EXISTING,
 * already-fired-for-every-session event `clio/partner-session.ended` (payload
 * `{ partnerSessionId }`, emitted by `emitPartnerSessionEndedEvent()` — B2B-37, live in production).
 * This is a pure new listener; nothing about the emitter or the other listeners on that event
 * (`partnerSessionInsightsExtractor`, `partnerSessionTraceLogFinalizer`) changes.
 *
 * The common case for this function is a no-op return: only sessions dispatched through
 * `app/api/demo/[slug]/dispatch/route.ts` (which writes a `demo_dispatches` row keyed by
 * `clio_session_ref`) are ever demo dispatches — every REAL partner session also fires this same
 * event and is correctly ignored here.
 *
 * Duration precision note (deliberate, documented tradeoff): reconstructs duration from
 * `partner_sessions.created_at`/`ended_at` wall-clock timestamps rather than the exact
 * `billed_duration_source` figure the real billing path computes (not stored as a standalone
 * column). For internal demo-minutes tracking this is acceptable precision (differs by at most a
 * few seconds of dispatch/webhook latency) — never used for any real revenue calculation.
 */
export const demoDispatchMinutesConsumer = inngest.createFunction(
  {
    id: 'demo-dispatch-minutes-consumer',
    name: 'Demo Dispatch Minutes Consumer',
    triggers: [{ event: 'clio/partner-session.ended' }],
    retries: 3,
  },
  async ({ event, step }: {
    event: { data: { partnerSessionId?: string } }
    step: { run: <T>(id: string, fn: () => Promise<T> | T) => Promise<T> }
  }) => {
    const { partnerSessionId } = event.data
    if (!partnerSessionId) return { status: 'skipped', reason: 'missing_partner_session_id' }

    // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project (root cause doc
    // comment in app/api/demo/[slug]/performance/route.ts); both replaced with array fetch + [0].
    const dispatch = await step.run('check-is-demo-dispatch', async () => {
      const supabase = createSupabaseAdminClient()
      const { data: rows } = await supabase
        .from('demo_dispatches')
        .select('id, billed_partner_account_id')
        .eq('clio_session_ref', partnerSessionId)
        .limit(1)
      return (rows?.[0] as { id: string; billed_partner_account_id: string } | undefined) ?? null
    })
    if (!dispatch) return { status: 'skipped', reason: 'not_a_demo_dispatch' } // the common case

    const durationMinutes = await step.run('compute-duration', async () => {
      const supabase = createSupabaseAdminClient()
      const { data: rows } = await supabase
        .from('partner_sessions')
        .select('created_at, ended_at')
        .eq('id', partnerSessionId)
        .limit(1)
      const data = rows?.[0] ?? null
      if (!data?.ended_at) return 0
      return Math.max(0, (new Date(data.ended_at as string).getTime() - new Date(data.created_at as string).getTime()) / 60000)
    })

    if (durationMinutes > 0) {
      // Returns whether the consume RPC actually succeeded — record-consumed below must only run
      // when it did, so demo_minutes_consumed is never recorded as if consumption happened when the
      // RPC itself failed (a persistent failure leaves that one session's minutes un-deducted AND
      // un-recorded, matching §8's "silently, accepted, non-blocking gap" — not a partially-true
      // record).
      const consumed = await step.run('consume-and-alert', async () => {
        const supabase = createSupabaseAdminClient()
        const { data: newBalance, error } = await supabase.rpc('consume_demo_minutes', {
          p_partner_account_id: dispatch.billed_partner_account_id,
          p_minutes: durationMinutes,
        })
        if (error) {
          console.error('[demo-dispatch-minutes-consumer] consume_demo_minutes failed:', error.message)
          return false
        }
        const dashboardPath =
          dispatch.billed_partner_account_id === DEMO_ADMIN_PARTNER_ACCOUNT_ID
            ? '/dashboard/admin/sales-partners'
            : '/dashboard/channel-partner/settings'
        await checkDemoLowBalanceAndAlert(dispatch.billed_partner_account_id, Number(newBalance), dashboardPath)
        return true
      })

      if (consumed) {
        await step.run('record-consumed', async () => {
          const supabase = createSupabaseAdminClient()
          await supabase.from('demo_dispatches').update({ demo_minutes_consumed: durationMinutes }).eq('id', dispatch.id)
        })
      }
    }

    return { status: 'consumed', durationMinutes }
  }
)
