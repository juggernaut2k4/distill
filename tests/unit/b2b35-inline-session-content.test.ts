import { describe, it, expect } from 'vitest'
import { buildInlineSessionContent, type InlineContentPage, type PartnerSessionRow } from '@/lib/partner/live-render'

/**
 * B2B-35 F1 (docs/specs/B2B-35-requirement-document.md §6.5/§7 AT-1/AT-2) — tests for
 * buildInlineSessionContent()'s handling of the new content_text field.
 */

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
  // B2B-36 F4 — new required fields on PartnerSessionRow, unrelated to this file's own coverage.
  endUserName: null,
  endUserIndustry: null,
  // B2B-50 — new required field on PartnerSessionRow, unrelated to this file's own coverage.
  providerBotId: null,
}

function makePage(overrides: Partial<InlineContentPage> = {}): InlineContentPage {
  return {
    url: 'https://content.example.com/1.html',
    media_type: 'html',
    title: 'What Is Claude?',
    subtitle: null,
    transition_trigger: 'after page one',
    transition_marker: 'MARKER_1',
    content_text: null,
    ...overrides,
  }
}

describe('buildInlineSessionContent — B2B-35 F1 content_text', () => {
  // AT-1
  it('includes a "CONTENT TO TEACH ON THIS PAGE:" line with the exact content_text value when present', () => {
    const page = makePage({ content_text: 'Claude is a family of large language models built by Anthropic.' })
    const result = buildInlineSessionContent(BASE_SESSION, [page])
    expect(result).toContain(
      'CONTENT TO TEACH ON THIS PAGE:\nClaude is a family of large language models built by Anthropic.'
    )
  })

  // AT-2 — byte-identical to pre-B2B-35 output when content_text is absent.
  it('omits the CONTENT TO TEACH line entirely when content_text is absent (byte-identical to pre-B2B-35 output)', () => {
    const pageWithout = makePage({ content_text: null })
    const pageWith = makePage({ content_text: 'Some content.' })

    const resultWithout = buildInlineSessionContent(BASE_SESSION, [pageWithout])
    const resultWith = buildInlineSessionContent(BASE_SESSION, [pageWith])

    expect(resultWithout).not.toContain('CONTENT TO TEACH ON THIS PAGE:')

    // The only diff between the two outputs should be the inserted CONTENT TO TEACH block —
    // proves the page's other lines (title/subtitle/transition instruction) are unaffected.
    const withoutContentLine = resultWith.replace('CONTENT TO TEACH ON THIS PAGE:\nSome content.\n', '')
    expect(withoutContentLine).toBe(resultWithout)
  })

  it('an explicitly-empty content_text string is treated identically to absent (no CONTENT TO TEACH line)', () => {
    const page = makePage({ content_text: '' })
    const result = buildInlineSessionContent(BASE_SESSION, [page])
    expect(result).not.toContain('CONTENT TO TEACH ON THIS PAGE:')
  })

  it('CONTENT TO TEACH line lands after Subtitle and before the STAGE DIRECTION line', () => {
    const page = makePage({ subtitle: 'A subtitle', content_text: 'The real content.' })
    const result = buildInlineSessionContent(BASE_SESSION, [page])
    const subtitleIndex = result.indexOf('Subtitle: A subtitle')
    const contentIndex = result.indexOf('CONTENT TO TEACH ON THIS PAGE:')
    const stageDirectionIndex = result.indexOf('[STAGE DIRECTION')
    expect(subtitleIndex).toBeGreaterThan(-1)
    expect(contentIndex).toBeGreaterThan(subtitleIndex)
    expect(stageDirectionIndex).toBeGreaterThan(contentIndex)
  })

  it('multiple pages each render their own content_text independently', () => {
    const page1 = makePage({ title: 'Page One', content_text: 'Content for page one.' })
    const page2 = makePage({ title: 'Page Two', content_text: 'Content for page two.' })
    const result = buildInlineSessionContent(BASE_SESSION, [page1, page2])
    expect(result).toContain('CONTENT TO TEACH ON THIS PAGE:\nContent for page one.')
    expect(result).toContain('CONTENT TO TEACH ON THIS PAGE:\nContent for page two.')
  })
})
