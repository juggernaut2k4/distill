/**
 * RTV-04 Section 4.1, Layer 1 — generation-time structural enforcement.
 *
 * Mirrors, field-for-field, the max-word table already enforced today only as
 * an LLM prompt instruction in generator.ts's generateTemplateData() system
 * prompt (see the "LAYOUT CONSTRAINTS" block, ~lines 1006-1036). No numbers
 * are invented here — every maxWords value below is copied verbatim from that
 * existing table, plus the 2 new templates' budgets from the RTV-04
 * requirement document Section 4.2.
 *
 * This module is pure and has no dependency on the Anthropic client — it only
 * computes budgets and performs deterministic truncation/floor-checks, which
 * keeps it fully unit-testable without mocking any network call. The
 * LLM-retry-then-mock-fallback orchestration (which does need the Anthropic
 * client) lives in generator.ts's validateTemplateData() wrapper, which calls
 * into this module's pure helpers.
 */

import type { TemplateName, TemplateSection } from './types'

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

/** Established, fixed conversion: ~5.5 chars/word average English word length + 1 space. */
export const CHARS_PER_WORD = 6.5

/** A field may never render at less than 40% of its own maximum. */
export const MIN_FLOOR_RATIO = 0.4

// ─── FIELD BUDGET MODEL ─────────────────────────────────────────────────────

export interface FieldBudget {
  /**
   * Dot/bracket path into the template's data object, e.g. "so_what",
   * "real_example.result", "steps[].description", "rows[]" (array of
   * scalars — each element is itself the leaf).
   */
  path: string
  /** Word-count max, copied verbatim from generator.ts's existing table. */
  maxWords: number
  /**
   * True when generator.ts specifies this field directly in CHARACTERS, not
   * words (StatCallout.headline_stat: "1-3 characters", NarrativeCard's
   * metric "value": "max 5 chars"). When true, `maxWords` holds the character
   * count directly and no x CHARS_PER_WORD conversion is applied.
   */
  charOverride?: boolean
  /**
   * True for non-prose fields (numeric literals) where a minimum-length
   * regeneration retry makes no sense — e.g. a stat that is legitimately "73"
   * should never trigger an "expand this field" LLM retry. Truncation (the
   * max-side check) still applies; the floor (min-side) check is skipped.
   */
  skipMinFloor?: boolean
}

export function computeMaxChars(budget: FieldBudget): number {
  return budget.charOverride ? budget.maxWords : Math.round(budget.maxWords * CHARS_PER_WORD)
}

export function computeMinChars(budget: FieldBudget): number {
  return Math.round(computeMaxChars(budget) * MIN_FLOOR_RATIO)
}

// ─── BUDGET TABLE ───────────────────────────────────────────────────────────
// GLOBAL fields (so_what/so_what_for_you: 30w, title: 8w, context: 15w) are
// folded into each template's own entry below rather than merged at lookup
// time, so every template's full field list is visible in one place.

