import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-17 — Glitch Log → Internal Issue Tracker.
 *
 * Companion daily purge for `glitch_instances` descriptions, on the SAME 30-day clock and SAME
 * 03:00 UTC schedule as the existing `partnerSessionInsightsPurge` job (which purges the JSONB
 * `partner_session_insights.glitches`, migration 078).
 *
 * WHY A SEPARATE FUNCTION (and not a step added to partnerSessionInsightsPurge):
 * `partnerSessionInsightsPurge` lives inside `inngest/partner-session-insights-extractor.ts`, which
 * B2B-17's hard no-regression invariant requires to remain byte-for-byte unchanged (Requirement Doc
 * Acceptance Test 11 greps/diffs that exact file for zero source change). Adding a `step.run` there
 * would break that invariant. This sibling function achieves the identical functional outcome —
 * glitch_instances descriptions purged on the 30-day clock — with zero diff to the capture pipeline.
 *
 * The purge policy itself (whether instances attached to an OPEN/INVESTIGATING issue are exempted
 * from the 30-day purge) is decided inside the `purge_glitch_instances_full_detail` RPC and is gated
 * behind a one-line boolean pending Arun's Q1 ratification — see migration 082 and Requirement Doc
 * Section 6.4 / Section 11 Q1. This job simply calls the RPC; it carries no policy of its own.
 */

const PURGE_WINDOW_DAYS = 30

export const glitchInstancesPurge = inngest.createFunction(
  {
    id: 'glitch-instances-purge',
    name: 'Glitch Instances — 30-Day Full-Detail Purge',
    retries: 3,
    triggers: [{ cron: '0 3 * * *' }],
  },
  async ({ step }) => {
    const purged = await step.run('purge-expired-glitch-instance-detail', async () => {
      const supabase = createSupabaseAdminClient()
      const cutoffIso = new Date(Date.now() - PURGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase.rpc('purge_glitch_instances_full_detail', { p_cutoff: cutoffIso })
      if (error) throw new Error(`Glitch instances purge RPC failed: ${error.message}`)
      return (data as number) ?? 0
    })
    console.log(`[glitch-instances-purge] Purged description from ${purged} glitch instance row(s)`)
    return { purged }
  }
)
