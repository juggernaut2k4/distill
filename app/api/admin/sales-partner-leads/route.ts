import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { listSalesPartnerLeads } from '@/lib/partner/sales-partner-leads'

/**
 * GET /api/admin/sales-partner-leads — list every sales-partner inquiry lead.
 * B2B-80 (docs/specs/B2B-80-requirement-document.md §4.B). `requireSuperAdmin()` only,
 * mirrors app/api/admin/partner-invites/route.ts's gate.
 */
export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const leads = await listSalesPartnerLeads()
  return NextResponse.json({ leads })
}
