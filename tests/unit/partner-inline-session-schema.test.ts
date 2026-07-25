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

// B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.5) — client_id is optional at
// the Zod layer (conditionally required is enforced imperatively in the route, since Zod has no
// access to the resolved auth context at parse time).
describe('B2B-34 CreateSessionSchema — client_id field', () => {
  it('accepts a request with a valid uuid client_id', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      client_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    })
    expect(res.success).toBe(true)
  })

  it('accepts a request with client_id omitted (optional at the schema layer)', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'ai-101' })
    expect(res.success).toBe(true)
  })

  it('rejects a non-uuid client_id', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      client_id: 'not-a-uuid',
    })
    expect(res.success).toBe(false)
  })
})

// B2B-35 F1 (docs/specs/B2B-35-requirement-document.md §6.1/§7 AT-4) — optional per-page
// content_text field on ContentPageSchema.
describe('B2B-35 F1 — content_pages[].content_text', () => {
  it('accepts an inline page with content_text populated', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [
        {
          url: 'https://content.partner.example.com/1.html',
          media_type: 'html',
          transition_trigger: 'after page one',
          content_text: 'Claude is a family of large language models built by Anthropic.',
        },
      ],
    })
    expect(res.success).toBe(true)
  })

  it('accepts an inline page with content_text omitted (backward compat — pre-B2B-35 shape)', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [
        { url: 'https://content.partner.example.com/1.html', media_type: 'html', transition_trigger: 'after page one' },
      ],
    })
    expect(res.success).toBe(true)
  })

  it('accepts an inline page with content_text as an explicit empty string', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [
        {
          url: 'https://content.partner.example.com/1.html',
          media_type: 'html',
          transition_trigger: 'after page one',
          content_text: '',
        },
      ],
    })
    expect(res.success).toBe(true)
  })

  // AT-4 — a content_text value longer than 6000 chars is rejected (never silently truncated).
  it('rejects content_text longer than 6000 characters', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [
        {
          url: 'https://content.partner.example.com/1.html',
          media_type: 'html',
          transition_trigger: 'after page one',
          content_text: 'x'.repeat(6001),
        },
      ],
    })
    expect(res.success).toBe(false)
  })

  it('accepts content_text at exactly the 6000-char cap', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [
        {
          url: 'https://content.partner.example.com/1.html',
          media_type: 'html',
          transition_trigger: 'after page one',
          content_text: 'x'.repeat(6000),
        },
      ],
    })
    expect(res.success).toBe(true)
  })
})

// B2B-35 F3 (docs/specs/B2B-35-requirement-document.md §6.8/§7 AT-9-11) — top-level, optional
// end_user_role field, applies to both content modes.
describe('B2B-35 F3 — end_user_role', () => {
  it('accepts a request with end_user_role set (Option 2/reference mode)', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_role: 'a first-year sales associate',
    })
    expect(res.success).toBe(true)
  })

  it('accepts a request with end_user_role set (Option 1/inline mode)', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [
        { url: 'https://content.partner.example.com/1.html', media_type: 'html', transition_trigger: 'after page one' },
      ],
      end_user_role: 'a first-year sales associate',
    })
    expect(res.success).toBe(true)
  })

  it('accepts end_user_role omitted (backward compat — defaults resolved downstream)', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'ai-101' })
    expect(res.success).toBe(true)
  })

  it('accepts end_user_role as whitespace-only (validated at the schema layer only; default resolution happens downstream)', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'ai-101', end_user_role: '   ' })
    expect(res.success).toBe(true)
  })

  it('rejects end_user_role longer than 200 characters', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_role: 'x'.repeat(201),
    })
    expect(res.success).toBe(false)
  })
})
