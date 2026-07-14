import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getQuestionnaire, updateQuestionnaire, validateQuestionnaireSchema } from '@/lib/partner/questionnaire'

const QuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(200),
  type: z.enum(['multiple_choice', 'short_text', 'yes_no']),
  options: z.array(z.string().min(1).max(60)).min(2).max(8).optional(),
  required: z.boolean(),
})

const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  layout: z.enum(['single_page', 'multi_page']).optional(),
  schema: z.array(QuestionSchema).optional(),
})

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const questionnaire = await getQuestionnaire(partnerAccountId, params.id)
  if (!questionnaire) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ questionnaire })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  if (parsed.data.schema && !validateQuestionnaireSchema(parsed.data.schema)) {
    return NextResponse.json({ error: 'invalid_schema' }, { status: 422 })
  }

  const result = await updateQuestionnaire(parsed.data.partner_account_id, params.id, {
    layout: parsed.data.layout,
    schema: parsed.data.schema,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === 'invalid_schema' ? 422 : 404 })
  return NextResponse.json({ questionnaire: result.data })
}
