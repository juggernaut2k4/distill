import { describe, it, expect } from 'vitest'
import { CreateSessionSchema } from '@/lib/partner/session-schema'

const MEETING = 'https://meet.google.com/abc-defg-hij'
// B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.2) — end_user_name is now required on
// every request. Added to every payload below that expects success:true so these pre-existing
// tests keep validating their original scenario rather than failing on an unrelated missing
// field. This is the one caller-breaking change the spec calls out explicitly (§6.2).
const NAME = 'Arun'
// B2B-38 (docs/specs/B2B-38-requirement-document.md §6.2) — reseller_id is now required on every
// request (mandatory for every account_kind, Open Item 3). Added to every payload below that
// expects success:true, same discipline as NAME above — the schema layer has no auth context to
// validate this UUID against, so any well-formed UUID satisfies it here; the route-level mismatch
// check (§6.5) is covered in tests/integration/partner-sessions-api.test.ts.
const RESELLER_ID = '99999999-9999-4999-8999-999999999999'

describe('B2B-19 CreateSessionSchema refine (exactly one of {inline, reference})', () => {
  // AT-BC-1 — existing Option 2 requests validate unchanged, no new field required.
  it('accepts Option 2 with content_ref (backward compat)', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, content_ref: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', end_user_name: NAME, reseller_id: RESELLER_ID })
    expect(res.success).toBe(true)
  })

  it('accepts Option 2 with partner_topic_ref (backward compat)', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'topic-42', end_user_name: NAME, reseller_id: RESELLER_ID })
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
      end_user_name: NAME, reseller_id: RESELLER_ID,
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
      end_user_name: NAME, reseller_id: RESELLER_ID,
    })
    expect(res.success).toBe(false)
  })

  // AT-6 — neither mode present → reject.
  it('rejects neither inline nor reference present', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, end_user_name: NAME, reseller_id: RESELLER_ID })
    expect(res.success).toBe(false)
  })

  it('rejects inline content_pages without a content_source_id', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_pages: [{ url: 'https://x.example.com/1.html', media_type: 'html', transition_trigger: 't' }],
      end_user_name: NAME, reseller_id: RESELLER_ID,
    })
    expect(res.success).toBe(false)
  })

  it('rejects a page with a non-url', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [{ url: 'not-a-url', media_type: 'html', transition_trigger: 't' }],
      end_user_name: NAME, reseller_id: RESELLER_ID,
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
      end_user_name: NAME, reseller_id: RESELLER_ID,
    })
    expect(res.success).toBe(true)
  })

  it('accepts a request with client_id omitted (optional at the schema layer)', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'ai-101', end_user_name: NAME, reseller_id: RESELLER_ID })
    expect(res.success).toBe(true)
  })

  it('rejects a non-uuid client_id', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      client_id: 'not-a-uuid',
      end_user_name: NAME, reseller_id: RESELLER_ID,
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
      end_user_name: NAME, reseller_id: RESELLER_ID,
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
      end_user_name: NAME, reseller_id: RESELLER_ID,
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
      end_user_name: NAME, reseller_id: RESELLER_ID,
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
      end_user_name: NAME, reseller_id: RESELLER_ID,
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
      end_user_name: NAME, reseller_id: RESELLER_ID,
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
      end_user_name: NAME, reseller_id: RESELLER_ID,
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
      end_user_name: NAME, reseller_id: RESELLER_ID,
    })
    expect(res.success).toBe(true)
  })

  it('accepts end_user_role omitted (backward compat — defaults resolved downstream)', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'ai-101', end_user_name: NAME, reseller_id: RESELLER_ID })
    expect(res.success).toBe(true)
  })

  it('accepts end_user_role as whitespace-only (validated at the schema layer only; default resolution happens downstream)', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'ai-101', end_user_role: '   ', end_user_name: NAME, reseller_id: RESELLER_ID })
    expect(res.success).toBe(true)
  })

  it('rejects end_user_role longer than 200 characters', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_role: 'x'.repeat(201),
      end_user_name: NAME, reseller_id: RESELLER_ID,
    })
    expect(res.success).toBe(false)
  })
})

