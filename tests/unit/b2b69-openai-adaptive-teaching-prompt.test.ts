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

  it('OPENAI_PROMPT_TEMPLATE_VERSION is v9 (2026-08-02: v3 through v8, then v9\'s removal of record_verification_result entirely — advance_tab reverted to pure model-judgment, rule 4 now a linear respond-then-summarize flow with prompt-only garbled/silence escalation)', () => {
    expect(OPENAI_PROMPT_TEMPLATE_VERSION).toBe('v9')
  })

  describe('rule 4 (verification/garbled/silence handling) — always present, independent of the flag', () => {
    it('is present with the flag unset', () => {
      delete process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('give the participant the benefit of the doubt on phrasing and disfluency')
      expect(normalized).toContain('There is no tool call anywhere in this rule')
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

    it('covers correct/incorrect/garbled outcomes as a linear flow — no tool call, no retry loop, no capping', () => {
      // 2026-08-02 (architecture revision) — record_verification_result is gone entirely, and with
      // it the retry loop / max-attempts capping it used to gate. CORRECT and INCORRECT are now a
      // single linear flow: respond once, summarize, move to rule 5 — every time, no exceptions.
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).not.toContain('record_verification_result')
      expect(normalized).toContain('There is no retry loop and no second question here')
      expect(normalized).toContain('explain it once, well, then summarize and move on to rule 5')
      expect(normalized).not.toContain('re-explain the concept exactly once')
      expect(normalized).not.toContain('do not re-explain a third time')
    })

    it('covers total silence (no response at all) as its own two-stage, prompt-only escalation', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('likely audio or connection issue, not a wrong answer')
      expect(normalized).toContain("I haven't heard anything for a little while")
      expect(normalized).toContain('call the end_session tool immediately after saying it')
    })

    it('adapts depth to the participant response (restored from the pre-B2B-68 prompt)', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('Adapt your depth to their response')
    })

    // 2026-08-02 (architecture revision) — GARBLED is now a 3-stage, purely prompt-tracked
    // escalation (repeat → check in on ending → end citing an audio issue), per Arun's explicit
    // instruction. Each stage has a concrete spoken line, not just "end gracefully."
    it('the repeated-garbled-speech ending is a 3-stage escalation with concrete spoken lines at each stage', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain("Sorry, I couldn't quite make that out")
      expect(normalized).toContain("I'm still not able to make that out clearly — would you like to stop here for now")
      expect(normalized).toContain("I'm having real trouble hearing you clearly")
      expect(normalized).toContain('spoken-goodbye-then-end_session pattern required everywhere')
    })

    // 2026-08-02 (architecture revision) — the earlier four "PATTERN" names (built around calling
    // record_verification_result) are gone along with that tool. Rule 4 now judges into four
    // "OUTCOME" cases, handled entirely in speech: CORRECT/INCORRECT are a single linear
    // respond-then-summarize flow; GARBLED/SILENCE are their own prompt-only escalations.
    it('rule 4 judges the answer into exactly four outcomes — CORRECT, INCORRECT, GARBLED, SILENCE — with no tool call anywhere', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('OUTCOME — CORRECT')
      expect(normalized).toContain('OUTCOME — INCORRECT')
      expect(normalized).toContain('OUTCOME — GARBLED')
      expect(normalized).toContain('OUTCOME — SILENCE')
      expect(normalized).toContain('Vary the actual wording of every outcome each time')
    })

    it('the CORRECT outcome gives its own brief summary, then hands off to rule 5\'s advance_tab — not a self-contained reaction', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('give a brief one- or two-sentence summary of what was just learned in this topic')
      expect(normalized).toContain('move on to rule 5 (advance_tab) when you\'re ready')
    })

    // 2026-08-02 (architecture revision) — per Arun's later, final instruction, INCORRECT no longer
    // asks a follow-up question at all: explain it once, well, then summarize and move on, exactly
    // like CORRECT. The earlier "give the re-explanation room to land before a new question" design
    // (from the four-PATTERN/record_verification_result era) is superseded by this simpler flow.
    it('the INCORRECT outcome explains once, with no retry loop and no follow-up question, then summarizes exactly like CORRECT', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).toContain('There is no retry loop and no second question here')
      expect(normalized).toContain('explain it once, well, then summarize and move on to rule 5 (advance_tab) exactly the way the CORRECT outcome does')
    })

    // 2026-08-02 — Arun's direct feedback: "so I don't want to keep talking to an empty room" read as
    // rude. Dropped entirely; straight from acknowledging the gap into the reassurance. Still true
    // under the architecture revision — the SILENCE outcome's wording carries this forward.
    it('the SILENCE outcome no longer includes the "empty room" line', () => {
      const normalized = assembleOpenAIRealtimePrompt(BASE_INPUT).replace(/\s+/g, ' ')
      expect(normalized).not.toContain('empty room')
      expect(normalized).toContain('I haven\'t heard anything for a little while — are you still there?')
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
