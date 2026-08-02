import { describe, it, expect } from 'vitest'
import { assembleHumeNativePrompt } from '@/lib/voice/hume-native/prompt-template'

/**
 * B2B-35 F2/F3 (docs/specs/B2B-35-requirement-document.md §6.6/§6.7/§7) — tests for the new
 * `sessionContentMode` and `audienceDescription` parameters on assembleHumeNativePrompt().
 * AT numbers below refer to the spec's Section 7 acceptance-test list.
 */

const BASE_INPUT = {
  profileContext: 'Executive in fintech.',
  intentContext: '',
  sessionContent: 'Section 1 content here.',
}

describe('B2B-35 F2 — sessionContentMode', () => {
  // AT-5
  it("'inline' mode: rule 1 matches the new inline-mode text and does not mention the Session Overview section", () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'inline' })
    // 2026-08-02 — B2B item 4 rewrote the icebreaker (see docs/2026-08-02-farewell-narration-findings.md
    // §3, Issue 4) to require asking how the participant is doing, tied to the topic, before the
    // "ready to dive in" check — replacing the old "offer a short, natural icebreaker" example-only wording.
    expect(assembled).toContain(
      "1. Open the session warmly and with genuine energy. Greet the participant, introduce yourself briefly, then ask how they're doing today"
    )
    expect(assembled).not.toContain("Session Overview section's prepared content")
  })

  it("'inline' mode: rule 8 closes with an own-words recap, not a reference to a Session Summary section, but keeps the unchanged a/b/c closing sequence", () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'inline' })
    expect(assembled).toContain(
      '8. When the final page is complete, close warmly. In your own words — not a scripted section, since none exists in this mode'
    )
    expect(assembled).not.toContain('Session Summary\n   section')
    // The a/b/c closing sequence is shared/unchanged across both modes.
    expect(assembled).toContain('a. Briefly summarize what was covered today in exactly two sentences.')
    expect(assembled).toContain('end_session tool. end_session is the only way the call ends when you')
  })

  it("'inline' mode: rule 12 states it does not apply in this mode", () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'inline' })
    expect(assembled).toContain('12. This rule does not apply in this mode')
    expect(assembled).not.toContain('explicitly say the word')
  })

  it("'inline' mode: no leftover [RULE n TEXT] placeholder tags in the assembled output", () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'inline' })
    expect(assembled).not.toContain('[RULE 1 TEXT]')
    expect(assembled).not.toContain('[RULE 8 TEXT]')
    expect(assembled).not.toContain('[RULE 12 TEXT]')
  })

  // AT-6 — the core backward-compatibility regression test. Rule 1's text was intentionally
  // updated 2026-08-02 (B2B item 4 — icebreaker rewrite, see
  // docs/2026-08-02-farewell-narration-findings.md §3 Issue 4), so it is no longer byte-identical
  // to the pre-B2B-35 (v7) text; rules 8 and 12 remain untouched by that change.
  it("sessionContentMode omitted: rules 1, 8, 12 match the current fixed (non-inline) text", () => {
    const assembled = assembleHumeNativePrompt(BASE_INPUT)
    expect(assembled).toContain(
      "1. Open the session warmly. Greet them, then ask how they're doing today —\n   tie the question naturally to today's topic rather than a generic\n   pleasantry, and wait briefly for their response before continuing. Follow\n   it with a short, genuine note of encouragement or confidence-building,\n   making today's topic feel approachable rather than intimidating. Then\n   deliver the Session Overview section's prepared content (marked in\n   SESSION CONTENT) in full — state the agenda, ask its verification\n   question, and wait for a response — before moving to the first real\n   subtopic. Treat this exactly like any other section: teach →\n   verification question → listen → respond → bridge. Do not skip or rush\n   past it, and do not ask what they want to cover — the agenda is fixed and\n   provided below in SESSION CONTENT."
    )
    expect(assembled).toContain(
      "8. When the final real subtopic is complete, deliver the Session Summary\n   section's prepared content in full (it already contains the wrap-up and\n   the one-thing-to-remember framing — do not additionally improvise your own\n   summary). Ask its verification question, then follow this closing\n   sequence every time, regardless of how the call has gone so far:"
    )
    expect(assembled).toContain(
      '12. Immediately before you begin delivering the Session Overview section\'s\n    content (rule 1), and again immediately before you begin delivering the\n    Session Summary section\'s content (rule 8), explicitly say the word\n    "overview" or "summary" (respectively) out loud, naturally, as part of\n    your sentence — for example, "Let\'s start with a quick overview," or\n    "Let\'s wrap up with a summary of what we covered." Say one of these two\n    words at that exact moment, every session, without exception.'
    )
  })

  it("sessionContentMode: 'template' explicit produces output identical to sessionContentMode omitted", () => {
    const omitted = assembleHumeNativePrompt(BASE_INPUT)
    const explicit = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'template' })
    expect(explicit).toBe(omitted)
  })

  it('an unexpected sessionContentMode value degrades to template-mode text rather than throwing (§8 defensive discipline)', () => {
    const templateOutput = assembleHumeNativePrompt(BASE_INPUT)
    // @ts-expect-error — intentionally an invalid value to exercise the defensive fallback.
    const weirdOutput = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'bogus' })
    expect(weirdOutput).toBe(templateOutput)
  })
})

describe('B2B-35 F3 — audienceDescription', () => {
  // AT-9
  it('a custom audienceDescription is substituted into the opening sentence', () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, audienceDescription: 'a first-year sales associate' })
    expect(assembled).toContain(
      'delivering a live, one-on-one coaching\nsession to a first-year sales associate over voice.'
    )
  })

  // AT-10
  it('audienceDescription omitted defaults to "a senior executive" (byte-identical to pre-B2B-35 default)', () => {
    const assembled = assembleHumeNativePrompt(BASE_INPUT)
    expect(assembled).toContain(
      'delivering a live, one-on-one coaching\nsession to a senior executive over voice.'
    )
  })

  // AT-12 — the legacy provision-config caller passes neither field; confirms the exact call
  // shape that route uses stays byte-identical.
  it('a caller that omits both sessionContentMode and audienceDescription (the provision-config route shape) gets the pre-B2B-35 default output', () => {
    const assembled = assembleHumeNativePrompt({
      profileContext: 'Some profile.',
      intentContext: 'Some intent.',
      sessionContent: 'Some content.',
    })
    expect(assembled).toContain('to a senior executive over voice.')
  })

  it('no leftover [AUDIENCE] placeholder tag in the assembled output', () => {
    const assembled = assembleHumeNativePrompt(BASE_INPUT)
    expect(assembled).not.toContain('[AUDIENCE]')
  })
})
