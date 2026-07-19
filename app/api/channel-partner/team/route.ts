import { NextResponse } from 'next/server'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { listTeamAndInvites } from '@/lib/partner/team-invites'

/**
 * GET /api/channel-partner/team
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §6.8, §12). Lists the
 * caller's own sales-partner account's team members (`partner_admin_users`)
 * and still-pending, unexpired invites (`partner_team_invites`).
 */
export async function GET() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const { members, pendingInvites } = await listTeamAndInvites(admin.partnerAccountId)
  return NextResponse.json({ members, pendingInvites })
}
