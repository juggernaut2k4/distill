import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { ADVANCE_DEBOUNCE_MS, shouldAdvanceOnTransition, type AdvanceDebounceRef } from '@/lib/partner/advance-transition'

/**
 * B2B-59 — dual-signal page-advance race: page 1→2 navigates correctly, then IMMEDIATELY jumps to
 * page 3, because both of B2B-19's redundant advance signals (transcript-watch, advance_tab
 * tool-call) resolve "which page's marker is this" by reading `activeIndexRef.current` FRESH at
 * the moment each is processed. If signal A advances the page first, a delayed echo of the SAME
 * real transition (signal B) resolves the NEW (never-fired) page's marker and slips past the
 * pre-existing per-marker dedup, producing a second, spurious advance.
 *
 * Fix: a shared, time-based debounce in `shouldAdvanceOnTransition` (lib/partner/advance-transition.ts),
 * additional to (not a replacement for) the existing per-marker dedup. See
 * .claude/agents/clio/feature-briefs/B2B-59-live-sync-double-advance-race.md.
 *
 * Part 1 (below) is real behavioral coverage of the extracted pure decision function —
 * `shouldAdvanceOnTransition` has no React/browser dependency, so it can be executed directly,
 * unlike `PartnerRenderClient.tsx` itself (see tests/unit/b2b58-show-visual-no-advance.test.ts's
 * established "not practically unit-testable via direct render" convention for that file, which
 * Part 2 below follows for confirming the component's *wiring* of this function).
 */

function freshRef(): AdvanceDebounceRef {
  return { current: null }
}

describe('B2B-59 — shouldAdvanceOnTransition debounce window', () => {
  it('ADVANCE_DEBOUNCE_MS matches the CEO-approved 2000ms window', () => {
    expect(ADVANCE_DEBOUNCE_MS).toBe(2000)
  })

  it('the very first call ever (no prior advance) succeeds', () => {
    const fired = new Set<string>()
    const lastAdvanceAtRef = freshRef()
    const result = shouldAdvanceOnTransition('kestrel-vellum-1000', 10_000, fired, lastAdvanceAtRef)
    expect(result).toBe(true)
    expect(fired.has('kestrel-vellum-1000')).toBe(true)
    expect(lastAdvanceAtRef.current).toBe(10_000)
  })

  it('same-marker case (pre-existing dedup): a second call with the IDENTICAL marker, immediately after, is blocked and results in exactly one advance', () => {
    const fired = new Set<string>()
    const lastAdvanceAtRef = freshRef()

    const first = shouldAdvanceOnTransition('kestrel-vellum-1000', 10_000, fired, lastAdvanceAtRef)
    const second = shouldAdvanceOnTransition('kestrel-vellum-1000', 10_050, fired, lastAdvanceAtRef)

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(fired.size).toBe(1)
  })

  it('the new race scenario: a second call with a DIFFERENT, never-before-seen marker, within the debounce window, is also blocked — exactly one advance total', () => {
    const fired = new Set<string>()
    const lastAdvanceAtRef = freshRef()

    // Signal A: page 1's transition fires, advances.
    const first = shouldAdvanceOnTransition('kestrel-vellum-1000', 10_000, fired, lastAdvanceAtRef)
    // Signal B: a delayed echo of the SAME real transition, but by the time it's processed
    // activeIndexRef.current has already moved, so it resolves page 2's marker — which has never
    // fired before. Without the debounce this would slip past firedMarkers and advance again.
    const second = shouldAdvanceOnTransition('basalt-cobalt-2000', 10_500, fired, lastAdvanceAtRef)

    expect(first).toBe(true)
    expect(second).toBe(false)
    // The blocked call must be a true no-op: the never-before-seen marker is NOT added to
    // firedMarkers, and lastAdvanceAtRef is not restamped.
    expect(fired.has('basalt-cobalt-2000')).toBe(false)
    expect(fired.size).toBe(1)
    expect(lastAdvanceAtRef.current).toBe(10_000)
  })

  it('a third, genuine call after the debounce window has fully elapsed succeeds normally', () => {
    const fired = new Set<string>()
    const lastAdvanceAtRef = freshRef()

    const first = shouldAdvanceOnTransition('kestrel-vellum-1000', 10_000, fired, lastAdvanceAtRef)
    const second = shouldAdvanceOnTransition('basalt-cobalt-2000', 10_500, fired, lastAdvanceAtRef) // blocked
    const third = shouldAdvanceOnTransition('basalt-cobalt-2000', 10_000 + ADVANCE_DEBOUNCE_MS + 1, fired, lastAdvanceAtRef)

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(third).toBe(true)
    expect(fired.has('basalt-cobalt-2000')).toBe(true)
    expect(fired.size).toBe(2)
    expect(lastAdvanceAtRef.current).toBe(10_000 + ADVANCE_DEBOUNCE_MS + 1)
  })

  it('a call landing exactly at the debounce boundary (now - lastAdvanceAt === debounceMs) is allowed (boundary is exclusive on the blocking side)', () => {
    const fired = new Set<string>()
    const lastAdvanceAtRef = freshRef()

    shouldAdvanceOnTransition('kestrel-vellum-1000', 10_000, fired, lastAdvanceAtRef)
    const atBoundary = shouldAdvanceOnTransition('basalt-cobalt-2000', 10_000 + ADVANCE_DEBOUNCE_MS, fired, lastAdvanceAtRef)

    expect(atBoundary).toBe(true)
  })

  it('a custom debounceMs override is honored (defense against a future config change silently no-op-ing this param)', () => {
    const fired = new Set<string>()
    const lastAdvanceAtRef = freshRef()

    shouldAdvanceOnTransition('kestrel-vellum-1000', 0, fired, lastAdvanceAtRef, 500)
    const blocked = shouldAdvanceOnTransition('basalt-cobalt-2000', 400, fired, lastAdvanceAtRef, 500)
    const allowed = shouldAdvanceOnTransition('basalt-cobalt-2000', 500, fired, lastAdvanceAtRef, 500)

    expect(blocked).toBe(false)
    expect(allowed).toBe(true)
  })
})

