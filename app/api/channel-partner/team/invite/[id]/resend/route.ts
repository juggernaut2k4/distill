import { NextRequest, NextResponse } from 'next/server'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { resendTeamInvite } from '@/lib/partner/team-invites'

/**
 * POST /api/channel-partner/team/invite/[id]/resend
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §7 AT-16, §8). Re-issues
 * a fresh token + email for a still-pending invite on the caller's own
 * account. 404 (not 403) if the invite id doesn't belong to the caller's
 * account — no info leak about whether the id exists under another account.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const result = await resendTeamInvite(params.id, admin.partnerAccountId)
  if (!result.success) {
    return NextResponse.json({ error: 'Invite not found.' }, { status: 404 })
  }

  return NextResponse.json({ resent: true })
}
