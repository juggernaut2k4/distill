import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createTestBlockCheckoutSession } from '@/lib/stripe'

/**
 * POST /api/admin/billing/test-block
 *
 * docs/specs/B2B-08-requirement-document.md Section 4.D / 15.2 — purchases
 * one 120-minute test block ($1.80 fixed, Stripe Checkout `mode: "payment"`).
 * Clerk-authenticated, requires a `partner_admin_users` row for the target
 * account — identical auth pattern to the sibling
 * `POST /api/admin/billing/checkout` route (wallet top-up).
 *
 * B2B-21 Requirement Doc §7 note — now also accepts `requireSuperAdmin()` as
 * an alternate passing credential: this route is invoked from the
 * now-super-admin-gated `/dashboard/admin/clients` page by a super-admin who
 * is not necessarily a `partner_admin_users` member of the target account.
 * Safe per the CEO review — a super-admin is already maximally privileged,
 * and `requireSuperAdmin()` itself hard-rejects a scoped `sales_partner`.
 * `requirePartnerAdmin`'s own body/behavior is untouched (§12 hardest
 * constraint) — this is a pure OR-alternate, checked first, falling through
 * to the existing check unchanged.
 *
 * `createTestBlockCheckoutSession()` (lib/stripe.ts) and the webhook
 * completion branch that credits `partner_wallets.test_minutes_balance`
 * (app/api/webhooks/stripe/route.ts) already exist and are unchanged by
 * this route — this route only wires the previously-missing initiation leg.
 */

const TestBlockSchema = z.object({
  partner_account_id: z.string().uuid(),
  success_url: z.string().optional(),
  cancel_url: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = TestBlockSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  // Try requireSuperAdmin() first (§7 note); fall through to the existing,
  // byte-for-byte-unchanged requirePartnerAdmin() check if that fails.
  const superAdmin = await requireSuperAdmin()
  if (superAdmin.error) {
    const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
    if (admin.error) return admin.error
  }

  try {
    const checkoutUrl = await createTestBlockCheckoutSession(
      parsed.data.partner_account_id,
      parsed.data.success_url,
      parsed.data.cancel_url
    )
    return NextResponse.json({ checkout_url: checkoutUrl }, { status: 201 })
  } catch (err) {
    console.error('[admin/billing/test-block] Failed to create test-block checkout session:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }, { status: 502 })
  }
}
