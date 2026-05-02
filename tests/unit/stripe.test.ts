import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPlanFromPriceId, createCheckoutSession, createPortalSession, constructWebhookEvent } from '@/lib/stripe'

// Ensure we're in placeholder mode
beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'PLACEHOLDER_STRIPE_SECRET_KEY')
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'PLACEHOLDER_STRIPE_WEBHOOK_SECRET')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://getdistill.ai')
  vi.stubEnv('STRIPE_STARTER_MONTHLY_PRICE_ID', 'price_starter_monthly')
  vi.stubEnv('STRIPE_STARTER_ANNUAL_PRICE_ID', 'price_starter_annual')
  vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_monthly')
  vi.stubEnv('STRIPE_PRO_ANNUAL_PRICE_ID', 'price_pro_annual')
  vi.stubEnv('STRIPE_EXECUTIVE_MONTHLY_PRICE_ID', 'price_exec_monthly')
  vi.stubEnv('STRIPE_EXECUTIVE_ANNUAL_PRICE_ID', 'price_exec_annual')
})

describe('getPlanFromPriceId', () => {
  it('should return "starter" for starter price IDs', () => {
    expect(getPlanFromPriceId('price_starter_monthly')).toBe('starter')
    expect(getPlanFromPriceId('price_starter_annual')).toBe('starter')
  })

  it('should return "pro" for pro price IDs', () => {
    expect(getPlanFromPriceId('price_pro_monthly')).toBe('pro')
    expect(getPlanFromPriceId('price_pro_annual')).toBe('pro')
  })

  it('should return "executive" for executive price IDs', () => {
    expect(getPlanFromPriceId('price_exec_monthly')).toBe('executive')
    expect(getPlanFromPriceId('price_exec_annual')).toBe('executive')
  })

  it('should return "unknown" for unknown price IDs', () => {
    expect(getPlanFromPriceId('price_unknown')).toBe('unknown')
    expect(getPlanFromPriceId('invalid_price_id')).toBe('unknown')
    expect(getPlanFromPriceId('')).toBe('unknown')
  })
})

describe('createCheckoutSession', () => {
  it('should return a URL string in placeholder mode', async () => {
    const result = await createCheckoutSession('user-123', 'price_pro_monthly')

    expect(typeof result).toBe('string')
    expect(result.startsWith('http')).toBe(true)
  })

  it('should include success parameters in mock URL', async () => {
    const result = await createCheckoutSession('user-456', 'price_starter_annual')

    expect(result).toContain('dashboard')
  })

  it('should not throw when called with valid parameters', async () => {
    await expect(
      createCheckoutSession('user-789', 'price_exec_monthly')
    ).resolves.toBeDefined()
  })
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