export const CONTAINER_BUDGETS: Partial<Record<TemplateName, FieldBudget[]>> = {
  TopicHero: [
    { path: 'topic_name', maxWords: 5 },
    { path: 'key_question', maxWords: 12 },
    { path: 'key_takeaways[]', maxWords: 12 },
    { path: 'so_what_preview', maxWords: 15 },
    { path: 'why_now', maxWords: 15 },
  ],
  ConceptDefinition: [
    { path: 'one_line', maxWords: 10 },
    { path: 'plain_english', maxWords: 14 },
    { path: 'real_example.what_they_did', maxWords: 12 },
    { path: 'real_example.result', maxWords: 8 },
    { path: 'common_misconception', maxWords: 12 },
    { path: 'so_what', maxWords: 30 },
  ],
  StepFlow: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'steps[].title', maxWords: 5 },
    { path: 'steps[].description', maxWords: 15 },
    { path: 'steps[].what_to_watch_for', maxWords: 12 },
    { path: 'outcome', maxWords: 15 },
    { path: 'so_what', maxWords: 30 },
  ],
  ComparisonTable: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'options[].name', maxWords: 3 },
    { path: 'options[].tagline', maxWords: 8 },
    { path: 'options[].best_for', maxWords: 8 },
    { path: 'criteria[].label', maxWords: 4 },
    { path: 'criteria[].values[]', maxWords: 6 },
    { path: 'verdict', maxWords: 25 },
    { path: 'so_what', maxWords: 30 },
  ],
  TwoByTwoMatrix: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'quadrants[].name', maxWords: 3 },
    { path: 'quadrants[].description', maxWords: 20 },
    { path: 'quadrants[].examples[]', maxWords: 5 },
    { path: 'so_what', maxWords: 30 },
  ],
  FrameworkCard: [
    { path: 'framework_name', maxWords: 5 },
    { path: 'purpose', maxWords: 5 },
    { path: 'components[].description', maxWords: 8 },
    { path: 'components[].executive_question', maxWords: 12 },
    { path: 'when_to_use', maxWords: 20 },
    { path: 'when_not_to_use', maxWords: 20 },
    { path: 'so_what', maxWords: 30 },
  ],
  ProsCons: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'pros[].title', maxWords: 5 },
    { path: 'pros[].description', maxWords: 15 },
    { path: 'pros[].evidence', maxWords: 12 },
    { path: 'cons[].title', maxWords: 5 },
    { path: 'cons[].description', maxWords: 15 },
    { path: 'cons[].mitigation', maxWords: 12 },
    { path: 'verdict', maxWords: 20 },
    { path: 'so_what', maxWords: 30 },
  ],
  CaseStudy: [
    { path: 'challenge', maxWords: 12 },
    { path: 'ai_solution', maxWords: 12 },
    { path: 'what_they_got_right', maxWords: 10 },
    { path: 'what_they_got_wrong', maxWords: 8 },
    { path: 'results[].metric', maxWords: 4 },
    { path: 'results[].value', maxWords: 5 },
    { path: 'so_what_for_you', maxWords: 30 },
  ],
  StatCallout: [
    { path: 'headline_stat', maxWords: 3, charOverride: true, skipMinFloor: true },
    { path: 'unit', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'why_it_matters', maxWords: 30 },
    { path: 'supporting_stats[].label', maxWords: 5 },
    { path: 'so_what', maxWords: 30 },
  ],
  Timeline: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'events[].title', maxWords: 6 },
    { path: 'events[].description', maxWords: 20 },
    { path: 'where_we_are_now', maxWords: 25 },
    { path: 'so_what', maxWords: 30 },
  ],
  ConceptMap: [
    { path: 'central_concept', maxWords: 4 },
    { path: 'nodes[].label', maxWords: 5 },
    { path: 'nodes[].description', maxWords: 10 },
    { path: 'so_what', maxWords: 30 },
  ],
  QuoteCallout: [
    { path: 'quote', maxWords: 40 },
    { path: 'context', maxWords: 20 },
    { path: 'so_what', maxWords: 30 },
  ],
  KeyTakeaway: [
    { path: 'insights[].insight', maxWords: 8 },
    { path: 'insights[].implication', maxWords: 18 },
    { path: 'one_thing_to_remember', maxWords: 15 },
    { path: 'action_for_you', maxWords: 20 },
  ],
  QuestionAnswer: [
    { path: 'direct_answer', maxWords: 30 },
    { path: 'analogy', maxWords: 25 },
    { path: 'example', maxWords: 25 },
    { path: 'important_nuance', maxWords: 20 },
    { path: 'so_what', maxWords: 30 },
  ],
  ActionPlan: [
    { path: 'key_takeaways[].takeaway', maxWords: 8 },
    { path: 'key_takeaways[].why_it_matters', maxWords: 15 },
    { path: 'immediate_actions[].action', maxWords: 10 },
    { path: 'questions_to_ask_your_team[]', maxWords: 10 },
    { path: 'watch_out_for[]', maxWords: 15 },
  ],
  Funnel: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'stages[].name', maxWords: 4 },
    { path: 'stages[].description', maxWords: 8 },
    { path: 'stages[].what_gets_filtered_out', maxWords: 7 },
    { path: 'stages[].decision_criteria', maxWords: 7 },
    { path: 'so_what', maxWords: 30 },
  ],
  Flowchart: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'nodes[].label', maxWords: 4 },
    { path: 'so_what', maxWords: 30 },
  ],
  Hierarchy: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'root.label', maxWords: 5 },
    { path: 'root.detail', maxWords: 5 },
    { path: 'so_what', maxWords: 30 },
  ],
  ChevronProcess: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'stages[].name', maxWords: 3 },
    { path: 'stages[].description', maxWords: 15 },
    { path: 'stages[].key_action', maxWords: 10 },
    { path: 'outcome', maxWords: 15 },
    { path: 'so_what', maxWords: 30 },
  ],
  NarrativeCard: [
    { path: 'challenge', maxWords: 20 },
    { path: 'approach', maxWords: 20 },
    { path: 'impact', maxWords: 20 },
    { path: 'metrics[].value', maxWords: 5, charOverride: true, skipMinFloor: true },
    { path: 'metrics[].label', maxWords: 4 },
    { path: 'lesson', maxWords: 15 },
    { path: 'so_what', maxWords: 30 },
  ],
  DefinitionTriptych: [
    { path: 'what_it_is', maxWords: 30 },
    { path: 'real_example.what', maxWords: 20 },
    { path: 'real_example.result', maxWords: 12 },
    { path: 'common_myth', maxWords: 20 },
    { path: 'so_what', maxWords: 30 },
  ],
  HorizontalDecision: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'nodes[].label', maxWords: 6 },
    { path: 'nodes[].detail', maxWords: 8 },
    { path: 'nodes[].branch_outcome', maxWords: 10 },
    { path: 'so_what', maxWords: 30 },
  ],
  AnswerSpotlight: [
    { path: 'direct_answer', maxWords: 35 },
    { path: 'analogy', maxWords: 25 },
    { path: 'example', maxWords: 25 },
    { path: 'important_nuance', maxWords: 20 },
    { path: 'so_what', maxWords: 30 },
  ],
  // RTV-04 — the 2 new templates, budgets copied verbatim from the requirement
  // document Section 4.2 (not invented).
  //
  // skipMinFloor is set on the short category/name/label fields below — a
  // single common word ("Sales", "Low", "Piloting") is a legitimate value for
  // these, not a sign of truncated or lazy generation, and the 40%-of-max
  // floor would otherwise trigger unnecessary expand-retries (and possibly a
  // mock-data fallback) on perfectly correct content. The floor stays active
  // on title/context/so_what and the other descriptive/prose fields, where an
  // unexpectedly short value is a real quality signal worth catching.
  Heatmap: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'row_label', maxWords: 4 },
    { path: 'column_label', maxWords: 4 },
    { path: 'rows[]', maxWords: 4, skipMinFloor: true },
    { path: 'columns[]', maxWords: 4, skipMinFloor: true },
    { path: 'cells[].label', maxWords: 3, skipMinFloor: true },
    { path: 'legend_low', maxWords: 3, skipMinFloor: true },
    { path: 'legend_high', maxWords: 3, skipMinFloor: true },
    { path: 'so_what', maxWords: 30 },
  ],
  Overlay: [
    { path: 'title', maxWords: 8 },
    { path: 'context', maxWords: 15 },
    { path: 'base_label', maxWords: 6 },
    { path: 'zones[].zone_label', maxWords: 3, skipMinFloor: true },
    { path: 'zones[].callout_label', maxWords: 4, skipMinFloor: true },
    { path: 'zones[].callout_detail', maxWords: 14 },
    { path: 'so_what', maxWords: 30 },
  ],
}

