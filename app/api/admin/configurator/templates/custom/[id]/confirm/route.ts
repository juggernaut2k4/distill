import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { confirmCustomTemplate } from '@/lib/partner/custom-templates'
import { recordPreferenceSignal } from '@/lib/partner/preference'

/**
 * POST /api/admin/configurator/templates/custom/:id/confirm
 * Section 6.4/11 Q1 — the partner-admin's own explicit `[Confirm & make
 * live]` click. No Clio-side check, no second-approver requirement — any
 * admin who passes `requirePartnerAdmin()` for this account may confirm.
 */

const BodySchema = z.object({ partner_account_id: z.string().uuid() })

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await confirmCustomTemplate(parsed.data.partner_account_id, params.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 })

  await recordPreferenceSignal(parsed.data.partner_account_id, { kind: 'ai_accepted_without_change' })

  return NextResponse.json({ custom_template: result.data })
}
