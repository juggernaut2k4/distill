import { describe, it, expect } from 'vitest'
import {
  ROLES,
  INDUSTRIES,
  MATURITY_LEVELS,
  WORRY_TYPES,
  CONTENT_TYPES,
  matchContentToUser,
  getNextContentType,
  type UserProfile,
  type ContentItem,
  type DeliveryLogEntry,
} from '@/lib/content/taxonomy'

describe('taxonomy constants', () => {
  it('should have non-empty ROLES array', () => {
    expect(ROLES.length).toBeGreaterThan(0)
    ROLES.forEach((role) => {
      expect(typeof role).toBe('string')
      expect(role.length).toBeGreaterThan(0)
    })
  })

  it('should have non-empty INDUSTRIES array', () => {
    expect(INDUSTRIES.length).toBeGreaterThan(0)
    INDUSTRIES.forEach((industry) => {
      expect(typeof industry).toBe('string')
      expect(industry.length).toBeGreaterThan(0)
    })
  })

  it('should have non-empty MATURITY_LEVELS array', () => {
    expect(MATURITY_LEVELS.length).toBeGreaterThan(0)
    MATURITY_LEVELS.forEach((level) => {
      expect(typeof level).toBe('string')
      expect(level.length).toBeGreaterThan(0)
    })
  })

  it('should have non-empty WORRY_TYPES array', () => {
    expect(WORRY_TYPES.length).toBeGreaterThan(0)
    WORRY_TYPES.forEach((worry) => {
      expect(typeof worry).toBe('string')
      expect(worry.length).toBeGreaterThan(0)
    })
  })
})

describe('matchContentToUser', () => {
  const mockUser: UserProfile = {
    id: 'user1',
    role: 'CEO / MD / President',
    industry: 'Technology / SaaS',
    ai_maturity: 'evaluator',
    worry_tags: ['roi_clarity', 'vendor_evaluation'],
  }

  it('should return empty array for empty content items', () => {
    const result = matchContentToUser(mockUser, [])
    expect(result).toEqual([])
  })

  it('should score exact role match higher than wildcard', () => {
    const exactMatch: ContentItem = {
      id: 'item1',
      type: 'tip',
      body_text: 'Test content',
      role_tags: ['CEO / MD / President'],
      industry_tags: [],
      maturity_tags: [],
      worry_tags: [],
      created_at: '2024-01-01',
    }

    const wildcard: ContentItem = {
      id: 'item2',
      type: 'tip',
      body_text: 'Test content',
      role_tags: [], // wildcard
      industry_tags: [],
      maturity_tags: [],
      worry_tags: [],
      created_at: '2024-01-01',
    }

    const result = matchContentToUser(mockUser, [wildcard, exactMatch])
    expect(result[0].id).toBe('item1') // exact match should come first
    expect(result[1].id).toBe('item2')
  })

  it('should score multiple exact tag matches highest', () => {
    const multiMatch: ContentItem = {
      id: 'item1',
      type: 'tip',
      body_text: 'Test content',
      role_tags: ['CEO / MD / President'],
      industry_tags: ['Technology / SaaS'],
      maturity_tags: ['evaluator'],
      worry_tags: ['roi_clarity'],
      created_at: '2024-01-01',
    }

    const singleMatch: ContentItem = {
      id: 'item2',
      type: 'tip',
      body_text: 'Test content',
      role_tags: ['CEO / MD / President'],
      industry_tags: [],
      maturity_tags: [],
      worry_tags: [],
      created_at: '2024-01-01',
    }

    const result = matchContentToUser(mockUser, [singleMatch, multiMatch])
    expect(result[0].id).toBe('item1') // multi-match should score higher
  })

  it('should handle user with empty tags gracefully', () => {
    const userWithEmptyTags: UserProfile = {
      id: 'user2',
      role: '',
      industry: '',
      ai_maturity: '',
      worry_tags: [],
    }

    const items: ContentItem[] = [
      {
        id: 'item1',
        type: 'tip',
        body_text: 'Test',
        role_tags: [],
        industry_tags: [],
        maturity_tags: [],
        worry_tags: [],
        created_at: '2024-01-01',
      },
    ]

    const result = matchContentToUser(userWithEmptyTags, items)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('item1')
  })

  it('should return all items even with no matches', () => {
    const noMatchUser: UserProfile = {
      id: 'user3',
      role: 'Other',
      industry: 'Other',
      ai_maturity: 'observer',
      worry_tags: ['team_upskilling'],
    }

    const items: ContentItem[] = [
      {
        id: 'item1',
        type: 'tip',
        body_text: 'Test',
        role_tags: ['CEO / MD / President'],
        industry_tags: ['Financial Services / Banking'],
        maturity_tags: ['scaler'],
        worry_tags: ['competitive_pressure'],
        created_at: '2024-01-01',
      },
    ]

    const result = matchContentToUser(noMatchUser, items)
    expect(result.length).toBe(1)
  })
})

describe('getNextContentType', () => {
  it('should return "tip" for empty delivery history', () => {
    const result = getNextContentType([])
    expect(result).toBe('tip')
  })

  it('should return a valid ContentType', () => {
    const deliveries: DeliveryLogEntry[] = [
      { content_item_id: '1', sent_at: '2024-01-05', content_type: 'tip' },
      { content_item_id: '2', sent_at: '2024-01-04', content_type: 'tip' },
    ]

    const result = getNextContentType(deliveries)
    expect(CONTENT_TYPES).toContain(result)
  })

  it('should prefer least recently used content type', () => {
    const deliveries: DeliveryLogEntry[] = [
      { content_item_id: '1', sent_at: '2024-01-05', content_type: 'tip' },
      { content_item_id: '2', sent_at: '2024-01-04', content_type: 'tip' },
      { content_item_id: '3', sent_at: '2024-01-03', content_type: 'tip' },
    ]

    const result = getNextContentType(deliveries)
    // Should NOT be 'tip' since it's been used 3 times recently
    expect(result).not.toBe('tip')
  })

  it('should rotate through different content types', () => {
    const deliveries: DeliveryLogEntry[] = [
      { content_item_id: '1', sent_at: '2024-01-05', content_type: 'signal' },
      { content_item_id: '2', sent_at: '2024-01-04', content_type: 'decoder' },
      { content_item_id: '3', sent_at: '2024-01-03', content_type: 'lens' },
      { content_item_id: '4', sent_at: '2024-01-02', content_type: 'framework' },
    ]

    const result = getNextContentType(deliveries)
    // 'tip' has not been used, so it should be selected
    expect(result).toBe('tip')
  })

  it('should handle deliveries without content_type gracefully', () => {
    const deliveries: DeliveryLogEntry[] = [
      { content_item_id: '1', sent_at: '2024-01-05' }, // no content_type
      { content_item_id: '2', sent_at: '2024-01-04' },
    ]

    const result = getNextContentType(deliveries)
    expect(CONTENT_TYPES).toContain(result)
  })
})
