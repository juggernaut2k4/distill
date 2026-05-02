import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/feedback/route'
import { NextRequest } from 'next/server'

// Mock Twilio verification
vi.mock('@/lib/delivery/sms', () => ({
  verifyTwilioSignature: vi.fn(() => true), // Mock signature always valid
  parseInboundSMS: vi.fn((body: string) => {
    const normalized = body.toLowerCase().trim()
    if (normalized === 'y' || normalized === 'yes') return 'feedback_yes'
    if (normalized === 'n' || normalized === 'no') return 'feedback_no'
    return 'question'
  }),
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
                data: { id: 'user-123' },
                error: null,
              })),
            })),
          })),
        }
      } else if (table === 'delivery_log') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    single: vi.fn(() => ({
                      data: { id: 'delivery-456' },
                      error: null,
                    })),
                  })),
                })),
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({ error: null })),
          })),
        }
      }
      return { select: vi.fn(() => ({ data: null, error: null })) }
    }),
  })),
}))

// Mock Inngest
vi.mock('@/inngest/client', () => ({
  inngest: {
    send: vi.fn(() => Promise.resolve()),
  },
}))

describe('POST /api/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('TWILIO_WEBHOOK_URL', 'https://test.com/api/feedback')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://test.com')
  })

  it('should return 200 TwiML for valid Y feedback', async () => {
    const formBody = new URLSearchParams({
      Body: 'Y',
      From: '+15551234567',
      To: '+15559876543',
    }).toString()

    const request = new NextRequest('http://localhost:3000/api/feedback', {
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
  })

  it('should return 200 TwiML for valid N feedback', async () => {
    const formBody = new URLSearchParams({
      Body: 'N',
      From: '+15551234567',
      To: '+15559876543',
    }).toString()

    const request = new NextRequest('http://localhost:3000/api/feedback', {
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
  })

  it('should return 403 for invalid Twilio signature', async () => {
    // Override mock to return false for this test
    const { verifyTwilioSignature } = await import('@/lib/delivery/sms')
    vi.mocked(verifyTwilioSignature).mockReturnValueOnce(false)

    const formBody = new URLSearchParams({
      Body: 'Y',
      From: '+15551234567',
    }).toString()

    const request = new NextRequest('http://localhost:3000/api/feedback', {
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

  it('should return empty TwiML for non-feedback messages', async () => {
    const formBody = new URLSearchParams({
      Body: 'What is AI?',
      From: '+15551234567',
    }).toString()

    const request = new NextRequest('http://localhost:3000/api/feedback', {
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
  })
})
