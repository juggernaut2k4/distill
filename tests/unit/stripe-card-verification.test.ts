import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-27 — lib/stripe.ts createCardVerificationCheckoutSession() tests.
 * See docs/specs/B2B-27-requirement-document.md Section 6.2 / 7.
 *
 * Mocks @/lib/supabase so getOrCreateStripeCustomer() (called internally,
 * first, before any Checkout Session is created) resolves without a real DB.
 */

const walletMaybeSingleMock = vi.fn(() => Promise.resolve({ data: null }))
const upsertMock = vi.fn(() => Promise.resolve({ data: null, error: null }))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_wallets') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: walletMaybeSingleMock })) })),
          upsert: upsertMock,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

describe('createCardVerificationCheckoutSession — mock-mode', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    walletMaybeSingleMock.mockResolvedValue({ data: null })
  })

  it('mocks cleanly when STRIPE_SECRET_KEY is placeholder — no real Stripe object referenced, no charge attempted', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'PLACEHOLDER_STRIPE_SECRET_KEY')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://distill-peach.vercel.app')

    const { createCardVerificationCheckoutSession } = await import('@/lib/stripe')
    const url = await createCardVerificationCheckoutSession('11111111-1111-1111-1111-111111111111')

    expect(url).toContain('mock_card_verification=1')
    expect(url).toContain('partner_account_id=11111111-1111-1111-1111-111111111111')
  })

  it('resolves/creates the Stripe customer before returning a URL, persisting stripe_customer_id onto partner_wallets', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'PLACEHOLDER_STRIPE_SECRET_KEY')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://distill-peach.vercel.app')

    const { createCardVerificationCheckoutSession } = await import('@/lib/stripe')
    await createCardVerificationCheckoutSession('22222222-2222-2222-2222-222222222222')

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ partner_account_id: '22222222-2222-2222-2222-222222222222' }),
      { onConflict: 'partner_account_id' }
    )
  })

  it('accepts custom success/cancel URL overrides in mock mode without throwing', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'PLACEHOLDER_STRIPE_SECRET_KEY')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://distill-peach.vercel.app')

    const { createCardVerificationCheckoutSession } = await import('@/lib/stripe')
    await expect(
      createCardVerificationCheckoutSession(
        '33333333-3333-3333-3333-333333333333',
        'https://example.com/success',
        'https://example.com/cancel'
      )
    ).resolves.toBeDefined()
  })
})
