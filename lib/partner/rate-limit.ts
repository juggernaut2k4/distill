/**
 * B2B-02 — Per-partner-account rate limiting (architecture.md Section 10, a
 * technical judgment call within BA authority).
 *
 * Token-bucket, keyed by `partner_account_id` + route class:
 *   POST /api/partner/v1/sessions                      → 60 requests/min
 *   GET  /api/partner/v1/sessions/:ref, /usage          → 300 requests/min
 *
 * KNOWN LIMITATION: this is an in-process, in-memory bucket. It is correctly
 * enforced within one warm serverless instance but does not share state
 * across concurrent instances/cold starts — there is no Redis/Upstash in the
 * CLAUDE.md-approved vendor list to back a distributed limiter. This is
 * documented here as a real gap, not silently glossed over: it still bounds a
 * single runaway loop hitting the same warm instance, but a partner spread
 * across many concurrent Vercel instances could exceed the nominal limit. A
 * distributed limiter is a reasonable future enhancement (e.g. once Upstash
 * Redis or similar is added to the approved vendor list), not built here.
 */

interface Bucket {
  tokens: number
  lastRefillAt: number
}

const buckets = new Map<string, Bucket>()

export type RateLimitClass =
  | 'sessions_create'
  | 'reads'
  | 'oauth_token'
  | 'widget_sessions_create'
  | 'bot_dispatch_create'
  | 'bot_sessions_create'

const LIMITS: Record<RateLimitClass, { capacity: number; refillPerMs: number }> = {
  sessions_create: { capacity: 60, refillPerMs: 60 / 60_000 }, // 60/min
  reads: { capacity: 300, refillPerMs: 300 / 60_000 }, // 300/min
  oauth_token: { capacity: 20, refillPerMs: 20 / 60_000 }, // B2B-06 — 20/min, keyed by client_id, not partner_account_id
  // B2B-70 (docs/specs/B2B-70-requirement-document.md §6.4) — deliberately higher than
  // sessions_create: a reseller's in-app "Learn with AI" button is expected to be clicked far more
  // often per minute than the meeting-bot flow's one-per-scheduled-meeting pattern.
  widget_sessions_create: { capacity: 300, refillPerMs: 300 / 60_000 }, // 300/min
  // 2026-08-12 — production two-stage pipeline (B2B-78), same 300/min ceiling as
  // widget_sessions_create: same "in-app button, clicked often" traffic shape. bot-dispatch is the
  // cheaper, more-frequently-retried stage 1 call (passcode auth, no wallet gate), so it gets its
  // own bucket rather than sharing bot_sessions_create's — a burst of retried bot-dispatch calls
  // must never starve a sales-partner's real bot-sessions traffic.
  bot_dispatch_create: { capacity: 300, refillPerMs: 300 / 60_000 }, // 300/min
  bot_sessions_create: { capacity: 300, refillPerMs: 300 / 60_000 }, // 300/min
}

/** Returns { allowed, retryAfterSeconds } for a given partner account + route class. Mutates in-memory bucket state. */
export function checkRateLimit(
  partnerAccountId: string,
  routeClass: RateLimitClass
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const limit = LIMITS[routeClass]
  const key = `${partnerAccountId}:${routeClass}`
  const now = Date.now()

  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { tokens: limit.capacity, lastRefillAt: now }
    buckets.set(key, bucket)
  }

  const elapsedMs = now - bucket.lastRefillAt
  bucket.tokens = Math.min(limit.capacity, bucket.tokens + elapsedMs * limit.refillPerMs)
  bucket.lastRefillAt = now

  if (bucket.tokens < 1) {
    const msUntilNextToken = (1 - bucket.tokens) / limit.refillPerMs
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(msUntilNextToken / 1000)) }
  }

  bucket.tokens -= 1
  return { allowed: true }
}

/** Test/dev-only reset — clears all bucket state. */
export function resetRateLimits(): void {
  buckets.clear()
}
