import { describe, it, expect, afterEach } from 'vitest'
import { assembleHumeNativePrompt } from '@/lib/voice/hume-native/prompt-template'

/**
 * B2B-36 F4/F5 (docs/specs/B2B-36-requirement-document.md §6.4/§7) — tests for the new
 * `participantName`/`endUserIndustry` inputs (F4) and the `HUME_NATIVE_PACING_GUIDANCE_ENABLED`
 * toggle (F5) on assembleHumeNativePrompt(). AT numbers below refer to the spec's Section 7
 * acceptance-test list.
 */

const BASE_INPUT = {
  profileContext: 'Executive in fintech.',
  intentContext: '',
  sessionContent: 'Section 1 content here.',
}

describe('B2B-36 F4 — participantName (inline mode only)', () => {
  // AT-1
  it("inline mode: a supplied participantName is greeted by name, 'Greet the participant,' is absent", () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'inline', participantName: 'Arun' })
    expect(assembled).toContain('Greet Arun,')
    expect(assembled).not.toContain('Greet the participant,')
  })

  // AT-2
  it('template mode: participantName is a no-op — output byte-identical to the pre-B2B-36 (v8) template-mode text', () => {
    const withName = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'template', participantName: 'Arun' })
    const withoutName = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'template' })
    expect(withName).toBe(withoutName)
    expect(withName).not.toContain('Arun')
  })

  it('inline mode: participantName omitted defaults to "the participant" (byte-identical to pre-B2B-36 default)', () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'inline' })
    expect(assembled).toContain('Greet the participant,')
  })

  it('inline mode: participantName as whitespace-only resolves to "the participant", not a literal whitespace string', () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'inline', participantName: '   ' })
    expect(assembled).toContain('Greet the participant,')
  })

  it('no leftover [PARTICIPANT NAME] placeholder tag in the assembled output', () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'inline' })
    expect(assembled).not.toContain('[PARTICIPANT NAME]')
  })
})

describe('B2B-36 F4 — endUserIndustry (both modes)', () => {
  // AT-4
  it('a supplied endUserIndustry extends the opening sentence, alongside audienceDescription (both modes)', () => {
    const assembled = assembleHumeNativePrompt({
      ...BASE_INPUT,
      audienceDescription: 'a sales manager',
      endUserIndustry: 'healthcare',
    })
    expect(assembled).toContain('delivering a live, one-on-one coaching\nsession to a sales manager in healthcare over voice.')
  })

  it('endUserIndustry extends the opening sentence in inline mode too (Fork 1 applies to both modes)', () => {
    const assembled = assembleHumeNativePrompt({
      ...BASE_INPUT,
      sessionContentMode: 'inline',
      audienceDescription: 'a sales manager',
      endUserIndustry: 'healthcare',
    })
    expect(assembled).toContain('delivering a live, one-on-one coaching\nsession to a sales manager in healthcare over voice.')
  })

  // AT-5
  it('endUserIndustry omitted resolves byte-identical to B2B-35 own output — no trailing space or empty clause artifact', () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, audienceDescription: 'a sales manager' })
    expect(assembled).toContain('delivering a live, one-on-one coaching\nsession to a sales manager over voice.')
  })

  // AT-6
  it('endUserIndustry as whitespace-only resolves identically to omitted — not a literal-whitespace clause', () => {
    const withWhitespace = assembleHumeNativePrompt({ ...BASE_INPUT, audienceDescription: 'a sales manager', endUserIndustry: '   ' })
    const omitted = assembleHumeNativePrompt({ ...BASE_INPUT, audienceDescription: 'a sales manager' })
    expect(withWhitespace).toBe(omitted)
  })

  it('no leftover [INDUSTRY CLAUSE] placeholder tag in the assembled output', () => {
    const assembled = assembleHumeNativePrompt(BASE_INPUT)
    expect(assembled).not.toContain('[INDUSTRY CLAUSE]')
  })
})

describe('B2B-36 F4 — legacy provision-config-shaped caller (AT-9)', () => {
  it('a caller that passes neither participantName nor endUserIndustry (the provision-config route shape) gets pre-B2B-36 byte-identical output', () => {
    const assembled = assembleHumeNativePrompt({
      profileContext: 'Some profile.',
      intentContext: 'Some intent.',
      sessionContent: 'Some content.',
    })
    expect(assembled).toContain('to a senior executive over voice.')
    expect(assembled).not.toContain('[PARTICIPANT NAME]')
    expect(assembled).not.toContain('[INDUSTRY CLAUSE]')
  })
})

describe('B2B-36 F5 — HUME_NATIVE_PACING_GUIDANCE_ENABLED toggle', () => {
  const ORIGINAL = process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED
    else process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED = ORIGINAL
  })

  const PRE_B2B36_RULE_7 =
    '7. Keep a natural pace: teach with patience, not speed. Prioritize the\n   participant actually understanding the material over covering everything\n   at maximum velocity — but you are responsible for keeping the session\n   moving toward completion within a reasonable session length.\n8.'

  const PACING_SENTENCE =
    ' When explaining something at length, naturally break up longer stretches of ' +
    'continuous speech — roughly every minute or so — with a brief pause, a quick check-in ' +
    'like "does that make sense so far?", or a short verification question, rather than ' +
    'delivering one long unbroken monologue. This is about rhythm and delivery, not ' +
    'shortening the material.'

  // AT-10
  it('unset: rule 7 output is byte-identical to the pre-B2B-36 (v8) fixed text — no trailing sentence', () => {
    delete process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED
    const assembled = assembleHumeNativePrompt(BASE_INPUT)
    expect(assembled).toContain(PRE_B2B36_RULE_7)
    expect(assembled).not.toContain(PACING_SENTENCE)
  })

  it('any value other than the literal string "true" resolves to no guidance', () => {
    process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED = 'True'
    let assembled = assembleHumeNativePrompt(BASE_INPUT)
    expect(assembled).toContain(PRE_B2B36_RULE_7)

    process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED = '1'
    assembled = assembleHumeNativePrompt(BASE_INPUT)
    expect(assembled).toContain(PRE_B2B36_RULE_7)

    process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED = 'false'
    assembled = assembleHumeNativePrompt(BASE_INPUT)
    expect(assembled).toContain(PRE_B2B36_RULE_7)
  })

  // AT-11
  it('enabled ("true"): rule 7 ends with the exact pacing-guidance sentence, appended directly with no extra blank line', () => {
    process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED = 'true'
    const assembled = assembleHumeNativePrompt(BASE_INPUT)
    expect(assembled).toContain(
      'moving toward completion within a reasonable session length.' + PACING_SENTENCE + '\n8.'
    )
  })

  it('no leftover [PACING GUIDANCE] placeholder tag in the assembled output either way', () => {
    delete process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED
    expect(assembleHumeNativePrompt(BASE_INPUT)).not.toContain('[PACING GUIDANCE]')
    process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED = 'true'
    expect(assembleHumeNativePrompt(BASE_INPUT)).not.toContain('[PACING GUIDANCE]')
  })
})
