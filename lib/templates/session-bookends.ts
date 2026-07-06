/**
 * SCREEN-01 — builds the SessionOverview / SessionSummary bookend sections and
 * wraps a real-subtopics-only sections array into the full N+2 contract used by
 * `walkthrough_state.sections`. Single source of truth so every pipeline that
 * assembles `sections` (session-meeting-setup.ts, app/api/recall/bot/route.ts)
 * produces byte-for-byte the same Overview/Summary shape and fixed copy — see
 * docs/specs/SCREEN-01-requirement-document.md Section 6 / Decisions C & D.
 *
 * NOT run through selectTemplate() — Overview/Summary are constructed directly
 * with a fixed type, never keyword/LLM-selected.
 */

import type { TemplateMeta, TemplateSection } from './types'

export interface SessionSectionLike {
  id: string
  meta: TemplateMeta
}

const OVERVIEW_FRAMING_LINE = "Let's dive in."
const SUMMARY_CLOSING_LINE = 'Nice work today.'

/**
 * Wraps N real-subtopic sections into the full N+2 array:
 *   [0]        SessionOverview
 *   [1..N]     the N real subtopics, unchanged content, shifted position only
 *   [N+1]      SessionSummary
 *
 * @param realSections   Real subtopic sections, in teaching order (length N, was 0..N-1)
 * @param sessionTitle   Session title, shared by both bookend screens
 * @param skippedTopics  Subtopic titles marked skipped via the existing skippedTopics mechanism
 */
export function wrapSectionsWithBookends<T extends TemplateSection>(
  realSections: T[],
  sessionTitle: string,
  skippedTopics: string[] = []
): TemplateSection[] {
  if (realSections.length === 0) {
    // Defensive minimum per Section 8: still render Overview/Summary with empty lists
    // rather than crashing, even in the zero-real-subtopics edge case.
    const emptyMeta: TemplateMeta = { subtopicTitle: 'Session Overview', sessionTitle, userRole: '', userIndustry: '' }
    const overview: TemplateSection = {
      id: 'session-overview',
      type: 'SessionOverview',
      meta: emptyMeta,
      data: { session_title: sessionTitle, agenda: [], framing_line: OVERVIEW_FRAMING_LINE },
      status: 'ready',
    }
    const summary: TemplateSection = {
      id: 'session-summary',
      type: 'SessionSummary',
      meta: { ...emptyMeta, subtopicTitle: 'Session Summary' },
      data: { session_title: sessionTitle, covered_subtopics: [], closing_line: SUMMARY_CLOSING_LINE },
      status: 'pending',
    }
    return [overview, summary]
  }

  const bookendMetaBase = realSections[0].meta

  const overview: TemplateSection = {
    id: 'session-overview',
    type: 'SessionOverview',
    meta: { ...bookendMetaBase, subtopicTitle: 'Session Overview', sessionTitle },
    data: {
      session_title: sessionTitle,
      agenda: realSections.map((s) => ({
        subtopic_title: s.meta.subtopicTitle,
        skipped: skippedTopics.includes(s.meta.subtopicTitle),
      })),
      framing_line: OVERVIEW_FRAMING_LINE,
    },
    status: 'ready',
  }

  const summary: TemplateSection = {
    id: 'session-summary',
    type: 'SessionSummary',
    meta: { ...bookendMetaBase, subtopicTitle: 'Session Summary', sessionTitle },
    data: {
      session_title: sessionTitle,
      // Per Decision D: "covered" = planned to cover and not skipped — real-time
      // "actually reached" tracking is out of scope for this fix.
      covered_subtopics: realSections
        .filter((s) => !skippedTopics.includes(s.meta.subtopicTitle))
        .map((s) => s.meta.subtopicTitle),
      closing_line: SUMMARY_CLOSING_LINE,
    },
    status: 'pending',
  }

  return [overview, ...realSections, summary]
}
