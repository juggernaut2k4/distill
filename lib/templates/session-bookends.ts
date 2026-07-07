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

// ─── CONTENT-02: fixed CHECKPOINT/CONTINUE copy for both bookends ─────────────
// These are fixed strings, not templated — see docs/specs/CONTENT-02-requirement-document.md
// Section 4.1. The Overview checkpoint confirms orientation, not comprehension;
// the Summary checkpoint is a closing check-in, not a comprehension check.

const OVERVIEW_CHECKPOINT =
  "Does that agenda work for you, or is there something specific you want to make sure we get to?"
const OVERVIEW_CONTINUE = "Perfect — let's dive into the first one."

const SUMMARY_CHECKPOINT = 'How did that feel — anything you want to flag before we close out?'
const SUMMARY_CONTINUE = 'Nice work today. Talk soon.'

const FALLBACK_SESSION_TITLE = 'this session'

/**
 * Builds the Overview bookend's real spoken TEACH content — pure deterministic
 * string templating from data already computed by wrapSectionsWithBookends
 * (session title + agenda). No LLM call. See spec Section 4.1.
 *
 * @param sessionTitle  Falls back to "this session" if empty/blank (Section 8 string-safety guard)
 * @param agenda        Same shape as SessionOverviewData.agenda; skipped items are excluded
 */
export function buildOverviewTeachContent(
  sessionTitle: string,
  agenda: { subtopic_title: string; skipped: boolean }[]
): string {
  const title = sessionTitle?.trim() ? sessionTitle : FALLBACK_SESSION_TITLE
  const items = agenda.filter((a) => !a.skipped).map((a) => a.subtopic_title)

  if (items.length === 0) {
    return `Today we're covering ${title}. Let's get started.`
  }

  if (items.length === 1) {
    return `Today we're covering ${title}. We'll go deep on one thing: ${items[0]}. By the end, you'll have a clear, practical grip on it — let's get started.`
  }

  const joined = joinNaturally(items)
  return `Today we're covering ${title}. We'll go through ${numberWord(items.length)} things: ${joined}. By the end, you'll have a clear, practical grip on all of it — let's get started.`
}

/**
 * Builds the Summary bookend's real spoken TEACH content — pure deterministic
 * string templating from data already computed by wrapSectionsWithBookends
 * (session title + covered_subtopics). No LLM call. See spec Section 4.1.
 *
 * @param sessionTitle       Falls back to "this session" if empty/blank
 * @param coveredSubtopics   Already excludes skipped subtopics (existing filter behavior)
 */
export function buildSummaryTeachContent(sessionTitle: string, coveredSubtopics: string[]): string {
  const title = sessionTitle?.trim() ? sessionTitle : FALLBACK_SESSION_TITLE

  if (coveredSubtopics.length === 0) {
    return `That's a wrap on ${title}. Thanks for your time today.`
  }

  const joined = joinNaturally(coveredSubtopics)
  const anchor = coveredSubtopics[0]
  return `That's a wrap on ${title}. Today we covered ${joined}. The one thing worth carrying forward: ${anchor} — keep coming back to that as you put this into practice.`
}

/** Joins items with commas and a trailing "and", e.g. "a, b, and c" or "a and b". */
function joinNaturally(items: string[]): string {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

const NUMBER_WORDS: Record<number, string> = {
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
}

function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}

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
      data: {
        session_title: sessionTitle,
        agenda: [],
        framing_line: OVERVIEW_FRAMING_LINE,
        script: {
          teach: buildOverviewTeachContent(sessionTitle, []),
          checkpoint: OVERVIEW_CHECKPOINT,
          continue: OVERVIEW_CONTINUE,
        },
      },
      status: 'ready',
    }
    const summary: TemplateSection = {
      id: 'session-summary',
      type: 'SessionSummary',
      meta: { ...emptyMeta, subtopicTitle: 'Session Summary' },
      data: {
        session_title: sessionTitle,
        covered_subtopics: [],
        closing_line: SUMMARY_CLOSING_LINE,
        script: {
          teach: buildSummaryTeachContent(sessionTitle, []),
          checkpoint: SUMMARY_CHECKPOINT,
          continue: SUMMARY_CONTINUE,
        },
      },
      status: 'pending',
    }
    return [overview, summary]
  }

  const bookendMetaBase = realSections[0].meta

  const agenda = realSections.map((s) => ({
    subtopic_title: s.meta.subtopicTitle,
    skipped: skippedTopics.includes(s.meta.subtopicTitle),
  }))

  const coveredSubtopics = realSections
    .filter((s) => !skippedTopics.includes(s.meta.subtopicTitle))
    .map((s) => s.meta.subtopicTitle)

  const overview: TemplateSection = {
    id: 'session-overview',
    type: 'SessionOverview',
    meta: { ...bookendMetaBase, subtopicTitle: 'Session Overview', sessionTitle },
    data: {
      session_title: sessionTitle,
      agenda,
      framing_line: OVERVIEW_FRAMING_LINE,
      script: {
        teach: buildOverviewTeachContent(sessionTitle, agenda),
        checkpoint: OVERVIEW_CHECKPOINT,
        continue: OVERVIEW_CONTINUE,
      },
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
      covered_subtopics: coveredSubtopics,
      closing_line: SUMMARY_CLOSING_LINE,
      script: {
        teach: buildSummaryTeachContent(sessionTitle, coveredSubtopics),
        checkpoint: SUMMARY_CHECKPOINT,
        continue: SUMMARY_CONTINUE,
      },
    },
    status: 'pending',
  }

  return [overview, ...realSections, summary]
}
