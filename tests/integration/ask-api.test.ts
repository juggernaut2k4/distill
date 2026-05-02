import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/ask/route'
import { NextRequest } from 'next/server'

// Mock Twilio verification and parsing
vi.mock('@/lib/delivery/sms', () => ({
  verifyTwilioSignature: vi.fn(() => true),
  parseInboundSMS: vi.fn((body: string) => {
    const normalized = body.toLowerCase().trim()
    if (normalized === 'y' || normalized === 'yes' || normalized === 'n' || normalized === 'no') {
      return normalized.startsWith('y') ? 'feedback_yes' : 'feedback_no'
    }
    if (body.includes('?') || body.length > 10) {
      return 'question'
    }
    return 'question' // Default to question for non-feedback
  }),
  sendSMS: vi.fn(),
  assignPhoneNumber: vi.fn(() => '+15551234567'),
}))

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
                  id: 'user-123',
                  role: 'CEO / MD / President',
                  industry: 'Technology / SaaS',
                },
                error: null,
              })),
            })),
          })),
        }
      } else if (table === 'sms_conversations') {
        return {
          insert: vi.fn(() => ({ error: null })),
        }
      }
      return { select: vi.fn(() => ({ data: null, error: null })) }
    }),
  })),
}))

// Ensure mock mode for Anthropic
vi.stubEnv('ANTHROPIC_API_KEY', 'PLACEHOLDER_ANTHROPIC_API_KEY')

describe('POST /api/ask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://test.com')
  })

  it('should return 400 for empty body', async () => {
    const request = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'valid_signature',
      },
      body: '',
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
  })

  it('should return 200 TwiML for valid question', async () => {
    const formBody = new URLSearchParams({
      Body: 'What is RAG in AI?',
      From: '+15551234567',
      To: '+15559876543',
    }).toString()

    const request = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'valid_signature',
      },
      body: formBody,
    })

    const response = await POST(request)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/xml')
    expect(text).toContain('<?xml')
    expect(text).toContain('<Response>')
    expect(text).toContain('<Message>')
  })

  it('should return 403 for invalid Twilio signature', async () => {
    const { verifyTwilioSignature } = await import('@/lib/delivery/sms')
    vi.mocked(verifyTwilioSignature).mockReturnValueOnce(false)

    const formBody = new URLSearchParams({
      Body: 'What is AI?',
      From: '+15551234567',
    }).toString()

    const request = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'bad_signature',
      },
      body: formBody,
    })

    const response = await POST(request)

    expect(response.status).toBe(403)
  })

  it('should return mock answer in placeholder mode', async () => {
    const formBody = new URLSearchParams({
      Body: 'How do I evaluate an AI vendor?',
      From: '+15551234567',
      To: '+15559876543',
    }).toString()

    const request = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'valid_signature',
      },
      body: formBody,
    })

    const response = await POST(request)
    const text = await response.text()

    expect(text).toContain('[MOCK]')
    expect(text).toContain('<Message>')
  })

  it('should return empty TwiML for non-question messages', async () => {
    const { parseInboundSMS } = await import('@/lib/delivery/sms')
    vi.mocked(parseInboundSMS).mockReturnValueOnce('feedback_yes')

    const formBody = new URLSearchParams({
      Body: 'Y',
      From: '+15551234567',
    }).toString()

    const request = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'valid_signature',
      },
      body: formBody,
    })

    const response = await POST(request)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain('<Response>')
    expect(text).not.toContain('<Message>')
  })
})
