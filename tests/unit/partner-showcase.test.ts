import { describe, it, expect } from 'vitest'
import { deriveContentSpecFromExcerpt, groupShowcaseContentIntoTopics } from '@/lib/partner/showcase'
import { CreateSessionSchema } from '@/lib/partner/session-schema'

/**
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §6.3/§6.4, AT-6, AT-10).
 * Covers the pure, non-LLM `deriveContentSpecFromExcerpt` helper (the fix
 * for `generateTemplateData`'s silent-skip-when-empty-items bug, §0 point
 * 5), the mock branch of `groupShowcaseContentIntoTopics` (AT-10 — no live
 * ANTHROPIC_API_KEY in the test environment), and the assembled final
 * payload's validity against the real, unmodified `CreateSessionSchema`
 * (AT-6).
 */

describe('deriveContentSpecFromExcerpt', () => {
  it('splits a multi-sentence excerpt into non-empty items, capped at 5', () => {
    const spec = deriveContentSpecFromExcerpt(
      'How Clio Works',
      'Clio joins as a bot. It watches the meeting content. It narrates a synced visual.'
    )
    expect(spec.headline).toBe('How Clio Works')
    expect(spec.items.length).toBeGreaterThan(0)
    expect(spec.items.length).toBeLessThanOrEqual(5)
    spec.items.forEach((item) => expect(item.trim().length).toBeGreaterThan(0))
  })

  it('never returns an empty items array, even for a short excerpt with no sentence breaks', () => {
    const spec = deriveContentSpecFromExcerpt('Setup', 'quick setup')
    expect(spec.items.length).toBeGreaterThan(0)
  })

  it('caps items at 5 for a long, many-sentence excerpt', () => {
    const excerpt = Array.from({ length: 10 }, (_, i) => `Sentence number ${i}.`).join(' ')
    const spec = deriveContentSpecFromExcerpt('Topic', excerpt)
    expect(spec.items.length).toBeLessThanOrEqual(5)
  })

  it('carries the full excerpt through as summary unmodified', () => {
    const excerpt = 'Clio narrates synced visuals during a live meeting, adapting to what is being discussed.'
    const spec = deriveContentSpecFromExcerpt('Topic', excerpt)
    expect(spec.summary).toBe(excerpt)
  })

  it('includes a topic-specific so_what line so generateTemplateData actually receives a non-empty contentSpec block', () => {
    const spec = deriveContentSpecFromExcerpt('Live Meeting Narration', 'text')
    expect(spec.so_what).toContain('Live Meeting Narration')
    // The bug this function fixes: generateTemplateData only uses contentSpec
    // when items.length > 0 — assert that invariant holds for every input.
    expect(spec.items.length).toBeGreaterThan(0)
  })
})

describe('groupShowcaseContentIntoTopics (AT-10 mock fallback — no live ANTHROPIC_API_KEY in test env)', () => {
  it('returns 2-3 topic titles for real multi-paragraph content', async () => {
    const titles = await groupShowcaseContentIntoTopics({
      title: 'How Clio Works',
      subtitle: 'A live look at AI-narrated learning',
      contentToExplain:
        'Clio joins as a bot and narrates a synced visual.\n\nThe narration adapts in real time to the conversation.\n\nSetup takes under 10 minutes via the API.',
    })
    expect(titles.length).toBeGreaterThanOrEqual(2)
    expect(titles.length).toBeLessThanOrEqual(3)
    titles.forEach((t) => expect(typeof t).toBe('string'))
  })

  it('falls back to a fixed 2-title set for sparse/empty content, never throwing', async () => {
    const titles = await groupShowcaseContentIntoTopics({ title: null, subtitle: null, contentToExplain: null })
    expect(Array.isArray(titles)).toBe(true)
    expect(titles.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Showcase final payload validity against the real CreateSessionSchema (AT-6)', () => {
  it('a fully-assembled Showcase payload (meeting_url replaced) passes CreateSessionSchema.safeParse with zero errors', () => {
    const payload = {
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      title: 'How Clio Works',
      subtitle: 'A live look at AI-narrated learning',
      content_to_explain: 'Some content to explain during the demo.',
      content_pages: [
        {
          url: 'https://hello-clio.com/showcase-render/11111111-1111-1111-1111-111111111111',
          media_type: 'html' as const,
          title: 'What Clio Does During a Live Meeting',
          transition_trigger: "Now let's look at What Clio Does During a Live Meeting.",
        },
        {
          url: 'https://hello-clio.com/showcase-render/22222222-2222-2222-2222-222222222222',
          media_type: 'html' as const,
          title: 'How the AI Narration Adapts in Real Time',
          transition_trigger: "Now let's look at How the AI Narration Adapts in Real Time.",
        },
      ],
      content_source_id: '33333333-3333-3333-3333-333333333333',
    }

    const result = CreateSessionSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('rejects the payload before meeting_url is replaced (REPLACE_WITH_MEETING_URL is not a valid URL)', () => {
    const payload = {
      meeting_url: 'REPLACE_WITH_MEETING_URL',
      content_pages: [
        {
          url: 'https://hello-clio.com/showcase-render/11111111-1111-1111-1111-111111111111',
          media_type: 'html' as const,
          transition_trigger: 'x',
        },
      ],
      content_source_id: '33333333-3333-3333-3333-333333333333',
    }
    const result = CreateSessionSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('rejects a Showcase payload missing content_source_id (the .refine() this brief must satisfy)', () => {
    const payload = {
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      content_pages: [
        {
          url: 'https://hello-clio.com/showcase-render/11111111-1111-1111-1111-111111111111',
          media_type: 'html' as const,
          transition_trigger: 'x',
        },
      ],
    }
    const result = CreateSessionSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })
})
