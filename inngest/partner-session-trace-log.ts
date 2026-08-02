import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-38 — finalizes a partner_session_trace_logs row the instant its session ends. Listens on the
 * SAME clio/partner-session.ended event B2B-37 established (3 emit call sites, already reliable,
 * already live) — purely additive, no changes to any of those 3 call sites. Inngest supports
 * multiple functions subscribed to one event natively; this is a second listener, not a
 * modification of partnerSessionInsightsExtractor's own listener.
 *
 * Per docs/specs/B2B-38-requirement-document.md §6.7.
 */
export const partnerSessionTraceLogFinalizer = inngest.createFunction(
  {
    id: 'partner-session-trace-log-finalizer',
    name: 'Finalize Partner Session Trace Log',
    retries: 3,
    triggers: [{ event: 'clio/partner-session.ended' }],
  },
  async ({ event, step }) => {
    const { partnerSessionId } = event.data as { partnerSessionId?: string }
    if (!partnerSessionId) return { status: 'skipped', reason: 'missing_partner_session_id' }

    await step.run('finalize-trace-log', async () => {
      // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project (root cause doc
      // comment in app/api/demo/[slug]/performance/route.ts); replaced with array fetch + [0].
      const supabase = createSupabaseAdminClient()
      const { data: sessionRows, error } = await supabase
        .from('partner_sessions')
        .select('created_at, ended_at, hume_config_id')
        .eq('id', partnerSessionId)
        .limit(1)

      const session = sessionRows?.[0] ?? null

      if (error || !session) {
        console.error(`[partner-session-trace-log] Could not read partner_sessions ${partnerSessionId}:`, error?.message)
        return
      }

      const endedAt = (session.ended_at as string | null) ?? new Date().toISOString()
      const durationSeconds = Math.max(
        0,
        Math.round((new Date(endedAt).getTime() - new Date(session.created_at as string).getTime()) / 1000)
      )

      const { error: updateError } = await supabase
        .from('partner_session_trace_logs')
        .update({ ended_at: endedAt, duration_seconds: durationSeconds, hume_config_id: session.hume_config_id })
        .eq('clio_session_ref', partnerSessionId)

      if (updateError) {
        console.error(`[partner-session-trace-log] Failed to finalize ${partnerSessionId}:`, updateError.message)
      }
    })

    return { status: 'finalized' }
  }
)

/**
 * B2B-38 — 60-day full-row retention purge. Open Item 4, resolved as recommended: FULL DELETE, not
 * redact-in-place. Mirrors partnerSessionInsightsPurge's exact shape
 * (inngest/partner-session-insights-extractor.ts) — same cron, same retries, same RPC-with-cutoff
 * pattern — deliberately NOT glitchInstancesPurge/partnerSessionInsightsPurge's own redact-in-place
 * behavior, because (a) this table has no free-text transcript/glitch detail to selectively strip
 * while preserving structured fields for historical reporting — every column here IS the structured
 * metadata those two jobs preserve — and (b) Arun's own word was "auto-delete," which those two
 * jobs' redact-in-place behavior does not literally do. Cutoff basis: created_at (session-creation
 * time), not ended_at — a session that never reaches a terminal status has a null ended_at forever
 * and would never be purged if the cutoff were ended_at-based.
 *
 * Per docs/specs/B2B-38-requirement-document.md §6.7.
 */
const TRACE_LOG_RETENTION_DAYS = 60

export const partnerSessionTraceLogPurge = inngest.createFunction(
  {
    id: 'partner-session-trace-log-purge',
    name: 'Partner Session Trace Logs — 60-Day Purge',
    retries: 3,
    triggers: [{ cron: '0 3 * * *' }],
  },
  async ({ step }) => {
    const purged = await step.run('purge-expired-trace-logs', async () => {
      const supabase = createSupabaseAdminClient()
      const cutoffIso = new Date(Date.now() - TRACE_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase.rpc('purge_partner_session_trace_logs', { p_cutoff: cutoffIso })
      if (error) throw new Error(`Trace log purge RPC failed: ${error.message}`)
      return (data as number) ?? 0
    })
    console.log(`[partner-session-trace-log-purge] Deleted ${purged} row(s)`)
    return { purged }
  }
)
