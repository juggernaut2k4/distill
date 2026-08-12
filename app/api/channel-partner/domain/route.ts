import { NextResponse } from 'next/server'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { getDomainSettings, serializeDomainSettings } from '@/lib/partner/domain-settings'

/**
 * GET /api/channel-partner/domain — B2B-79 (docs/specs/B2B-79-requirement-document.md §6.2).
 * Thin wrapper over the existing `lib/partner/domain-settings.ts`, swapping
 * `requirePartnerAdmin(partner_account_id)` for `requireChannelPartnerAdmin()` (resolves the
 * account from the Clerk session, no id param needed) — structurally identical to
 * `/api/admin/configurator/domain`. Zero new domain logic.
 */
export async function GET() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const settings = await getDomainSettings(admin.partnerAccountId)
  if (!settings) return NextResponse.json({ error: 'Account not found' }, { status: 400 })

  return NextResponse.json(serializeDomainSettings(settings))
}
