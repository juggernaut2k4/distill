import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { approveContentItem } from '@/lib/partner/content-generation'

/**
 * POST /api/admin/configurator/content/:id/approve
 * Section 4.A.3/6.3 — pushes via `pushPartnerContent()`, mints `content_ref`,
 * nulls `draft_payload` in the same write on success (Section 7's acceptance
 * test). On push failure: inline error, draft stays intact for retry.
 */

const BodySchema = z.object({ partner_account_id: z.string().uuid() })

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await approveContentItem(parsed.data.partner_account_id, params.id)
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'not_ready_for_review' ? 409 : 502
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({ content_ref: result.contentRef })
}
