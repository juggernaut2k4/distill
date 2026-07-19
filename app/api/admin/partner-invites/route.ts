import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { listDirectPartnerInvites, issueDirectPartnerInvite } from '@/lib/internal-admin/direct-partner-invites'

/**
 * GET  /api/admin/partner-invites — list every direct-partner invite.
 * POST /api/admin/partner-invites — generate a new single-use invite link.
 *
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §6.3). `requireSuperAdmin()` only.
 */

const IssueSchema = z.object({ label: z.string().trim().max(200).optional().nullable() })

export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const invites = await listDirectPartnerInvites()
  return NextResponse.json({ invites })
}

export async function POST(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const parsed = IssueSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const result = await issueDirectPartnerInvite(parsed.data.label ?? null, admin.internalAdminUserId as string)
  if (!result.success) {
    console.error('[admin/partner-invites] Failed to issue invite:', result.error)
    return NextResponse.json({ error: "Couldn't generate this invite. Try again." }, { status: 500 })
  }

  return NextResponse.json({ acceptUrl: result.acceptUrl }, { status: 201 })
}
