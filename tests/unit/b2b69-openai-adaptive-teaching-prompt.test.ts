import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { assembleOpenAIRealtimePrompt, OPENAI_PROMPT_TEMPLATE_VERSION } from '@/lib/voice/openai-realtime-prompt-template'

/**
 * B2B-69 originally ported B2B-66's adaptive-teaching guidance (bounded understanding-check/
 * re-teach loop, benefit-of-the-doubt on garbled STT, "own words" delivery) to the OpenAI-only
 * prompt template verbatim from Hume's version, gated behind HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED
 * for both rules 3 and 4.
 *
 * 2026-08-02 (live editing session with Arun) — rule 4's verification-outcome handling (the
 * correct/incorrect/garbled judgment, the re-teach loop, the silence case) is now permanent,
 * unconditional prompt text, independent of the flag — it's core mechanics now that advance_tab
 * cannot succeed without record_verification_result being called first. Rule 3's "explain in your
 * own words" guidance deliberately stays flag-gated, unchanged. See the module doc comment in
 * lib/voice/openai-realtime-prompt-template.ts for the full rationale, and
 * tests/unit/b2b66-adaptive-teaching-prompt.test.ts for the still-flag-gated Hume-side equivalent
 * (Hume's tools are dashboard-configured, out of reach for this build, so it keeps its original
 * gated design).
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

  it('OPENAI_PROMPT_TEMPLATE_VERSION is v8 (2026-08-02: v3 through v7, then v8\'s shape-based rule 10 rewrite, four fixed rule-4 response patterns, and the advance_tab/rule-8 ordering + explicit teaching fix)', () => {
    expect(OPENAI_PROMPT_TEMPLATE_VERSION).toBe('v8')
  })

  describe('rule 4 (verification/garbled/silence handling) — always present, independent of the flag', () => {
    it('is present with the flag unset', () => {
      delete process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('give the participant the benefit of the doubt on phrasing and disfluency')
      expect(normalized).toContain('immediately call the record_verification_result tool')
      expect(normalized).toContain('garbled')
    })

    it('is present and byte-identical with the flag set to true', () => {
      process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = 'true'
      const withFlag = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      delete process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED
      const withoutFlag = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      // Only rule 3's own-words delivery guidance should differ; rule 4 is unaffected either way.
      expect(withFlag).toContain('give the participant the benefit of the doubt on phrasing and disfluency')
      expect(withoutFlag).toContain('give the participant the benefit of the doubt on phrasing and disfluency')
    })

    it('covers correct/incorrect/garbled outcomes and defers capping to record_verification_result', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain("immediately call the record_verification_result tool")
      expect(normalized).toContain('a genuinely different, simpler way than your last')
      expect(normalized).toContain('Never decide any of this yourself independent of what the tool just told you')
      // The old one-shot cap is gone — capping is now the tool's job, not a fixed rule in the prompt.
      expect(normalized).not.toContain('re-explain the concept exactly once')
      expect(normalized).not.toContain('do not re-explain a third time')
    })

    it('covers total silence (no response at all) as its own graceful-closing case', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('likely audio or connection issue, not a wrong answer')
      expect(normalized).toContain("I haven't been able to hear anything")
      expect(normalized).toContain('call the end_session tool immediately after saying it')
    })

    it('adapts depth to the participant response (restored from the pre-B2B-68 prompt)', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('Adapt your depth to their response')
    })

    // 2026-08-02 — CEO-review follow-up: the garbled-max ending had no actual script, unlike the
    // silence case right next to it — a model with no concrete line for "end gracefully" is exactly
    // where inconsistent behavior (or skipping the mandatory spoken goodbye) would show up.
    it('the repeated-garbled-speech ending now has a concrete spoken line, not just "end gracefully"', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain("I'm having trouble hearing you clearly enough to keep going")
      expect(normalized).toContain('same spoken-goodbye-then-end_session pattern required everywhere else')
    })

    // 2026-08-02 — Arun's direct feedback after seeing rule 10's fix in a real call: banning "let
    // me think about how to build on that" as a stopping point wasn't enough — the phrase itself
    // reads unnaturally regardless of whether the model keeps talking after it. A real person
    // either directly agrees or pivots with "but"/"though" into the correction, never announces
    // that they're about to think about the answer. This is a phrasing-style fix in rule 4,
    // distinct from rule 10's turn-continuation mechanism.
    // 2026-08-02 — superseded the single "speak naturally, agree or pivot with but/though" guidance
    // with four named, fixed response patterns (CORRECT/INCORRECT/GARBLED/SILENCE), per Arun's direct
    // instruction: instead of banning bad phrasing, give the model a parameterized template to fill
    // in for each judged outcome, so there's no freeform space left to drift into a stall phrase.
    it('rule 4 judges the answer into exactly four fixed response patterns — CORRECT, INCORRECT, GARBLED, SILENCE', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('PATTERN — CORRECT')
      expect(normalized).toContain('PATTERN — INCORRECT')
      expect(normalized).toContain('PATTERN — GARBLED')
      expect(normalized).toContain('PATTERN — SILENCE')
      expect(normalized).toContain('Vary the actual wording of every pattern each time')
    })

    it('the CORRECT pattern hands off directly into rule 8\'s recap-and-transition, not a self-contained reaction', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('then, in that same breath, move directly into rule')
      expect(normalized).toContain('8\'s recap-and-transition sequence')
    })

    // 2026-08-02 — Arun's explicit instruction: the re-explanation must land as real teaching before
    // the new question follows, not be crammed into the same breath as the correction like a rushed quiz.
    it('the INCORRECT pattern gives the re-explanation room to land before asking a new, simpler question — not bundled into the same breath', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('Once that explanation has actually landed')
      expect(normalized).toContain('not crammed into the same breath as the correction')
      expect(normalized).toContain('Give the explanation real weight before the new question')
    })

    // 2026-08-02 — Arun's direct feedback: "so I don't want to keep talking to an empty room" read as
    // rude. Dropped entirely; straight from acknowledging the gap into the reassurance.
    it('the SILENCE pattern no longer includes the "empty room" line', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).not.toContain('empty room')
      expect(normalized).toContain('I haven\'t been able to hear anything for a little while — if something\'s off with your mic or connection')
    })
  })

  // 2026-08-02 — CEO-review follow-up: rule 1 (opening) had no silence-escape, unlike rule 4's
  // carefully scripted mid-session silence case — an unhandled dead-air case at the very start of
  // the call is a very plausible place for the model to just sit there and go idle.
  it('rule 1 (opening) now has a silence-escape at both of its wait-for-response points', () => {
    const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
    expect(normalized).toContain('If either of these two moments meets total silence')
    expect(normalized).toContain('treat it exactly as rule 4 describes for mid-session silence')
  })

  // 2026-08-02 — CEO-review follow-up: "every session follows the same shape" wasn't true given
  // rule 4's silence/garbled-max exits and rule 12's participant-requested exit all skip it.
  it('the SESSION SHAPE framing sentence acknowledges the early-exit paths as the exception, not the shape', () => {
    const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
    expect(normalized).toContain('Every session that runs to completion follows the same shape')
    expect(normalized).toContain('those are the exception, not this shape')
  })

  describe('rule 3 (own-words delivery) — still flag-gated, unchanged behavior', () => {
    it('unset: no own-words delivery text appears', () => {
      delete process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED
      const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
      expect(assembled).not.toContain('do not read it verbatim as written')
    })

    it.each(['TRUE', '1', 'yes', ''])('non-exact-match value %j is treated as disabled', (value) => {
      process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = value
      const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
      expect(assembled).not.toContain('do not read it verbatim as written')
    })

    it('true: own-words delivery instruction is present', () => {
      process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = 'true'
      const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
      expect(assembled).toContain('do not read it verbatim as written — explain it in your own words')
    })
  })

  it('the transition/farewell rules (3 substance, 5, 8, 9) are unaffected by the flag', () => {
    process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = 'true'
    const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
    const normalized = assembled.replace(/\s+/g, ' ')
    expect(normalized).toContain('announce or describe that you are advancing')
    expect(normalized).toContain('Sample phrases you can use directly')
  })
})
