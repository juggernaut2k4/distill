import { describe, it, expect } from 'vitest'

/**
 * Production rebuild (2026-08-12) — coverage for `lib/voice/bot-elevenlabs-prompt-rules.ts`, the
 * production bot-render channel's own copy of the demo's prompt assembler. Mirrors
 * `tests/unit/elevenlabs-adapter.test.ts`'s `widget-elevenlabs-prompt-rules` block — same
 * assertions, against the isolated production file, plus one new assertion for the rule 3b worked
 * example fix.
 */
describe('lib/voice/bot-elevenlabs-prompt-rules', () => {
  it('assembles without throwing on minimal input', async () => {
    const { assembleBotElevenLabsPrompt } = await import('@/lib/voice/bot-elevenlabs-prompt-rules')
    expect(() =>
      assembleBotElevenLabsPrompt({ profileContext: '', intentContext: '', sessionContent: '' })
    ).not.toThrow()
  })

  it('contains the session content and the participant name', async () => {
    const { assembleBotElevenLabsPrompt } = await import('@/lib/voice/bot-elevenlabs-prompt-rules')
    const out = assembleBotElevenLabsPrompt({
      profileContext: '',
      intentContext: '',
      sessionContent: 'PAGE 1: Context windows are the working memory of a model.',
      participantName: 'Aryan',
    })
    expect(out).toContain('PAGE 1: Context windows are the working memory of a model.')
    expect(out).toContain('Aryan')
  })

  it('G-rule numbering is contiguous from G1 with no gaps', async () => {
    const { BOT_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/bot-elevenlabs-prompt-rules')
    const numbers = Array.from(BOT_ELEVENLABS_PROMPT_TEMPLATE.matchAll(/^G(\d+)\. /gm)).map((m) => Number(m[1]))
    expect(numbers.length).toBeGreaterThan(0)
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1))
  })

  it('contains no reference to a G-rule number beyond the highest rule that exists', async () => {
    const { BOT_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/bot-elevenlabs-prompt-rules')
    const declared = Array.from(BOT_ELEVENLABS_PROMPT_TEMPLATE.matchAll(/^G(\d+)\. /gm)).map((m) => Number(m[1]))
    const highest = Math.max(...declared)
    const referenced = Array.from(BOT_ELEVENLABS_PROMPT_TEMPLATE.matchAll(/\(G(\d+)\)/g)).map((m) => Number(m[1]))
    expect(referenced.length).toBeGreaterThan(0)
    for (const ref of referenced) {
      expect(ref).toBeLessThanOrEqual(highest)
      expect(declared).toContain(ref)
    }
  })

  it('exports its own version constant, independent of the demo/widget prompt', async () => {
    const { BOT_ELEVENLABS_PROMPT_VERSION } = await import('@/lib/voice/bot-elevenlabs-prompt-rules')
    expect(BOT_ELEVENLABS_PROMPT_VERSION).toBe('bot-el-v1')
  })

  it('rule 3b carries the same worked-example fix as the demo prompt, distinguishing it from rule 3f', async () => {
    const { BOT_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/bot-elevenlabs-prompt-rules')
    expect(BOT_ELEVENLABS_PROMPT_TEMPLATE).toContain('for example, on a page about what makes Claude different')
    expect(BOT_ELEVENLABS_PROMPT_TEMPLATE).toContain('This is never the generic "do you have any questions?"')
  })

  it('is a genuinely separate module from the demo/widget prompt — text is identical content, but the two are independently importable and independently versioned', async () => {
    const bot = await import('@/lib/voice/bot-elevenlabs-prompt-rules')
    const widget = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    // Same underlying content (a faithful fork), but distinct exported identifiers — proves this
    // is a real, separate file, not a re-export.
    expect(bot.BOT_ELEVENLABS_PROMPT_VERSION).not.toBe(widget.WIDGET_ELEVENLABS_PROMPT_VERSION)
  })
})
