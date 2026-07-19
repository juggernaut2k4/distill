import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth as clerkAuth, currentUser as clerkCurrentUser } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { hashInviteToken } from '@/lib/internal-admin/invite-tokens'
import { acceptTeamInvite } from '@/lib/partner/team-invites'

/**
 * GET/POST /api/team-invite/accept
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §4, §6.8, §7 AT-13/14,
 * §8). Mirrors `app/api/admin/team/invites/accept` exactly (unauthenticated
 * token-gated GET lookup for the pre-sign-in state; authenticated POST to
 * bind the invite). Same no-info-leak discipline: invalid/expired/consumed
 * tokens all resolve identically.
 */

const AcceptSchema = z.object({
  token: z.string().trim().min(1),
})

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim()
  if (!token) {
    return NextResponse.json({ valid: false }, { status: 200 })
  }

  const tokenHash = hashInviteToken(token)
  const supabase = createSupabaseAdminClient()

  const { data: row } = await supabase
    .from('partner_team_invites')
    .select('email, invite_token_expires_at, partner_account_id')
    .eq('invite_token_hash', tokenHash)
    .eq('status', 'pending')
    .maybeSingle()

  if (!row || !row.invite_token_expires_at || new Date(row.invite_token_expires_at as string) < new Date()) {
    return NextResponse.json({ valid: false }, { status: 200 })
  }

  const { data: account } = await supabase
    .from('partner_accounts')
    .select('name')
    .eq('id', row.partner_account_id as string)
    .maybeSingle()

  return NextResponse.json({ valid: true, email: row.email, companyName: (account?.name as string | undefined) ?? '' })
}

export async function POST(request: NextRequest) {
  const { userId } = clerkAuth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body', message: 'Invalid JSON body' } }, { status: 400 })
  }

  const parsed = AcceptSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'validation_failed', message: 'Invalid request.' } }, { status: 400 })
  }

  const clerkUser = await clerkCurrentUser()
  const primaryEmailEntry = clerkUser?.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
  const isVerified = primaryEmailEntry?.verification?.status === 'verified'
  // Deliberately NOT short-circuited on a missing/unverified email before the
  // token lookup — mirrors app/api/admin/team/invites/accept's ordering
  // exactly: token validity/expiry is checked first (inside
  // acceptTeamInvite), email match second, so an invalid token is always
  // reported as invalid_or_used_token rather than a misleading
  // email_mismatch when both conditions happen to be true at once.
  const currentEmail = isVerified ? primaryEmailEntry?.emailAddress ?? '' : ''

  const result = await acceptTeamInvite(parsed.data.token, userId, currentEmail)

  if (!result.success) {
    if (result.error === 'email_mismatch') {
      return NextResponse.json({ error: { code: 'email_mismatch', message: "You're signed in as a different email than this invite was sent to." } }, { status: 409 })
    }
    return NextResponse.json({ error: { code: 'invalid_or_used_token', message: 'This invite link is no longer valid.' } }, { status: 422 })
  }

  return NextResponse.json({ accepted: true })
}
