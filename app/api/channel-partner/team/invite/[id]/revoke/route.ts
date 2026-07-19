import { NextRequest, NextResponse } from 'next/server'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { revokeTeamInvite } from '@/lib/partner/team-invites'

/**
 * POST /api/channel-partner/team/invite/[id]/revoke
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §7 AT-17, §8). Revokes a
 * still-pending invite on the caller's own account. No confirmation dialog
 * (matches this codebase's existing no-confirm-dialog convention for
 * equivalent B2B-21 actions). 409 no-op if the invite is no longer pending.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const result = await revokeTeamInvite(params.id, admin.partnerAccountId)
  if (!result.success) {
    return NextResponse.json({ error: 'This invite is no longer pending.' }, { status: 409 })
  }

  return NextResponse.json({ revoked: true })
}
