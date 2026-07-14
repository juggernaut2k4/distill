import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { recheckCustomDomain, serializeDomainSettings } from '@/lib/partner/domain-settings'

/** POST /api/admin/configurator/domain/custom-domain/recheck — Requirement Doc 4.B.5. */

const BodySchema = z.object({ partner_account_id: z.string().uuid() })

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await recheckCustomDomain(parsed.data.partner_account_id)
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code } }, { status: 404 })
  }

  return NextResponse.json(serializeDomainSettings(result.data))
}
