import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/onboarding/route'
import { NextRequest } from 'next/server'

// Mock Clerk auth
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(() => ({ userId: 'test-user-123' })),
}))

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      upsert: vi.fn(() => ({ error: null })),
    })),
  })),
}))

// Mock SMS assignment
vi.mock('@/lib/delivery/sms', () => ({
  assignPhoneNumber: vi.fn(() => '+15551234567'),
}))

// Mock personalizer (will use existing mocks from generator)
vi.stubEnv('ANTHROPIC_API_KEY', 'PLACEHOLDER_ANTHROPIC_API_KEY')

describe('POST /api/onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 200 with valid payload', async () => {
    const validPayload = {
      role: 'CEO / MD / President',
      industry: 'Technology / SaaS',
      aiMaturity: 'evaluator',
      worry: 'roi_clarity',
      deliveryPreference: 'email',
      timezone: 'America/New_York',
      email: 'test@example.com',
      plan: 'free',
    }

    const request = new NextRequest('http://localhost:3000/api/onboarding', {
      method: 'POST',
      body: JSON.stringify(validPayload),
    })

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.userId).toBeDefined()
  })

  it('should return 400 when role is missing', async () => {
    const invalidPayload = {
      // role missing
      industry: 'Technology / SaaS',
      aiMaturity: 'evaluator',
      worry: 'roi_clarity',
      deliveryPreference: 'email',
    }

    const request = new NextRequest('http://localhost:3000/api/onboarding', {
      method: 'POST',
      body: JSON.stringify(invalidPayload),
    })

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toBe('Validation failed')
  })

  it('should return 400 when aiMaturity is invalid', async () => {
    const invalidPayload = {
      role: 'CEO / MD / President',
      industry: 'Technology / SaaS',
      aiMaturity: 'invalid_level', // not in enum
      worry: 'roi_clarity',
      deliveryPreference: 'email',
    }

    const request = new NextRequest('http://localhost:3000/api/onboarding', {
      method: 'POST',
      body: JSON.stringify(invalidPayload),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
  })

  it('should return 400 when deliveryPreference is invalid', async () => {
    const invalidPayload = {
      role: 'CEO / MD / President',
      industry: 'Technology / SaaS',
      aiMaturity: 'evaluator',
      worry: 'roi_clarity',
      deliveryPreference: 'fax', // not in enum
    }

    const request = new NextRequest('http://localhost:3000/api/onboarding', {
      method: 'POST',
      body: JSON.stringify(invalidPayload),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
  })

  it('should accept all valid aiMaturity levels', async () => {
    const maturityLevels = ['observer', 'evaluator', 'pilot', 'scaler']

    for (const level of maturityLevels) {
      const payload = {
        role: 'CEO / MD / President',
        industry: 'Technology / SaaS',
        aiMaturity: level,
        worry: 'roi_clarity',
        deliveryPreference: 'email',
      }

      const request = new NextRequest('http://localhost:3000/api/onboarding', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      const response = await POST(request)
      expect(response.status).toBe(200)
    }
  })

  it('should accept all valid deliveryPreference values', async () => {
    const preferences = ['email', 'sms', 'both']

    for (const pref of preferences) {
      const payload = {
        role: 'VP / SVP / EVP',
        industry: 'Financial Services / Banking',
        aiMaturity: 'pilot',
        worry: 'team_upskilling',
        deliveryPreference: pref,
      }

      const request = new NextRequest('http://localhost:3000/api/onboarding', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      const response = await POST(request)
      expect(response.status).toBe(200)
    }
  })
})
