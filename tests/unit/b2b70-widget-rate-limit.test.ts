import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, resetRateLimits } from '@/lib/partner/rate-limit'

/**
 * B2B-70 (docs/specs/B2B-70-requirement-document.md §6.4) — the new 'widget_sessions_create'
 * RateLimitClass. Additive-only: checkRateLimit()'s own token-bucket logic is untouched (covered by
 * whatever pre-existing test coverage 'sessions_create'/'reads' already have); this file only
 * verifies the new class is wired into LIMITS with its own bucket, independent of every other class.
 */

describe("checkRateLimit — 'widget_sessions_create'", () => {
  beforeEach(() => {
    resetRateLimits()
  })

  it('allows requests up to its own 300/min capacity', () => {
    for (let i = 0; i < 300; i++) {
      expect(checkRateLimit('acct-widget', 'widget_sessions_create')).toEqual({ allowed: true })
    }
  })

  it('rejects the 301st request within the same window, with a positive retryAfterSeconds', () => {
    for (let i = 0; i < 300; i++) checkRateLimit('acct-widget', 'widget_sessions_create')
    const result = checkRateLimit('acct-widget', 'widget_sessions_create')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('is bucketed independently of sessions_create for the same account', () => {
    for (let i = 0; i < 60; i++) checkRateLimit('acct-shared', 'sessions_create')
    expect(checkRateLimit('acct-shared', 'sessions_create')).toEqual({ allowed: false, retryAfterSeconds: expect.any(Number) })
    // The sessions_create bucket is exhausted, but widget_sessions_create's own bucket is untouched.
    expect(checkRateLimit('acct-shared', 'widget_sessions_create')).toEqual({ allowed: true })
  })

  it('is bucketed independently per partner account', () => {
    for (let i = 0; i < 300; i++) checkRateLimit('acct-a', 'widget_sessions_create')
    expect(checkRateLimit('acct-a', 'widget_sessions_create').allowed).toBe(false)
    expect(checkRateLimit('acct-b', 'widget_sessions_create')).toEqual({ allowed: true })
  })
})
