import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPortalSession, constructWebhookEvent } from '@/lib/stripe'

// Ensure we're in placeholder mode
beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'PLACEHOLDER_STRIPE_SECRET_KEY')
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'PLACEHOLDER_STRIPE_WEBHOOK_SECRET')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://distill-peach.vercel.app')
})

describe('createPortalSession', () => {
  it('should return a URL string in placeholder mode', async () => {
    const result = await createPortalSession('cus_test123')

    expect(typeof result).toBe('string')
    expect(result.startsWith('http')).toBe(true)
  })

  it('should include billing path in mock URL', async () => {
    const result = await createPortalSession('cus_test456')

    expect(result).toContain('billing')
  })

  it('should not throw when called with customer ID', async () => {
    await expect(createPortalSession('cus_789')).resolves.toBeDefined()
  })
})

describe('constructWebhookEvent', () => {
  it('should return null in placeholder mode', () => {
    const mockBody = JSON.stringify({ type: 'customer.subscription.created' })
    const mockSignature = 't=1234567890,v1=signature_here'

    const result = constructWebhookEvent(mockBody, mockSignature)

    expect(result).toBeNull()
  })

  it('should handle empty body gracefully', () => {
    const result = constructWebhookEvent('', 'invalid_sig')

    expect(result).toBeNull()
  })

  it('should handle invalid signature gracefully', () => {
    const mockBody = JSON.stringify({ type: 'test.event' })

    const result = constructWebhookEvent(mockBody, 'bad_signature')

    expect(result).toBeNull()
  })
})
