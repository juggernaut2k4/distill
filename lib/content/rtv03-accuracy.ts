/**
 * RTV-03 — accuracy-report computation for the observe-only position tracker.
 *
 * See requirement-docs/RTV-03-live-position-tracking.md Section 6/7. This
 * module is split into:
 *   1. A pure, side-effect-free computation function (computeRtv03AccuracyReport)
 *      that takes ground-truth mentions + tracker events — BOTH already
 *      expressed as seconds-since-bot_joined — and produces the report shape.
 *      Unit-testable with hand-built fixtures (plain numbers), no DB/network,
 *      no Date parsing inside the function itself.
 *   2. Small DB-facing helpers (getRtv03AuditEvents, decodeTrackerStateAdvanceEvents,
 *      buildGroundTruthMentions) used by inngest/rtv03-accuracy-evaluator.ts,
 *      which perform the one-time ISO-timestamp -> bot_joined-relative-seconds
 *      conversion BEFORE calling into the pure function.
 *
 * Per Section 6.1: a new, narrowly-filtered query rather than the existing
 * getAuditLog() in lib/session-billing.ts (which returns every row for a
 * session and is billing-specific) — this keeps QA/accuracy-report code
 * decoupled from the billing module's contract.
 */

import { createSupabaseAdminClient } from '@/lib/supabase'
import { tokenize } from '@/lib/content/tokenize'
import type { SessionMarkerEntry } from '@/lib/content/session-markers'

// ─── Types ──────────────────────────────────────────────────────────────────

export type Rtv03CorrectionType = 'normal' | 'gap_jump'

/** One row from session_billing_audit_log, filtered to RTV-03-relevant event types. */
export interface Rtv03AuditRow {
  event_type: 'bot_joined' | 'rtv03_state_advance' | 'rtv03_quick_summary_cue' | 'rtv03_next_topic_cue'
  occurred_at: string
  metadata: Record<string, unknown>
}

/**
 * A single tracker state-advance event, already converted to seconds-since-
 * bot_joined (the same time base the transcript's own word timestamps use —
 * Section 4/6.1's "shared time epoch"). This is what makes
 * computeRtv03AccuracyReport a pure function operating entirely on plain
 * numbers, with no Date parsing or epoch logic inside it.
 */
export interface TrackerStateAdvanceEvent {
  fromState: number
  toState: number
  matchedWord: string
  correctionType: Rtv03CorrectionType
  timeS: number
}

/** Ground-truth "first mention" reconstruction for one non-bookend topic. */
export interface GroundTruthTopicMention {
  section_index: number
  subtopic_title: string | null
  /** Seconds from bot_joined (== the transcript's own time base); null if the
   *  topic's marker words never appeared in Clio's transcript speech at all. */
  time_s: number | null
  matched_word: string | null
}

export interface Rtv03PerTopicEntry {
  section_index: number
  subtopic_title: string | null
  ground_truth_first_mention_time_s: number | null
  tracker_detected_time_s: number | null
  delta_seconds: number | null
  matched_word: string | null
  correction_type: Rtv03CorrectionType | null
  note?: string
}

export interface Rtv03AccuracyReport {
  topics_total: number
  topics_matched: number
  max_topics_out_of_sync: number
  self_correction_events: number
  mean_abs_delta_seconds: number | null
  median_abs_delta_seconds: number | null
  max_delta_seconds: number | null
  per_topic: Rtv03PerTopicEntry[]
}

// ─── Pure computation (unit-testable without any DB/network) ───────────────

/**
 * Computes the full accuracy report from ground truth + tracker events. Pure
 * function — no I/O, no Date parsing. `groundTruth` must cover every
 * non-bookend topic (type: 'topic') in the session's marker set, in
 * section_index order. `trackerEvents` may be in any order (sorted here by
 * timeS); both series must already be expressed in the same
 * seconds-since-bot_joined time base by the caller.
 */
