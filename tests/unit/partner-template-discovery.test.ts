import { describe, it, expect } from 'vitest'
import { scoreTemplateMatch, componentSlotsForTemplate } from '@/lib/partner/template-discovery'

/**
 * B2B-03 Requirement Doc Section 6.5 — free-text discovery's bounded,
 * deterministic keyword-overlap heuristic. `>=0.7` high, `0.4-0.69` medium,
 * `<0.4` low (and triggers "No match found" in the caller).
 */

describe('scoreTemplateMatch', () => {
  it('scores a strong keyword match highly', () => {
    const score = scoreTemplateMatch('I need a heatmap showing intensity across a grid', 'Heatmap')
    expect(score).toBeGreaterThanOrEqual(0.4)
  })

  it('scores an unrelated description low', () => {
    const score = scoreTemplateMatch('a 3D rotating org chart with drill-down', 'Heatmap')
    expect(score).toBeLessThan(0.4)
  })

  it('is deterministic — identical input always produces identical output', () => {
    const a = scoreTemplateMatch('compare these tools side by side', 'ComparisonTable')
    const b = scoreTemplateMatch('compare these tools side by side', 'ComparisonTable')
    expect(a).toBe(b)
  })

  it('never throws on empty free text', () => {
    expect(() => scoreTemplateMatch('', 'Heatmap')).not.toThrow()
    expect(scoreTemplateMatch('', 'Heatmap')).toBe(0)
  })
})

describe('componentSlotsForTemplate — Section 12.5 fixed slot sets', () => {
  it('returns the documented Heatmap slots', () => {
    expect(componentSlotsForTemplate('Heatmap')).toEqual(['cell', 'legend'])
  })

  it('returns the documented Overlay slots', () => {
    expect(componentSlotsForTemplate('Overlay')).toEqual(['zone_marker', 'connector', 'callout_card'])
  })

  it('returns an empty list for a template with no defined slot set, never throws', () => {
    expect(componentSlotsForTemplate('SomeUnknownTemplate')).toEqual([])
  })
})
