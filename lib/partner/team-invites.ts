import { clerkClient } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateInviteToken, hashInviteToken, inviteExpiresAt } from '@/lib/internal-admin/invite-tokens'
import { sendPartnerTeamInviteEmail } from '@/lib/delivery/email'

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §6.8) — a sales-partner's
 * own team invite flow. Reuses B2B-21's token-generation utility
 * (`lib/internal-admin/invite-tokens.ts`) verbatim, not a fork, per the
 * source brief's "do not reinvent token generation" instruction. This is a
 * new, small `partner_admin_users`-scoped invite mechanism, distinct from
 * B2B-21's `internal_admin_users` table — invitees here end up as
 * `partner_admin_users` rows on the sales-partner's own `partner_accounts`
 * row, not `internal_admin_users` rows.
 */

export interface TeamMemberRow {
  id: string
  clerkUserId: string
  email: string
  role: 'owner' | 'member'
}

export interface PendingInviteRow {
  id: string
  email: string
  invitedAt: string
}

/** Resolves a Clerk user's primary email address. Never throws — returns null on any lookup failure. */
async function resolveClerkEmail(clerkUserId: string): Promise<string | null> {
  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId)
    return clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress ?? null
  } catch (err) {
    console.error('[team-invites] Failed to resolve Clerk email for', clerkUserId, err)
    return null
  }
}

/**
 * Issues a new team invite. Checks (1) an existing `partner_admin_users` row
 * for this email on this account (resolved via a live Clerk lookup per
 * member — same accepted, precedented cost as
 * `inngest/partner-signup-reminder.ts`'s owner-email lookup, no caching
 * layer exists for this anywhere in the codebase today) and (2) an existing
 * `pending` `partner_team_invites` row for (partnerAccountId, lower(email)).
 * Either match returns `already_has_access` (§8) — deliberately the same
 * generic message for both cases, including the "inviting the account's own
 * owner" edge case (§9 Edge Case 6): no special-cased copy needed.
 */
export async function issueTeamInvite(
  partnerAccountId: string,
  email: string,
  invitedByClerkUserId: string
): Promise<{ success: boolean; error: 'already_has_access' | null }> {
  const supabase = createSupabaseAdminClient()
  const normalizedEmail = email.trim().toLowerCase()

  const { data: members } = await supabase
    .from('partner_admin_users')
    .select('clerk_user_id')
    .eq('partner_account_id', partnerAccountId)

  for (const member of members ?? []) {
    const memberEmail = await resolveClerkEmail(member.clerk_user_id as string)
    if (memberEmail && memberEmail.toLowerCase() === normalizedEmail) {
      return { success: false, error: 'already_has_access' }
    }
  }

  const { data: pendingInvite } = await supabase
    .from('partner_team_invites')
    .select('id')
    .eq('partner_account_id', partnerAccountId)
    .eq('status', 'pending')
    .ilike('email', normalizedEmail)
    .maybeSingle()

  if (pendingInvite) {
    return { success: false, error: 'already_has_access' }
  }

  const { token, tokenHash } = generateInviteToken()
  const expiresAt = inviteExpiresAt()

  const { error: insertError } = await supabase.from('partner_team_invites').insert({
    partner_account_id: partnerAccountId,
    email: normalizedEmail,
    role: 'member',
    status: 'pending',
    invited_by_clerk_user_id: invitedByClerkUserId,
    invite_token_hash: tokenHash,
    invite_token_expires_at: expiresAt,
  })

  if (insertError) {
    console.error('[team-invites] Failed to insert partner_team_invites row:', insertError.message)
    // Generic infra failure — not `already_has_access` (§8's only documented
    // error case for this function); the route handler treats
    // `success: false, error: null` as a 500, matching this codebase's
    // existing convention (e.g. `createOrClaimPartnerAccount`).
    return { success: false, error: null }
  }

  const [inviterEmail, account] = await Promise.all([
    resolveClerkEmail(invitedByClerkUserId),
    supabase.from('partner_accounts').select('name').eq('id', partnerAccountId).maybeSingle().then((r) => r.data),
  ])

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const acceptUrl = `${appUrl}/team-invite/accept?token=${token}`
  const companyName = (account?.name as string | undefined) ?? 'your team'

  const emailResult = await sendPartnerTeamInviteEmail(normalizedEmail, inviterEmail ?? 'A Clio sales-partner admin', companyName, acceptUrl)
  if (!emailResult.success) {
    console.error('[team-invites] sendPartnerTeamInviteEmail failed (non-blocking):', emailResult.error)
  }

  return { success: true, error: null }
}

/**
 * Mirrors `app/api/admin/team/invites/accept` POST exactly: hash token, look
 * up by `invite_token_hash` + `status='pending'` + unexpired; verify
 * `verifiedEmail` matches the row's email case-insensitively (State A3
 * otherwise); on match, in two sequential writes (matching this codebase's
 * existing no-DB-transaction discipline): update the invite to `accepted`,
 * then insert the `partner_admin_users` row (`role='member'`).
 */
