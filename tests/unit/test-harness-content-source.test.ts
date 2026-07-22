import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 7, §4 Screen C, AT-7). Covers
 * `ensureTestHarnessContentSource` in isolation: registers a new `partner_content_sources` row via
 * the real `POST /api/partner/v1/content-sources` endpoint only when no topic already has one, and
 * reuses an existing one otherwise (AT-7 — "no second POST call is made").
 */

const state = { topicsQueue: [] as unknown[] }

function chainable(getResult: () => unknown) {
  const obj: Record<string, unknown> = {}
  const passthrough = () => obj
  obj.select = passthrough
  obj.eq = passthrough
  obj.not = passthrough
  obj.limit = passthrough
  obj.is = passthrough
  obj.update = passthrough
  obj.maybeSingle = () => Promise.resolve(getResult())
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(getResult()).then(resolve)
  return obj
}

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'test_harness_topics') {
        return chainable(() => state.topicsQueue.shift() ?? { data: null })
      }
      throw new Error(`Unexpected table in mock: ${table}`)
    }),
  })),
}))

import { ensureTestHarnessContentSource } from '@/lib/test-harness/content-source'

describe('ensureTestHarnessContentSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.topicsQueue = []
    vi.stubGlobal('fetch', vi.fn())
    process.env.NEXT_PUBLIC_APP_URL = 'https://hello-clio.com'
    process.env.TEST_HARNESS_PARTNER_API_KEY = 'clio_test_sk_fixture'
  })

  it('registers a new content source via the real endpoint when none exists yet', async () => {
    state.topicsQueue = [{ data: null }, { data: null }] // scan finds nothing, persist-update call
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ content_source_id: 'src-newly-registered' }),
    })

    const result = await ensureTestHarnessContentSource('topic-a')

    expect(result).toBe('src-newly-registered')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(calledUrl)).toBe('https://hello-clio.com/api/partner/v1/content-sources')
    expect((calledInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer clio_test_sk_fixture' })
  })

  it('AT-7: reuses an existing content source and never re-registers', async () => {
    state.topicsQueue = [{ data: { content_source_id: 'src-existing' } }, { data: null }]

    const result = await ensureTestHarnessContentSource('topic-b')

    expect(result).toBe('src-existing')
    expect(fetch).not.toHaveBeenCalled()
  })
})
