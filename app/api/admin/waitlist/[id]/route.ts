import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { deleteWaitlistSignup } from '@/lib/partner/waitlist'

/**
 * DELETE /api/admin/waitlist/:id — permanently delete one waitlist signup.
 * WAITLIST-01 (docs/specs/WAITLIST-01-requirement-document.md §6.3), modeled on
 * app/api/admin/partner-keys/[id]/route.ts's auth/404/200 shape, adapted to `requireSuperAdmin()`
 * since this is an internal-admin route, not a partner-scoped one.
 */

interface Params {
  params: { id: string }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const result = await deleteWaitlistSignup(params.id)
  if (!result.found) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Entry not found.' } }, { status: 404 })
  }
  if (!result.success) {
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to delete entry.' } }, { status: 500 })
  }
  return NextResponse.json({ success: true }, { status: 200 })
}
