import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-78 (docs/specs/B2B-78-requirement-document.md §6.5) — marks abandoned `bot_dispatch_reservations`
 * expired. Runs every 5 minutes (tighter than a daily job, matching the reservation window's own
 * short 15-minute timescale) so an abandoned reservation is promptly marked `expired` rather than
 * sitting in a stale `reserved` state for up to a day. Mirrors `inngest/partner-session-trace-log.ts`'s
 * own cron-purge structure — same retries, same RPC-with-cutoff pattern.
 *
 * Rows are never deleted here — kept as `expired` for diagnostic visibility (this codebase's general
 * soft-invalidation convention). A separate, much slower full-row purge (60-day retention, mirroring
 * `partner_session_trace_logs`' own precedent) is pure storage hygiene, not built in this same
 * function since it runs on a wholly different cadence — see the second function below.
 */
export const botDispatchReservationCleanup = inngest.createFunction(
  {
    id: 'bot-dispatch-reservation-cleanup',
    name: 'Bot Dispatch Reservations — Expiry Sweep',
    retries: 3,
    triggers: [{ cron: '*/5 * * * *' }],
  },
  async ({ step }) => {
    const expiredCount = await step.run('expire-reservations', async () => {
      const supabase = createSupabaseAdminClient()
      const { data, error } = await supabase.rpc('expire_bot_dispatch_reservations', { p_cutoff: new Date().toISOString() })
      if (error) throw new Error(`Reservation expiry RPC failed: ${error.message}`)
      return (data as number) ?? 0
    })
    console.log(`[bot-dispatch-reservation-cleanup] Expired ${expiredCount} reservation(s)`)
    return { expired: expiredCount }
  }
)

const RESERVATION_ROW_RETENTION_DAYS = 60

export const botDispatchReservationPurge = inngest.createFunction(
  {
    id: 'bot-dispatch-reservation-purge',
    name: 'Bot Dispatch Reservations — 60-Day Purge',
    retries: 3,
    triggers: [{ cron: '0 3 * * *' }],
  },
  async ({ step }) => {
    const purged = await step.run('purge-old-reservations', async () => {
      const supabase = createSupabaseAdminClient()
      const cutoffIso = new Date(Date.now() - RESERVATION_ROW_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase.rpc('purge_bot_dispatch_reservations', { p_cutoff: cutoffIso })
      if (error) throw new Error(`Reservation purge RPC failed: ${error.message}`)
      return (data as number) ?? 0
    })
    console.log(`[bot-dispatch-reservation-purge] Deleted ${purged} row(s)`)
    return { purged }
  }
)
