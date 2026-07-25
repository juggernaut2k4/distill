import { describe, it, expect } from 'vitest'

/**
 * B2B-34 Part D — Hume-verified adaptive session cutoff.
 *
 * Per this repo's established Inngest-testing convention (see
 * tests/unit/voice-gap-watchdog.test.ts's own note): there is no harness in
 * this repo for driving an Inngest step function (step.sleep/step.run) body
 * directly, and building one is out of scope. Instead, inngest/
 * partner-live-cutoff.ts exports the pure decision logic the tiered loop and
 * gate check are built from — resolveVerificationGate(), selectPolling
 * IntervalSeconds(), and evaluateCutoffCycle() — and this file unit-tests
 * those directly. This covers every acceptance test in Part D §7 that is
 * expressible as a pure function of inputs:
 *   - gate resolution, including the below-80%/query-failure fallback (regression
 *     coverage for "runs exactly as it does today, byte-for-byte" when ungated)
 *   - tiered interval selection at various starting/remaining budgets
 *   - the fail-safe branch (Hume fetch failure -> Inngest-clock fallback, never
 *     force-ends on that signal alone)
 *   - the crossing-courtesy-grace branch that hands off into the existing
 *     nudge/force-end sequence
 * The step.sleep/step.run wiring itself (inngest/partner-live-cutoff.ts's
 * `partnerLiveCutoffJob`) is declarative Inngest config built directly on top
 * of these functions — nothing further to unit-test there beyond reading the
 * literal control flow, same reasoning as voice-gap-watchdog.ts.
 */

import {
  resolveVerificationGate,
  selectPollingIntervalSeconds,
  evaluateCutoffCycle,
  COURTESY_GRACE_MINUTES,
} from '@/inngest/partner-live-cutoff'

describe('resolveVerificationGate (§6.1 gate — regression coverage for the ungated path)', () => {
  it('is NOT gated when low_balance_alert_fired_at is null (account below 80% usage)', () => {
    expect(resolveVerificationGate({ low_balance_alert_fired_at: null }, null)).toBe(false)
  })

  it('is NOT gated when no wallet row exists', () => {
    expect(resolveVerificationGate(null, null)).toBe(false)
  })

  it('IS gated when low_balance_alert_fired_at is set (account at/above 80% usage)', () => {
    expect(resolveVerificationGate({ low_balance_alert_fired_at: '2026-07-20T00:00:00Z' }, null)).toBe(true)
  })

  it('§8 — treats a gate-check query failure as gate-not-met (falls back to the proven-safe ungated path)', () => {
    expect(
      resolveVerificationGate({ low_balance_alert_fired_at: '2026-07-20T00:00:00Z' }, { message: 'connection reset' })
    ).toBe(false)
  })
})

describe('selectPollingIntervalSeconds (§6.2 tiered schedule)', () => {
  it('given 45 affordable minutes, enters the 30-minute tier (not immediately the 10-minute tier)', () => {
    expect(selectPollingIntervalSeconds(45)).toBe(30 * 60)
  })

  it('given only 8 affordable minutes, enters the 5-minute tier directly (not the 30- or 10-minute tier)', () => {
    expect(selectPollingIntervalSeconds(8)).toBe(5 * 60)
  })

  it('generalizes to any starting budget — a session starting with 12 minutes begins in the 10-minute tier', () => {
    expect(selectPollingIntervalSeconds(12)).toBe(10 * 60)
  })

  it('under 5 minutes remaining checks every 1 minute', () => {
    expect(selectPollingIntervalSeconds(3)).toBe(60)
  })

  it('handles a very small starting budget (edge case: 1 minute) without divide-by-zero or negative behavior', () => {
    expect(selectPollingIntervalSeconds(1)).toBe(60)
    expect(Number.isFinite(selectPollingIntervalSeconds(1))).toBe(true)
  })
})

describe('evaluateCutoffCycle (§6.2 point 3/4, §6.3, §6.4 fail-safe)', () => {
  it('on a successful Hume fetch, recomputes remaining minutes from real elapsed time', () => {
    const result = evaluateCutoffCycle({
      affordableMinutes: 45,
      inngestClockRemainingMinutes: 15,
      humeResult: { ok: true, durationSeconds: 30 * 60 }, // 30 real minutes elapsed
    })
    expect(result.usedHumeVerification).toBe(true)
    expect(result.remainingMinutes).toBe(15)
    expect(result.shouldCutoffNow).toBe(false)
  })

  it('crossing the ~1-minute courtesy grace proceeds directly to the nudge/force-end sequence', () => {
    const result = evaluateCutoffCycle({
      affordableMinutes: 10,
      inngestClockRemainingMinutes: 5,
      humeResult: { ok: true, durationSeconds: 9.5 * 60 }, // 0.5 min remain — crosses the 1-min grace
    })
    expect(result.shouldCutoffNow).toBe(true)
    expect(result.remainingMinutes).toBeCloseTo(0.5)
  })

  it('exactly at the courtesy grace boundary triggers cutoff (<=, not <)', () => {
    const result = evaluateCutoffCycle({
      affordableMinutes: 10,
      inngestClockRemainingMinutes: 5,
      humeResult: { ok: true, durationSeconds: 9 * 60 }, // exactly 1 min remains
      courtesyGraceMinutes: COURTESY_GRACE_MINUTES,
    })
    expect(result.shouldCutoffNow).toBe(true)
  })

  it('on a failed Hume fetch, falls back to the Inngest-clock remaining time and does NOT force-end on that signal alone', () => {
    const result = evaluateCutoffCycle({
      affordableMinutes: 45,
      inngestClockRemainingMinutes: 15,
      humeResult: { ok: false, reason: 'timeout' },
    })
    expect(result.usedHumeVerification).toBe(false)
    expect(result.shouldCutoffNow).toBe(false)
    expect(result.remainingMinutes).toBe(15)
  })

  it('treats an in-progress-call "missing_timestamps" result the same as any other failure (safe fallback, no force-end)', () => {
    const result = evaluateCutoffCycle({
      affordableMinutes: 45,
      inngestClockRemainingMinutes: 20,
      humeResult: { ok: false, reason: 'missing_timestamps' },
    })
    expect(result.shouldCutoffNow).toBe(false)
    expect(result.remainingMinutes).toBe(20)
  })

  it('every single Hume check failing across a session never forces a cutoff via this function alone (the Inngest-clock loop itself still exhausts the budget)', () => {
    let remaining = 10
    for (let i = 0; i < 20; i++) {
      const result = evaluateCutoffCycle({
        affordableMinutes: 45,
        inngestClockRemainingMinutes: remaining,
        humeResult: { ok: false, reason: 'network_error: ECONNRESET' },
      })
      expect(result.shouldCutoffNow).toBe(false)
      remaining = result.remainingMinutes
    }
    // Confirms the fallback never itself decides to cut off — the caller's own
    // Inngest-clock-driven loop (decrementing remainingMinutes each sleep) is
    // what eventually crosses the grace and enters the existing safety net
    // (mark-session-completed), exactly as §7's last acceptance test requires.
    expect(remaining).toBe(10)
  })
})
