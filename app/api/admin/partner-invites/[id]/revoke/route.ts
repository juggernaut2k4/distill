import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { revokeDirectPartnerInvite } from '@/lib/internal-admin/direct-partner-invites'

/**
 * POST /api/admin/partner-invites/[id]/revoke
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §6.4). No confirmation
 * dialog, matching this codebase's existing convention. Only a genuinely
 * pending (not expired/accepted/already-revoked) row may be revoked.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const result = await revokeDirectPartnerInvite(params.id)
  if (!result.success) {
    return NextResponse.json({ error: 'This invite is no longer pending.' }, { status: 409 })
  }
  return NextResponse.json({ revoked: true })
}
