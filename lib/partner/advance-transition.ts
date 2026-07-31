/**
 * B2B-59 — Pure decision core of `advanceOnTransition`, extracted out of
 * `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` so it can be
 * directly unit-tested. That client component has browser/WebRTC/Hume dependencies (mic capture,
 * WebSocket connection) that make it "isn't practically unit-testable via direct render" (see
 * tests/unit/b2b58-show-visual-no-advance.test.ts's established convention for this exact file) —
 * and `eval`/`Function()` are prohibited by CLAUDE.md, so re-executing the component's own source
 * text isn't an option either. Extracting the actual decision logic into a small,
 * dependency-free, directly-importable function (same pattern as
 * lib/content/transition-markers.ts's `matchesTransitionMarker`) is what makes real behavioral
 * proof possible.
 *
 * DEPENDENCY-FREE / CLIENT-SAFE, like transition-markers.ts — imported only by
 * PartnerRenderClient.tsx (client-side) and this module's own test file.
 *
 * Root cause being fixed: both of B2B-19's redundant advance signals (transcript-watch,
 * advance_tab tool-call) resolve "which page's marker is this transition about" by reading
 * `activeIndexRef.current` FRESH at the moment each is processed, not pinned to the specific
 * transition they're reporting on. If signal A fires first and advances the page, a delayed echo
 * of the SAME real transition (signal B) reads the NEW page's marker — which has never fired
 * before — and legitimately advances again by the pre-existing per-marker dedup alone. See
 * .claude/agents/clio/feature-briefs/B2B-59-live-sync-double-advance-race.md for the full
 * investigation.
 *
 * Fix: a shared, time-based debounce/lock, independent of and in addition to the existing
 * per-marker dedup (firedMarkers). Any call is ignored if it arrives within `debounceMs` of the
 * previous successful advance — regardless of which marker it resolves to. This closes the
 * loophole unconditionally: it does not matter that a delayed second signal resolves a *different*
 * (fresh, not-yet-fired) marker after the index moved, because the debounce doesn't key on the
 * marker at all.
 *
 * Do NOT change the existing per-marker dedup (`firedMarkers`) — this debounce is an ADDITIONAL
 * layer, not a replacement (explicit B2B-19 / B2B-59 constraint).
 */

/** 2000ms, per the CEO brief: two GENUINE transitions cannot occur this close together, because
 * the prompt requires Clio to teach a section, ask a verification question, and wait for/respond
 * to the answer before calling advance_tab again. This window can only ever suppress the specific
 * double-fire this bug produces, never a legitimate fast transition. */
export const ADVANCE_DEBOUNCE_MS = 2000

/** Minimal ref-shaped container so this module stays React-free while still being usable directly
 * with a real `useRef<number | null>(null)` from the component (React ref objects are plain
 * `{ current: T }` objects — no React import needed here to accept one). */
export interface AdvanceDebounceRef {
  current: number | null
}

/**
 * True iff `advanceOnTransition` should actually advance the page for this call. Side-effecting on
 * a `true` result (mirrors the ref-mutation `advanceOnTransition` itself already performs): adds
 * `marker` to `firedMarkers` and stamps `lastAdvanceAtRef.current = now`. On a `false` result,
 * neither `firedMarkers` nor `lastAdvanceAtRef` is touched — a blocked call must be a true no-op.
 *
 * Order matters and is deliberate (per the CEO brief): the time-based debounce check runs BEFORE
 * the marker dedup check, so it blocks unconditionally regardless of which marker the caller
 * resolved.
 */
export function shouldAdvanceOnTransition(
  marker: string,
  now: number,
  firedMarkers: Set<string>,
  lastAdvanceAtRef: AdvanceDebounceRef,
  debounceMs: number = ADVANCE_DEBOUNCE_MS
): boolean {
  if (lastAdvanceAtRef.current !== null && now - lastAdvanceAtRef.current < debounceMs) return false // B2B-59 debounce
  if (firedMarkers.has(marker)) return false // pre-existing B2B-19 per-marker dedup, unchanged

  firedMarkers.add(marker)
  lastAdvanceAtRef.current = now
  return true
}
