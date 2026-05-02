import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateContent, type PersonalizedContent } from '@/lib/content/generator'
import type { ContentItem, UserProfile } from '@/lib/content/taxonomy'

// Since ANTHROPIC_API_KEY is a placeholder, generator runs in mock mode
describe('generateContent', () => {
  const mockContentItem: ContentItem = {
    id: 'test-item-1',
    type: 'tip',
    body_text: 'Test insight about AI vendor evaluation',
    role_tags: ['CEO / MD / President'],
    industry_tags: ['Technology / SaaS'],
    maturity_tags: ['evaluator'],
    worry_tags: ['vendor_evaluation'],
    created_at: '2024-01-01',
  }

  const mockUser: UserProfile = {
    id: 'user1',
    role: 'CEO / MD / President',
    industry: 'Technology / SaaS',
    ai_maturity: 'evaluator',
    worry_tags: ['vendor_evaluation', 'roi_clarity'],
  }

  beforeEach(() => {
    // Ensure we're in placeholder mode (which is default in test env)
    vi.stubEnv('ANTHROPIC_API_KEY', 'PLACEHOLDER_ANTHROPIC_API_KEY')
  })

  it('should return PersonalizedContent with emailBody and smsBody', async () => {
    const result = await generateContent(mockContentItem, mockUser, 'tip')

    expect(result).toHaveProperty('emailBody')
    expect(result).toHaveProperty('smsBody')
    expect(result).toHaveProperty('wordCount')
    expect(typeof result.emailBody).toBe('string')
    expect(typeof result.smsBody).toBe('string')
    expect(typeof result.wordCount).toBe('number')
  })

  it('should have non-empty emailBody', async () => {
    const result = await generateContent(mockContentItem, mockUser, 'tip')

    expect(result.emailBody.length).toBeGreaterThan(0)
  })

  it('should have smsBody <= 160 characters', async () => {
    const result = await generateContent(mockContentItem, mockUser, 'tip')

    expect(result.smsBody.length).toBeLessThanOrEqual(160)
  })

  it('should have emailBody <= 80 words (mock mode)', async () => {
    const result = await generateContent(mockContentItem, mockUser, 'tip')

    const wordCount = result.emailBody.trim().split(/\s+/).length
    expect(wordCount).toBeLessThanOrEqual(80)
  })

  it('should accept different contentType parameters', async () => {
    const types = ['tip', 'signal', 'decoder', 'lens', 'framework'] as const

    for (const type of types) {
      const result = await generateContent(
        { ...mockContentItem, type },
        mockUser,
        type
      )
      expect(result.emailBody.length).toBeGreaterThan(0)
      expect(result.smsBody.length).toBeLessThanOrEqual(160)
    }
  })

  it('should return realistic mock content in placeholder mode', async () => {
    const result = await generateContent(mockContentItem, mockUser, 'tip')

    // Mock content should contain "So what?" as per generator's MOCK_CONTENT
    expect(result.emailBody.toLowerCase()).toContain('so what')
  })

  it('should have wordCount matching actual email word count', async () => {
    const result = await generateContent(mockContentItem, mockUser, 'signal')

    const actualWordCount = result.emailBody.trim().split(/\s+/).filter(Boolean).length
    expect(result.wordCount).toBe(actualWordCount)
  })

  it('should not throw when given different user profiles', async () => {
    const differentUser: UserProfile = {
      id: 'user2',
      role: 'VP / SVP / EVP',
      industry: 'Financial Services / Banking',
      ai_maturity: 'pilot',
      worry_tags: ['team_upskilling'],
    }

    await expect(
      generateContent(mockContentItem, differentUser, 'framework')
    ).resolves.toBeDefined()
  })
})
