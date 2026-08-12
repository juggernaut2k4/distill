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
 * B2B-60 — Stage 1 of the two-stage natural transition mechanism: a single,
 * fixed, global wrap-up phrase Clio says naturally when she's finished
 * covering a page. Arms detection for Stage 2 (the next page's title — see
 * `computeStage2Eligibility` / `matchesSpokenPhrase` below). Deliberately one
 * fixed string, shared across every transition, every session, every partner
 * — not per-page or per-partner-configurable (Arun's design). Because it
 * can't be regenerated per-session the way the old random marker could, its
 * safety comes from being a self-referential, discourse-level clause
 * ("what I wanted to walk through here") rather than generic business
 * vocabulary — see the non-blocking collision check in
 * `lib/partner/live-render.ts`'s `buildInlineSessionContent` (§5 of the
 * B2B-60 feature brief).
 */
export const STAGE_1_WRAP_UP_PHRASE = 'That covers what I wanted to walk through here.'

/**
 * True iff `phrase`'s word tokens appear in `spokenText` as an ordered,
 * bounded-proximity subsequence — each successive phrase word must be found
 * within `maxGap` tokens of the previous match (default 3), preserving
 * relative order. This is intentionally STRICTER than `matchesTransitionMarker`'s
 * pure set-membership check: that check is only safe for the old system
 * because its marker words (kestrel, vellum, ...) are rare enough that set
 * membership alone is the whole safety margin. Natural-language phrases
 * reuse common words constantly, so a phrase like "That covers what I wanted
 * to walk through here" would false-fire under pure set-matching on any
 * utterance that happens to contain all of those words scattered anywhere,
 * in any order, over a long enough stretch of narration. Safety here instead
 * comes from requiring the words to actually appear together, in order, the
 * way the phrase would be spoken.
 *
 * Used for Stage 1 (fixed wrap-up phrase) and Stage 2 (next-page title)
 * detection in `PartnerRenderClient.tsx`. `matchesTransitionMarker` is
 * unchanged and untouched, and is no longer used for any live
 * spoken-transcript matching — `transitionMarker` now serves only as an
 * internal, never-spoken dedup key.
 */
export function matchesSpokenPhrase(spokenText: string, phrase: string, maxGap = 3): boolean {
  const phraseWords = wordTokens(phrase)
  if (phraseWords.length === 0) return false
  const spokenWords = wordTokens(spokenText)
  if (spokenWords.length === 0) return false

  let searchFrom = 0
  for (const word of phraseWords) {
    let found = -1
    const limit = Math.min(spokenWords.length, searchFrom + maxGap + 1)
    for (let i = searchFrom; i < limit; i++) {
      if (spokenWords[i] === word) {
        found = i
        break
      }
    }
    if (found === -1) return false
    searchFrom = found + 1
  }
  return true
}

export interface EligibilityPageInput {
  title: string | null
  subtitle?: string | null
  transitionTrigger?: string | null
}

/**
 * B2B-60 — Per-transition (i.e. "advancing FROM page i") eligibility for
 * Stage-2 transcript detection. Returns an array of length `pages.length`;
 * index i is true iff page i+1's title is distinctive enough (>= 1 word
 * token of length >= 4) AND none of its word tokens collide with any OTHER
 * page's title/subtitle/transitionTrigger or the session narration. The
 * LAST index is always false (no next page to detect).
 *
 * Ineligible transitions simply fall back to the existing `advance_tab`
 * tool-call as the sole advance signal for that specific transition —
 * nothing else in the dual-signal system changes, and this can never be
 * worse than today's shipped reliability.
 *
 * Reuses the identical collision-check pattern and scope of source text as
 * `generateTransitionMarkers`' `forbidden` set, adapted for titles instead
 * of marker words.
 */
export function computeStage2Eligibility(pages: EligibilityPageInput[], narrationText: string): boolean[] {
  const sessionForbidden = new Set<string>(wordTokens(narrationText))

  // Per-page word sets (title/subtitle/transitionTrigger), built once so each
  // page's own words can be excluded when checking against "any OTHER page".
  const perPageWords = pages.map((p) => new Set(wordTokens(`${p.title ?? ''} ${p.subtitle ?? ''} ${p.transitionTrigger ?? ''}`)))

  return pages.map((_, i) => {
    if (i === pages.length - 1) return false // last index — no next page

    const nextPage = pages[i + 1]
    const nextTitleWords = wordTokens(nextPage.title)
    if (!nextTitleWords.some((w) => w.length >= 4)) return false // too short/generic

    // Build the "forbidden" scope for this specific next-title: session narration
    // plus every OTHER page's title/subtitle/transitionTrigger (excluding the next
    // page's own entry, since a title trivially contains its own words).
    const forbidden = new Set<string>(sessionForbidden)
    perPageWords.forEach((words, j) => {
      if (j === i + 1) return
      words.forEach((w) => forbidden.add(w))
    })

    return !nextTitleWords.some((w) => forbidden.has(w))
  })
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
