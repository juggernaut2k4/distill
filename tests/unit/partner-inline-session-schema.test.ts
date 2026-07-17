import { describe, it, expect } from 'vitest'
import { CreateSessionSchema } from '@/lib/partner/session-schema'

const MEETING = 'https://meet.google.com/abc-defg-hij'

describe('B2B-19 CreateSessionSchema refine (exactly one of {inline, reference})', () => {
  // AT-BC-1 — existing Option 2 requests validate unchanged, no new field required.
  it('accepts Option 2 with content_ref (backward compat)', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, content_ref: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' })
    expect(res.success).toBe(true)
  })

  it('accepts Option 2 with partner_topic_ref (backward compat)', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'topic-42' })
    expect(res.success).toBe(true)
  })

  // AT-5 — a valid Option 1 inline body validates.
  it('accepts Option 1 inline (content_pages + content_source_id)', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [
        { url: 'https://content.partner.example.com/1.html', media_type: 'html', transition_trigger: 'after page one' },
      ],
    })
    expect(res.success).toBe(true)
  })

  // AT-6 — both modes present → reject.
  it('rejects both inline and reference present', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_ref: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [{ url: 'https://x.example.com/1.html', media_type: 'html', transition_trigger: 't' }],
    })
    expect(res.success).toBe(false)
  })

  // AT-6 — neither mode present → reject.
  it('rejects neither inline nor reference present', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING })
    expect(res.success).toBe(false)
  })

  it('rejects inline content_pages without a content_source_id', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_pages: [{ url: 'https://x.example.com/1.html', media_type: 'html', transition_trigger: 't' }],
    })
    expect(res.success).toBe(false)
  })

  it('rejects a page with a non-url', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [{ url: 'not-a-url', media_type: 'html', transition_trigger: 't' }],
    })
    expect(res.success).toBe(false)
  })
})
