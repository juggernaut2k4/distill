import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getContentItem } from '@/lib/partner/content-generation'

/** GET /api/admin/configurator/content/:id — polled every 5s while status='generating' (Section 4.A.3). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const item = await getContentItem(partnerAccountId, params.id)
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ item })
}