export function computeRtv03AccuracyReport(
  groundTruth: GroundTruthTopicMention[],
  trackerEvents: TrackerStateAdvanceEvent[],
): Rtv03AccuracyReport {
  const sortedEvents = [...trackerEvents].sort((a, b) => a.timeS - b.timeS)

  // First (earliest) event that reached each to_state. A well-behaved
  // forward-only tracker only ever reaches a given state once; taking the
  // earliest of any duplicate is the genuine "first detected" instant.
  const firstEventByToState = new Map<number, TrackerStateAdvanceEvent>()
  for (const ev of sortedEvents) {
    if (!firstEventByToState.has(ev.toState)) firstEventByToState.set(ev.toState, ev)
  }

  const perTopic: Rtv03PerTopicEntry[] = groundTruth.map((gt) => {
    const trackerEvent = firstEventByToState.get(gt.section_index)
    const trackerTimeS = trackerEvent ? trackerEvent.timeS : null

    const deltaSeconds =
      gt.time_s !== null && trackerTimeS !== null ? trackerTimeS - gt.time_s : null

    let note: string | undefined
    if (trackerEvent?.correctionType === 'gap_jump') {
      note = `topic ${gt.section_index - 1}'s own golden word was never detected in this session — tracker caught up on topic ${gt.section_index}'s hit`
    } else if (gt.time_s === null) {
      note = 'ground-truth mention not found in the real transcript'
    } else if (!trackerEvent) {
      note = 'tracker never reached this state during the session'
    }

    return {
      section_index: gt.section_index,
      subtopic_title: gt.subtopic_title,
      ground_truth_first_mention_time_s: gt.time_s,
      tracker_detected_time_s: trackerTimeS,
      delta_seconds: deltaSeconds !== null ? Number(deltaSeconds.toFixed(2)) : null,
      matched_word: trackerEvent?.matchedWord ?? gt.matched_word,
      correction_type: trackerEvent?.correctionType ?? null,
      ...(note ? { note } : {}),
    }
  })

  const topicsTotal = groundTruth.length
  const topicsMatched = perTopic.filter((t) => t.tracker_detected_time_s !== null).length
  const selfCorrectionEvents = sortedEvents.filter((e) => e.correctionType === 'gap_jump').length

  const absDeltas = perTopic
    .map((t) => t.delta_seconds)
    .filter((d): d is number => d !== null)
    .map((d) => Math.abs(d))

  const meanAbsDelta = absDeltas.length > 0
    ? Number((absDeltas.reduce((s, d) => s + d, 0) / absDeltas.length).toFixed(2))
    : null
  const medianAbsDelta = absDeltas.length > 0 ? Number(median(absDeltas).toFixed(2)) : null
  const maxAbsDelta = absDeltas.length > 0 ? Number(Math.max(...absDeltas).toFixed(2)) : null

  // ── max_topics_out_of_sync ──────────────────────────────────────────────
  // At each ground-truth topic's own first-mention instant, how many topics
  // was the tracker's own state behind what ground truth says is actually
  // being taught right now? Bounded below at 0 (a tracker "ahead" of ground
  // truth is not "out of sync behind").
  let maxOutOfSync = 0
  for (const gt of groundTruth) {
    if (gt.time_s === null) continue
    const trackerStateAtTime = latestStateAtOrBefore(sortedEvents, gt.time_s)
    const outOfSync = Math.max(0, gt.section_index - trackerStateAtTime)
    if (outOfSync > maxOutOfSync) maxOutOfSync = outOfSync
  }

  return {
    topics_total: topicsTotal,
    topics_matched: topicsMatched,
    max_topics_out_of_sync: maxOutOfSync,
    self_correction_events: selfCorrectionEvents,
    mean_abs_delta_seconds: meanAbsDelta,
    median_abs_delta_seconds: medianAbsDelta,
    max_delta_seconds: maxAbsDelta,
    per_topic: perTopic,
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Tracker's own state at or immediately before a given ground-truth time_s.
 *  rtvStateRef always seeds to 0 (Session Overview — Section 4a), so a
 *  ground-truth instant before the tracker's first-ever event correctly
 *  yields state 0. */
function latestStateAtOrBefore(sortedEvents: TrackerStateAdvanceEvent[], timeS: number): number {
  let state = 0
  for (const ev of sortedEvents) {
    if (ev.timeS <= timeS) {
      state = ev.toState
    } else {
      break
    }
  }
  return state
}

// ─── DB-facing helpers (used by inngest/rtv03-accuracy-evaluator.ts) ────────

/**
 * Fetches this session's bot_joined + rtv03_* audit rows, ordered by
 * occurred_at. A new, narrowly-filtered query — not lib/session-billing.ts's
 * getAuditLog() (billing-specific, returns every row for a session).
 */
export async function getRtv03AuditEvents(sessionId: string): Promise<Rtv03AuditRow[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('session_billing_audit_log')
    .select('event_type, occurred_at, metadata')
    .eq('session_id', sessionId)
    .in('event_type', ['bot_joined', 'rtv03_state_advance', 'rtv03_quick_summary_cue', 'rtv03_next_topic_cue'])
    .order('occurred_at', { ascending: true })

  return (data ?? []) as Rtv03AuditRow[]
}

/** Earliest `bot_joined` row's occurred_at, or null if none exists yet. */
export function extractBotJoinedAt(rows: Rtv03AuditRow[]): string | null {
  const row = rows.find((r) => r.event_type === 'bot_joined')
  return row?.occurred_at ?? null
}

/**
 * Decodes `rtv03_state_advance` rows into TrackerStateAdvanceEvent[], each
 * converted to seconds-since-`botJoinedAtIso` — the shared time epoch (Section
 * 4/6.1) that puts tracker-derived timestamps on the same time base as the
 * transcript's own word timestamps (which are already relative to bot join).
 */
export function decodeTrackerStateAdvanceEvents(
  rows: Rtv03AuditRow[],
  botJoinedAtIso: string,
): TrackerStateAdvanceEvent[] {
  const epochMs = new Date(botJoinedAtIso).getTime()
  return rows
    .filter((r) => r.event_type === 'rtv03_state_advance')
    .map((r) => {
      const m = r.metadata as {
        from_state?: number
        to_state?: number
        matched_word?: string
        correction_type?: string
      }
      return {
        fromState: typeof m.from_state === 'number' ? m.from_state : 0,
        toState: typeof m.to_state === 'number' ? m.to_state : 0,
        matchedWord: typeof m.matched_word === 'string' ? m.matched_word : '',
        correctionType: m.correction_type === 'gap_jump' ? 'gap_jump' : 'normal',
        timeS: (new Date(r.occurred_at).getTime() - epochMs) / 1000,
      } satisfies TrackerStateAdvanceEvent
    })
}

/** Minimal transcript utterance shape needed for ground-truth reconstruction. */
export interface ClioUtteranceForGroundTruth {
  text: string
  /** Seconds from the transcript's own time base (== Recall's `start_time`,
   *  which is itself relative to bot join — no separate epoch conversion
   *  needed for the transcript side; see Section 4/6.1). */
  start_time_s: number
}

/**
 * Scans Clio's transcript utterances (time-ordered) for each non-bookend
 * topic's first golden-word mention, using the EXACT SAME tokenize()
 * function the live tracker uses (Section 4a) — so ground-truth matching
 * semantics are identical to live-matching semantics. Utterance-level
 * granularity, matching the live tracker's own limitation (Section 4a: "no
 * cross-utterance buffering").
 */
export function buildGroundTruthMentions(
  topics: SessionMarkerEntry[],
  clioUtterances: ClioUtteranceForGroundTruth[],
): GroundTruthTopicMention[] {
  const nonBookendTopics = topics
    .filter((t) => !t.is_bookend)
    .sort((a, b) => a.section_index - b.section_index)

  const sortedUtterances = [...clioUtterances].sort((a, b) => a.start_time_s - b.start_time_s)

  return nonBookendTopics.map((topic) => {
    for (const utt of sortedUtterances) {
      const tokens = new Set(tokenize(utt.text))
      const hit = topic.markers.find((m) => tokens.has(m.word))
      if (hit) {
        return {
          section_index: topic.section_index,
          subtopic_title: topic.subtopic_title ?? null,
          time_s: utt.start_time_s,
          matched_word: hit.word,
        }
      }
    }
    return {
      section_index: topic.section_index,
      subtopic_title: topic.subtopic_title ?? null,
      time_s: null,
      matched_word: null,
    }
  })
}
