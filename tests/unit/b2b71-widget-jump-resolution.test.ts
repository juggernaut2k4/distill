import { describe, it, expect } from 'vitest'
import { resolveWidgetJumpIndex, computeNextProgressIndex } from '@/lib/voice/widget-jump-resolution'

/**
 * B2B-71 (docs/specs/B2B-71-requirement-document.md §6.3/§6.5/§13) — resolveWidgetJumpIndex and
 * computeNextProgressIndex tests. Ported logic from PartnerRenderClient.tsx's resolveSectionIndex
 * (template-mode only there); this is a new, standalone module with its own test coverage.
 */

const PAGES = [{ title: 'Intro' }, { title: 'Pricing' }, { title: 'Onboarding' }, { title: null }]

describe('resolveWidgetJumpIndex', () => {
  it('resolves an exact topic_title match', () => {
    expect(resolveWidgetJumpIndex({ topic_title: 'Pricing' }, PAGES, 0)).toBe(1)
  })

  it('resolves a valid in-range section_index directly', () => {
    expect(resolveWidgetJumpIndex({ section_index: 2 }, PAGES, 0)).toBe(2)
  })

  it('prefers section_index over topic_title when both are given and section_index is valid', () => {
    expect(resolveWidgetJumpIndex({ section_index: 2, topic_title: 'Pricing' }, PAGES, 0)).toBe(2)
  })

  it('falls through to topic_title when section_index is out of range', () => {
    expect(resolveWidgetJumpIndex({ section_index: 99, topic_title: 'Onboarding' }, PAGES, 0)).toBe(2)
  })

  it('falls through to topic_title when section_index is negative', () => {
    expect(resolveWidgetJumpIndex({ section_index: -1, topic_title: 'Onboarding' }, PAGES, 0)).toBe(2)
  })

  it('returns currentIndex unchanged when topic_title matches no page', () => {
    expect(resolveWidgetJumpIndex({ topic_title: 'Nonexistent Page' }, PAGES, 3)).toBe(3)
  })

  it('returns currentIndex unchanged when neither param is usable', () => {
    expect(resolveWidgetJumpIndex({}, PAGES, 2)).toBe(2)
  })

  it('does not throw on an empty pages array, returning currentIndex', () => {
    expect(resolveWidgetJumpIndex({ topic_title: 'Anything' }, [], 0)).toBe(0)
    expect(resolveWidgetJumpIndex({ section_index: 0 }, [], 0)).toBe(0)
  })

  it('never matches a page whose title is null via topic_title', () => {
    expect(resolveWidgetJumpIndex({ topic_title: 'null' }, PAGES, 1)).toBe(1)
  })
})

describe('computeNextProgressIndex', () => {
  it('advances by one', () => {
    expect(computeNextProgressIndex(2, 5)).toBe(3)
  })

  it('clamps at count - 1 (forward-only, never past the last page)', () => {
    expect(computeNextProgressIndex(4, 5)).toBe(4)
  })

  it('handles a single-page session without going negative or throwing', () => {
    expect(computeNextProgressIndex(0, 1)).toBe(0)
  })
})
