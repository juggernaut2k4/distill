import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen C, AT-9). Covers
 * `GET /api/test-harness/payload/[topicId]`'s zero-screens guard: never attempts content-source
 * registration (never calls `assembleTestHarnessPayload`, which is the only thing that would touch
 * it) for an incomplete payload.
 */

vi.mock('@/lib/test-harness/data', () => ({
  getScreensForTopic: vi.fn(),
}))
vi.mock('@/lib/test-harness/payload', () => ({
  assembleTestHarnessPayload: vi.fn(),
  PLACEHOLDER_MEETING_URL: 'REPLACE_WITH_MEETING_URL',
  TestHarnessTopicNotFoundError: class TestHarnessTopicNotFoundError extends Error {},
}))

import { getScreensForTopic } from '@/lib/test-harness/data'
import { assembleTestHarnessPayload } from '@/lib/test-harness/payload'
import { GET } from '@/app/api/test-harness/payload/[topicId]/route'

describe('GET /api/test-harness/payload/[topicId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('AT-9: returns 422 and never assembles a payload when the topic has zero screens', async () => {
    ;(getScreensForTopic as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const res = await GET(new NextRequest('https://test.hello-clio.com/api/test-harness/payload/topic-1'), {
      params: { topicId: 'topic-1' },
    })

    expect(res.status).toBe(422)
    expect(assembleTestHarnessPayload).not.toHaveBeenCalled()
  })

  it('assembles and returns the payload when at least one screen exists', async () => {
    ;(getScreensForTopic as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 's1' }])
    ;(assembleTestHarnessPayload as ReturnType<typeof vi.fn>).mockResolvedValue({ meeting_url: 'REPLACE_WITH_MEETING_URL', content_pages: [] })

    const res = await GET(new NextRequest('https://test.hello-clio.com/api/test-harness/payload/topic-1'), {
      params: { topicId: 'topic-1' },
    })

    expect(res.status).toBe(200)
    expect(assembleTestHarnessPayload).toHaveBeenCalledWith('topic-1', 'REPLACE_WITH_MEETING_URL')
  })
})
