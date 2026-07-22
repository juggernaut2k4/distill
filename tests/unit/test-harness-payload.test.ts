import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §6.5, AT-6). Covers `assembleTestHarnessPayload`
 * — the single shared helper used by both the `GET payload` preview route and the `POST dispatch`
 * route — and validates its output against the real, unmodified `CreateSessionSchema` (AT-6).
 */

vi.mock('@/lib/test-harness/data', () => ({
  getTopic: vi.fn(),
  getScreensForTopic: vi.fn(),
}))
vi.mock('@/lib/test-harness/content-source', () => ({
  ensureTestHarnessContentSource: vi.fn(),
}))

import { getTopic, getScreensForTopic } from '@/lib/test-harness/data'
import { ensureTestHarnessContentSource } from '@/lib/test-harness/content-source'
import { assembleTestHarnessPayload, TestHarnessTopicNotFoundError } from '@/lib/test-harness/payload'
import { CreateSessionSchema } from '@/lib/partner/session-schema'

describe('assembleTestHarnessPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://hello-clio.com'
  })

  it('throws TestHarnessTopicNotFoundError when the topic does not exist', async () => {
    ;(getTopic as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await expect(assembleTestHarnessPayload('missing-topic', 'https://meet.google.com/abc-defg-hij')).rejects.toThrow(
      TestHarnessTopicNotFoundError
    )
  })

  it('assembles a payload whose content_pages are sorted by position and reference /test-harness-render/[id]', async () => {
    ;(getTopic as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'topic-1',
      title: 'Q3 AI Strategy Briefing',
      subtitle: 'A test of HTML + image screen rendering',
      content_to_explain: 'Walk through the current-state overview.',
    })
    ;(getScreensForTopic as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'screen-2', position: 2, screen_type: 'image', title: 'The three bets', transition_trigger: 'advance once the three bets are introduced' },
      { id: 'screen-1', position: 1, screen_type: 'html', title: 'Where we are today', transition_trigger: 'move on after the current-state overview' },
    ])
    ;(ensureTestHarnessContentSource as ReturnType<typeof vi.fn>).mockResolvedValue('content-source-1')

    const payload = await assembleTestHarnessPayload('topic-1', 'https://meet.google.com/abc-defg-hij')

    expect(payload.content_pages.map((p) => p.url)).toEqual([
      'https://hello-clio.com/test-harness-render/screen-1',
      'https://hello-clio.com/test-harness-render/screen-2',
    ])
    expect(payload.content_pages[0].media_type).toBe('html')
    expect(payload.content_pages[1].media_type).toBe('image')
    expect(payload.content_source_id).toBe('content-source-1')
  })

  it('AT-6: the assembled payload passes CreateSessionSchema.safeParse with zero validation errors', async () => {
    ;(getTopic as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'topic-1',
      title: 'Q3 AI Strategy Briefing',
      subtitle: 'A test of HTML + image screen rendering',
      content_to_explain: 'Walk through the current-state overview.',
    })
    ;(getScreensForTopic as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: '11111111-1111-1111-1111-111111111111', position: 1, screen_type: 'html', title: 'Where we are today', transition_trigger: 'move on after the current-state overview' },
      { id: '22222222-2222-2222-2222-222222222222', position: 2, screen_type: 'image', title: 'The three bets', transition_trigger: 'advance once the three bets are introduced' },
    ])
    ;(ensureTestHarnessContentSource as ReturnType<typeof vi.fn>).mockResolvedValue('33333333-3333-3333-3333-333333333333')

    const payload = await assembleTestHarnessPayload('topic-1', 'https://meet.google.com/abc-defg-hij')
    const result = CreateSessionSchema.safeParse(payload)

    expect(result.success).toBe(true)
  })

  it('the un-replaced REPLACE_WITH_MEETING_URL placeholder correctly fails CreateSessionSchema (preview-only state)', async () => {
    ;(getTopic as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't', title: null, subtitle: null, content_to_explain: null })
    ;(getScreensForTopic as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: '11111111-1111-1111-1111-111111111111', position: 1, screen_type: 'html', title: null, transition_trigger: 'x' },
    ])
    ;(ensureTestHarnessContentSource as ReturnType<typeof vi.fn>).mockResolvedValue('33333333-3333-3333-3333-333333333333')

    const payload = await assembleTestHarnessPayload('t', 'REPLACE_WITH_MEETING_URL')
    const result = CreateSessionSchema.safeParse(payload)

    expect(result.success).toBe(false)
  })
})
