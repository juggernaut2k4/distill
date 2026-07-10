/**
 * RTV-03 — accuracy-report evaluator for the observe-only position tracker.
 *
 * A sibling Inngest function to session-quality-evaluator.ts (FB-008), on the
 * identical cron/window, deliberately kept SEPARATE rather than folded into
 * that function's body — per requirement-docs/RTV-03-live-position-tracking.md
 * Section 6.3: "a sibling function is slightly safer since it cannot regress
 * FB-008's own quality-scoring logic even if RTV-03's step throws." Reuses
 * FB-008's exact transcript-fetch and Clio-speaker-identification logic
 * (fetchRecallTranscript / identifyClioSpeaker), never duplicates it.
 *
 * For every completed session with rtv03_tracking_enabled = true that hasn't
 * already been evaluated, this reconstructs ground-truth "first mention" times
 * per topic from the real Recall.ai transcript, aligns them against the
 * tracker's own logged rtv03_state_advance audit events (using bot_joined as
 * the shared time epoch), and upserts one row into rtv03_accuracy_reports.
 */

import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { fetchRecallTranscript, identifyClioSpeaker } from './session-quality-evaluator'
import {
  getRtv03AuditEvents,
  extractBotJoinedAt,
  decodeTrackerStateAdvanceEvents,
  buildGroundTruthMentions,
  computeRtv03AccuracyReport,
} from '@/lib/content/rtv03-accuracy'
import type { SessionMarkers, SessionMarkerEntry } from '@/lib/content/session-markers'

interface Rtv03SessionRow {
  id: string
  recall_bot_id: string | null
  session_markers: SessionMarkers | null
}

type StepFn = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> }

// ─── Per-session evaluation ────────────────────────────────────────────────

/**
 * Writes an error-state report: per_topic stays [] and every numeric field
 * that would otherwise represent a real measurement is null/0 — never a
 * fabricated delta (Section 8: "the report is written with
 * transcript_fetch_error populated and per_topic: [] rather than silently
 * fabricating zero deltas").
 */
async function upsertErrorReport(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  sessionId: string,
  topics: SessionMarkerEntry[],
  errorReason: string,
): Promise<void> {
  const topicsTotal = topics.filter((t) => !t.is_bookend).length
  const { error } = await supabase.from('rtv03_accuracy_reports').upsert(
    {
      session_id: sessionId,
      topics_total: topicsTotal,
      topics_matched: 0,
      max_topics_out_of_sync: 0,
      self_correction_events: 0,
      mean_abs_delta_seconds: null,
      median_abs_delta_seconds: null,
      max_delta_seconds: null,
      per_topic: [],
      transcript_fetch_error: errorReason,
    },
    { onConflict: 'session_id' },
  )
  if (error) {
    console.error(`[rtv03-accuracy-evaluator] Failed to upsert error report for session ${sessionId}:`, error.message)
  }
}

