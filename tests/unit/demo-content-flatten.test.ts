import { describe, it, expect, vi } from 'vitest'
import { flattenBlocksToNarrationText, type ContentBlock } from '@/app/demo/_content'

/**
 * B2B-35 F1 (docs/specs/B2B-35-requirement-document.md §6.3/§7 AT-3) — tests for the demo's
 * block-flattening helper. No AI call — deterministic transform of already-authored blocks.
 */

describe('flattenBlocksToNarrationText', () => {
  it('renders paragraph blocks verbatim', () => {
    const blocks: ContentBlock[] = [{ type: 'paragraph', text: 'Claude is a family of large language models.' }]
    expect(flattenBlocksToNarrationText(blocks)).toBe('Claude is a family of large language models.')
  })

  it('renders list blocks as "- <item>" lines', () => {
    const blocks: ContentBlock[] = [{ type: 'list', items: ['Opus — the most capable model.', 'Haiku — the fastest model.'] }]
    expect(flattenBlocksToNarrationText(blocks)).toBe('- Opus — the most capable model.\n- Haiku — the fastest model.')
  })

  it('replaces code blocks with the fixed spoken-safe placeholder sentence, never reading code aloud', () => {
    const blocks: ContentBlock[] = [{ type: 'code', language: 'python', code: 'class Car:\n    pass' }]
    const result = flattenBlocksToNarrationText(blocks)
    expect(result).toBe("(There's a code example on screen illustrating this — the participant can see it.)")
    expect(result).not.toContain('class Car')
  })

  it('joins multiple blocks with a blank line between them, in order', () => {
    const blocks: ContentBlock[] = [
      { type: 'paragraph', text: 'First paragraph.' },
      { type: 'list', items: ['Item one.', 'Item two.'] },
      { type: 'paragraph', text: 'Second paragraph.' },
    ]
    expect(flattenBlocksToNarrationText(blocks)).toBe(
      'First paragraph.\n\n- Item one.\n- Item two.\n\nSecond paragraph.'
    )
  })

  it('handles multiple code blocks — each gets its own placeholder sentence, not deduplicated', () => {
    const blocks: ContentBlock[] = [
      { type: 'code', code: 'x = 1' },
      { type: 'code', code: 'y = 2' },
    ]
    const result = flattenBlocksToNarrationText(blocks)
    const occurrences = result.split("(There's a code example on screen illustrating this — the participant can see it.)").length - 1
    expect(occurrences).toBe(2)
  })

  it('skips an unknown block type silently (logs a warning) rather than throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const blocks = [
      { type: 'paragraph', text: 'Known block.' },
      { type: 'quiz', text: 'Unknown block type.' },
    ] as unknown as ContentBlock[]
    let result = ''
    expect(() => {
      result = flattenBlocksToNarrationText(blocks)
    }).not.toThrow()
    expect(result).toBe('Known block.')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('an empty blocks array produces an empty string (degrades gracefully, no throw)', () => {
    expect(flattenBlocksToNarrationText([])).toBe('')
  })

  it('truncates output exceeding 6000 characters at the last complete sentence boundary', () => {
    const longSentence = 'This is a sentence about Claude and its capabilities. '
    const blocks: ContentBlock[] = [{ type: 'paragraph', text: longSentence.repeat(200) }]
    const result = flattenBlocksToNarrationText(blocks)
    expect(result.length).toBeLessThanOrEqual(6000)
    // Ends at a sentence boundary, not mid-word/mid-sentence.
    expect(result.endsWith('.')).toBe(true)
  })

  it('text under the 6000-char cap is returned unmodified', () => {
    const blocks: ContentBlock[] = [{ type: 'paragraph', text: 'Short and well under the cap.' }]
    expect(flattenBlocksToNarrationText(blocks)).toBe('Short and well under the cap.')
  })
})
