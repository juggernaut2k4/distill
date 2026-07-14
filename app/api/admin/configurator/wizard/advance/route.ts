import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { advanceWizardStep, serializeWizardProgress } from '@/lib/partner/wizard'

/** POST /api/admin/configurator/wizard/advance — Requirement Doc 13.4.A/13.10/14.7.3. */

const BodySchema = z.object({
  partner_account_id: z.string().uuid(),
  step: z.enum(['questionnaire', 'topics', 'content', 'visualization', 'domain', 'payment']),
  action: z.enum(['complete', 'skip']),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await advanceWizardStep(parsed.data.partner_account_id, parsed.data.step, parsed.data.action)

  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code } }, { status: result.status })
  }

  return NextResponse.json(serializeWizardProgress(result.data))
}
