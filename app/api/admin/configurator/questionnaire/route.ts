import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { listQuestionnaires, createQuestionnaire } from '@/lib/partner/questionnaire'

/**
 * GET  /api/admin/configurator/questionnaire?partner_account_id=... — list
 * POST /api/admin/configurator/questionnaire — create a new draft
 *
 * Requirement Doc Section 4.A.1/6.1; architecture.md Section 12.2. Every
 * route in this directory tree takes `partner_account_id` explicitly and
 * calls `requirePartnerAdmin()` before any DB access (Section 6.4's
 * isolation mechanism) — no exceptions.
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const questionnaires = await listQuestionnaires(partnerAccountId)
  return NextResponse.json({ questionnaires })
}

const CreateSchema = z.object({
  partner_account_id: z.string().uuid(),
  layout: z.enum(['single_page', 'multi_page']).optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const questionnaire = await createQuestionnaire(parsed.data.partner_account_id, parsed.data.layout ?? 'single_page')
  if (!questionnaire) return NextResponse.json({ error: 'Failed to create questionnaire' }, { status: 500 })

  return NextResponse.json({ questionnaire }, { status: 201 })
}
