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
 * PAUSED — Arun's direct instruction, 2026-07-17: "now lets not delete the glitches we can
 * maintain for tracking. we can decide wipe it later sometime in the future. for now no need to
 * delete the glitch." This supersedes Q1 (Requirement Doc Section 6.4 / Section 11) — rather than
 * the narrower "exempt only actively-tracked issues" resolution, the decision is to purge nothing
 * at all for now. The function stays registered and the RPC/schema are untouched so this is a
 * one-line reversal (delete the early return below) once Arun decides on a retention window.
 * `partner_session_insights.glitches` purge (migration 078, unrelated job) is untouched by this
 * pause — separate policy, also covers action items/psychology, not in scope of this instruction.
 */

const PURGE_WINDOW_DAYS = 30
const PURGE_PAUSED = true // Arun, 2026-07-17 — see comment above. Flip to false to resume.

export const glitchInstancesPurge = inngest.createFunction(
  {
    id: 'glitch-instances-purge',
    name: 'Glitch Instances — 30-Day Full-Detail Purge (PAUSED)',
    retries: 3,
    triggers: [{ cron: '0 3 * * *' }],
  },
  async ({ step }) => {
    if (PURGE_PAUSED) {
      console.log('[glitch-instances-purge] Paused per Arun 2026-07-17 — no rows purged this run.')
      return { purged: 0, paused: true }
    }

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
