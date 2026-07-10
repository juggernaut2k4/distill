import { describe, it, expect } from 'vitest'
import {
  computeRtv03AccuracyReport,
  buildGroundTruthMentions,
  decodeTrackerStateAdvanceEvents,
  extractBotJoinedAt,
  type GroundTruthTopicMention,
  type TrackerStateAdvanceEvent,
  type Rtv03AuditRow,
} from '@/lib/content/rtv03-accuracy'
import type { SessionMarkerEntry } from '@/lib/content/session-markers'

/**
 * RTV-03 — coverage for the accuracy-report computation logic per requirement
 * doc Section 6/7 (mocked transcript + mocked audit log rows -> correct
 * deltas). The real Inngest cron run (inngest/rtv03-accuracy-evaluator.ts)
 * against a live Recall.ai transcript is a manual/QA acceptance test per the
 * spec's own framing — not simulated here.
 */

describe('computeRtv03AccuracyReport — pure computation', () => {
  it('computes correct deltas for a normal (non-gap_jump) match', () => {
    const groundTruth: GroundTruthTopicMention[] = [
      { section_index: 1, subtopic_title: 'What Generative AI Is', time_s: 38.4, matched_word: 'transformer' },
    ]
    const trackerEvents: TrackerStateAdvanceEvent[] = [
      { fromState: 0, toState: 1, matchedWord: 'transformer', correctionType: 'normal', timeS: 41.1 },
    ]

    const report = computeRtv03AccuracyReport(groundTruth, trackerEvents)

    expect(report.topics_total).toBe(1)
    expect(report.topics_matched).toBe(1)
    expect(report.self_correction_events).toBe(0)
    expect(report.per_topic[0]).toMatchObject({
      section_index: 1,
      ground_truth_first_mention_time_s: 38.4,
      tracker_detected_time_s: 41.1,
      delta_seconds: 2.7,
      matched_word: 'transformer',
      correction_type: 'normal',
    })
    expect(report.per_topic[0].note).toBeUndefined()
    expect(report.mean_abs_delta_seconds).toBe(2.7)
    expect(report.max_delta_seconds).toBe(2.7)
  })

  it('computes a gap_jump entry with the disclosed note, per the wireframe example', () => {
    const groundTruth: GroundTruthTopicMention[] = [
      { section_index: 1, subtopic_title: 'What Generative AI Is', time_s: null, matched_word: null },
      { section_index: 2, subtopic_title: 'The Foundation Model Landscape', time_s: 190.0, matched_word: 'gemini' },
    ]
    const trackerEvents: TrackerStateAdvanceEvent[] = [
      { fromState: 0, toState: 2, matchedWord: 'gemini', correctionType: 'gap_jump', timeS: 231.5 },
    ]

    const report = computeRtv03AccuracyReport(groundTruth, trackerEvents)

    expect(report.topics_total).toBe(2)
    expect(report.topics_matched).toBe(1) // topic 1 never reached (ground truth null AND no tracker event to state 1)
    expect(report.self_correction_events).toBe(1)

    const topic1 = report.per_topic.find((t) => t.section_index === 1)!
    expect(topic1.ground_truth_first_mention_time_s).toBeNull()
    expect(topic1.tracker_detected_time_s).toBeNull()
    expect(topic1.note).toMatch(/ground-truth mention not found/)

    const topic2 = report.per_topic.find((t) => t.section_index === 2)!
    expect(topic2.correction_type).toBe('gap_jump')
    expect(topic2.delta_seconds).toBe(41.5)
    expect(topic2.note).toMatch(/tracker caught up on topic 2/)
  })

  it('max_topics_out_of_sync reflects the bounded 1-topic lag guaranteed by gap_jump', () => {
    // Ground truth: topic 1 at 100s (tracker never reaches it directly),
    // topic 2 at 190s. Tracker reaches state 1 late via a normal advance at
    // 120s (word said late), then gap_jumps to state 2 at 231.5s.
    const groundTruth: GroundTruthTopicMention[] = [
      { section_index: 1, subtopic_title: 'Topic 1', time_s: 100, matched_word: 'w1' },
      { section_index: 2, subtopic_title: 'Topic 2', time_s: 190, matched_word: 'w2' },
    ]
    const trackerEvents: TrackerStateAdvanceEvent[] = [
      { fromState: 0, toState: 1, matchedWord: 'w1', correctionType: 'normal', timeS: 120 },
      { fromState: 1, toState: 2, matchedWord: 'w2', correctionType: 'normal', timeS: 191 },
    ]

    const report = computeRtv03AccuracyReport(groundTruth, trackerEvents)
    // At t=100 (topic 1 ground truth start), tracker is still at state 0 (its
    // state-1 event hasn't landed yet at t=120) -> out of sync by 1.
    // At t=190 (topic 2 ground truth start), tracker is at state 1 (state-2
    // event lands at 191, after 190) -> out of sync by 1.
    expect(report.max_topics_out_of_sync).toBe(1)
  })

  it('mean/median/max are computed only over topics with a real delta (never fabricated for missing data)', () => {
    const groundTruth: GroundTruthTopicMention[] = [
      { section_index: 1, subtopic_title: 'Topic 1', time_s: 10, matched_word: 'w1' },
      { section_index: 2, subtopic_title: 'Topic 2', time_s: 20, matched_word: 'w2' },
      { section_index: 3, subtopic_title: 'Topic 3', time_s: null, matched_word: null },
    ]
    const trackerEvents: TrackerStateAdvanceEvent[] = [
      { fromState: 0, toState: 1, matchedWord: 'w1', correctionType: 'normal', timeS: 12 }, // delta 2
      { fromState: 1, toState: 2, matchedWord: 'w2', correctionType: 'normal', timeS: 26 }, // delta 6
    ]

    const report = computeRtv03AccuracyReport(groundTruth, trackerEvents)
    expect(report.mean_abs_delta_seconds).toBe(4) // (2 + 6) / 2
    expect(report.median_abs_delta_seconds).toBe(4)
    expect(report.max_delta_seconds).toBe(6)
    expect(report.topics_matched).toBe(2)
    expect(report.topics_total).toBe(3)
  })

  it('returns all-null aggregate fields (not zero-fabricated) when there is no tracker data at all', () => {
    const groundTruth: GroundTruthTopicMention[] = [
      { section_index: 1, subtopic_title: 'Topic 1', time_s: 10, matched_word: 'w1' },
    ]
    const report = computeRtv03AccuracyReport(groundTruth, [])
    expect(report.topics_matched).toBe(0)
    expect(report.mean_abs_delta_seconds).toBeNull()
    expect(report.median_abs_delta_seconds).toBeNull()
    expect(report.max_delta_seconds).toBeNull()
    expect(report.max_topics_out_of_sync).toBe(1) // tracker never left state 0
  })
})

