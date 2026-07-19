import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { issueTeamInvite } from '@/lib/partner/team-invites'

/**
 * POST /api/channel-partner/team/invite
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §6.8, §7 AT-12, §8).
 * Issues a new team invite for the caller's own sales-partner account.
 */

const InviteSchema = z.object({
  email: z.string().trim().email(),
})

export async function POST(request: NextRequest) {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 422 })
  }

  const parsed = InviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const result = await issueTeamInvite(admin.partnerAccountId, parsed.data.email, admin.clerkUserId)

  if (!result.success) {
    if (result.error === 'already_has_access') {
      return NextResponse.json({ error: 'This person already has access or a pending invite.' }, { status: 409 })
    }
    return NextResponse.json({ error: "Couldn't send invite. Try again." }, { status: 500 })
  }

  return NextResponse.json({ success: true }, { status: 201 })
}
