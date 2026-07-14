import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { unpublishQuestionnaire } from '@/lib/partner/questionnaire'

/**
 * POST /api/admin/configurator/questionnaire/:id/unpublish
 * Section 4.A.1's `[Unpublish]` list-view action — a small, natural
 * extension of the publish/draft state machine already specified (not in
 * architecture.md Section 12.2's literal route table, which enumerates
 * publish but not its inverse; added here since Section 4.A.1's own
 * wireframe requires it and the state transition is a strict subset of
 * publishQuestionnaire's already-specified logic).
 */

const BodySchema = z.object({ partner_account_id: z.string().uuid() })

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const ok = await unpublishQuestionnaire(parsed.data.partner_account_id, params.id)
  if (!ok) return NextResponse.json({ error: 'unpublish_failed' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