/** Returns the budget list for a template type, or an empty array if none exists. */
export function getBudgetsForTemplate(templateType: TemplateName): FieldBudget[] {
  return CONTAINER_BUDGETS[templateType] ?? []
}

// ─── PATH RESOLUTION ────────────────────────────────────────────────────────

interface LeafTarget {
  get: () => unknown
  set: (value: unknown) => void
}

type AnyRecord = Record<string, unknown>

interface LeafMarker {
  __leaf: true
  parent: AnyRecord | unknown[]
  key: string | number
}

function isLeafMarker(value: unknown): value is LeafMarker {
  return typeof value === 'object' && value !== null && (value as { __leaf?: unknown }).__leaf === true
}

/**
 * Resolves a budget path (e.g. "so_what", "steps[].description", "rows[]")
 * against a data object into a list of leaf get/set targets — one per array
 * element when the path traverses an array.
 */
function resolvePathTargets(data: unknown, path: string): LeafTarget[] {
  const segments = path.split('.')
  let current: unknown[] = [data]

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const isLastSegment = i === segments.length - 1
    const isArraySeg = seg.endsWith('[]')
    const key = isArraySeg ? seg.slice(0, -2) : seg

    const next: unknown[] = []
    for (const ctx of current) {
      if (ctx == null || typeof ctx !== 'object') continue
      const val = (ctx as AnyRecord)[key]
      if (isArraySeg) {
        if (!Array.isArray(val)) continue
        if (isLastSegment) {
          // Leaf is each array element itself (array of scalars, e.g. "rows[]").
          val.forEach((_, idx) => next.push({ __leaf: true, parent: val, key: idx } satisfies LeafMarker))
        } else {
          val.forEach((item) => next.push(item))
        }
      } else if (isLastSegment) {
        next.push({ __leaf: true, parent: ctx as AnyRecord, key } satisfies LeafMarker)
      } else {
        next.push(val)
      }
    }
    current = next
  }

  return current
    .filter(isLeafMarker)
    .map((marker) => ({
      get: () => (marker.parent as AnyRecord)[marker.key as string],
      set: (v: unknown) => { (marker.parent as AnyRecord)[marker.key as string] = v },
    }))
}

