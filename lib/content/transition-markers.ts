/**
 * B2B-19 — Transition markers for partner inline-content sessions.
 *
 * DEPENDENCY-FREE / CLIENT-SAFE. This module is imported both server-side (at
 * session initiation, to generate + collision-check markers) and client-side
 * (PartnerRenderClient.tsx, to match them against the bot's live speech). It
 * must never pull in a server-only SDK — like lib/content/tokenize.ts, keep it
 * import-free.
 *
 * A transition marker is a system-generated, near-zero-natural-occurrence
 * phrase (two uncommon words + a random 4-digit tag, e.g. "kestrel-vellum-9471")
 * injected into what the bot is told to say at a page's transition point
 * (Requirement Doc Section 2). It is NEVER the partner's raw `transition_trigger`
 * string (which is a common-word false-trigger risk Arun named) — that string is
 * used only as the intent label to position the marker.
 *
 * Detection matches on the two WORD tokens, ignoring the digits and any
 * hyphen/space rendering the transcript happens to use, so the same match fires
 * whether Hume renders "kestrel-vellum-9471" or "kestrel vellum 9471".
 */

// Uncommon-but-cleanly-transcribable words. Two of these co-occurring in one
// utterance has near-zero natural probability, which is what makes the marker
// safe to advance on from a single decisive hit (RTV-03 semantics).
const MARKER_WORDS = [
  'kestrel', 'vellum', 'basalt', 'cobalt', 'quartz', 'thistle', 'marlin', 'cinder',
  'lantern', 'harbor', 'juniper', 'saffron', 'meridian', 'obsidian', 'zephyr', 'cascade',
  'falcon', 'granite', 'amber', 'indigo', 'nimbus', 'onyx', 'peregrine', 'sable',
  'tarragon', 'umber', 'verdant', 'willow', 'yarrow', 'azimuth', 'beacon', 'citron',
  'dahlia', 'ember', 'fathom', 'glacier', 'halcyon', 'ivory', 'jasper', 'kelp',
]

/** Lowercased alphabetic word tokens (length >= 3) from arbitrary text. Robust to hyphens/spaces/punctuation. */
function wordTokens(text: string | null | undefined): string[] {
  if (!text) return []
  return (text.normalize('NFKC').toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 3)
}

/** The two matchable word tokens of a marker phrase (drops the digit tag). */
export function markerWordTokens(marker: string): string[] {
  return wordTokens(marker)
}

/**
 * True iff every word token of `marker` appears in `spokenText`. Ignores the
 * digit tag and is agnostic to hyphen-vs-space transcription. Deterministic and
 * side-effect-free — the unit-testable core of the transcript-watch signal.
 */
export function matchesTransitionMarker(spokenText: string, marker: string): boolean {
  const markerWords = markerWordTokens(marker)
  if (markerWords.length === 0) return false
  const spoken = new Set(wordTokens(spokenText))
  return markerWords.every((w) => spoken.has(w))
}

function randInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive)
}

/**
 * Generates one marker phrase whose two words collide with neither `forbidden`
 * (tokens appearing in the page narration/content — AT-8 collision check) nor
 * `usedWords` (words already claimed by another page's marker this session).
 * Falls back to appending an extra random digit tag if the word pool is
 * exhausted, so it always returns a usable, unique phrase.
 */
export function generateTransitionMarker(forbidden: Set<string>, usedWords: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const a = MARKER_WORDS[randInt(MARKER_WORDS.length)]
    const b = MARKER_WORDS[randInt(MARKER_WORDS.length)]
    if (a === b) continue
    if (forbidden.has(a) || forbidden.has(b)) continue
    if (usedWords.has(a) || usedWords.has(b)) continue
    usedWords.add(a)
    usedWords.add(b)
    const tag = 1000 + randInt(9000)
    return `${a}-${b}-${tag}`
  }
  // Extremely unlikely fallback — guarantees termination + uniqueness.
  const tag = Date.now() % 100000
  return `marker-${tag}-${randInt(9000)}`
}

export interface MarkerPageInput {
  title?: string | null
  subtitle?: string | null
  transitionTrigger: string
}

/**
 * Generates one collision-checked marker per page (Requirement Doc Section 2.1).
 * `narrationText` is the union of narration inputs the bot will speak
 * (content_to_explain + per-page titles/subtitles/triggers) — the marker words
 * are guaranteed not to appear in it, so the marker can never occur incidentally
 * in the bot's natural speech (AT-8).
 */
export function generateTransitionMarkers(pages: MarkerPageInput[], narrationText: string): string[] {
  const forbidden = new Set<string>(wordTokens(narrationText))
  for (const p of pages) {
    for (const w of wordTokens(`${p.title ?? ''} ${p.subtitle ?? ''} ${p.transitionTrigger}`)) forbidden.add(w)
  }
  const usedWords = new Set<string>()
  return pages.map(() => generateTransitionMarker(forbidden, usedWords))
}