describe('B2B-59 — PartnerRenderClient.tsx wiring (source-text assertions, following the b2b58 convention for this file)', () => {
  const clientSrcRaw = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx'
    ),
    'utf8'
  )
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const clientSrc = stripComments(clientSrcRaw)

  it('imports shouldAdvanceOnTransition from the new pure decision module', () => {
    expect(clientSrc).toMatch(/import\s*\{\s*shouldAdvanceOnTransition\s*\}\s*from\s*'@\/lib\/partner\/advance-transition'/)
  })

  it('declares lastAdvanceAtRef alongside the existing firedMarkersRef', () => {
    expect(clientSrc).toMatch(/const lastAdvanceAtRef = useRef<number \| null>\(null\)/)
  })

  it('advanceOnTransition delegates the decision to shouldAdvanceOnTransition and only advances on true, threading the real refs (not fresh local state)', () => {
    const fnStart = clientSrcRaw.indexOf('function advanceOnTransition(transitionMarker: string) {')
    expect(fnStart).toBeGreaterThan(-1)
    const fnEnd = clientSrcRaw.indexOf('\n  }', fnStart)
    const fnBody = stripComments(clientSrcRaw.slice(fnStart, fnEnd))

    expect(fnBody).toMatch(
      /if \(!shouldAdvanceOnTransition\(transitionMarker, Date\.now\(\), firedMarkersRef\.current, lastAdvanceAtRef\)\) return/
    )
    expect(fnBody).toMatch(/goToSection\(next\)/)
  })

  it('firedMarkersRef declaration and its per-marker dedup semantics are unchanged (debounce is additional, not a replacement)', () => {
    expect(clientSrc).toMatch(/const firedMarkersRef = useRef<Set<string>>\(new Set\(\)\)/)
  })

  it('templateTools (legacy non-inline path) does not reference the new debounce machinery — confirmed out of scope', () => {
    const templateToolsStart = clientSrcRaw.indexOf('const templateTools = {')
    const templateToolsBlock = stripComments(clientSrcRaw.slice(templateToolsStart))
    expect(templateToolsBlock).not.toMatch(/shouldAdvanceOnTransition/)
    expect(templateToolsBlock).not.toMatch(/lastAdvanceAtRef/)
  })
})
