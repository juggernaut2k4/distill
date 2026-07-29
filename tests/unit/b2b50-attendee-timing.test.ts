import { describe, it, expect } from 'vitest'
import { extractAttendeeEventTimestamp, clampDurationMinutes } from '@/lib/partner/attendee-timing'

/**
 * B2B-50 (docs/specs/B2B-50-requirement-document.md §6.8, §13.5) — refactor-safety net for the
 * shared module extracted from app/api/attendee/webhook/route.ts's previously private, unexported
 * functions of the same name/behavior.
 */

describe('extractAttendeeEventTimestamp()', () => {
  it('returns an ISO timestamp when event.data carries a recognized candidate key', () => {
    const result = extractAttendeeEventTimestamp({ data: { timestamp: '2026-07-29T10:00:00.000Z' } })
    expect(result).toBe('2026-07-29T10:00:00.000Z')
  })

  it('checks candidate keys in priority order (created_at wins over timestamp)', () => {
    const result = extractAttendeeEventTimestamp({
      data: { created_at: '2026-07-29T09:00:00.000Z', timestamp: '2026-07-29T10:00:00.000Z' },
    })
    expect(result).toBe('2026-07-29T09:00:00.000Z')
  })

  it('accepts a numeric epoch-ms candidate', () => {
    const epochMs = Date.UTC(2026, 6, 29, 12, 0, 0)
    const result = extractAttendeeEventTimestamp({ data: { occurred_at: epochMs } })
    expect(result).toBe(new Date(epochMs).toISOString())
  })

  it('returns null when no candidate key is present', () => {
    expect(extractAttendeeEventTimestamp({ data: {} })).toBeNull()
  })

  it('returns null when the only candidate present is unparseable', () => {
    expect(extractAttendeeEventTimestamp({ data: { time: 'not-a-date' } })).toBeNull()
  })
})

describe('clampDurationMinutes()', () => {
  it('converts milliseconds to minutes', () => {
    expect(clampDurationMinutes(5 * 60_000)).toBe(5)
  })

  it('floors negative durations at 0', () => {
    expect(clampDurationMinutes(-1000)).toBe(0)
  })

  it('caps durations at 600 minutes', () => {
    expect(clampDurationMinutes(1000 * 60 * 1000)).toBe(600)
  })
})
