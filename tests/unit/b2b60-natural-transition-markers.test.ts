import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  matchesSpokenPhrase,
  computeStage2Eligibility,
  STAGE_1_WRAP_UP_PHRASE,
  type EligibilityPageInput,
} from '@/lib/content/transition-markers'
import { buildInlineSessionContent, type InlineContentPage, type PartnerSessionRow } from '@/lib/partner/live-render'

/**
 * B2B-60 — Natural two-stage transition markers, replacing the system-generated random-word
 * marker phrase with (1) a fixed wrap-up line, then (2) the next page's real title, said
 * naturally. See .claude/agents/clio/feature-briefs/B2B-60-natural-two-stage-transition-markers.md.
 *
 * §3 is the most important technical catch in the brief: matchesSpokenPhrase must be
 * order-and-proximity-aware, NOT pure set-membership (matchesTransitionMarker's check) — natural
 * language phrases reuse common words constantly, so word-set matching alone would false-fire.
 */

describe('B2B-60 — matchesSpokenPhrase (order + proximity aware, §3)', () => {
  it('matches an exact spoken phrase', () => {
    expect(matchesSpokenPhrase('so, that covers what I wanted to walk through here, thanks', STAGE_1_WRAP_UP_PHRASE)).toBe(true)
  })

  it('tolerates 1-2 filler/ASR-noise words inserted between phrase words', () => {
    // "that" ... "covers" (ok, adjacent) ... "really what" (1 filler) ... "I" ... "kind of wanted" (1 filler) ...
    expect(matchesSpokenPhrase('that covers really what I kind of wanted to walk right through here today', STAGE_1_WRAP_UP_PHRASE)).toBe(true)
  })

  it('does NOT match when phrase words are present but scattered far apart (out of proximity)', () => {
    // Every word from the phrase appears somewhere, but spread across a long stretch of narration
    // — this is the exact false-positive class matchesTransitionMarker's set-matching would allow.
    const spoken =
      'that is a great point about our roadmap covers a lot of ground honestly what our customers ' +
      'have wanted for years is more visibility so let us walk the team through what happened here today'
    expect(matchesSpokenPhrase(spoken, STAGE_1_WRAP_UP_PHRASE)).toBe(false)
  })

  it('does NOT match when phrase words are present but out of order', () => {
    expect(matchesSpokenPhrase('here we walk through what wanted I covers that', STAGE_1_WRAP_UP_PHRASE)).toBe(false)
  })

  it('does NOT match on a partial phrase (not all words present)', () => {
    expect(matchesSpokenPhrase('that covers what I wanted to discuss today', STAGE_1_WRAP_UP_PHRASE)).toBe(false)
  })

  it('does NOT match empty spoken text or empty phrase', () => {
    expect(matchesSpokenPhrase('', STAGE_1_WRAP_UP_PHRASE)).toBe(false)
    expect(matchesSpokenPhrase('some text', '')).toBe(false)
  })

  it('matches a next-page title said naturally mid-sentence (Stage 2 use case)', () => {
    expect(matchesSpokenPhrase("now let's turn to Pricing Strategy and see how it plays out", 'Pricing Strategy')).toBe(true)
  })

  it('respects a custom maxGap', () => {
    // "kestrel" then 4 filler words then "vellum" — outside default maxGap=3, but within maxGap=5.
    const spoken = 'kestrel one two three four vellum'
    expect(matchesSpokenPhrase(spoken, 'kestrel vellum', 3)).toBe(false)
    expect(matchesSpokenPhrase(spoken, 'kestrel vellum', 5)).toBe(true)
  })
})

