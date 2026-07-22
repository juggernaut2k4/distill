import { describe, it, expect } from 'vitest'
import { buildPostmanCollection, slugify } from '@/lib/test-harness/postman'
import type { TestHarnessPayload } from '@/lib/test-harness/payload-types'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 10b, §6.9, AT-15, AT-16).
 */

const REAL_KEY_FIXTURE = 'clio_test_sk_super_secret_value_that_must_never_leak_1234567890'

const SAMPLE_PAYLOAD: TestHarnessPayload = {
  meeting_url: 'https://meet.google.com/abc-defg-hij',
  title: 'Q3 AI Strategy Briefing',
  subtitle: 'A test of HTML + image screen rendering',
  content_to_explain: 'Walk through the current-state overview.',
  content_source_id: 'b3f1c2a4-0000-0000-0000-000000000000',
  content_pages: [
    {
      url: 'https://hello-clio.com/test-harness-render/8f2a0000-0000-0000-0000-000000000000',
      media_type: 'html',
      title: 'Where we are today',
      transition_trigger: 'move on after the current-state overview',
    },
  ],
}

describe('buildPostmanCollection (AT-15, AT-16)', () => {
  it('never embeds the real API key anywhere in the collection — uses a Postman variable instead', () => {
    // Simulate the real key existing in the process env, as it would server-side — buildPostmanCollection
    // must never read or embed it; it only ever receives the already-assembled payload.
    process.env.TEST_HARNESS_PARTNER_API_KEY = REAL_KEY_FIXTURE

    const collection = buildPostmanCollection('Q3 AI Strategy Briefing', SAMPLE_PAYLOAD)
    const serialized = JSON.stringify(collection)

    expect(serialized).not.toContain(REAL_KEY_FIXTURE)
    expect(collection.item[0].request.header.find((h) => h.key === 'Authorization')?.value).toBe('Bearer {{TEST_HARNESS_API_KEY}}')
    expect(collection.variable).toEqual([{ key: 'TEST_HARNESS_API_KEY', value: '', type: 'string' }])

    delete process.env.TEST_HARNESS_PARTNER_API_KEY
  })

  it('the collection body deep-equals the payload passed in — no drift between preview and download', () => {
    const collection = buildPostmanCollection('Q3 AI Strategy Briefing', SAMPLE_PAYLOAD)
    const bodyParsed = JSON.parse(collection.item[0].request.body.raw)
    expect(bodyParsed).toEqual(SAMPLE_PAYLOAD)
  })

  it('names the collection after the topic title, falling back to "Untitled topic" when blank', () => {
    const withTitle = buildPostmanCollection('My Topic', SAMPLE_PAYLOAD)
    expect(withTitle.info.name).toContain('My Topic')

    const withoutTitle = buildPostmanCollection('', SAMPLE_PAYLOAD)
    expect(withoutTitle.info.name).toContain('Untitled topic')
  })

  it('points at the real /api/partner/v1/sessions endpoint, not a mock', () => {
    const collection = buildPostmanCollection('Topic', SAMPLE_PAYLOAD)
    expect(collection.item[0].request.url.path).toEqual(['api', 'partner', 'v1', 'sessions'])
    expect(collection.item[0].request.method).toBe('POST')
  })
})

describe('slugify', () => {
  it('produces a filesystem-safe slug', () => {
    expect(slugify('Q3 AI Strategy Briefing')).toBe('q3-ai-strategy-briefing')
  })

  it('falls back to "untitled" for an empty string', () => {
    expect(slugify('')).toBe('untitled')
  })

  it('strips leading/trailing dashes from punctuation-heavy input', () => {
    expect(slugify('--Hello, World!--')).toBe('hello-world')
  })
})
