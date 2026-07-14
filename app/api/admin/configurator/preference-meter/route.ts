import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getPreferenceMeter } from '@/lib/partner/preference'

/**
 * GET /api/admin/configurator/preference-meter?partner_account_id=...
 * Section 4.A.0/6.5/7 — a fresh partner account with zero Configurator
 * activity returns `score=0, domains_touched=[]` (Section 7's acceptance
 * test — the meter starts genuinely cold).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const meter = await getPreferenceMeter(partnerAccountId)
  return NextResponse.json({ meter })
}