describe('B2B-60 — computeStage2Eligibility (§2)', () => {
  it('the last index is always false, regardless of title content', () => {
    const pages: EligibilityPageInput[] = [
      { title: 'Where We Are Today', transitionTrigger: 'after intro' },
      { title: 'The Three Bets', transitionTrigger: 'after bets' },
      { title: 'Risk Posture', transitionTrigger: 'wrap' },
    ]
    const result = computeStage2Eligibility(pages, '')
    expect(result).toHaveLength(3)
    expect(result[2]).toBe(false)
  })

  it('a distinctive, non-colliding next title is eligible', () => {
    const pages: EligibilityPageInput[] = [
      { title: 'Where We Are Today', transitionTrigger: 'after intro' },
      { title: 'The Three Adoption Bets', transitionTrigger: 'after bets' },
    ]
    const result = computeStage2Eligibility(pages, 'A short narration blob about strategy.')
    expect(result[0]).toBe(true)
  })

  it('a next title that is too short/generic (no word token >= 4 chars) is ineligible', () => {
    const pages: EligibilityPageInput[] = [
      { title: 'Overview', transitionTrigger: 'after intro' },
      { title: 'Q&A', transitionTrigger: 'wrap' },
    ]
    const result = computeStage2Eligibility(pages, '')
    expect(result[0]).toBe(false) // next page (index 1) title "Q&A" has no word token >= 4 chars
  })

  it('a next title colliding with another page\'s title is ineligible', () => {
    const pages: EligibilityPageInput[] = [
      { title: 'Page One', transitionTrigger: 'after one' },
      { title: 'Pricing Strategy', transitionTrigger: 'after pricing' },
      { title: 'Pricing Strategy Recap', transitionTrigger: 'wrap' }, // shares "pricing"/"strategy" with page index 1
    ]
    const result = computeStage2Eligibility(pages, '')
    // Transition FROM page 0 targets page 1's title "Pricing Strategy" — collides with page 2's title.
    expect(result[0]).toBe(false)
  })

  it('a next title colliding with the session-level narration text is ineligible', () => {
    const pages: EligibilityPageInput[] = [
      { title: 'Intro', transitionTrigger: 'after intro' },
      { title: 'Vendor Evaluation', transitionTrigger: 'wrap' },
    ]
    const narrationText = 'This session focuses on vendor evaluation criteria for the executive team.'
    const result = computeStage2Eligibility(pages, narrationText)
    expect(result[0]).toBe(false)
  })

  it('a null next-page title is ineligible (no word tokens to key on)', () => {
    const pages: EligibilityPageInput[] = [
      { title: 'Intro', transitionTrigger: 'after intro' },
      { title: null, transitionTrigger: 'wrap' },
    ]
    const result = computeStage2Eligibility(pages, '')
    expect(result[0]).toBe(false)
  })

  it("does not falsely flag a title's own words as colliding with itself", () => {
    const pages: EligibilityPageInput[] = [
      { title: 'Intro', transitionTrigger: 'after intro' },
      { title: 'Building Momentum', transitionTrigger: 'wrap' },
    ]
    const result = computeStage2Eligibility(pages, '')
    expect(result[0]).toBe(true)
  })

  it('empty pages array returns empty array without throwing', () => {
    expect(computeStage2Eligibility([], '')).toEqual([])
  })
})

describe('B2B-60 — buildInlineSessionContent prompt wording (§4b/§4c)', () => {
  const BASE_SESSION: PartnerSessionRow = {
    id: 'session-1',
    partnerAccountId: 'partner-1',
    contentRef: null,
    partnerTopicRef: null,
    partnerEndUserRef: null,
    status: 'requested',
    testMode: false,
    contentSourceId: null,
    contentPages: null,
    contentToExplain: null,
    contentTitle: null,
    contentSubtitle: null,
    endUserRole: null,
    endUserName: null,
    endUserIndustry: null,
    providerBotId: null,
    conversationLanguage: null,
  }

  function makePage(overrides: Partial<InlineContentPage> = {}): InlineContentPage {
    return {
      url: 'https://content.example.com/1.html',
      media_type: 'html',
      title: 'What Is Claude?',
      subtitle: null,
      transition_trigger: 'after page one',
      transition_marker: 'kestrel-vellum-9471',
      content_text: null,
      ...overrides,
    }
  }

  it('non-last page: instructs the fixed Stage 1 phrase and naming the next page title, NOT the old transition_marker', () => {
    const page1 = makePage({ title: 'Page One', transition_marker: 'kestrel-vellum-9471' })
    const page2 = makePage({ title: 'Page Two', transition_marker: 'basalt-cobalt-3312' })
    const result = buildInlineSessionContent(BASE_SESSION, [page1, page2])

    expect(result).toContain(`say "${STAGE_1_WRAP_UP_PHRASE}" naturally as part of your sentence.`)
    expect(result).toContain('naturally say its name — "Page Two"')
    expect(result).toContain('Only after you have said the next part\'s name should you call the advance_tab tool.')
    // The old spoken-marker phrases must never appear in the prompt text.
    expect(result).not.toContain('kestrel-vellum-9471')
    expect(result).not.toContain('basalt-cobalt-3312')
  })

  it('last page: drops the spoken-marker instruction entirely and defers to the closing sequence', () => {
    // Single-page session so the only STAGE DIRECTION block present is the last-page one —
    // isolates the assertion to the last-page branch specifically (a multi-page session's
    // earlier, non-last pages legitimately DO contain the wrap-up phrase instruction).
    const onlyPage = makePage({ title: 'Final Page', transition_marker: 'basalt-cobalt-3312' })
    const result = buildInlineSessionContent(BASE_SESSION, [onlyPage])

    expect(result).toContain('This is the final page')
    expect(result).toContain('follow the closing sequence (rule 8) and call the end_session tool.')
    expect(result).not.toContain('basalt-cobalt-3312')
    expect(result).not.toContain(STAGE_1_WRAP_UP_PHRASE) // no wrap-up phrase instruction on the last page
  })

  it('non-last page with a null next-page title drops the naming clause but keeps the wrap-up phrase instruction', () => {
    const page1 = makePage({ title: 'Page One' })
    const page2 = makePage({ title: null })
    const result = buildInlineSessionContent(BASE_SESSION, [page1, page2])

    expect(result).toContain(`say "${STAGE_1_WRAP_UP_PHRASE}" naturally as part of your sentence.`)
    expect(result).not.toContain('naturally say its name')
  })

  it('§5 — warns (non-blocking) when session narration collides with the fixed Stage 1 phrase, and never throws', () => {
    const warnSpy = { called: false, args: [] as unknown[] }
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnSpy.called = true
      warnSpy.args = args
    }
    try {
      const collidingSession: PartnerSessionRow = {
        ...BASE_SESSION,
        contentToExplain: 'That covers what I wanted to walk through here in this executive briefing.',
      }
      const result = buildInlineSessionContent(collidingSession, [makePage({ title: 'Page One' }), makePage({ title: 'Page Two' })])
      expect(warnSpy.called).toBe(true)
      expect(result).toBeTruthy() // session creation / prompt assembly is never blocked
    } finally {
      console.warn = originalWarn
    }
  })

  it('§5 — does not warn when narration has no collision with the fixed Stage 1 phrase', () => {
    const warnSpy = { called: false }
    const originalWarn = console.warn
    console.warn = () => {
      warnSpy.called = true
    }
    try {
      buildInlineSessionContent(
        { ...BASE_SESSION, contentToExplain: 'A normal executive briefing about AI adoption strategy.' },
        [makePage({ title: 'Page One' }), makePage({ title: 'Page Two' })]
      )
      expect(warnSpy.called).toBe(false)
    } finally {
      console.warn = originalWarn
    }
  })
})

