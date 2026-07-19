import { NextResponse } from 'next/server'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { checkCardOnFile } from '@/lib/partner/configurator-status'

/**
 * GET /api/channel-partner/billing/card-status
 *
 * Hotfix (2026-07-19), split out of GET /api/channel-partner/account so the
 * Settings page's Company-info fields and Payment card load independently —
 * see that route's own comment for why. Reuses `checkCardOnFile`, already
 * fully generic over any `partner_account_id`.
 */
export async function GET() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const cardOnFile = await checkCardOnFile(admin.partnerAccountId)
  return NextResponse.json({ card_on_file: cardOnFile })
}
