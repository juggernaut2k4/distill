import { describe, it, expect } from 'vitest'
import {
  APPROVED_COLOR_TOKENS,
  isFixLoopTemplate,
  validateStyleOverrides,
} from '@/lib/templates/styleOverrideSlots'

/**
 * TMPL-01 — Structural enforcement, Layer 2 (requirement doc Section 4.1/7).
 * validateStyleOverrides() is the mechanical, all-or-nothing gate that runs
 * before any LLM-proposed fix is ever persisted or shown to Arun.
 */

describe('isFixLoopTemplate', () => {
  it('is true only for Heatmap and Overlay', () => {
    expect(isFixLoopTemplate('Heatmap')).toBe(true)
    expect(isFixLoopTemplate('Overlay')).toBe(true)
    expect(isFixLoopTemplate('CaseStudy')).toBe(false)
    expect(isFixLoopTemplate('TopicHero')).toBe(false)
  })
})

describe('validateStyleOverrides — Heatmap', () => {
  it('accepts a fully valid override object', () => {
    const result = validateStyleOverrides('Heatmap', {
      'intensity-2': APPROVED_COLOR_TOKENS[2],
      'cell-gap': 6,
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.overrides['intensity-2']).toBe(APPROVED_COLOR_TOKENS[2])
      expect(result.overrides['cell-gap']).toBe(6)
    }
  })

  it('accepts an empty object (no-op override)', () => {
    expect(validateStyleOverrides('Heatmap', {}).valid).toBe(true)
  })

  it('rejects the ENTIRE object when one key is not in the allowlist (all-or-nothing)', () => {
    const result = validateStyleOverrides('Heatmap', {
      'cell-gap': 4,
      'cell-padding': 10, // not an allowed slot
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toMatch(/cell-padding/)
      expect(result.reason).toMatch(/not an allowed style-override slot/i)
    }
  })

  it('rejects a color value that is not one of the approved accent tokens', () => {
    const result = validateStyleOverrides('Heatmap', { 'intensity-3': '#FF00FF' })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toMatch(/approved accent color tokens/i)
  })

  it('rejects an out-of-range integer value for cell-gap (max 8)', () => {
    const result = validateStyleOverrides('Heatmap', { 'cell-gap': 14 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toMatch(/between 0 and 8/)
  })

  it('rejects a non-integer numeric value', () => {
    const result = validateStyleOverrides('Heatmap', { 'cell-size': 64.5 })
    expect(result.valid).toBe(false)
  })

  it('rejects a value of the wrong JS type for a range slot (string instead of number)', () => {
    const result = validateStyleOverrides('Heatmap', { 'cell-gap': '6' })
    expect(result.valid).toBe(false)
  })

  it('rejects a non-object proposal (array, null, primitive)', () => {
    expect(validateStyleOverrides('Heatmap', null).valid).toBe(false)
    expect(validateStyleOverrides('Heatmap', ['x']).valid).toBe(false)
    expect(validateStyleOverrides('Heatmap', 'nope').valid).toBe(false)
  })

  it('a single invalid key rejects the whole object even when every other key is valid (not partially applied)', () => {
    const result = validateStyleOverrides('Heatmap', {
      'intensity-0': APPROVED_COLOR_TOKENS[0],
      'intensity-1': APPROVED_COLOR_TOKENS[1],
      'cell-size': 64,
      'cell-gap': 999, // invalid — out of range
    })
    expect(result.valid).toBe(false)
  })
})

describe('validateStyleOverrides — Overlay', () => {
  it('accepts a fully valid override object', () => {
    const result = validateStyleOverrides('Overlay', {
      'zone-color-purple': APPROVED_COLOR_TOKENS[0],
      'callout-width': 240,
      'panel-border-width': 3,
    })
    expect(result.valid).toBe(true)
  })

  it('rejects an unknown zone-color key not declared for Overlay', () => {
    const result = validateStyleOverrides('Overlay', { 'zone-color-teal': '#7C3AED' })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toMatch(/zone-color-teal/)
  })

  it('rejects callout-height outside its 80-130 range', () => {
    expect(validateStyleOverrides('Overlay', { 'callout-height': 300 }).valid).toBe(false)
    expect(validateStyleOverrides('Overlay', { 'callout-height': 10 }).valid).toBe(false)
  })

  it('rejects panel-border-width outside its 1-4 range', () => {
    expect(validateStyleOverrides('Overlay', { 'panel-border-width': 0 }).valid).toBe(false)
    expect(validateStyleOverrides('Overlay', { 'panel-border-width': 12 }).valid).toBe(false)
  })

  it('Heatmap slots are not valid keys for Overlay and vice versa', () => {
    expect(validateStyleOverrides('Overlay', { 'cell-gap': 4 }).valid).toBe(false)
    expect(validateStyleOverrides('Heatmap', { 'callout-width': 200 }).valid).toBe(false)
  })
})
