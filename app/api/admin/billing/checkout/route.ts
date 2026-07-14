import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { createWalletTopupCheckoutSession } from '@/lib/stripe'

/**
 * POST /api/admin/billing/checkout
 *
 * B2B-04 Requirement Doc Section 4.B.3 / 5.B.2 — self-serve wallet top-up.
 * Clerk-authenticated, requires a `partner_admin_users` row for the target
 * account (same authorization pattern as `POST /api/admin/partner-keys`).
 *
 * `amount_usd` bounds (>= 20, <= 50000) are a technical implementation
 * guardrail against fat-finger entry, not a pricing decision (Requirement
 * Doc Section 4.B.3) — adjustable without a spec change.
 */

const CheckoutSchema = z.object({
  partner_account_id: z.string().uuid(),
  amount_usd: z.number().min(20).max(50000),
  success_url: z.string().optional(),
  cancel_url: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = CheckoutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  try {
    const checkoutUrl = await createWalletTopupCheckoutSession(
      parsed.data.partner_account_id,
      parsed.data.amount_usd,
      parsed.data.success_url,
      parsed.data.cancel_url
    )
    return NextResponse.json({ checkout_url: checkoutUrl }, { status: 201 })
  } catch (err) {
    console.error('[admin/billing/checkout] Failed to create wallet top-up checkout session:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }, { status: 502 })
  }
}
