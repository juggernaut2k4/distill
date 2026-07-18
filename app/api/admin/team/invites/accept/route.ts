import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth as clerkAuth, currentUser as clerkCurrentUser } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { hashInviteToken } from '@/lib/internal-admin/invite-tokens'
import { internalAdminErrorEnvelope } from '@/lib/internal-admin/auth'

/**
 * POST /api/admin/team/invites/accept
 *
 * B2B-21 Requirement Doc §6.4 / §4.C — called from the public
 * `/invite/accept` page, itself gated by requiring an active Clerk session
 * (no new anonymous-write surface). Hashes the token, looks up by
 * invite_token_hash + unexpired + status='pending' + clerk_user_id IS NULL;
 * verifies the now-authenticated Clerk user's primary verified email matches
 * the row's email case-insensitively (State A3 otherwise, §9 email_mismatch);
 * on match, binds clerk_user_id, sets status='active', clears the token
 * (single-use).
 */

const AcceptSchema = z.object({
  token: z.string().trim().min(1),
})

/**
 * GET /api/admin/team/invites/accept?token=...
 *
 * Unauthenticated, token-gated lookup backing State A1 of `/invite/accept`
 * (Requirement Doc §4.C) — the page must show the invited email address and
 * role-branded copy ("as a sales partner" / "as a super-admin") BEFORE the
 * visitor signs in, which is otherwise impossible since the accept POST
 * itself requires an authenticated session. Returns only the two fields
 * already known to whoever holds the unguessable 48-hex-char bearer token
 * (the same two facts already sent to them in the invite email) — no
 * partner names, no other user data. Same invalid/expired/consumed
 * no-info-leak discipline as POST (§9).
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim()
  if (!token) {
    return NextResponse.json({ valid: false }, { status: 200 })
  }

  const tokenHash = hashInviteToken(token)
  const supabase = createSupabaseAdminClient()

  const { data: row } = await supabase
    .from('internal_admin_users')
    .select('email, role, status, invite_token_expires_at')
    .eq('invite_token_hash', tokenHash)
    .eq('status', 'pending')
    .is('clerk_user_id', null)
    .maybeSingle()

  if (!row || !row.invite_token_expires_at || new Date(row.invite_token_expires_at as string) < new Date()) {
    return NextResponse.json({ valid: false }, { status: 200 })
  }

  return NextResponse.json({ valid: true, email: row.email, role: row.role })
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
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = AcceptSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const tokenHash = hashInviteToken(parsed.data.token)
  const supabase = createSupabaseAdminClient()

  const { data: row, error: lookupError } = await supabase
    .from('internal_admin_users')
    .select('id, email, role, status, invite_token_expires_at, clerk_user_id')
    .eq('invite_token_hash', tokenHash)
    .eq('status', 'pending')
    .is('clerk_user_id', null)
    .maybeSingle()

  if (lookupError) {
    console.error('[admin/team/invites/accept] Failed to look up invite:', lookupError.message)
    return NextResponse.json(internalAdminErrorEnvelope('invalid_or_used_token', 'This invite link is no longer valid.'), { status: 422 })
  }

  // Same code for not-found / expired / already-used — no info leak about *why* it failed (§9).
  if (!row || !row.invite_token_expires_at || new Date(row.invite_token_expires_at as string) < new Date()) {
    return NextResponse.json(internalAdminErrorEnvelope('invalid_or_used_token', 'This invite link is no longer valid.'), { status: 422 })
  }

  const clerkUser = await clerkCurrentUser()
  const primaryEmailEntry = clerkUser?.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
  const isVerified = primaryEmailEntry?.verification?.status === 'verified'
  const currentEmail = isVerified ? primaryEmailEntry?.emailAddress : null

  if (!currentEmail || currentEmail.toLowerCase() !== (row.email as string).toLowerCase()) {
    return NextResponse.json(
      internalAdminErrorEnvelope('email_mismatch', `You're signed in as a different email than this invite was sent to.`),
      { status: 409 }
    )
  }

  const { error: updateError } = await supabase
    .from('internal_admin_users')
    .update({
      clerk_user_id: userId,
      status: 'active',
      accepted_at: new Date().toISOString(),
      invite_token_hash: null,
      invite_token_expires_at: null,
    })
    .eq('id', row.id)

  if (updateError) {
    console.error('[admin/team/invites/accept] Failed to bind invite:', updateError.message)
    return NextResponse.json({ error: 'Could not accept the invite.' }, { status: 500 })
  }

  return NextResponse.json({ accepted: true, role: row.role })
}
