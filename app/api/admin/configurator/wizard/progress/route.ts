import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getOrCreateWizardProgress, serializeWizardProgress } from '@/lib/partner/wizard'

/** GET /api/admin/configurator/wizard/progress — Requirement Doc 14.7.3. */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const progress = await getOrCreateWizardProgress(partnerAccountId)
  return NextResponse.json(serializeWizardProgress(progress))
}
