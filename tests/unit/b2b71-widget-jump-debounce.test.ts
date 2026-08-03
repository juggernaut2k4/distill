import { describe, it, expect } from 'vitest'
import { createJumpGuardState, shouldAllowJump, JUMP_DEBOUNCE_MS, MAX_JUMPS_PER_WINDOW, JUMP_WINDOW_MS } from '@/lib/partner/widget-jump-debounce'

/**
 * B2B-71 (docs/specs/B2B-71-requirement-document.md §6.4/§13) — shouldAllowJump tests. Structurally
 * mirrors advance-transition.ts's own testable-ref pattern, but a genuinely distinct guard (jump vs.
 * forward-advance debounce answer different questions) — new, standalone test coverage.
 */

describe('shouldAllowJump', () => {
  it('allows the first jump', () => {
    const state = createJumpGuardState()
    expect(shouldAllowJump(state, 1000)).toBe(true)
  })

  it('blocks a second jump within JUMP_DEBOUNCE_MS of the first', () => {
    const state = createJumpGuardState()
    expect(shouldAllowJump(state, 1000)).toBe(true)
    expect(shouldAllowJump(state, 1000 + JUMP_DEBOUNCE_MS - 1)).toBe(false)
  })

  it('allows a second jump exactly at the debounce boundary and beyond', () => {
    const state = createJumpGuardState()
    expect(shouldAllowJump(state, 1000)).toBe(true)
    expect(shouldAllowJump(state, 1000 + JUMP_DEBOUNCE_MS)).toBe(true)
  })

  it('leaves state untouched on a blocked (false) call', () => {
    const state = createJumpGuardState()
    shouldAllowJump(state, 1000)
    const beforeBlock = { ...state }
    shouldAllowJump(state, 1000 + 500) // blocked — within debounce window
    expect(state).toEqual(beforeBlock)
  })

  it(`allows exactly ${MAX_JUMPS_PER_WINDOW} jumps within one fixed 60s window, blocking the (${MAX_JUMPS_PER_WINDOW + 1})th`, () => {
    const state = createJumpGuardState()
    let now = 0
    let allowed = 0
    for (let i = 0; i < MAX_JUMPS_PER_WINDOW + 1; i++) {
      now += JUMP_DEBOUNCE_MS // step past the per-jump debounce each time, so only the window cap is being tested
      if (shouldAllowJump(state, now)) allowed++
    }
    expect(allowed).toBe(MAX_JUMPS_PER_WINDOW)
  })

  it('resets the window counter once JUMP_WINDOW_MS has elapsed since the window started', () => {
    const state = createJumpGuardState()
    let now = 0
    for (let i = 0; i < MAX_JUMPS_PER_WINDOW; i++) {
      now += JUMP_DEBOUNCE_MS
      expect(shouldAllowJump(state, now)).toBe(true)
    }
    // Cap reached — next jump within the same window is blocked.
    now += JUMP_DEBOUNCE_MS
    expect(shouldAllowJump(state, now)).toBe(false)

    // A new window (JUMP_WINDOW_MS after the window started) resets the counter.
    const nextWindowStart = now + JUMP_WINDOW_MS
    expect(shouldAllowJump(state, nextWindowStart)).toBe(true)
  })
})
