import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { submitQuestionnaireAnswers } from '@/lib/partner/questionnaire'

/**
 * POST /partner-questionnaire/[partner_account_id]/submit
 *
 * Requirement Doc Section 6.1/12.3 — forwards synchronously to
 * `{outbound_base_url}/questionnaire-response`, never persisted. No auth
 * (matches the render page itself — Clio has no end-user-identity model,
 * per the Non-Negotiable Data Boundary).
 */

const SubmitSchema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.boolean()])),
})

export async function POST(request: NextRequest, { params }: { params: { partner_account_id: string } }) {
  const partnerAccountId = params.partner_account_id
  if (!z.string().uuid().safeParse(partnerAccountId).success) {
    return NextResponse.json({ error: 'invalid_partner_account_id' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  const parsed = SubmitSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const result = await submitQuestionnaireAnswers(partnerAccountId, parsed.data.answers)

  if (!result.ok) {
    return NextResponse.json({ error: 'delivery_failed' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
