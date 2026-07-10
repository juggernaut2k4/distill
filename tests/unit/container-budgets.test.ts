import { describe, it, expect } from 'vitest'
import {
  CHARS_PER_WORD,
  MIN_FLOOR_RATIO,
  computeMaxChars,
  computeMinChars,
  truncateAtSentenceBoundary,
  applyBudgetTruncation,
  getBudgetsForTemplate,
  getContainerSpecForTemplate,
} from '@/lib/templates/containerBudgets'

describe('containerBudgets — char/floor formulas', () => {
  it('computeMaxChars applies the documented CHARS_PER_WORD conversion for word-based fields', () => {
    expect(CHARS_PER_WORD).toBe(6.5)
    expect(computeMaxChars({ path: 'so_what', maxWords: 30 })).toBe(Math.round(30 * 6.5))
  })

  it('computeMaxChars uses the raw value directly for charOverride fields (no word conversion)', () => {
    expect(computeMaxChars({ path: 'headline_stat', maxWords: 3, charOverride: true })).toBe(3)
  })

  it('computeMinChars is exactly 40% of computeMaxChars', () => {
    const budget = { path: 'so_what', maxWords: 30 }
    const maxChars = computeMaxChars(budget)
    expect(computeMinChars(budget)).toBe(Math.round(maxChars * MIN_FLOOR_RATIO))
  })

  it('every template with a budget copies real max-word numbers already used in generator.ts (spot check)', () => {
    // These are copied verbatim from generator.ts's existing LAYOUT CONSTRAINTS
    // prompt (lines ~1006-1036) — not invented.
    const comparisonTable = getBudgetsForTemplate('ComparisonTable')
    expect(comparisonTable.find((b) => b.path === 'options[].name')?.maxWords).toBe(3)
    expect(comparisonTable.find((b) => b.path === 'verdict')?.maxWords).toBe(25)

    const heatmap = getBudgetsForTemplate('Heatmap')
    expect(heatmap.find((b) => b.path === 'rows[]')?.maxWords).toBe(4)
    expect(heatmap.find((b) => b.path === 'so_what')?.maxWords).toBe(30)

    const overlay = getBudgetsForTemplate('Overlay')
    expect(overlay.find((b) => b.path === 'base_label')?.maxWords).toBe(6)
    expect(overlay.find((b) => b.path === 'zones[].callout_detail')?.maxWords).toBe(14)
  })
})

describe('truncateAtSentenceBoundary', () => {
  it('returns the original string unchanged when under the limit', () => {
    expect(truncateAtSentenceBoundary('Short text.', 100)).toBe('Short text.')
  })

  it('truncates at the last complete sentence at or before maxChars — never mid-word', () => {
    const text =
      'This is the first sentence of the passage. This is the second sentence, which is also fairly long. This third sentence pushes well past the limit for sure.'
    const result = truncateAtSentenceBoundary(text, 100)

    expect(result.length).toBeLessThanOrEqual(100)
    expect(result.endsWith('.')).toBe(true)
    // Never cuts mid-word: the result must be a prefix of the original text up to a "."
    expect(text.startsWith(result)).toBe(true)
  })

  it('falls back to the last complete word boundary when no sentence-ending punctuation fits', () => {
    const text = 'onewordwithnostops thatkeepsgoingandgoing withoutanyperiodsatall wayoverthelimit'
    const result = truncateAtSentenceBoundary(text, 40)

    expect(result.length).toBeLessThanOrEqual(40)
    // Must not end mid-word — every char up to result.length in the original
    // must either be a space right after result, or result must equal a
    // whitespace-bounded prefix.
    expect(text.startsWith(result)).toBe(true)
    expect(result.endsWith(' ')).toBe(false) // trimmed
  })
})

