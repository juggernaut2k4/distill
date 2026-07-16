import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { createPlanSubscriptionCheckout } from '@/lib/stripe'

/**
 * POST /api/admin/billing/plan-subscription
 *
 * B2B-13 Requirement Doc Section 6.E — recurring Plan tier checkout.
 * Clerk-authenticated, requires a `partner_admin_users` row for the target
 * account (identical authorization pattern to
 * `POST /api/admin/billing/checkout` / `.../subscription`).
 */

const PlanSubscriptionSchema = z.object({
  partner_account_id: z.string().uuid(),
  plan_tier_key: z.enum(['starter', 'growth']),
  billing_period: z.enum(['monthly', 'annual']),
  success_url: z.string().optional(),
  cancel_url: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = PlanSubscriptionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  try {
    const checkoutUrl = await createPlanSubscriptionCheckout(
      parsed.data.partner_account_id,
      parsed.data.plan_tier_key,
      parsed.data.billing_period,
      parsed.data.success_url,
      parsed.data.cancel_url
    )
    return NextResponse.json({ checkout_url: checkoutUrl }, { status: 201 })
  } catch (err) {
    console.error('[admin/billing/plan-subscription] Failed to create plan subscription checkout session:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }, { status: 502 })
  }
}
