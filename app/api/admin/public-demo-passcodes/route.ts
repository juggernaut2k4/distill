import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { listPublicDemoPasscodesAndRedemptions } from '@/lib/demo/public-demo-passcodes'

/**
 * GET /api/admin/public-demo-passcodes — list every issued public $10 demo passcode and its
 * redemption log. DEMO-PASSCODE-01 (docs/specs/DEMO-PASSCODE-01-requirement-document.md §6.9).
 * `requireSuperAdmin()` only, byte-identical shape to app/api/admin/waitlist/route.ts.
 */
export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const { passcodes, redemptions } = await listPublicDemoPasscodesAndRedemptions()
  return NextResponse.json({ passcodes, redemptions })
}
