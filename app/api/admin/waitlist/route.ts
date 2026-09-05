import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { listWaitlistSignups } from '@/lib/partner/waitlist'

/**
 * GET /api/admin/waitlist — list every waitlist signup.
 * WAITLIST-01 (docs/specs/WAITLIST-01-requirement-document.md §6.3). `requireSuperAdmin()` only,
 * byte-identical shape to app/api/admin/sales-partner-leads/route.ts.
 */
export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const signups = await listWaitlistSignups()
  return NextResponse.json({ signups })
}
