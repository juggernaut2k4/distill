import { describe, it, expect } from 'vitest'
import { shallowFieldsEqual } from '@/lib/test-harness/dirty-state'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 9, AT-11). This is the exact
 * comparison Screen B's topic form and each in-place screen edit use to gate their Save button
 * (`app/test-harness/topics/[topicId]/page.tsx`) — Save stays disabled while every field matches
 * the last-saved baseline, and re-enables the instant any field changes.
 */
describe('shallowFieldsEqual (AT-11 Save-button dirty-state gating)', () => {
  it('reports unchanged when every field matches the saved baseline', () => {
    const saved = { title: 'Q3 Briefing', subtitle: 'x', contentToExplain: 'y' }
    const current = { title: 'Q3 Briefing', subtitle: 'x', contentToExplain: 'y' }
    expect(shallowFieldsEqual(current, saved)).toBe(true)
  })

  it('reports changed the instant a single field diverges', () => {
    const saved = { title: 'Q3 Briefing', subtitle: 'x', contentToExplain: 'y' }
    const current = { title: 'Q3 Briefing (edited)', subtitle: 'x', contentToExplain: 'y' }
    expect(shallowFieldsEqual(current, saved)).toBe(false)
  })

  it('treats a freshly-loaded empty-string baseline as equal only to an unedited empty field', () => {
    const saved = { title: '', subtitle: '', contentToExplain: '' }
    expect(shallowFieldsEqual({ title: '', subtitle: '', contentToExplain: '' }, saved)).toBe(true)
    expect(shallowFieldsEqual({ title: 'now typed', subtitle: '', contentToExplain: '' }, saved)).toBe(false)
  })
})
