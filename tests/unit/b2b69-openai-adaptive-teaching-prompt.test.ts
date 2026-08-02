import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { assembleOpenAIRealtimePrompt, OPENAI_PROMPT_TEMPLATE_VERSION } from '@/lib/voice/openai-realtime-prompt-template'

/**
 * B2B-69 originally ported B2B-66's adaptive-teaching guidance (bounded understanding-check/
 * re-teach loop, benefit-of-the-doubt on garbled STT, "own words" delivery) to the OpenAI-only
 * prompt template verbatim from Hume's version, per Arun's direct follow-up ("i wanted adaptive
 * learning in openAI prompt"). B2B items 6/7 (2026-08-02) then rewrote the OpenAI-only rule 4 text
 * below to hand attempt-counting off to the new code-enforced record_verification_result /
 * advance_tab gate instead of the model capping itself at one re-explanation — see
 * docs/2026-08-02-farewell-narration-findings.md §6. The gate
 * (HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED) is still shared, but the wording now deliberately
 * diverges from Hume's — see tests/unit/b2b66-adaptive-teaching-prompt.test.ts for the unchanged
 * Hume-side equivalent.
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

  describe('flag on — appended text present (rule 3 wording matches Hume; rule 4 deliberately diverges, see B2B items 6/7)', () => {
    beforeEach(() => {
      process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = 'true'
    })

    it('rule 3 gains the own-words delivery instruction', () => {
      const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
      expect(assembled).toContain('do not read it verbatim as written — explain it in your own words')
    })

    // 2026-08-02 — B2B items 6/7 rewrote this rule to hand attempt-counting/capping off to the new
    // record_verification_result tool (code-enforced) instead of the model capping itself at one
    // re-explanation. See docs/2026-08-02-farewell-narration-findings.md §6.
    it('rule 4 defers attempt-counting and capping to record_verification_result, distinguishing correct/incorrect/garbled', () => {
      const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
      expect(assembled).toContain('give the participant the benefit of the doubt on phrasing and disfluency')
      expect(assembled).toContain("immediately call record_verification_result with that outcome")
      expect(assembled).toContain("garbled")
      expect(assembled).toContain('progressively simpler phrasing each time')
      expect(assembled).toContain('Never decide any of this yourself independent of what the tool just told you')
      // The old one-shot cap is gone — capping is now the tool's job, not a fixed rule in the prompt.
      expect(assembled).not.toContain('re-explain the concept exactly once')
      expect(assembled).not.toContain('do not re-explain a third time')
    })

    it('the transition/farewell rules (3 substance, 5, 8, 11) are unaffected by the flag', () => {
      const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
      const normalized = assembled.replace(/\s+/g, ' ')
      expect(normalized).toContain('announce or describe that you are advancing')
      expect(normalized).toContain('Sample phrases you can use directly')
    })
  })
})
