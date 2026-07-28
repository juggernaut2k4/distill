import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §6, §4.C, AT-8). Tests for lib/stripe.ts's
 * createDemoTopupCheckoutSession + DEMO_TOPUP_TIERS (provisional pricing table). No mocking needed —
 * STRIPE_SECRET_KEY is unset/placeholder in this test environment (matching tests/unit/stripe.test.ts's
 * own convention), so these exercise the real placeholder/mock-URL code path.
 */

describe('DEMO_TOPUP_TIERS', () => {
  it('has exactly the 7 tiers from the provisional pricing ladder, in minutes/price', async () => {
    const { DEMO_TOPUP_TIERS } = await import('@/lib/stripe')
    expect(DEMO_TOPUP_TIERS).toEqual({
      min15: { minutes: 15, priceUsd: 0.5, label: '15 min' },
      min30: { minutes: 30, priceUsd: 0.75, label: '30 min' },
      hr1: { minutes: 60, priceUsd: 1.25, label: '1 hour' },
      hr2: { minutes: 120, priceUsd: 1.8, label: '2 hours' },
      hr3: { minutes: 180, priceUsd: 2.5, label: '3 hours' },
      hr5: { minutes: 300, priceUsd: 4.0, label: '5 hours' },
      hr10: { minutes: 600, priceUsd: 7.5, label: '10 hours' },
    })
  })

  it('the 2-hour tier matches the existing real test-block price exactly ($1.80/120min)', async () => {
    const { DEMO_TOPUP_TIERS } = await import('@/lib/stripe')
    expect(DEMO_TOPUP_TIERS.hr2).toEqual({ minutes: 120, priceUsd: 1.8, label: '2 hours' })
  })
})

describe('createDemoTopupCheckoutSession', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'PLACEHOLDER_STRIPE_SECRET_KEY')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://distill-peach.vercel.app')
  })

  it('returns a mock checkout URL in placeholder mode, never throwing without a real Stripe key', async () => {
    const { createDemoTopupCheckoutSession } = await import('@/lib/stripe')
    const url = await createDemoTopupCheckoutSession('acct-reseller-1', 'hr2')
    expect(typeof url).toBe('string')
    expect(url).toContain('acct-reseller-1')
    expect(url).toContain('hr2')
  })

  it('accepts every one of the 7 tier keys without throwing', async () => {
    const { createDemoTopupCheckoutSession, DEMO_TOPUP_TIERS } = await import('@/lib/stripe')
    for (const tier of Object.keys(DEMO_TOPUP_TIERS) as (keyof typeof DEMO_TOPUP_TIERS)[]) {
      await expect(createDemoTopupCheckoutSession('acct-1', tier)).resolves.toBeDefined()
    }
  })
})
