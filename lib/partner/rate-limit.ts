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

export type RateLimitClass = 'sessions_create' | 'reads' | 'oauth_token'

const LIMITS: Record<RateLimitClass, { capacity: number; refillPerMs: number }> = {
  sessions_create: { capacity: 60, refillPerMs: 60 / 60_000 }, // 60/min
  reads: { capacity: 300, refillPerMs: 300 / 60_000 }, // 300/min
  oauth_token: { capacity: 20, refillPerMs: 20 / 60_000 }, // B2B-06 — 20/min, keyed by client_id, not partner_account_id
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
