import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { createAutoRechargeSubscriptionCheckout } from '@/lib/stripe'

/**
 * POST /api/admin/billing/subscription
 *
 * B2B-04 Requirement Doc Section 4.B.4 / 5.B.3 — mid-market auto-recharge.
 * Clerk-authenticated, requires a `partner_admin_users` row for the target
 * account (same authorization pattern as `POST /api/admin/partner-keys`).
 * Uses Stripe Checkout in `mode: "subscription"` to collect the recurring
 * payment method — a hosted, PCI-scope-free page, not a bespoke card-
 * collection form.
 */

const SubscriptionSchema = z.object({
  partner_account_id: z.string().uuid(),
  monthly_minimum_usd: z.number().min(100),
  success_url: z.string().optional(),
  cancel_url: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = SubscriptionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  try {
    const checkoutUrl = await createAutoRechargeSubscriptionCheckout(
      parsed.data.partner_account_id,
      parsed.data.monthly_minimum_usd,
      parsed.data.success_url,
      parsed.data.cancel_url
    )
    return NextResponse.json({ checkout_url: checkoutUrl }, { status: 201 })
  } catch (err) {
    console.error('[admin/billing/subscription] Failed to create auto-recharge checkout session:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }, { status: 502 })
  }
}
