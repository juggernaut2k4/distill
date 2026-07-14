import { describe, it, expect } from 'vitest'
import { validateSkeletonSchema } from '@/lib/partner/custom-templates'

/**
 * B2B-03 Requirement Doc Section 6.4/7/8 — the generation-safety boundary.
 * "An AI-generated skeleton_schema payload contains a value that fails the
 * enum/regex safety validation ... the payload is rejected outright (never
 * sanitized and rendered)."
 */

const VALID_SKELETON = {
  layout: 'grid',
  slots: [{ slot_id: 'primary', label: 'Primary panel', style_mode: 'fill', motion: 'fade' }],
  primary_color: '#7C3AED',
  accent_color: '#06B6D4',
}

describe('validateSkeletonSchema — generation-safety boundary', () => {
  it('accepts a well-formed skeleton', () => {
    expect(validateSkeletonSchema(VALID_SKELETON)).toBe(true)
  })

  it('rejects a non-hex color string (injection surface)', () => {
    expect(validateSkeletonSchema({ ...VALID_SKELETON, primary_color: 'red' })).toBe(false)
    expect(validateSkeletonSchema({ ...VALID_SKELETON, primary_color: 'javascript:alert(1)' })).toBe(false)
  })

  it('rejects an out-of-enum layout value', () => {
    expect(validateSkeletonSchema({ ...VALID_SKELETON, layout: 'custom-canvas' })).toBe(false)
  })

  it('rejects embedded markup/CSS in a label', () => {
    expect(
      validateSkeletonSchema({
        ...VALID_SKELETON,
        slots: [{ slot_id: 'primary', label: '<script>alert(1)</script>', style_mode: 'fill', motion: 'fade' }],
      })
    ).toBe(false)
    expect(
      validateSkeletonSchema({
        ...VALID_SKELETON,
        slots: [{ slot_id: 'primary', label: 'Panel"}; body{background:url(x)', style_mode: 'fill', motion: 'fade' }],
      })
    ).toBe(false)
  })

  it('rejects an out-of-enum style_mode or motion on a slot', () => {
    expect(
      validateSkeletonSchema({ ...VALID_SKELETON, slots: [{ slot_id: 'primary', label: 'Panel', style_mode: 'glow', motion: 'fade' }] })
    ).toBe(false)
    expect(
      validateSkeletonSchema({ ...VALID_SKELETON, slots: [{ slot_id: 'primary', label: 'Panel', style_mode: 'fill', motion: 'bounce' }] })
    ).toBe(false)
  })

  it('rejects unknown top-level keys (structural JSON only)', () => {
    expect(validateSkeletonSchema({ ...VALID_SKELETON, raw_css: 'body{background:red}' })).toBe(false)
  })

  it('rejects unknown slot keys', () => {
    expect(
      validateSkeletonSchema({
        ...VALID_SKELETON,
        slots: [{ slot_id: 'primary', label: 'Panel', style_mode: 'fill', motion: 'fade', onClick: 'alert(1)' }],
      })
    ).toBe(false)
  })

  it('rejects zero slots or more than 6 slots', () => {
    expect(validateSkeletonSchema({ ...VALID_SKELETON, slots: [] })).toBe(false)
    expect(
      validateSkeletonSchema({
        ...VALID_SKELETON,
        slots: Array.from({ length: 7 }, (_, i) => ({ slot_id: `s${i}`, label: 'Panel', style_mode: 'fill', motion: 'none' })),
      })
    ).toBe(false)
  })

  it('rejects a non-object payload entirely', () => {
    expect(validateSkeletonSchema('body{background:red}')).toBe(false)
    expect(validateSkeletonSchema(null)).toBe(false)
    expect(validateSkeletonSchema([VALID_SKELETON])).toBe(false)
  })

  it('accent_color and primary_color are optional', () => {
    const { primary_color, accent_color, ...rest } = VALID_SKELETON
    expect(validateSkeletonSchema(rest)).toBe(true)
  })
})
