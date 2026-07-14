import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { publishQuestionnaire } from '@/lib/partner/questionnaire'

/**
 * POST /api/admin/configurator/questionnaire/:id/publish
 * Section 4.A.1/6.1/8 — 422 if the target has zero questions; otherwise
 * enforces the single-published-per-partner invariant.
 */

const BodySchema = z.object({ partner_account_id: z.string().uuid() })

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await publishQuestionnaire(parsed.data.partner_account_id, params.id)
  if (!result.ok) {
    const status = result.error === 'no_questions' ? 422 : result.error === 'not_found' ? 404 : 500
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({ questionnaire: result.data })
}