describe('B2B-60 — matchesTransitionMarker, generateTransitionMarker(s), MarkerPageInput remain unchanged (Known Constraints)', () => {
  it('transition-markers.ts still exports the pre-existing marker-generation API', async () => {
    const mod = await import('@/lib/content/transition-markers')
    expect(typeof mod.matchesTransitionMarker).toBe('function')
    expect(typeof mod.generateTransitionMarker).toBe('function')
    expect(typeof mod.generateTransitionMarkers).toBe('function')
    expect(typeof mod.markerWordTokens).toBe('function')
  })
})

describe('B2B-60 — PartnerRenderClient.tsx wiring (source-text assertions, following the b2b58/b2b59 convention for this file)', () => {
  const clientSrcRaw = fs.readFileSync(
    path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx'),
    'utf8'
  )
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const clientSrc = stripComments(clientSrcRaw)

  it('imports matchesSpokenPhrase, computeStage2Eligibility, and STAGE_1_WRAP_UP_PHRASE from the transition-markers module', () => {
    expect(clientSrc).toMatch(
      /import\s*\{\s*matchesSpokenPhrase,\s*computeStage2Eligibility,\s*STAGE_1_WRAP_UP_PHRASE\s*\}\s*from\s*'@\/lib\/content\/transition-markers'/
    )
  })

  it('declares stage1ArmedRef, initialized to false', () => {
    expect(clientSrc).toMatch(/const stage1ArmedRef = useRef\(false\)/)
  })

  it('declares stage2EligibleRef, computed via computeStage2Eligibility', () => {
    // B2B-62 — this declaration now spans multiple lines (gated by isEnglishSession), so the
    // regex allows computeStage2Eligibility( to appear anywhere after the useRef<boolean[]>( open,
    // not just on the same line.
    expect(clientSrc).toMatch(/const stage2EligibleRef = useRef<boolean\[\]>\([\s\S]*?computeStage2Eligibility\(/)
  })

  it('advanceOnTransition resets stage1ArmedRef.current to false between the debounce guard and goToSection', () => {
    const fnStart = clientSrcRaw.indexOf('function advanceOnTransition(transitionMarker: string) {')
    expect(fnStart).toBeGreaterThan(-1)
    const fnEnd = clientSrcRaw.indexOf('\n  }', fnStart)
    const fnBody = stripComments(clientSrcRaw.slice(fnStart, fnEnd))

    const guardIdx = fnBody.indexOf('if (!shouldAdvanceOnTransition(transitionMarker, Date.now(), firedMarkersRef.current, lastAdvanceAtRef)) return')
    const resetIdx = fnBody.indexOf('stage1ArmedRef.current = false')
    const gotoIdx = fnBody.indexOf('goToSection(next)')

    expect(guardIdx).toBeGreaterThan(-1)
    expect(resetIdx).toBeGreaterThan(guardIdx)
    expect(gotoIdx).toBeGreaterThan(resetIdx)
  })

  it('the inline onMessage handler no longer references matchesTransitionMarker (no longer used for live transcript matching)', () => {
    const onMessageStart = clientSrcRaw.indexOf('const onMessage = isInline')
    const onMessageEnd = clientSrcRaw.indexOf('const adapter = await HumeAdapter.create(')
    const onMessageBlock = stripComments(clientSrcRaw.slice(onMessageStart, onMessageEnd))
    expect(onMessageBlock).not.toMatch(/matchesTransitionMarker/)
  })

  it('the inline onMessage handler returns early on the last page and when Stage 2 is ineligible', () => {
    const onMessageStart = clientSrcRaw.indexOf('const onMessage = isInline')
    const onMessageEnd = clientSrcRaw.indexOf('const adapter = await HumeAdapter.create(')
    const onMessageBlock = stripComments(clientSrcRaw.slice(onMessageStart, onMessageEnd))

    expect(onMessageBlock).toMatch(/if \(idx === count - 1\) return/)
    expect(onMessageBlock).toMatch(/if \(!stage2EligibleRef\.current\[idx\]\) return/)
  })

  it('the inline onMessage handler arms on Stage 1 then checks Stage 2 only once armed, calling advanceOnTransition with the (internal, unspoken) transitionMarker', () => {
    const onMessageStart = clientSrcRaw.indexOf('const onMessage = isInline')
    const onMessageEnd = clientSrcRaw.indexOf('const adapter = await HumeAdapter.create(')
    const onMessageBlock = stripComments(clientSrcRaw.slice(onMessageStart, onMessageEnd))

    const armIdx = onMessageBlock.indexOf('if (!stage1ArmedRef.current)')
    const stage1MatchIdx = onMessageBlock.indexOf('matchesSpokenPhrase(text, STAGE_1_WRAP_UP_PHRASE)')
    const stage2MatchIdx = onMessageBlock.indexOf('matchesSpokenPhrase(text, nextTitle)')
    const advanceIdx = onMessageBlock.indexOf('advanceOnTransition(page.transitionMarker)')

    expect(armIdx).toBeGreaterThan(-1)
    expect(stage1MatchIdx).toBeGreaterThan(armIdx)
    expect(stage2MatchIdx).toBeGreaterThan(stage1MatchIdx)
    expect(advanceIdx).toBeGreaterThan(stage2MatchIdx)
  })

  it('inlineTools.advance_tab is untouched — still calls advanceOnTransition via the page transitionMarker directly', () => {
    const inlineToolsStartRaw = clientSrcRaw.indexOf('const inlineTools = {')
    const advanceTabStartRaw = clientSrcRaw.indexOf('advance_tab: async () => {', inlineToolsStartRaw)
    const endSessionStartRaw = clientSrcRaw.indexOf('end_session: async () => {', advanceTabStartRaw)
    const inlineAdvanceTabBlock = stripComments(clientSrcRaw.slice(advanceTabStartRaw, endSessionStartRaw))

    // 2026-08-02 — B2B items 6/7 introduced `const idx = activeIndexRef.current` above this line
    // (for the new verification gate check) and the marker lookup now reads from `idx`.
    expect(inlineAdvanceTabBlock).toMatch(/const marker = inlinePages!\[idx\]\?\.transitionMarker/)
    expect(inlineAdvanceTabBlock).toMatch(/if \(marker\) advanceOnTransition\(marker\)/)
  })

  it('templateTools (legacy non-inline path) is untouched by the two-stage machinery', () => {
    const templateToolsStart = clientSrcRaw.indexOf('const templateTools = {')
    const templateToolsEnd = clientSrcRaw.indexOf('const onMessage = isInline', templateToolsStart)
    expect(templateToolsStart).toBeGreaterThan(-1)
    expect(templateToolsEnd).toBeGreaterThan(templateToolsStart)
    const templateToolsBlock = stripComments(clientSrcRaw.slice(templateToolsStart, templateToolsEnd))
    expect(templateToolsBlock).not.toMatch(/stage1ArmedRef/)
    expect(templateToolsBlock).not.toMatch(/stage2EligibleRef/)
    expect(templateToolsBlock).not.toMatch(/matchesSpokenPhrase/)
  })
})
