import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-13 — lib/stripe.ts createPlanSubscriptionCheckout() tests.
 * See docs/specs/B2B-13-requirement-document.md Section 6.C / 7.
 * Covers both independent mock-mode guards: missing/placeholder
 * STRIPE_SECRET_KEY, and a still-PLACEHOLDER_-prefixed Price ID env var even
 * when STRIPE_SECRET_KEY itself is real.
 */

describe('createPlanSubscriptionCheckout — mock-mode guards', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('mocks cleanly when STRIPE_SECRET_KEY is placeholder — no real Stripe object referenced', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'PLACEHOLDER_STRIPE_SECRET_KEY')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://distill-peach.vercel.app')
    vi.stubEnv('STRIPE_PLAN_STARTER_MONTHLY_PRICE_ID', 'PLACEHOLDER_STRIPE_PLAN_STARTER_MONTHLY')

    const { createPlanSubscriptionCheckout } = await import('@/lib/stripe')
    const url = await createPlanSubscriptionCheckout('11111111-1111-1111-1111-111111111111', 'starter', 'monthly')

    expect(url).toContain('mock_plan_subscription=1')
    expect(url).toContain('plan_tier_key=starter')
    expect(url).toContain('plan_billing_period=monthly')
  })

  it('mocks cleanly when the resolved Price ID env var is still PLACEHOLDER_-prefixed, even with a real-looking STRIPE_SECRET_KEY', async () => {
    // A real key alone must not be enough — Arun may set STRIPE_SECRET_KEY
    // before creating the real Plan Products/Prices (Requirement Doc Section 6.C).
    vi.stubEnv('STRIPE_SECRET_KEY', 'fake-test-key-not-a-real-credential-and-not-placeholder-prefixed')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://distill-peach.vercel.app')
    vi.stubEnv('STRIPE_PLAN_GROWTH_ANNUAL_PRICE_ID', 'PLACEHOLDER_STRIPE_PLAN_GROWTH_ANNUAL')

    const { createPlanSubscriptionCheckout } = await import('@/lib/stripe')
    const url = await createPlanSubscriptionCheckout('22222222-2222-2222-2222-222222222222', 'growth', 'annual')

    expect(url).toContain('mock_plan_subscription=1')
    expect(url).toContain('plan_tier_key=growth')
    expect(url).toContain('plan_billing_period=annual')
  })

  it('throws for an unrecognized plan_tier_key', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'PLACEHOLDER_STRIPE_SECRET_KEY')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://distill-peach.vercel.app')

    const { createPlanSubscriptionCheckout } = await import('@/lib/stripe')
    // @ts-expect-error — deliberately passing an invalid key to test the runtime guard
    await expect(createPlanSubscriptionCheckout('id', 'enterprise', 'monthly')).rejects.toThrow(/unrecognized plan_tier_key/)
  })
})
