import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { assembleHumeNativePrompt } from '@/lib/voice/hume-native/prompt-template'

/**
 * B2B-66 (docs/specs/B2B-66-requirement-document.md §7/§13) — Marin adaptive-teaching persona:
 * bounded understanding-check/re-teach loop, benefit-of-the-doubt on garbled STT, "own words"
 * delivery for a section's initial teaching, and an elaboration-inviting follow-up. All gated
 * behind HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED (default OFF, byte-identical to pre-B2B-66 output).
 */

const BASE_INPUT = {
  profileContext: 'Executive in fintech.',
  intentContext: '',
  sessionContent: 'Section 1 content here.',
}

const RULE_3_BASE =
  '3. For every section in SESSION CONTENT, call the show_visual tool at the\n' +
  '   moment you begin covering that section, before you start speaking about\n' +
  '   it substantively. Pass the section\'s index as instructed in the content.'

const RULE_4_BASE =
  '4. After teaching a section\'s core content, ask a verification question to\n' +
  '   confirm understanding before moving on. Listen to the answer and respond\n' +
  '   naturally — affirm what\'s correct, gently correct what\'s off, and adapt\n' +
  '   your depth to their response.'

describe('assembleHumeNativePrompt — B2B-66 adaptive-teaching persona', () => {
  const originalFlag = process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED
  const originalPacingFlag = process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED
    else process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = originalFlag
    if (originalPacingFlag === undefined) delete process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED
    else process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED = originalPacingFlag
  })

  describe('flag off (default) — byte-identical to pre-B2B-66 output', () => {
    it('unset: Rule 3 and Rule 4 text match the pre-B2B-66 fixed wording exactly', () => {
      delete process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED
      const assembled = assembleHumeNativePrompt(BASE_INPUT)
      expect(assembled).toContain(RULE_3_BASE + '\n' + RULE_4_BASE)
      expect(assembled).not.toContain('do not read it verbatim as written')
      expect(assembled).not.toContain('benefit of the doubt on phrasing')
    })

    it.each(['TRUE', '1', 'yes', ''])('non-exact-match value %j is treated as disabled', (value) => {
      process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = value
      const assembled = assembleHumeNativePrompt(BASE_INPUT)
      expect(assembled).toContain(RULE_3_BASE + '\n' + RULE_4_BASE)
    })
  })

  describe('flag on — appended text present, exact wording, nothing else changed', () => {
    beforeEach(() => {
      process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = 'true'
    })

    it('Rule 3 gains the own-words delivery instruction, appended after the existing fixed text', () => {
      const assembled = assembleHumeNativePrompt(BASE_INPUT)
      expect(assembled).toContain(
        RULE_3_BASE +
          ' When you begin covering a section\'s content, do not read it verbatim as written — explain ' +
          'it in your own words, the way a person teaching the material would: restate the core idea in ' +
          'natural spoken language, and add at least one of your own supporting examples, analogies, or ' +
          'illustrations grounded in what SESSION CONTENT and PARTICIPANT CONTEXT actually establish. Never ' +
          'introduce a fact, statistic, or claim that SESSION CONTENT does not support. This changes how you ' +
          'explain the material, not how much of it you cover — a well-explained section is not automatically ' +
          'longer than reading the script, and a section the participant already understands does not need ' +
          'extra length just because this instruction is active.'
      )
    })

    it('Rule 4 gains the bounded re-teach + benefit-of-the-doubt + elaboration-inviting instruction', () => {
      const assembled = assembleHumeNativePrompt(BASE_INPUT)
      expect(assembled).toContain('give the participant the benefit of the doubt on phrasing and disfluency')
      expect(assembled).toContain('re-explain the concept exactly once, from a genuinely different angle')
      expect(assembled).toContain('do not re-explain a third time even if understanding still seems shaky')
      expect(assembled).toContain('look for a natural moment to invite them to elaborate with an open-ended question')
    })

    it('no other rule\'s text is affected by the flag', () => {
      const assembled = assembleHumeNativePrompt(BASE_INPUT)
      expect(assembled).toContain(
        '1. Open the session warmly. Deliver the Session Overview'
      )
      expect(assembled).toContain('9. Never break character.')
      expect(assembled).toContain(
        '11. Before moving from one topic to the next, give a quick, natural spoken'
      )
    })
  })

  describe('composition with other flags/modes', () => {
    it('combined with HUME_NATIVE_PACING_GUIDANCE_ENABLED=true — both blocks present, no collision', () => {
      process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = 'true'
      process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED = 'true'
      const assembled = assembleHumeNativePrompt(BASE_INPUT)
      expect(assembled).toContain('do not read it verbatim as written')
      expect(assembled).toContain('benefit of the doubt on phrasing')
      expect(assembled).toContain('naturally break up longer stretches of')
    })

    it('mode-invariant: identical Rule 3/4 appended text for both sessionContentMode values', () => {
      process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED = 'true'
      const inline = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'inline' })
      const template = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'template' })
      const extractRule34 = (s: string) => s.slice(s.indexOf('3. For every section'), s.indexOf('5. When you judge'))
      expect(extractRule34(inline)).toBe(extractRule34(template))
    })
  })
})