describe('applyBudgetTruncation', () => {
  it('truncates an over-max top-level field on a cloned object, leaving the original untouched', () => {
    const original = {
      title: 'A'.repeat(200) + '. Done.',
      context: 'short context',
      quote: 'x',
      so_what: 'As a CEO, short is fine here for this test case example only.',
    }
    // QuoteCallout budgets: quote (40w), context (20w), so_what (30w) — title isn't budgeted for QuoteCallout,
    // so use a template that budgets "title" directly: Heatmap.
    const heatmapData = {
      title: 'Short first sentence here. ' + 'B'.repeat(100),
      context: 'short context under budget',
      row_label: 'Function',
      column_label: 'Stage',
      rows: ['Sales'],
      columns: ['Piloting'],
      cells: [{ row: 'Sales', column: 'Piloting', intensity: 1, label: null }],
      legend_low: 'Low',
      legend_high: 'High',
      so_what: 'As a CEO, this so_what field is written long enough to comfortably clear the minimum floor requirement.',
    }

    const { data, underMinPaths } = applyBudgetTruncation('Heatmap', heatmapData as never)

    expect((data as typeof heatmapData).title.length).toBeLessThanOrEqual(Math.round(8 * 6.5))
    expect((data as typeof heatmapData).title.endsWith('.')).toBe(true)
    // Original object is untouched (deep clone, not mutation)
    expect(heatmapData.title.length).toBeGreaterThan(Math.round(8 * 6.5))
    // so_what was long enough not to need truncation or flag as under-floor
    expect(underMinPaths).not.toContain('so_what')
    void original
  })

  it('reports under-min paths without mutating the value (caller decides retry/fallback)', () => {
    const data = {
      quote: 'The companies that will win with AI are not the ones with the best models but the best decision processes for choosing problems worth solving.',
      context: 'Said at a conference discussing enterprise AI investment patterns and outcomes.',
      so_what: 'Too short.',
    }

    const result = applyBudgetTruncation('QuoteCallout', data as never)

    expect(result.underMinPaths).toContain('so_what')
    // Value left as-is — validateTemplateData (generator.ts) decides what happens next
    expect((result.data as typeof data).so_what).toBe('Too short.')
  })

  it('skips minimum-floor checks for charOverride numeric fields (e.g. StatCallout.headline_stat)', () => {
    const data = {
      headline_stat: '7',
      unit: '% of something',
      context: 'A short but legitimate numeric-literal context line here.',
      why_it_matters: 'As a CEO, this single-digit stat is exactly as long as it should be — never regenerate a number for being short.',
      supporting_stats: [],
      so_what: 'As a CEO, this so_what field clears the floor comfortably with enough words in it.',
    }

    const { underMinPaths } = applyBudgetTruncation('StatCallout', data as never)
    expect(underMinPaths).not.toContain('headline_stat')
  })

  it('returns the input unchanged for a template with no budget table entries', () => {
    const data = { session_title: 'x', agenda: [], framing_line: 'y' }
    const result = applyBudgetTruncation('SessionOverview', data as never)
    expect(result.data).toEqual(data)
    expect(result.underMinPaths).toEqual([])
  })
})

describe('getContainerSpecForTemplate', () => {
  it('includes fixed pixel dimensions only for Heatmap and Overlay', () => {
    const heatmapSpec = getContainerSpecForTemplate('Heatmap')
    expect(heatmapSpec.fixedContainer).toMatchObject({ cellSize: 64, maxRows: 6, maxColumns: 4 })

    const overlaySpec = getContainerSpecForTemplate('Overlay')
    expect(overlaySpec.fixedContainer).toMatchObject({ panelWidth: 700, panelHeight: 420, maxZones: 4 })

    const comparisonTableSpec = getContainerSpecForTemplate('ComparisonTable')
    expect(comparisonTableSpec.fixedContainer).toBeNull()
  })

  it('field list includes computed maxChars/minChars for every budgeted field', () => {
    const spec = getContainerSpecForTemplate('Heatmap')
    const fields = spec.fields as Array<{ path: string; maxChars: number; minChars: number | null }>
    const soWhat = fields.find((f) => f.path === 'so_what')
    expect(soWhat?.maxChars).toBe(Math.round(30 * 6.5))
    expect(soWhat?.minChars).toBe(Math.round(Math.round(30 * 6.5) * 0.4))
  })
})