// ─── TRUNCATION ─────────────────────────────────────────────────────────────

/**
 * Truncates text to at most maxChars, cutting at the last complete sentence
 * boundary (., !, or ?) within the limit. Falls back to the last complete
 * word boundary if no sentence-ending punctuation is found. Never cuts
 * mid-word.
 */
export function truncateAtSentenceBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const slice = text.slice(0, maxChars)

  const sentenceEnd = /[.!?](?=\s|$)/g
  let lastIndex = -1
  let match: RegExpExecArray | null
  while ((match = sentenceEnd.exec(slice)) !== null) {
    lastIndex = match.index + 1
  }
  if (lastIndex > 0) {
    return slice.slice(0, lastIndex).trim()
  }

  const lastSpace = slice.lastIndexOf(' ')
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim()
}

// ─── VALIDATION RESULT ──────────────────────────────────────────────────────

export interface BudgetTruncationResult {
  data: TemplateSection['data']
  /** Budget paths whose value(s) fell under the 40%-of-max floor and were left as-is (caller decides retry/fallback). */
  underMinPaths: string[]
}

/**
 * Applies Layer 1 truncation deterministically and reports which budgeted
 * fields fall under their minimum floor. Pure — performs no network calls,
 * making it directly unit-testable. Over-max fields are truncated in place
 * (on a deep clone); under-min fields are left untouched and their paths
 * reported so the caller (generator.ts's validateTemplateData) can decide
 * whether to retry or fall back to mock data.
 */
export function applyBudgetTruncation(
  templateType: TemplateName,
  data: TemplateSection['data']
): BudgetTruncationResult {
  const budgets = getBudgetsForTemplate(templateType)
  if (budgets.length === 0) return { data, underMinPaths: [] }

  const cloned = JSON.parse(JSON.stringify(data)) as TemplateSection['data']
  const underMinPaths: string[] = []

  for (const budget of budgets) {
    const maxChars = computeMaxChars(budget)
    const minChars = computeMinChars(budget)
    const targets = resolvePathTargets(cloned, budget.path)

    for (const target of targets) {
      const value = target.get()
      if (typeof value !== 'string' || value.length === 0) continue

      if (value.length > maxChars) {
        target.set(truncateAtSentenceBoundary(value, maxChars))
      } else if (!budget.skipMinFloor && value.length < minChars) {
        if (!underMinPaths.includes(budget.path)) underMinPaths.push(budget.path)
      }
    }
  }

  return { data: cloned, underMinPaths }
}

// ─── CONTAINER SPEC (for template_library.container_spec) ─────────────────

/** Fixed pixel container dimensions — only Heatmap/Overlay have these (Section 4.1 Layer 2). Existing 23 templates use flex-1/auto-height (confirmed gap, out of scope — Section 10). */
const FIXED_CONTAINER_DIMENSIONS: Partial<Record<TemplateName, Record<string, unknown>>> = {
  Heatmap: {
    headerHeight: 72,
    columnHeaderHeight: 56,
    rowRailWidth: 140,
    cellSize: 64,
    legendHeight: 40,
    footerHeight: 72,
    maxRows: 6,
    maxColumns: 4,
  },
  Overlay: {
    headerHeight: 72,
    panelWidth: 700,
    panelHeight: 420,
    gridCellWidth: Math.round(700 / 3),
    gridCellHeight: 420 / 3,
    calloutWidth: 220,
    calloutHeight: 96,
    footerHeight: 72,
    maxZones: 4,
  },
}

/**
 * Builds the JSON-serializable container_spec used to seed template_library
 * — the field budget table (words/chars/floor) plus, for Heatmap/Overlay
 * only, the fixed pixel dimensions from Section 4.2.
 */
export function getContainerSpecForTemplate(templateType: TemplateName): Record<string, unknown> {
  const budgets = getBudgetsForTemplate(templateType)
  const fields = budgets.map((b) => ({
    path: b.path,
    maxWords: b.charOverride ? null : b.maxWords,
    maxChars: computeMaxChars(b),
    minChars: b.skipMinFloor ? null : computeMinChars(b),
  }))

  return {
    fields,
    fixedContainer: FIXED_CONTAINER_DIMENSIONS[templateType] ?? null,
  }
}
