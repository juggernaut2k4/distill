import { NextResponse } from 'next/server'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { recheckCustomDomain, serializeDomainSettings } from '@/lib/partner/domain-settings'

/**
 * POST /api/channel-partner/domain/custom-domain/recheck — the "Verify" button.
 *
 * B2B-79 (docs/specs/B2B-79-requirement-document.md §6.2). Synchronous check-on-click, mirroring
 * the existing direct-partner mechanism exactly (§6.2's own resolution of Brief §6 Q3) — a single
 * Vercel API round-trip, no background job or polling loop.
 */
export async function POST() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const result = await recheckCustomDomain(admin.partnerAccountId)
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code } }, { status: 404 })
  }

  return NextResponse.json(serializeDomainSettings(result.data))
}
