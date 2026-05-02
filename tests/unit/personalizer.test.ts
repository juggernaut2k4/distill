import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getUserContentPlan } from '@/lib/content/personalizer'

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({
                data: {
                  id: 'test-user-1',
                  role: 'CEO / MD / President',
                  industry: 'Technology / SaaS',
                  ai_maturity: 'evaluator',
                  worry_tags: ['roi_clarity', 'vendor_evaluation'],
                },
                error: null,
              })),
            })),
          })),
        }
      } else if (table === 'delivery_log') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  data: [
                    {
                      content_item_id: 'item1',
                      sent_at: '2024-01-05T08:00:00Z',
                      content_items: { type: 'tip' },
                    },
                  ],
                  error: null,
                })),
              })),
            })),
          })),
        }
      } else if (table === 'feedback_weights') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              data: [{ tag: 'roi_clarity', weight: 5 }],
              error: null,
            })),
          })),
        }
      } else if (table === 'content_items') {
        return {
          select: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                data: [
                  {
                    id: 'content1',
                    type: 'signal',
                    body_text: 'Test content about AI trends',
                    role_tags: ['CEO / MD / President'],
                    industry_tags: ['Technology / SaaS'],
                    maturity_tags: ['evaluator'],
                    worry_tags: ['roi_clarity'],
                    created_at: '2024-01-01T00:00:00Z',
                  },
                  {
                    id: 'content2',
                    type: 'tip',
                    body_text: 'Another test content',
                    role_tags: [],
                    industry_tags: [],
                    maturity_tags: [],
                    worry_tags: [],
                    created_at: '2024-01-02T00:00:00Z',
                  },
                ],
                error: null,
              })),
            })),
          })),
        }
      }
      return {
        select: vi.fn(() => ({ data: [], error: null })),
      }
    }),
  })),
}))

// Mock generator (already in mock mode with PLACEHOLDER key, but ensure it)
vi.stubEnv('ANTHROPIC_API_KEY', 'PLACEHOLDER_ANTHROPIC_API_KEY')

describe('getUserContentPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return ContentPlan with required properties', async () => {
    const result = await getUserContentPlan('test-user-1')

    expect(result).toHaveProperty('emailContent')
    expect(result).toHaveProperty('smsContent')
    expect(result).toHaveProperty('contentItemId')
    expect(result).toHaveProperty('contentType')
    expect(result).toHaveProperty('wordCount')
  })

  it('should have non-empty emailContent', async () => {
    const result = await getUserContentPlan('test-user-1')

    expect(typeof result.emailContent).toBe('string')
    expect(result.emailContent.length).toBeGreaterThan(0)
  })

  it('should have non-empty smsContent', async () => {
    const result = await getUserContentPlan('test-user-1')

    expect(typeof result.smsContent).toBe('string')
    expect(result.smsContent.length).toBeGreaterThan(0)
    expect(result.smsContent.length).toBeLessThanOrEqual(160)
  })

  it('should have valid contentItemId', async () => {
    const result = await getUserContentPlan('test-user-1')

    expect(typeof result.contentItemId).toBe('string')
    expect(result.contentItemId.length).toBeGreaterThan(0)
  })

  it('should have valid contentType', async () => {
    const result = await getUserContentPlan('test-user-1')

    const validTypes = ['tip', 'signal', 'decoder', 'lens', 'framework']
    expect(validTypes).toContain(result.contentType)
  })

  it('should have numeric wordCount', async () => {
    const result = await getUserContentPlan('test-user-1')

    expect(typeof result.wordCount).toBe('number')
    expect(result.wordCount).toBeGreaterThan(0)
    expect(result.wordCount).toBeLessThanOrEqual(80)
  })
})
