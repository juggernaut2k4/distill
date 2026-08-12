import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, resetRateLimits } from '@/lib/partner/rate-limit'

/**
 * Production rebuild (2026-08-12) — the new 'bot_dispatch_create'/'bot_sessions_create'
 * RateLimitClass entries. Mirrors tests/unit/b2b70-widget-rate-limit.test.ts's own shape: this file
 * only verifies the two new classes are wired into LIMITS with their own independent buckets —
 * checkRateLimit()'s token-bucket logic itself is untouched, already covered elsewhere.
 */

describe("checkRateLimit — 'bot_dispatch_create' / 'bot_sessions_create'", () => {
  beforeEach(() => {
    resetRateLimits()
  })

  it('bot_dispatch_create allows requests up to its own 300/min capacity, then rejects the 301st', () => {
    for (let i = 0; i < 300; i++) {
      expect(checkRateLimit('acct-bot', 'bot_dispatch_create')).toEqual({ allowed: true })
    }
    const result = checkRateLimit('acct-bot', 'bot_dispatch_create')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('bot_sessions_create allows requests up to its own 300/min capacity, then rejects the 301st', () => {
    for (let i = 0; i < 300; i++) {
      expect(checkRateLimit('acct-bot', 'bot_sessions_create')).toEqual({ allowed: true })
    }
    const result = checkRateLimit('acct-bot', 'bot_sessions_create')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('bot_dispatch_create and bot_sessions_create are bucketed independently of each other and of widget_sessions_create, for the same account', () => {
    for (let i = 0; i < 300; i++) checkRateLimit('acct-shared', 'bot_dispatch_create')
    expect(checkRateLimit('acct-shared', 'bot_dispatch_create').allowed).toBe(false)
    // A burst of bot-dispatch retries never starves real bot-sessions or demo widget-sessions traffic.
    expect(checkRateLimit('acct-shared', 'bot_sessions_create')).toEqual({ allowed: true })
    expect(checkRateLimit('acct-shared', 'widget_sessions_create')).toEqual({ allowed: true })
  })

  it('is bucketed independently per partner account', () => {
    for (let i = 0; i < 300; i++) checkRateLimit('acct-a', 'bot_sessions_create')
    expect(checkRateLimit('acct-a', 'bot_sessions_create').allowed).toBe(false)
    expect(checkRateLimit('acct-b', 'bot_sessions_create')).toEqual({ allowed: true })
  })
})
