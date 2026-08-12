import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { markSalesPartnerLeadContacted } from '@/lib/partner/sales-partner-leads'

/**
 * POST /api/admin/sales-partner-leads/[id]/contact — "Mark contacted", a plain status update, no
 * confirmation (B2B-80 §4.B). Mirrors app/api/admin/partner-invites/[id]/revoke/route.ts's shape.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const result = await markSalesPartnerLeadContacted(params.id)
  if (!result.success) {
    return NextResponse.json({ error: "Couldn't update this lead. Try again." }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
