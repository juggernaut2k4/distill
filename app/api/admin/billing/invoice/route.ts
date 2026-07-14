import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createEnterpriseInvoice, getOrCreateStripeCustomer } from '@/lib/stripe'

/**
 * POST /api/admin/billing/invoice
 *
 * B2B-04 Requirement Doc Section 4.B.5 / 5.B.4 — enterprise invoicing.
 * NOT partner-self-serve — enterprise deals are negotiated manually, so this
 * route is called by Clio's own ops (Arun), gated the same way as
 * `GET /api/admin/billing/clients` (any signed-in Clerk user, matching the
 * `/dashboard/admin/templates` authorization boundary — a stricter
 * internal-staff-only gate is a cross-cutting future enhancement, not
 * unique to this route, per Requirement Doc Section 4.B.5).
 */

const InvoiceSchema = z.object({
  partner_account_id: z.string().uuid(),
  amount_usd: z.number().positive(),
  description: z.string().min(1),
  collection_method: z.enum(['send_invoice', 'charge_automatically']),
})

export async function POST(request: NextRequest) {
  const { error: authError } = requireAuth()
  if (authError) return authError

  const body = await request.json().catch(() => null)
  const parsed = InvoiceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const stripeCustomerId = await getOrCreateStripeCustomer(parsed.data.partner_account_id)
    const invoice = await createEnterpriseInvoice(
      parsed.data.partner_account_id,
      parsed.data.amount_usd,
      stripeCustomerId,
      parsed.data.description,
      parsed.data.collection_method
    )
    return NextResponse.json({ invoice_id: invoice.invoiceId, hosted_invoice_url: invoice.hostedInvoiceUrl }, { status: 201 })
  } catch (err) {
    console.error('[admin/billing/invoice] Failed to create enterprise invoice:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'stripe_error', message: 'Failed to create invoice.' } }, { status: 502 })
  }
}