export async function acceptTeamInvite(
  token: string,
  clerkUserId: string,
  verifiedEmail: string
): Promise<{ success: boolean; error: 'invalid_or_used_token' | 'email_mismatch' | null; partnerAccountId: string | null }> {
  const supabase = createSupabaseAdminClient()
  const tokenHash = hashInviteToken(token)

  const { data: row } = await supabase
    .from('partner_team_invites')
    .select('id, partner_account_id, email, invite_token_expires_at')
    .eq('invite_token_hash', tokenHash)
    .eq('status', 'pending')
    .maybeSingle()

  if (!row || !row.invite_token_expires_at || new Date(row.invite_token_expires_at as string) < new Date()) {
    return { success: false, error: 'invalid_or_used_token', partnerAccountId: null }
  }

  if (verifiedEmail.toLowerCase() !== (row.email as string).toLowerCase()) {
    return { success: false, error: 'email_mismatch', partnerAccountId: null }
  }

  const partnerAccountId = row.partner_account_id as string

  const { error: updateError } = await supabase
    .from('partner_team_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', row.id)

  if (updateError) {
    console.error('[team-invites] Failed to mark invite accepted:', updateError.message)
    return { success: false, error: 'invalid_or_used_token', partnerAccountId: null }
  }

  const { error: adminError } = await supabase
    .from('partner_admin_users')
    .insert({ clerk_user_id: clerkUserId, partner_account_id: partnerAccountId, role: 'member' })

  if (adminError) {
    console.error('[team-invites] Failed to insert partner_admin_users row on accept:', adminError.message)
    return { success: false, error: 'invalid_or_used_token', partnerAccountId: null }
  }

  return { success: true, error: null, partnerAccountId }
}

/**
 * Re-issues a fresh token + email for a still-pending invite. Ownership
 * check: the invite's `partner_account_id` must equal the caller's own
 * (enforced by the route handler via `requireChannelPartnerAdmin` before this
 * is called — this function itself also re-checks by filtering the UPDATE on
 * `partner_account_id`, defense in depth). Mirrors
 * `sales-partners/[id]/resend-invite`'s pattern.
 */
export async function resendTeamInvite(inviteId: string, partnerAccountId: string): Promise<{ success: boolean }> {
  const supabase = createSupabaseAdminClient()

  const { data: row } = await supabase
    .from('partner_team_invites')
    .select('id, email, invited_by_clerk_user_id, partner_account_id')
    .eq('id', inviteId)
    .eq('partner_account_id', partnerAccountId)
    .eq('status', 'pending')
    .maybeSingle()

  if (!row) {
    return { success: false }
  }

  const { token, tokenHash } = generateInviteToken()
  const expiresAt = inviteExpiresAt()

  const { error: updateError } = await supabase
    .from('partner_team_invites')
    .update({ invite_token_hash: tokenHash, invite_token_expires_at: expiresAt })
    .eq('id', inviteId)
    .eq('partner_account_id', partnerAccountId)

  if (updateError) {
    console.error('[team-invites] Failed to refresh invite token:', updateError.message)
    return { success: false }
  }

  const [inviterEmail, account] = await Promise.all([
    resolveClerkEmail(row.invited_by_clerk_user_id as string),
    supabase.from('partner_accounts').select('name').eq('id', partnerAccountId).maybeSingle().then((r) => r.data),
  ])

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const acceptUrl = `${appUrl}/team-invite/accept?token=${token}`
  const companyName = (account?.name as string | undefined) ?? 'your team'

  const emailResult = await sendPartnerTeamInviteEmail(row.email as string, inviterEmail ?? 'A Clio sales-partner admin', companyName, acceptUrl)
  if (!emailResult.success) {
    console.error('[team-invites] sendPartnerTeamInviteEmail (resend) failed (non-blocking):', emailResult.error)
  }

  return { success: true }
}

/** Revokes a still-pending invite. No-ops (returns success: false) if the invite isn't pending or doesn't belong to this account. */
export async function revokeTeamInvite(inviteId: string, partnerAccountId: string): Promise<{ success: boolean }> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_team_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)
    .eq('partner_account_id', partnerAccountId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error || !data) {
    return { success: false }
  }
  return { success: true }
}

/**
 * Reads `partner_admin_users` (role owner/member) for this account, resolving
 * each row's email via a live Clerk lookup (`partner_admin_users` stores only
 * `clerk_user_id`, never an email), plus `partner_team_invites` rows that are
 * still `pending` and unexpired.
 */
export async function listTeamAndInvites(
  partnerAccountId: string
): Promise<{ members: TeamMemberRow[]; pendingInvites: PendingInviteRow[] }> {
  const supabase = createSupabaseAdminClient()

  const { data: memberRows } = await supabase
    .from('partner_admin_users')
    .select('id, clerk_user_id, role')
    .eq('partner_account_id', partnerAccountId)

  const members: TeamMemberRow[] = []
  for (const row of memberRows ?? []) {
    const email = await resolveClerkEmail(row.clerk_user_id as string)
    members.push({
      id: row.id as string,
      clerkUserId: row.clerk_user_id as string,
      email: email ?? '(unknown)',
      role: row.role === 'owner' ? 'owner' : 'member',
    })
  }

  const { data: inviteRows } = await supabase
    .from('partner_team_invites')
    .select('id, email, created_at')
    .eq('partner_account_id', partnerAccountId)
    .eq('status', 'pending')
    .gt('invite_token_expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  const pendingInvites: PendingInviteRow[] = (inviteRows ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    invitedAt: row.created_at as string,
  }))

  return { members, pendingInvites }
}
