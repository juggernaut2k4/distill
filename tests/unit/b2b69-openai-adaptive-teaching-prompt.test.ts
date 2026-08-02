import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { assembleOpenAIRealtimePrompt, OPENAI_PROMPT_TEMPLATE_VERSION } from '@/lib/voice/openai-realtime-prompt-template'

/**
 * B2B-69 — ports B2B-66's adaptive-teaching guidance (bounded understanding-check/re-teach loop,
 * benefit-of-the-doubt on garbled STT, "own words" delivery) to the OpenAI-only prompt template,
 * per Arun's direct follow-up ("i wanted adaptive learning in openAI prompt"). Identical wording
 * and identical gate (HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED) to the Hume template's own version —
 * see tests/unit/b2b66-adaptive-teaching-prompt.test.ts for the Hume-side equivalent of this suite.
 */

const BASE_INPUT = {
  profileContext: 'Executive in fintech.',
  intentContext: '',
  sessionContent: 'Section 1 content here.',
}

describe('assembleOpenAIRealtimePrompt — B2B-69 adaptive-teaching persona', () => {
  const originalFlag = process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED
    else process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = originalFlag
  })

  it('OPENAI_PROMPT_TEMPLATE_VERSION is v2 (B2B-69 added the adaptive-teaching placeholders)', () => {
    expect(OPENAI_PROMPT_TEMPLATE_VERSION).toBe('v2')
  })

  describe('flag off (default) — byte-identical to pre-B2B-69 output', () => {
    it('unset: no adaptive-teaching text appears anywhere', () => {
      delete process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED
      const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
      expect(assembled).not.toContain('do not read it verbatim as written')
      expect(assembled).not.toContain('benefit of the doubt on phrasing')
    })

    it.each(['TRUE', '1', 'yes', ''])('non-exact-match value %j is treated as disabled', (value) => {
      process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = value
      const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
      expect(assembled).not.toContain('do not read it verbatim as written')
    })
  })

  describe('flag on — appended text present, exact wording matching the Hume template', () => {
    beforeEach(() => {
      process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = 'true'
    })

    it('rule 3 gains the own-words delivery instruction', () => {
      const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
      expect(assembled).toContain('do not read it verbatim as written — explain it in your own words')
    })

    it('rule 4 gains the bounded re-teach + benefit-of-the-doubt + elaboration-inviting instruction', () => {
      const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
      expect(assembled).toContain('give the participant the benefit of the doubt on phrasing and disfluency')
      expect(assembled).toContain('re-explain the concept exactly once, from a genuinely different angle')
      expect(assembled).toContain('do not re-explain a third time even if understanding still seems shaky')
    })

    it('the transition/farewell rules (3 substance, 5, 8, 11) are unaffected by the flag', () => {
      const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
      const normalized = assembled.replace(/\s+/g, ' ')
      expect(normalized).toContain('announce or describe that you are advancing')
      expect(normalized).toContain('Sample phrases you can use directly')
    })
  })
})
