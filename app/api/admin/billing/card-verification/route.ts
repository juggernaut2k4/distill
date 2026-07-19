import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { createCardVerificationCheckoutSession } from '@/lib/stripe'

/**
 * POST /api/admin/billing/card-verification
 *
 * B2B-27 — zero-dollar card-on-file verification. Clerk-authenticated,
 * requires a partner_admin_users row for the target account (identical
 * authorization pattern to POST /api/admin/billing/checkout).
 */

const CardVerificationSchema = z.object({
  partner_account_id: z.string().uuid(),
  success_url: z.string().optional(),
  cancel_url: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = CardVerificationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  try {
    const checkoutUrl = await createCardVerificationCheckoutSession(
      parsed.data.partner_account_id,
      parsed.data.success_url,
      parsed.data.cancel_url
    )
    return NextResponse.json({ checkout_url: checkoutUrl }, { status: 201 })
  } catch (err) {
    console.error('[admin/billing/card-verification] Failed to create card verification checkout session:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }, { status: 502 })
  }
}
