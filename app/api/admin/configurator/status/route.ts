import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getConfiguratorStatus, checkCardOnFile } from '@/lib/partner/configurator-status'

/**
 * GET /api/admin/configurator/status?partner_account_id=... — B2B-20 §6.1.
 *
 * Thin aggregator returning the live completion map for the Configurator
 * left-nav dots. Composes the existing `checkStepComplete()` existence checks
 * for all seven sections (`lib/partner/configurator-status.ts`) — Integration
 * reads through the same `checkStepComplete()` case the Go-Live gate uses
 * (B2B-23 §6.3), so the nav dot and the server gate can never drift apart.
 * Auth is `requirePartnerAdmin`, identical to every other configurator admin
 * route.
 *
 * B2B-27 — additive `card_on_file` sibling field (NOT part of the typed
 * `ConfiguratorStatus` object): true when
 * `partner_wallets.stripe_default_payment_method_id IS NOT NULL`. Deliberately
 * kept separate from `payment` (which reads `funding_mechanism`) — see
 * lib/partner/configurator-status.ts's `checkCardOnFile` doc comment. No
 * existing consumer of this endpoint (nav dots, GoLivePanel) reads or is
 * affected by an unrecognized extra field.
 */
export async function GET(request: NextRequest) {
  const partnerAccountId = request.nextUrl.searchParams.get('partner_account_id')
  if (!partnerAccountId) {
    return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const [status, cardOnFile] = await Promise.all([
    getConfiguratorStatus(partnerAccountId),
    checkCardOnFile(partnerAccountId),
  ])
  return NextResponse.json({ ...status, card_on_file: cardOnFile })
}
