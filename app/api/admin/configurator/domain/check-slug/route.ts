import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { checkSlugAvailability } from '@/lib/partner/domain-settings'

/**
 * GET /api/admin/configurator/domain/check-slug — Requirement Doc 4.B.2.
 * Never errors on an unavailable slug — unavailability is a normal `200`
 * outcome, not a `4xx`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  const slug = searchParams.get('slug')
  if (!partnerAccountId || !slug) {
    return NextResponse.json({ error: 'partner_account_id and slug query params are required' }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const result = await checkSlugAvailability(partnerAccountId, slug.toLowerCase())
  return NextResponse.json(result)
}
