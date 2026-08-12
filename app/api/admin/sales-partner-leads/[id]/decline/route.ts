import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { declineSalesPartnerLead } from '@/lib/partner/sales-partner-leads'

/**
 * POST /api/admin/sales-partner-leads/[id]/decline — sets status='declined', no confirmation
 * dialog, reversible only by re-contacting the lead through "Invite" later (B2B-80 §4.B).
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const result = await declineSalesPartnerLead(params.id)
  if (!result.success) {
    return NextResponse.json({ error: "Couldn't update this lead. Try again." }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
