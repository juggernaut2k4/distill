import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { rejectContentItem } from '@/lib/partner/content-generation'

/**
 * POST /api/admin/configurator/content/:id/reject
 * Serves both Section 4.A.3's `[Regenerate]`-precursor rejection and the
 * UI's `[Discard]` action (both null `draft_payload` and mark the row
 * non-live — architecture.md Section 12.2 defines only `reject` as the
 * backend action; the UI's Discard button calls this same endpoint).
 */

const BodySchema = z.object({ partner_account_id: z.string().uuid() })

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const ok = await rejectContentItem(parsed.data.partner_account_id, params.id)
  if (!ok) return NextResponse.json({ error: 'reject_failed' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
