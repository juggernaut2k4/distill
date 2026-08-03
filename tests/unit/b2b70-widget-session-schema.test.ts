import { describe, it, expect } from 'vitest'
import { CreateWidgetSessionSchema } from '@/lib/partner/widget-session-schema'

/**
 * B2B-70 v2.0 (docs/specs/B2B-70-requirement-document.md §6.2) — CreateWidgetSessionSchema tests,
 * rewritten for the inline-content shape (content_pages supplied on every call, no container_id).
 * This is a v1.1/v2.0-era test file, not a pre-existing one — rewriting it is expected, not a
 * do-not-touch violation (see the requirement doc's own §7 acceptance test on this point).
 */

const RESELLER_ID = '99999999-9999-4999-8999-999999999999'
const CONTENT_SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const NAME = 'Arun'
const PAGE = { url: 'https://content.partner.example.com/1.html', media_type: 'html' as const, transition_trigger: 'after page one' }

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    content_pages: [PAGE],
    content_source_id: CONTENT_SOURCE_ID,
    end_user_name: NAME,
    reseller_id: RESELLER_ID,
    ...overrides,
  }
}

describe('CreateWidgetSessionSchema — required fields', () => {
  it('accepts a minimal valid body', () => {
    expect(CreateWidgetSessionSchema.safeParse(validBody()).success).toBe(true)
  })

  it('rejects a missing content_pages', () => {
    const { content_pages, ...rest } = validBody()
    expect(CreateWidgetSessionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects an empty content_pages array', () => {
    expect(CreateWidgetSessionSchema.safeParse(validBody({ content_pages: [] })).success).toBe(false)
  })

  it('rejects content_pages present without content_source_id (schema refine)', () => {
    const { content_source_id, ...rest } = validBody()
    expect(CreateWidgetSessionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a page with a non-url', () => {
    expect(CreateWidgetSessionSchema.safeParse(validBody({ content_pages: [{ ...PAGE, url: 'not-a-url' }] })).success).toBe(false)
  })

  it('rejects a missing end_user_name', () => {
    const { end_user_name, ...rest } = validBody()
    expect(CreateWidgetSessionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects an empty-string end_user_name', () => {
    expect(CreateWidgetSessionSchema.safeParse(validBody({ end_user_name: '' })).success).toBe(false)
  })

  it('rejects a missing reseller_id', () => {
    const { reseller_id, ...rest } = validBody()
    expect(CreateWidgetSessionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a non-uuid reseller_id', () => {
    expect(CreateWidgetSessionSchema.safeParse(validBody({ reseller_id: 'not-a-uuid' })).success).toBe(false)
  })
})

describe('CreateWidgetSessionSchema — optional fields', () => {
  it('accepts every optional field populated, including content_text on a page', () => {
    const res = CreateWidgetSessionSchema.safeParse(
      validBody({
        content_pages: [{ ...PAGE, title: 'Page one', subtitle: 'An intro', content_text: 'Real narration content.' }],
        content_to_explain: 'Overview text',
        content_title: 'Course title',
        content_subtitle: 'Course subtitle',
        expected_duration_minutes: 20,
        end_user_role: 'a first-year sales associate',
        end_user_industry: 'healthcare',
        partner_end_user_ref: 'user-42',
        partner_reference: 'acme-onboarding',
        reseller_unique_id: 'order-48213',
        language: 'french',
        client_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      })
    )
    expect(res.success).toBe(true)
  })

  it('rejects a non-uuid client_id', () => {
    expect(CreateWidgetSessionSchema.safeParse(validBody({ client_id: 'not-a-uuid' })).success).toBe(false)
  })

  it('rejects reseller_unique_id longer than 256 characters', () => {
    expect(CreateWidgetSessionSchema.safeParse(validBody({ reseller_unique_id: 'x'.repeat(257) })).success).toBe(false)
  })

  it('rejects an empty-string reseller_unique_id', () => {
    expect(CreateWidgetSessionSchema.safeParse(validBody({ reseller_unique_id: '' })).success).toBe(false)
  })

  it('rejects language longer than 60 characters', () => {
    expect(CreateWidgetSessionSchema.safeParse(validBody({ language: 'x'.repeat(61) })).success).toBe(false)
  })

  it('does not accept container_id — the concept is retired, not a passthrough field', () => {
    const res = CreateWidgetSessionSchema.safeParse(validBody({ container_id: '22222222-2222-4222-8222-222222222222' }))
    expect(res.success).toBe(true)
    if (res.success) {
      expect((res.data as Record<string, unknown>).container_id).toBeUndefined()
    }
  })
})
