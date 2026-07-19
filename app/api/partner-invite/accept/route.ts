import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth as clerkAuth, currentUser } from '@clerk/nextjs/server'
import { createOrClaimPartnerAccount } from '@/lib/partner/signup'
import { lookupDirectPartnerInviteByToken, markDirectPartnerInviteAccepted } from '@/lib/internal-admin/direct-partner-invites'

/**
 * GET/POST /api/partner-invite/accept
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §6.5). GET is an
 * unauthenticated, no-info-leak token lookup (mirrors
 * /api/team-invite/accept's own GET exactly) — no companyName/email in the
 * response, since unlike a team invite there is nothing pre-known about the
 * invitee to show them. POST is the authenticated accept, third caller of
 * createOrClaimPartnerAccount.
 */

const AcceptSchema = z.object({
  token: z.string().min(1),
  companyName: z.string().trim().min(1).max(200),
})

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? ''
  const { valid } = await lookupDirectPartnerInviteByToken(token)
  return NextResponse.json({ valid })
}

export async function POST(request: NextRequest) {
  const { userId } = clerkAuth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 422 })
  }

  const parsed = AcceptSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const { valid, inviteId } = await lookupDirectPartnerInviteByToken(parsed.data.token)
  if (!valid || !inviteId) {
    return NextResponse.json({ error: 'This invite link is no longer valid.' }, { status: 422 })
  }

  const user = await currentUser()
  const primaryEmail = user?.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
  if (!primaryEmail) {
    console.error('[partner-invite/accept] No primary email for Clerk user', userId)
    return NextResponse.json({ success: false, error: 'Failed to set up your account.' }, { status: 500 })
  }

  const result = await createOrClaimPartnerAccount(userId, parsed.data.companyName, primaryEmail, 'partner')
  if (!result.success) {
    console.error('[partner-invite/accept] createOrClaimPartnerAccount failed:', result.error)
    return NextResponse.json({ success: false, error: 'Failed to set up your account.' }, { status: 500 })
  }

  // §9 Edge Case 1 — an already-member visitor: the invite must NOT be marked
  // accepted (no new account was created through it — it stays pending for
  // someone else to use), and the client must show the distinct
  // 'already-member' state, not a false "success."
  if (result.alreadyMember) {
    return NextResponse.json({ success: true, alreadyMember: true, accountKind: result.accountKind })
  }

  await markDirectPartnerInviteAccepted(inviteId, result.partnerAccountId as string)
  return NextResponse.json({ success: true, alreadyMember: false, accountKind: result.accountKind })
}
