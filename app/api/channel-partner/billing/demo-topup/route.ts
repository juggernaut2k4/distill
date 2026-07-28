import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { createDemoTopupCheckoutSession, DEMO_TOPUP_TIERS } from '@/lib/stripe'

/**
 * POST /api/channel-partner/billing/demo-topup
 *
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §4.C, §6, AT-8). Creates a tiered Stripe
 * Checkout session for the reseller's own demo-minutes balance — separate from the general wallet
 * top-up flow. Mirrors `/api/channel-partner/billing/card-verification`'s auth/response shape.
 */
const Schema = z.object({
  tier: z.enum(Object.keys(DEMO_TOPUP_TIERS) as [keyof typeof DEMO_TOPUP_TIERS, ...(keyof typeof DEMO_TOPUP_TIERS)[]]),
  success_url: z.string().optional(),
  cancel_url: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const body = await request.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const checkoutUrl = await createDemoTopupCheckoutSession(
      admin.partnerAccountId,
      parsed.data.tier,
      parsed.data.success_url,
      parsed.data.cancel_url
    )
    return NextResponse.json({ checkout_url: checkoutUrl }, { status: 201 })
  } catch (err) {
    console.error('[channel-partner/billing/demo-topup] Failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }, { status: 502 })
  }
}
