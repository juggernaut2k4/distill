/**
 * RTV-03 — Live position-tracking state machine (observe-only).
 *
 * HARD SCOPE BOUNDARY: this module is OBSERVE-ONLY. It must never reference
 * the display-poll write endpoint, the screen serialization queue, or write
 * to either display-side position ref (the visible-sections list ref or the
 * current-section-index ref) — see requirement-docs/
 * RTV-03-live-position-tracking.md Section 4b (Question 4). This is a
 * grep-checkable, one-line CI assertion any reviewer can run against this
 * file's literal source (deliberately not spelled out token-for-token in this
 * comment, so the check itself stays a true zero-match grep rather than
 * matching its own documentation): see tests/unit/rtv03-tracker.test.ts for
 * the automated version, which asserts on the exact forbidden identifiers.
 *
 * Isolated, new module mirroring the existing LIVE-01 convention already
 * established by lib/content/live-conductor-client.ts: it holds no shared
 * state with WalkthroughClient.tsx's display-side refs, and is only ever
 * invoked from a well-defined point in that file's onMessage handler. All
 * state (rtvStateRef, rtvTopicsRef) lives in WalkthroughClient.tsx itself —
 * this module is a pure, side-effect-free state machine + metadata builder,
 * intentionally testable without mocking fetch/DOM/refs.
 *
 * Depth-2 lookahead design (Section 4a): a hit on `current+1`'s markers
 * advances the state by 1 (`correction_type: 'normal'`, `lookahead_depth: 1`).
 * A hit on `current+2`'s markers, with `current+1` never having been hit,
 * advances directly to `current+2` (`correction_type: 'gap_jump'`,
 * `lookahead_depth: 2`). Depth 3+ and any state <= current are structurally
 * never checked — there is no code path here that reads `topics[current+3]`
 * or below `current` — which is what makes "never more than one topic out of
 * sync" and "never jumps backward" true by construction, not by a runtime
 * guard. Same-utterance double-match (both current+1 and current+2 match in
 * one text string) resolves to depth-1 priority, since depth-1 is evaluated
 * and returned before depth-2 is ever checked (Section 9 edge case).
 */

import { tokenize } from '@/lib/content/tokenize'
import type { SessionMarkerEntry } from '@/lib/content/session-markers'

export type Rtv03CorrectionType = 'normal' | 'gap_jump'
export type Rtv03LookaheadDepth = 1 | 2

export interface Rtv03Hit {
  fromState: number
  toState: number
  matchedWord: string
  lookaheadDepth: Rtv03LookaheadDepth
  correctionType: Rtv03CorrectionType
  subtopicSlug: string | null
}

/**
 * Finds the SessionMarkerEntry for a given section_index, or undefined if the
 * session has no state at that index (e.g. currentState is already the last
 * state, N+1 — there is no current+1/current+2 to check, so the tracker
 * simply never advances again for the rest of the session).
 */
function findEntry(topics: SessionMarkerEntry[], sectionIndex: number): SessionMarkerEntry | undefined {
  return topics.find((t) => t.section_index === sectionIndex)
}

/**
 * Returns the first marker word (in the entry's existing rank order — index 0
 * is the highest within-topic-frequency golden word per RTV-02's scoring) that
 * appears in the given token set, or null if none match.
 */
function firstMatchingMarkerWord(entry: SessionMarkerEntry | undefined, tokens: Set<string>): string | null {
  if (!entry) return null
  for (const marker of entry.markers) {
    if (tokens.has(marker.word)) return marker.word
  }
  return null
}

/**
 * Runs one depth-2 lookahead check for a single utterance against the session's
 * marker set, per requirement doc Section 4a.
 *
 * @param currentState - rtvStateRef.current at the time this utterance arrived.
 * @param topics - the session's full SessionMarkerEntry[] (rtvTopicsRef.current).
 * @param text - the raw AI utterance text (onMessage's `text` param).
 * @returns a Rtv03Hit describing the qualifying transition, or null if neither
 *   current+1 nor current+2 matched in this utterance.
 */
export function checkRtv03Transition(
  currentState: number,
  topics: SessionMarkerEntry[],
  text: string
): Rtv03Hit | null {
  const tokens = new Set(tokenize(text))
  if (tokens.size === 0) return null

  // Depth-1 is evaluated FIRST and returned immediately if it matches — this is
  // what makes same-utterance double-match resolve to depth-1 priority (Section 9).
  const depth1Entry = findEntry(topics, currentState + 1)
  const depth1Word = firstMatchingMarkerWord(depth1Entry, tokens)
  if (depth1Word !== null) {
    return {
      fromState: currentState,
      toState: currentState + 1,
      matchedWord: depth1Word,
      lookaheadDepth: 1,
      correctionType: 'normal',
      subtopicSlug: depth1Entry!.subtopic_slug,
    }
  }

  // Depth-2 is only ever checked once depth-1 has already failed to match in
  // this utterance — never any deeper, never any state <= currentState.
  const depth2Entry = findEntry(topics, currentState + 2)
  const depth2Word = firstMatchingMarkerWord(depth2Entry, tokens)
  if (depth2Word !== null) {
    return {
      fromState: currentState,
      toState: currentState + 2,
      matchedWord: depth2Word,
      lookaheadDepth: 2,
      correctionType: 'gap_jump',
      subtopicSlug: depth2Entry!.subtopic_slug,
    }
  }

  return null
}

/**
 * Builds the three audit-event metadata payloads for a qualifying hit, per
 * requirement doc Section 6.2 / Question 2. All three are logged off the same
 * single detection signal in this phase — `rtv03_quick_summary_cue` is
 * explicitly flagged `same_signal_as_next_topic_cue: true` so this known,
 * disclosed limitation is visible in the data itself, not hidden.
 */
export function buildRtv03AuditMetadata(hit: Rtv03Hit): {
  stateAdvance: Record<string, unknown>
  quickSummaryCue: Record<string, unknown>
  nextTopicCue: Record<string, unknown>
} {
  return {
    stateAdvance: {
      from_state: hit.fromState,
      to_state: hit.toState,
      matched_word: hit.matchedWord,
      lookahead_depth: hit.lookaheadDepth,
      correction_type: hit.correctionType,
      subtopic_slug: hit.subtopicSlug,
    },
    quickSummaryCue: {
      state: hit.toState,
      matched_word: hit.matchedWord,
      same_signal_as_next_topic_cue: true,
    },
    nextTopicCue: {
      from_state: hit.fromState,
      to_state: hit.toState,
      matched_word: hit.matchedWord,
    },
  }
}