async function evaluateRtv03Session(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  session: Rtv03SessionRow,
  recallApiKey: string,
): Promise<void> {
  const topics = session.session_markers?.topics ?? []

  // ── Reuse FB-008's exact transcript fetch — 404 re-throws so Inngest
  // retries this step (Section 8), other failures return a transcriptError
  // string rather than throwing.
  const { utterances, transcriptError } = await fetchRecallTranscript(session.id, session.recall_bot_id, recallApiKey)

  if (transcriptError) {
    await upsertErrorReport(supabase, session.id, topics, transcriptError)
    return
  }

  // ── Reuse FB-008's exact Clio-speaker heuristic ───────────────────────────
  const { clioUtterances } = identifyClioSpeaker(utterances)
  if (clioUtterances.length === 0) {
    await upsertErrorReport(supabase, session.id, topics, 'no_clio_speech_detected')
    return
  }

  // ── Shared time epoch (Section 4/6.1) ────────────────────────────────────
  const auditRows = await getRtv03AuditEvents(session.id)
  const botJoinedAt = extractBotJoinedAt(auditRows)
  if (!botJoinedAt) {
    await upsertErrorReport(supabase, session.id, topics, 'no_bot_joined_event')
    return
  }

  const trackerEvents = decodeTrackerStateAdvanceEvents(auditRows, botJoinedAt)

  const clioUtterancesForGroundTruth = clioUtterances.map((u) => ({
    text: u.words.map((w) => w.text).join(' '),
    start_time_s: u.words[0]?.start_time ?? 0,
  }))
  const groundTruth = buildGroundTruthMentions(topics, clioUtterancesForGroundTruth)

  const report = computeRtv03AccuracyReport(groundTruth, trackerEvents)

  const { error } = await supabase.from('rtv03_accuracy_reports').upsert(
    {
      session_id: session.id,
      topics_total: report.topics_total,
      topics_matched: report.topics_matched,
      max_topics_out_of_sync: report.max_topics_out_of_sync,
      self_correction_events: report.self_correction_events,
      mean_abs_delta_seconds: report.mean_abs_delta_seconds,
      median_abs_delta_seconds: report.median_abs_delta_seconds,
      max_delta_seconds: report.max_delta_seconds,
      per_topic: report.per_topic,
      transcript_fetch_error: null,
    },
    { onConflict: 'session_id' },
  )

  if (error) {
    console.error(`[rtv03-accuracy-evaluator] Failed to upsert report for session ${session.id}:`, error.message)
    return
  }

  console.log(
    `[rtv03-accuracy-evaluator] Session ${session.id} evaluated: ` +
    `${report.topics_matched}/${report.topics_total} topics matched, ` +
    `${report.self_correction_events} self-corrections, ` +
    `max_topics_out_of_sync=${report.max_topics_out_of_sync}`,
  )
}

// ─── Inngest cron function ─────────────────────────────────────────────────

export const rtv03AccuracyEvaluator = inngest.createFunction(
  {
    id: 'rtv03-accuracy-evaluator',
    retries: 3,
    triggers: [{ cron: '*/15 * * * *' }],
  },
  async ({ step }: { step: StepFn }) => {
    const recallApiKey = process.env.RECALL_API_KEY ?? ''
    if (!recallApiKey || recallApiKey.startsWith('PLACEHOLDER_')) {
      console.warn('[rtv03-accuracy-evaluator] RECALL_API_KEY not set — skipping transcript fetch')
    }

    const supabase = createSupabaseAdminClient()

    // Same 2–2.25h post-session-end window as FB-008 (session-quality-evaluator.ts).
    const sessions = await step.run('find-rtv03-sessions-to-evaluate', async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, recall_bot_id, session_markers')
        .eq('status', 'completed')
        .eq('rtv03_tracking_enabled', true)
        .gte('ended_at', new Date(Date.now() - 2 * 60 * 60 * 1000 - 15 * 60 * 1000).toISOString())
        .lt('ended_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())

      if (error) {
        console.error('[rtv03-accuracy-evaluator] Failed to fetch sessions:', error.message)
        return [] as Rtv03SessionRow[]
      }

      const rows = (data ?? []) as Rtv03SessionRow[]
      if (rows.length === 0) return []

      // Idempotency: skip sessions that already have a report row, so this
      // doesn't re-fetch the Recall transcript every 15 minutes forever.
      const ids = rows.map((r) => r.id)
      const { data: existingReports } = await supabase
        .from('rtv03_accuracy_reports')
        .select('session_id')
        .in('session_id', ids)
      const alreadyEvaluated = new Set((existingReports ?? []).map((r) => r.session_id as string))

      return rows.filter((r) => !alreadyEvaluated.has(r.id))
    })

    console.log(`[rtv03-accuracy-evaluator] Sessions to evaluate: ${sessions.length}`)

    for (const session of sessions) {
      await step.run(`evaluate-rtv03-${session.id}`, async () => {
        await evaluateRtv03Session(supabase, session, recallApiKey)
      })
    }

    return { evaluated: sessions.length }
  },
)
