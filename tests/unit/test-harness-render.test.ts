import { describe, it, expect } from 'vitest'
import { wrapHtmlFragmentIfNeeded } from '@/lib/test-harness/render'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen C render note, AT-4).
 */
describe('wrapHtmlFragmentIfNeeded', () => {
  it('passes a full document through byte-identical', () => {
    const fullDoc = '<!doctype html><html><head><title>x</title></head><body>hello</body></html>'
    expect(wrapHtmlFragmentIfNeeded(fullDoc)).toBe(fullDoc)
  })

  it('wraps a bare fragment (no <html> tag) in a minimal valid document shell', () => {
    const fragment = '<div style="padding:40px;font-size:32px">Where we are today</div>'
    const wrapped = wrapHtmlFragmentIfNeeded(fragment)
    expect(wrapped).not.toBe(fragment)
    expect(wrapped).toContain('<!doctype html>')
    expect(wrapped).toContain('<html>')
    expect(wrapped).toContain(fragment)
  })

  it('detects an <html> tag with attributes as already a full document', () => {
    const fullDoc = '<html lang="en"><body>hi</body></html>'
    expect(wrapHtmlFragmentIfNeeded(fullDoc)).toBe(fullDoc)
  })
})
