import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getTopicConfig, upsertTopicConfig } from '@/lib/partner/topics-config'

/** GET/PATCH /api/admin/configurator/topics-config — Section 4.A.2/6.2, two independent toggles. */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const config = await getTopicConfig(partnerAccountId)
  return NextResponse.json({ config })
}

const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  topics_source: z.enum(['clio_generated', 'partner_supplied']).optional(),
  prerequisites_source: z.enum(['clio_generated', 'partner_supplied']).optional(),
})

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await upsertTopicConfig(parsed.data.partner_account_id, {
    topicsSource: parsed.data.topics_source,
    prerequisitesSource: parsed.data.prerequisites_source,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })

  return NextResponse.json({ config: result.data })
}