describe('buildGroundTruthMentions', () => {
  const topics: SessionMarkerEntry[] = [
    { section_index: 0, type: 'SessionOverview', subtopic_slug: null, is_bookend: true, golden_word: 'overview', markers: [{ word: 'overview', literal: true }] },
    { section_index: 1, type: 'topic', subtopic_slug: 'genai-basics', subtopic_title: 'What Generative AI Is', is_bookend: false, golden_word: 'transformer', markers: [{ word: 'transformer', within_topic_freq: 1, rank: 1 }] },
    { section_index: 2, type: 'SessionSummary', subtopic_slug: null, is_bookend: true, golden_word: 'summary', markers: [{ word: 'summary', literal: true }] },
  ]

  it('finds the first chronological utterance mentioning each non-bookend topic\'s marker, excluding bookends', () => {
    const utterances = [
      { text: 'Welcome, let\'s get started today.', start_time_s: 0 },
      { text: 'A transformer processes tokens in parallel.', start_time_s: 38.4 },
      { text: 'Transformers are everywhere now.', start_time_s: 90 },
    ]
    const result = buildGroundTruthMentions(topics, utterances)
    expect(result).toHaveLength(1) // only the one non-bookend topic
    expect(result[0]).toMatchObject({ section_index: 1, time_s: 38.4, matched_word: 'transformer' })
  })

  it('returns time_s: null for a topic whose golden word never appears in the transcript', () => {
    const utterances = [{ text: 'Nothing relevant here.', start_time_s: 0 }]
    const result = buildGroundTruthMentions(topics, utterances)
    expect(result[0].time_s).toBeNull()
    expect(result[0].matched_word).toBeNull()
  })
})

describe('decodeTrackerStateAdvanceEvents / extractBotJoinedAt', () => {
  it('converts occurred_at ISO timestamps to seconds-since-bot_joined', () => {
    const rows: Rtv03AuditRow[] = [
      { event_type: 'bot_joined', occurred_at: '2026-07-10T09:00:00.000Z', metadata: {} },
      {
        event_type: 'rtv03_state_advance',
        occurred_at: '2026-07-10T09:00:41.100Z',
        metadata: { from_state: 0, to_state: 1, matched_word: 'transformer', correction_type: 'normal' },
      },
    ]
    const botJoinedAt = extractBotJoinedAt(rows)
    expect(botJoinedAt).toBe('2026-07-10T09:00:00.000Z')

    const events = decodeTrackerStateAdvanceEvents(rows, botJoinedAt!)
    expect(events).toHaveLength(1)
    expect(events[0].timeS).toBeCloseTo(41.1, 5)
    expect(events[0].correctionType).toBe('normal')
    expect(events[0].toState).toBe(1)
  })

  it('returns null when no bot_joined row exists', () => {
    const rows: Rtv03AuditRow[] = [
      { event_type: 'rtv03_state_advance', occurred_at: '2026-07-10T09:00:41.100Z', metadata: {} },
    ]
    expect(extractBotJoinedAt(rows)).toBeNull()
  })
})
