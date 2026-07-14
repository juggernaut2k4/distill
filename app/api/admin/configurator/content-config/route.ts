import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getContentSource, setContentSource, listContentItems } from '@/lib/partner/content-generation'

/** GET/PATCH /api/admin/configurator/content-config — Section 4.A.3's source toggle + item list. */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const [contentSource, items] = await Promise.all([
    getContentSource(partnerAccountId),
    listContentItems(partnerAccountId),
  ])

  return NextResponse.json({ content_source: contentSource, items })
}

const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  content_source: z.enum(['clio_generated', 'partner_supplied']),
})

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await setContentSource(parsed.data.partner_account_id, parsed.data.content_source)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })

  return NextResponse.json({ content_source: result.data })
}
