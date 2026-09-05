import { NextResponse } from 'next/server'
import { createPublicDemoPasscodeCheckoutSession } from '@/lib/stripe'

/**
 * POST /api/public-demo-passcode/checkout
 * DEMO-PASSCODE-01 (docs/specs/DEMO-PASSCODE-01-requirement-document.md §6.9). Public,
 * unauthenticated — creates a $10 Stripe Checkout session for the public demo-passcode purchase.
 * No request body is validated beyond accepting an empty JSON object (the homepage CTA sends none).
 */
export async function POST() {
  try {
    const checkoutUrl = await createPublicDemoPasscodeCheckoutSession()
    return NextResponse.json({ checkout_url: checkoutUrl })
  } catch (err) {
    console.error('[public-demo-passcode/checkout] Failed to create checkout session:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: { code: 'stripe_error', message: 'Failed to create checkout session.' } },
      { status: 502 }
    )
  }
}