// B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.2/§7 AT-3, §6.2 caps) — end_user_name
// (required) and end_user_industry (optional).
describe('B2B-36 F4 — end_user_name / end_user_industry', () => {
  // AT-3
  it('rejects a request with end_user_name omitted', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'ai-101' })
    expect(res.success).toBe(false)
    if (!res.success) {
      const flat = res.error.flatten()
      expect(flat.fieldErrors.end_user_name).toBeDefined()
    }
  })

  it('rejects a request with end_user_name as an empty string', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'ai-101', end_user_name: '' })
    expect(res.success).toBe(false)
  })

  it('rejects end_user_name longer than 200 characters', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_name: 'x'.repeat(201),
    })
    expect(res.success).toBe(false)
  })

  it('accepts a request with end_user_name present and end_user_industry omitted', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'ai-101', end_user_name: NAME, reseller_id: RESELLER_ID })
    expect(res.success).toBe(true)
  })

  it('accepts a request with end_user_industry present', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_name: NAME, reseller_id: RESELLER_ID,
      end_user_industry: 'healthcare',
    })
    expect(res.success).toBe(true)
  })

  it('rejects end_user_industry longer than 200 characters', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_name: NAME, reseller_id: RESELLER_ID,
      end_user_industry: 'x'.repeat(201),
    })
    expect(res.success).toBe(false)
  })
})

// B2B-38 (docs/specs/B2B-38-requirement-document.md §6.2/§7 AT-2, AT-4-AT-9) — reseller_id
// (required, every account_kind — schema layer only, the mismatch check itself is in the route) and
// reseller_unique_id (optional, idempotency key).
describe('B2B-38 — reseller_id / reseller_unique_id', () => {
  // AT-2 — omitted entirely fails Zod's own required-field validation with the generic shape.
  it('AT-2: rejects a request with reseller_id omitted, referencing reseller_id in fieldErrors', () => {
    const res = CreateSessionSchema.safeParse({ meeting_url: MEETING, partner_topic_ref: 'ai-101', end_user_name: NAME })
    expect(res.success).toBe(false)
    if (!res.success) {
      const flat = res.error.flatten()
      expect(flat.fieldErrors.reseller_id).toBeDefined()
    }
  })

  it('rejects a non-uuid reseller_id', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_name: NAME,
      reseller_id: 'not-a-uuid',
    })
    expect(res.success).toBe(false)
  })

  // AT-4 — mandatory regardless of account_kind is a route-level concept (the schema has no
  // account_kind at all); at the schema layer this just confirms any well-formed UUID validates.
  it('accepts a well-formed reseller_id UUID (schema layer has no account_kind concept)', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_name: NAME,
      reseller_id: RESELLER_ID,
    })
    expect(res.success).toBe(true)
  })

  // AT-5 — reseller_id and client_id are independent, unrelated fields at the schema layer.
  it('accepts reseller_id and client_id both present together', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_name: NAME,
      reseller_id: RESELLER_ID,
      client_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    })
    expect(res.success).toBe(true)
  })

  it('accepts reseller_unique_id omitted (optional)', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_name: NAME,
      reseller_id: RESELLER_ID,
    })
    expect(res.success).toBe(true)
  })

  it('accepts a well-formed reseller_unique_id', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_name: NAME,
      reseller_id: RESELLER_ID,
      reseller_unique_id: 'order-48213',
    })
    expect(res.success).toBe(true)
  })

  it('rejects an empty-string reseller_unique_id', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_name: NAME,
      reseller_id: RESELLER_ID,
      reseller_unique_id: '',
    })
    expect(res.success).toBe(false)
  })

  it('rejects reseller_unique_id longer than 256 characters', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_name: NAME,
      reseller_id: RESELLER_ID,
      reseller_unique_id: 'x'.repeat(257),
    })
    expect(res.success).toBe(false)
  })

  it('accepts reseller_unique_id at exactly the 256-char cap', () => {
    const res = CreateSessionSchema.safeParse({
      meeting_url: MEETING,
      partner_topic_ref: 'ai-101',
      end_user_name: NAME,
      reseller_id: RESELLER_ID,
      reseller_unique_id: 'x'.repeat(256),
    })
    expect(res.success).toBe(true)
  })
})
