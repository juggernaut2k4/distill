import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { createCardVerificationCheckoutSession } from '@/lib/stripe'

/**
 * POST /api/channel-partner/billing/card-verification
 *
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §6.12). Card-on-file
 * verification (Stripe `setup`-mode, no charge) for a channel-partner's own
 * account — the same mechanism `/api/admin/billing/card-verification`
 * already provides for direct partners, gated instead by
 * `requireChannelPartnerAdmin()` (no `partner_account_id` param). Acts on
 * the caller's own account. `createCardVerificationCheckoutSession`
 * (`lib/stripe.ts`) is already fully generic over any `partnerAccountId` —
 * zero changes needed there.
 */

const Schema = z.object({ success_url: z.string().optional(), cancel_url: z.string().optional() })

export async function POST(request: NextRequest) {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const body = await request.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 })
  }

  try {
    const checkoutUrl = await createCardVerificationCheckoutSession(
      admin.partnerAccountId,
      parsed.data.success_url,
      parsed.data.cancel_url
    )
    return NextResponse.json({ checkout_url: checkoutUrl }, { status: 201 })
  } catch (err) {
    console.error('[channel-partner/billing/card-verification] Failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }, { status: 502 })
  }
}
