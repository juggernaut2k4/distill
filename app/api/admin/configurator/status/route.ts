import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getConfiguratorStatus } from '@/lib/partner/configurator-status'

/**
 * GET /api/admin/configurator/status?partner_account_id=... — B2B-20 §6.1.
 *
 * Thin aggregator returning the live completion map for the Configurator
 * left-nav dots. Composes the existing `checkStepComplete()` existence checks
 * plus the Integration OAuth-count rule (`lib/partner/configurator-status.ts`).
 * Auth is `requirePartnerAdmin`, identical to every other configurator admin
 * route.
 */
export async function GET(request: NextRequest) {
  const partnerAccountId = request.nextUrl.searchParams.get('partner_account_id')
  if (!partnerAccountId) {
    return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const status = await getConfiguratorStatus(partnerAccountId)
  return NextResponse.json(status)
}
