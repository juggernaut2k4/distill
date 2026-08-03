/**
 * B2B-71 (docs/specs/B2B-71-requirement-document.md §6.4) — rate/abuse guard for the widget
 * channel's on-topic visual jump. Structurally mirrors `lib/partner/advance-transition.ts`'s own
 * proven pure-function/testable-ref pattern, but a distinct concept (a genuinely new, standalone
 * file, not a shared import) — jump-debounce and forward-advance-debounce answer different
 * questions and must not be conflated.
 */

/** Minimum time between two successful jumps. Absorbs an accidental double-fire of a single
 *  question (the model calling show_visual twice for what is really one utterance) without
 *  blocking two genuinely distinct rapid-fire questions a real participant can plausibly ask a few
 *  seconds apart. */
export const JUMP_DEBOUNCE_MS = 2000

/** Hard ceiling on jumps per rolling minute, guarding against a pathological/adversarial run of
 *  tangential questions thrashing the screen. Fixed (not rolling) 60s window for simplicity and
 *  direct testability. Beyond the ceiling, further jumps are silently suppressed (Clio keeps
 *  answering verbally; only the screen stops moving) rather than erroring, so the model's own
 *  turn-taking is never disrupted by an apparent tool failure. */
export const MAX_JUMPS_PER_WINDOW = 8
export const JUMP_WINDOW_MS = 60_000

export interface JumpGuardState {
  lastJumpAt: number | null
  windowStartedAt: number | null
  jumpsInWindow: number
}

export function createJumpGuardState(): JumpGuardState {
  return { lastJumpAt: null, windowStartedAt: null, jumpsInWindow: 0 }
}

/**
 * True iff a jump should actually be allowed to move the screen right now. Side-effecting on a
 * `true` result (mirrors `shouldAdvanceOnTransition`'s own convention): stamps `lastJumpAt`, and
 * increments/resets the fixed-window counter. On `false`, state is left untouched.
 */
export function shouldAllowJump(state: JumpGuardState, now: number): boolean {
  if (state.lastJumpAt !== null && now - state.lastJumpAt < JUMP_DEBOUNCE_MS) return false

  if (state.windowStartedAt === null || now - state.windowStartedAt >= JUMP_WINDOW_MS) {
    state.windowStartedAt = now
    state.jumpsInWindow = 0
  }
  if (state.jumpsInWindow >= MAX_JUMPS_PER_WINDOW) return false

  state.lastJumpAt = now
  state.jumpsInWindow += 1
  return true
}
