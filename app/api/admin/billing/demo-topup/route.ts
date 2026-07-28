import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createDemoTopupCheckoutSession, DEMO_TOPUP_TIERS } from '@/lib/stripe'
import { DEMO_ADMIN_PARTNER_ACCOUNT_ID } from '@/lib/demo/passcode-accounts'

/**
 * POST /api/admin/billing/demo-topup
 *
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §4.C, §6, AT-8). Admin equivalent of
 * `/api/channel-partner/billing/demo-topup` — `requireSuperAdmin()`-gated, always targeting the
 * fixed "Clio Internal — Public Demo" sentinel account.
 */
const Schema = z.object({
  tier: z.enum(Object.keys(DEMO_TOPUP_TIERS) as [keyof typeof DEMO_TOPUP_TIERS, ...(keyof typeof DEMO_TOPUP_TIERS)[]]),
  success_url: z.string().optional(),
  cancel_url: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const body = await request.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const checkoutUrl = await createDemoTopupCheckoutSession(
      DEMO_ADMIN_PARTNER_ACCOUNT_ID,
      parsed.data.tier,
      parsed.data.success_url,
      parsed.data.cancel_url
    )
    return NextResponse.json({ checkout_url: checkoutUrl }, { status: 201 })
  } catch (err) {
    console.error('[admin/billing/demo-topup] Failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }, { status: 502 })
  }
}
