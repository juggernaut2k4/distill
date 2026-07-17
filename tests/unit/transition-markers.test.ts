import { describe, it, expect } from 'vitest'
import {
  matchesTransitionMarker,
  markerWordTokens,
  generateTransitionMarker,
  generateTransitionMarkers,
} from '@/lib/content/transition-markers'

describe('B2B-19 transition markers', () => {
  // AT-Q-B-1 — the transcript-watch match fires on the injected marker.
  it('matches when both marker words appear in the spoken text (hyphenated marker)', () => {
    const marker = 'kestrel-vellum-9471'
    expect(matchesTransitionMarker('...and so we say kestrel vellum 9471 to move on', marker)).toBe(true)
  })

  it('matches regardless of hyphen-vs-space transcription', () => {
    const marker = 'basalt-cobalt-3312'
    expect(matchesTransitionMarker('the phrase basalt-cobalt-3312 appears', marker)).toBe(true)
    expect(matchesTransitionMarker('the phrase basalt cobalt appears', marker)).toBe(true)
  })

  // AT-Q-B-4 — a common English word never triggers; only the system-unique marker does.
  it('does NOT match on common words or a single marker word', () => {
    const marker = 'juniper-saffron-5566'
    expect(matchesTransitionMarker('let us move on to the next section now', marker)).toBe(false)
    expect(matchesTransitionMarker('the juniper tree is nice', marker)).toBe(false) // only one word present
    expect(matchesTransitionMarker('', marker)).toBe(false)
  })

  it('markerWordTokens drops the digit tag', () => {
    expect(markerWordTokens('kestrel-vellum-9471')).toEqual(['kestrel', 'vellum'])
  })

  // AT-8 — generated markers never collide with the page narration.
  it('generates a marker whose words are absent from forbidden narration tokens', () => {
    const forbidden = new Set(['kestrel', 'vellum', 'basalt'])
    const used = new Set<string>()
    const marker = generateTransitionMarker(forbidden, used)
    for (const w of markerWordTokens(marker)) {
      expect(forbidden.has(w)).toBe(false)
    }
  })

  it('generates one unique marker per page, none colliding with narration', () => {
    const pages = [
      { title: 'Where we are today', subtitle: null, transitionTrigger: 'after current state' },
      { title: 'The three bets', subtitle: null, transitionTrigger: 'after the three bets' },
      { title: 'Risk posture', subtitle: null, transitionTrigger: 'wrap after risk' },
    ]
    const narration = 'Walk the exec through our three AI adoption bets and the risk posture for each.'
    const markers = generateTransitionMarkers(pages, narration)
    expect(markers).toHaveLength(3)
    expect(new Set(markers).size).toBe(3) // all distinct

    const narrationWords = new Set(narration.toLowerCase().match(/[a-z]+/g) ?? [])
    for (const m of markers) {
      for (const w of markerWordTokens(m)) {
        expect(narrationWords.has(w)).toBe(false)
      }
    }
  })

  // AT-Q-B-3 — the dual-signal race dedup: two signals for the same marker
  // advance exactly once. Simulates the client-side advanceOnTransition set.
  it('dedups both signals for the same marker to a single advance', () => {
    const fired = new Set<string>()
    let advances = 0
    const advanceOnTransition = (markerId: string) => {
      if (fired.has(markerId)) return
      fired.add(markerId)
      advances++
    }

    const marker = 'meridian-obsidian-7788'
    advanceOnTransition(marker) // transcript-watch signal
    advanceOnTransition(marker) // tool-call signal, same marker
    advanceOnTransition(marker) // any further signal
    expect(advances).toBe(1)
  })
})
