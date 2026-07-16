import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * B2B-13 (Requirement Doc Section 6.E/7/8) — POST /api/admin/billing/plan-subscription.
 * Mirrors the isolation-gate pattern used by
 * tests/integration/configurator-prompt-behavior-api.test.ts and the existing
 * checkout/subscription routes' own auth convention.
 */

const requirePartnerAdminMock = vi.fn()
vi.mock('@/lib/partner/auth', () => ({
  requirePartnerAdmin: (...args: unknown[]) => requirePartnerAdminMock(...args),
}))

const createPlanSubscriptionCheckoutMock = vi.fn()
vi.mock('@/lib/stripe', () => ({
  createPlanSubscriptionCheckout: (...args: unknown[]) => createPlanSubscriptionCheckoutMock(...args),
}))

import { POST } from '@/app/api/admin/billing/plan-subscription/route'

const VALID_PARTNER_ID = '3f9a1c22-1234-4321-aaaa-111122223333'

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/admin/billing/plan-subscription', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/billing/plan-subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'clerk-user-1', error: null })
    createPlanSubscriptionCheckoutMock.mockResolvedValue('https://checkout.stripe.com/mock-session')
  })

  it('happy path: valid starter/monthly request returns 201 with checkout_url', async () => {
    const res = await POST(
      makeRequest({ partner_account_id: VALID_PARTNER_ID, plan_tier_key: 'starter', billing_period: 'monthly' })
    )

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json).toEqual({ checkout_url: 'https://checkout.stripe.com/mock-session' })
    expect(createPlanSubscriptionCheckoutMock).toHaveBeenCalledWith(
      VALID_PARTNER_ID, 'starter', 'monthly', undefined, undefined
    )
  })

  it('validation failure: bad plan_tier_key returns 422 before requirePartnerAdmin is ever called', async () => {
    const res = await POST(
      makeRequest({ partner_account_id: VALID_PARTNER_ID, plan_tier_key: 'enterprise', billing_period: 'monthly' })
    )

    expect(res.status).toBe(422)
    expect(requirePartnerAdminMock).not.toHaveBeenCalled()
    expect(createPlanSubscriptionCheckoutMock).not.toHaveBeenCalled()
  })

  it('validation failure: bad billing_period returns 422', async () => {
    const res = await POST(
      makeRequest({ partner_account_id: VALID_PARTNER_ID, plan_tier_key: 'growth', billing_period: 'weekly' })
    )

    expect(res.status).toBe(422)
    expect(createPlanSubscriptionCheckoutMock).not.toHaveBeenCalled()
  })

  it('auth failure: requirePartnerAdmin rejects -> propagates its error response, never calls Stripe', async () => {
    requirePartnerAdminMock.mockResolvedValue({
      clerkUserId: null,
      error: NextResponse.json({ error: { code: 'forbidden', message: 'forbidden' } }, { status: 403 }),
    })

    const res = await POST(
      makeRequest({ partner_account_id: VALID_PARTNER_ID, plan_tier_key: 'starter', billing_period: 'annual' })
    )

    expect(res.status).toBe(403)
    expect(createPlanSubscriptionCheckoutMock).not.toHaveBeenCalled()
  })

  it('Stripe error: createPlanSubscriptionCheckout throws -> 502 stripe_error envelope', async () => {
    createPlanSubscriptionCheckoutMock.mockRejectedValue(new Error('stripe down'))

    const res = await POST(
      makeRequest({ partner_account_id: VALID_PARTNER_ID, plan_tier_key: 'growth', billing_period: 'monthly' })
    )

    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error.code).toBe('stripe_error')
  })
})
