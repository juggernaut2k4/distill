import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getDomainSettings, serializeDomainSettings } from '@/lib/partner/domain-settings'

/** GET /api/admin/configurator/domain — Requirement Doc 4.B.1. */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const settings = await getDomainSettings(partnerAccountId)
  if (!settings) return NextResponse.json({ error: 'partner_account_id not found' }, { status: 400 })

  return NextResponse.json(serializeDomainSettings(settings))
}
